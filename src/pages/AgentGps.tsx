import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/providers/trpc";
import { useTranslate } from "@/i18n";
import { MapPin, Radio, CheckCircle2, AlertCircle, Loader2, RefreshCw, Navigation } from "lucide-react";
import { format } from "date-fns";
import { plural } from "@/lib/plural";

type GpsState = "idle" | "locating" | "success" | "error";

/**
 * Как часто авто-трекинг шлёт точку.
 *
 * Названо числом здесь и подставляется в подпись на экране — чтобы обещание
 * и поведение не могли разойтись. До этого подпись обещала две минуты, а код
 * слал по КАЖДОМУ изменению положения (watchPosition): идущий агент отправлял
 * точку по нескольку раз в минуту.
 *
 * Пять минут — столько же, сколько шлёт мобильное приложение. Менять эту
 * величину надо в обоих местах сразу, иначе супервайзер получит от телефона и
 * от браузера разную частоту следа.
 */
const AUTO_TRACK_MS = 5 * 60 * 1000;
const AUTO_TRACK_MIN = AUTO_TRACK_MS / 60_000;

/* ═══════════════════════════════════════════════════════════════════════════
   Две разные съёмки — и разница между ними это батарея телефона.

   Ручная: человек нажал кнопку и ждёт точность. Включаем спутниковый приёмник
   и берём свежую точку.

   Автоматическая: точка нужна супервайзеру, чтобы понимать, где агент. Здесь
   спутники не нужны вовсе — хватает положения по вышкам и Wi-Fi (это десятки
   метров в городе), а оно берётся почти даром. И если система УЖЕ знает, где
   телефон, свежее минуты, берём готовое: тогда съёмки не происходит совсем.

   До этого автоматический режим шёл с enableHighAccuracy и maximumAge: 0 —
   то есть будил приёмник на каждой отправке и запрещал брать готовое. Именно
   это и сажало батарею.
   ═══════════════════════════════════════════════════════════════════════════ */
const MANUAL_FIX: PositionOptions = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 };
const AUTO_FIX: PositionOptions = { enableHighAccuracy: false, timeout: 30_000, maximumAge: 60_000 };

