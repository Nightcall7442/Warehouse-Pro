import { useState, useCallback } from "react";
import { trpc } from "@/providers/trpc";
import { useTranslate } from "@/i18n";
import { MapPin, Radio, CheckCircle2, AlertCircle, Loader2, Navigation, Info } from "lucide-react";
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

  /*
    Вид — «Геолокация» мобилки v8 (Warehouse-Pro-Mobile, app/(tabs)/gps.tsx):
    карточка состояния, «Поделиться геолокацией», авто-отправка с честной
    биркой (в браузере — только пока экран открыт), «Последняя отправка»
    крупным временем и «Как это работает». Владелец, 25.09.2026.
  */
  const card: React.CSSProperties = { background: "var(--color-surface)", boxShadow: "var(--shadow-raised)", borderRadius: 24 };
  const last = lastSent ?? lastPing;
  const status = {
    idle:     { icon: <MapPin size={34} color="var(--color-primary-text)" />, bg: "var(--color-primary-subtle)", text: t("Нажмите кнопку, чтобы поделиться геолокацией", "Joylashuvni yuborish uchun tugmani bosing"), color: "var(--color-text-secondary)" },
    locating: { icon: <Loader2 size={34} className="animate-spin" color="var(--color-primary-text)" />, bg: "var(--color-primary-subtle)", text: t("Определяем местоположение…", "Joylashuv aniqlanmoqda…"), color: "var(--color-text-secondary)" },
    success:  { icon: <CheckCircle2 size={34} color="var(--color-success-text)" />, bg: "var(--color-success-subtle)", text: t("Геолокация успешно отправлена", "Joylashuv yuborildi"), color: "var(--color-success-text)" },
    error:    { icon: <AlertCircle size={34} color="var(--color-danger-text)" />, bg: "var(--color-danger-subtle)", text: error, color: "var(--color-danger-text)" },
  }[state];

  return (
    <div className="space-y-3 max-w-sm mx-auto animate-fade-up" data-testid="agent-gps">
      <div>
        <h1 className="hidden md:block font-display text-2xl font-bold text-primary tracking-tight">{t("Геолокация", "Geolokatsiya")}</h1>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>{t("координаты уходят сами, пока приложение открыто", "ilova ochiq bo'lganda koordinatalar o'zi ketadi")}</p>
      </div>

      {/* ── Состояние ── */}
      <div className="flex flex-col items-center text-center" style={{ ...card, padding: "32px 20px" }}>
        <span className="flex items-center justify-center rounded-full mb-3" style={{ width: 84, height: 84, background: status.bg }}>{status.icon}</span>
        <p style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.45, color: status.color, margin: 0 }}>{status.text}</p>
        {state === "success" && coords && (
          <>
            <p className="font-data" style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "8px 0 0", letterSpacing: "0.02em" }}>
              {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
            </p>
            {mapsUrl && (
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-2" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-primary-text)" }}>
                <Navigation size={14} />{t("Открыть на карте", "Xaritada ochish")}
              </a>
            )}
          </>
        )}
      </div>

      <button
        onClick={() => locate(MANUAL_FIX)}
        disabled={state === "locating"}
        className="neo-btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
        style={{ minHeight: 52, fontSize: 15, fontWeight: 700, borderRadius: 16 }}
      >
        {state === "locating"
          ? <><Loader2 size={18} className="animate-spin" />{t("Определяем…", "Aniqlanmoqda…")}</>
          : <><MapPin size={18} />{t("Поделиться геолокацией", "Joylashuvni yuborish")}</>}
      </button>

      {/* ── Авто-отправка ── */}
      <div style={{ ...card, padding: 16 }}>
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center flex-shrink-0" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--color-primary-subtle)" }}>
            <Radio size={18} color="var(--color-primary-text)" />
          </span>
          <div className="flex-1 min-w-0">
            <p style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>{t("Авто-отправка", "Avto-yuborish")}</p>
            <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>
              {t(`Раз в ${PING_MIN} ${plural(PING_MIN, "минуту", "минуты", "минут")}, пока приложение открыто`, `Ilova ochiq bo'lganda har ${PING_MIN} daqiqada`)}
            </p>
          </div>
        </div>
        {/* Честно: браузер замораживает свёрнутую вкладку, фоновый след — только у мобильного приложения. */}
        <span className="inline-flex rounded-full px-2.5 py-1 mt-3" style={{ fontSize: 11, fontWeight: 600, background: "var(--color-warning-subtle)", color: "var(--color-warning-text)" }}>
          {t("Слежение только на экране", "Kuzatuv faqat ekranda")}
        </span>
      </div>

      {/* ── Последняя отправка ── */}
      <div className="flex flex-col items-center" style={{ ...card, padding: "16px 20px" }}>
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: "var(--color-text-tertiary)", margin: "0 0 4px" }}>{t("ПОСЛЕДНЯЯ ОТПРАВКА", "OXIRGI YUBORISH")}</p>
        <p className="font-data" style={{ fontSize: 26, color: "var(--color-text-primary)", margin: 0 }}>{last ? format(last, "HH:mm:ss") : "—"}</p>
        {coords && (
          <p className="font-data" style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "4px 0 0" }}>
            {coords.lat.toFixed(5)}° N, {coords.lng.toFixed(5)}° E · ±{Math.round(coords.accuracy)} {t("м", "m")}
          </p>
        )}
        {!last && (
          <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "4px 0 0", textAlign: "center" }}>
            {t("Ещё не отправлялась — разрешите геолокацию, когда браузер спросит", "Hali yuborilmagan — brauzer so'raganda geolokatsiyaga ruxsat bering")}
          </p>
        )}
      </div>

      {/* ── Как это работает ── */}
      <div className="flex gap-3" style={{ borderRadius: 24, padding: 16, background: "var(--color-primary-subtle)" }}>
        <Info size={18} color="var(--color-primary-text)" className="flex-shrink-0 mt-0.5" />
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>{t("Как это работает", "Bu qanday ishlaydi")}</p>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: "var(--color-text-secondary)", margin: "4px 0 0" }}>
            {t("Ваши координаты будут видны супервайзеру на карте. Это помогает планировать маршруты и подтверждать посещения магазинов.", "Koordinatalaringiz supervayzerga xaritada ko'rinadi. Bu marshrutlarni rejalashtirish va do'kon tashriflarini tasdiqlashga yordam beradi.")}
          </p>
        </div>
      </div>
    </div>
  );
}
