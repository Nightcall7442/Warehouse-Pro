import { useState, useCallback } from "react";
import { trpc } from "@/providers/trpc";
import { useTranslate } from "@/i18n";
import { MapPin, Radio, CheckCircle2, AlertCircle, Loader2, RefreshCw, Navigation } from "lucide-react";
import { format } from "date-fns";
import { plural } from "@/lib/plural";
import { PING_MIN, useLastPing } from "@/hooks/useLocationPing";

type GpsState = "idle" | "locating" | "success" | "error";

/*
  Экран «GPS» в вебе — кнопка «отправить сейчас» и строка о том, что точка
  уходит сама раз в десять минут, пока приложение открыто (src/hooks/
  useLocationPing.ts, включается в Layout для агента и мерчандайзера).

  Переключателя «Авто-трекинг» здесь больше нет: он обещал слежение, которого
  браузер дать не может — свёрнутая вкладка заморожена, — и работал только
  пока агент сидел на этом экране. Решение владельца: в вебе без слежения,
  просто раз в десять минут; настоящий фоновый след — у мобильного приложения.
*/
const MANUAL_FIX: PositionOptions = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 };

export default function AgentGps() {
  const t = useTranslate();

  const [state,     setState]     = useState<GpsState>("idle");
  const [coords,    setCoords]    = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [error,     setError]     = useState("");
  const [lastSent,  setLastSent]  = useState<Date | null>(null);
  const lastPing = useLastPing();

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

      {/* Точка уходит сама — пока приложение открыто */}
      <div className="neo-card p-4 flex items-start gap-3">
        <Radio size={16} className="text-success flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-primary text-sm">
            {t(
              `Пока приложение открыто, точка уходит сама раз в ${PING_MIN} ${plural(PING_MIN, "минуту", "минуты", "минут")}`,
              `Ilova ochiq bo'lganda nuqta har ${PING_MIN} daqiqada o'zi yuboriladi`,
            )}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
            {lastPing
              ? `${t("Последняя", "Oxirgisi")}: ${format(lastPing, "HH:mm")}`
              : t("Ещё не отправлялась — разрешите геолокацию, когда браузер спросит", "Hali yuborilmagan — brauzer so'raganda geolokatsiyaga ruxsat bering")}
            {" · "}
            {t("Слежение в фоне даёт только мобильное приложение", "Fonda kuzatishni faqat mobil ilova beradi")}
          </p>
        </div>
      </div>

      {/* Подтверждение отправки */}
      {lastSent && (
        <p className="text-xs text-center" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>
          ✓ {t("Местоположение отправлено в", "Joylashuv yuborildi")} {format(lastSent, "HH:mm:ss")}
        </p>
      )}
    </div>
  );
}