export default function AgentGps() {
  const t = useTranslate();

  const [state,     setState]     = useState<GpsState>("idle");
  const [coords,    setCoords]    = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [error,     setError]     = useState("");
  const [autoTrack, setAutoTrack] = useState(false);
  const [lastSent,  setLastSent]  = useState<Date | null>(null);

  const saveMutation = trpc.agent.saveLocation.useMutation({
    onSuccess: () => setLastSent(new Date()),
  });

  const locate = useCallback((fix: PositionOptions = MANUAL_FIX) => {
    if (!navigator.geolocation) {
      setError(t(
        "GPS недоступен в этом браузере.",
        "Bu brauzerda GPS mavjud emas."
      ));
      setState("error");
      return;
    }
    setState("locating");
    setError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = {
          lat:      pos.coords.latitude,
          lng:      pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        setCoords(c);
        setState("success");
        saveMutation.mutate({
          lat:      String(c.lat),
          lng:      String(c.lng),
          accuracy: String(c.accuracy),
        });
      },
      (err) => {
        const msg =
          err.code === 1 ? t(
            "Доступ к геолокации запрещён. Разрешите доступ в настройках браузера.",
            "Geolokatsiyaga kirish taqiqlangan. Brauzer sozlamalarida ruxsat bering."
          ) :
          err.code === 2 ? t(
            "Местоположение недоступно. Перейдите на открытое место.",
            "Joylashuv aniqlanmadi. Ochiq joyga o'ting."
          ) :
          t(
            "Превышено время ожидания GPS. Попробуйте снова.",
            "GPS vaqti tugadi. Qayta urinib ko'ring."
          );
        setError(msg);
        setState("error");
      },
      fix,
    );
  }, [saveMutation, t]);

  /* ═══════════════════════════════════════════════════════════════════════
     Авто-трекинг.

     ── Что было: бесконечный круг ──────────────────────────────────────────

     Здесь стоял watchPosition, а зависимостями эффекта были
     `[autoTrack, saveMutation, t]`. `saveMutation` — объект от useMutation, и
     он НОВЫЙ на каждом рендере. Дальше круг замыкался сам:

       слежение отдало точку → mutate → состояние запроса изменилось →
       перерисовка → новый saveMutation → эффект сняли и поставили заново →
       новое слежение отдало точку из кэша немедленно → …

     Браузер бил в agent.saveLocation десятками запросов в минуту, упирался в
     ограничение частоты (двести мутаций за четверть часа), получал отказ, а
     отказ ставил состояние ошибки — то есть опять перерисовку и опять новый
     круг. Со стороны это и выглядело как «цикл ошибок».

     ── Как сделано теперь ──────────────────────────────────────────────────

     Эффект зависит ТОЛЬКО от переключателя. Свежая функция отправки живёт в
     ref: он меняется молча, и эффект от этого не перезапускается.

     И вместо слежения — обычный таймер на ту величину, которая обещана в
     подписи. watchPosition для «раз в пять минут» не нужен вовсе: он держит
     приёмник горячим и сажает батарею ради точек, которые никто не просил.
     ═══════════════════════════════════════════════════════════════════════ */
  const tickRef = useRef(locate);
  // Обновляется отдельным эффектом, а не прямо в отрисовке: ref во время
  // отрисовки трогать нельзя, и правило проверки это ловит.
  useEffect(() => { tickRef.current = locate; }, [locate]);

  useEffect(() => {
    if (!autoTrack) return;

    /*
      Пока вкладка спрятана — не снимаем ничего.

      Браузер в фоне всё равно душит таймеры и замораживает вкладку, так что
      надёжного следа оттуда не выходит; выходит только расход батареи на
      попытки. Честнее не притворяться: спрятали — молчим, вернулись —
      отправляем сразу, чтобы супервайзер увидел свежую точку, а не дыру.

      Настоящий фоновый след даёт мобильное приложение: там этим занимается
      система, а не вкладка.
    */
    let id: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (id !== null) return;
      // Первую точку — сразу: иначе человек включил трекинг и пять минут не
      // видит подтверждения, что тот работает.
      tickRef.current(AUTO_FIX);
      id = setInterval(() => tickRef.current(AUTO_FIX), AUTO_TRACK_MS);
    };
    const stop = () => {
      if (id !== null) { clearInterval(id); id = null; }
    };

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) start();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [autoTrack]);

  const mapsUrl = coords
    ? `https://maps.google.com/?q=${coords.lat},${coords.lng}`
    : null;

  return (
    <div className="space-y-4 max-w-sm mx-auto animate-fade-up">
      <h1 className="font-display text-2xl font-bold text-primary tracking-tight">
        {t("GPS Трекер", "GPS Tracker")}
      </h1>

      {/* Статус карточка */}
      <div className="neo-card p-8 text-center">
        {state === "idle" && (
          <div className="space-y-3">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mx-auto"
              style={{ background: "var(--color-surface-light, #f6f4f0)" }}
            >
              <MapPin size={32} className="text-secondary" />
            </div>
            <p className="text-secondary text-sm">
              {t(
                "Нажмите кнопку ниже чтобы отправить своё местоположение супервайзеру",
                "Joylashuvingizni supervisorga yuborish uchun quyidagi tugmani bosing"
              )}
            </p>
          </div>
        )}

        {state === "locating" && (
          <div className="space-y-3">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mx-auto animate-pulse"
              style={{ background: "color-mix(in srgb, var(--color-primary) 10%, transparent)" }}
            >
              <Loader2 size={32} className="text-primary animate-spin" />
            </div>
            <p className="text-secondary text-sm">
              {t("Определяем ваше местоположение…", "Joylashuvingiz aniqlanmoqda…")}
            </p>
          </div>
        )}

        {state === "success" && coords && (
          <div className="space-y-4">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mx-auto"
              style={{ background: "rgba(74,222,128,.10)" }}
            >
              <CheckCircle2 size={32} className="text-success" />
            </div>
            <div>
              <p className="font-label text-[10px] tracking-wider mb-2" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
                {t("КООРДИНАТЫ", "KOORDINATALAR")}
              </p>
              <p className="font-data text-primary text-sm">
                {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
                {t("Точность:", "Aniqlik:")} ±{Math.round(coords.accuracy)} м
              </p>
            </div>
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium"
                style={{ color: "var(--color-primary-text)" }}
              >
                <Navigation size={14} />
                {t("Открыть на карте", "Xaritada ochish")}
              </a>
            )}
          </div>
        )}

        {state === "error" && (
          <div className="space-y-3">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center mx-auto"
              style={{ background: "var(--color-danger-subtle, rgba(232,80,80,.10))" }}
            >
              <AlertCircle size={32} className="text-danger" />
            </div>
            <p className="text-sm text-danger">{error}</p>
          </div>
        )}
      </div>

      {/* Кнопка отправки */}
      <button
        onClick={() => locate(MANUAL_FIX)}
        disabled={state === "locating"}
        className="neo-btn-primary w-full py-4 flex items-center justify-center gap-2 text-base disabled:opacity-50"
      >
        {state === "locating"
          ? <><Loader2 size={18} className="animate-spin" />{t("Определяем…", "Aniqlanmoqda…")}</>
          : <><RefreshCw size={18} />{t("Отправить моё местоположение", "Joylashuvimni yuborish")}</>}
      </button>

      {/* Авто-трекинг */}
      <div className="neo-card p-4 flex items-center justify-between">
        <div>
          <p className="font-medium text-primary text-sm">
            {t("Авто-трекинг", "Avto-kuzatish")}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
            {/* Число — из той же константы, что и таймер: разойтись им нечем. */}
            {t(
              `Отправлять местоположение каждые ${AUTO_TRACK_MIN} ${plural(AUTO_TRACK_MIN, "минуту", "минуты", "минут")}`,
              `Har ${AUTO_TRACK_MIN} daqiqada joylashuv yuborish`,
            )}
          </p>
        </div>
        <button
          onClick={() => setAutoTrack(v => !v)}
          aria-label={t("Авто-трекинг", "Avtomatik kuzatuv")}
          className="w-12 h-6 rounded-full relative transition-colors flex-shrink-0"
          style={{ background: autoTrack ? "var(--color-primary)" : "var(--color-surface-light, #f6f4f0)", border: autoTrack ? "none" : "1px solid var(--color-border, #d8d5cd)" }}
        >
          <span
            className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
            style={{ transform: autoTrack ? "translateX(24px)" : "translateX(2px)" }}
          />
        </button>
      </div>

      {/* Статус авто-трекинга */}
      {autoTrack && (
        <div
          className="flex items-center gap-2 px-4 py-3 rounded-xl"
          style={{ background: "rgba(74,222,128,.10)", border: "1px solid rgba(74,222,128,.25)" }}
        >
          <Radio size={14} className="text-success animate-pulse flex-shrink-0" />
          <p className="text-sm text-success">
            {t("Авто-трекинг активен", "Avto-kuzatish faol")}
            {lastSent && (
              <span className="text-xs ml-1 opacity-70">
                · {t("последнее обновление", "so'nggi yangilanish")} {format(lastSent, "HH:mm:ss")}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Подтверждение отправки */}
      {lastSent && !autoTrack && (
        <p className="text-xs text-center" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
          ✓ {t("Местоположение отправлено в", "Joylashuv yuborildi")} {format(lastSent, "HH:mm:ss")}
        </p>
      )}
    </div>
  );
}
