import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { MapPin, Radio, CheckCircle2, AlertCircle, Loader2, RefreshCw, Navigation } from "lucide-react";
import { format } from "date-fns";

type GpsState = "idle" | "locating" | "success" | "error";

export default function AgentGps() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const [state,     setState]     = useState<GpsState>("idle");
  const [coords,    setCoords]    = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [error,     setError]     = useState("");
  const [autoTrack, setAutoTrack] = useState(false);
  const [lastSent,  setLastSent]  = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const saveMutation = trpc.agent.saveLocation.useMutation({
    onSuccess: () => setLastSent(new Date()),
  });

  const locate = useCallback(() => {
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
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }, [saveMutation, t]);

  // Авто-трекинг каждые 2 минуты
  useEffect(() => {
    if (autoTrack) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      locate();
      intervalRef.current = setInterval(locate, 2 * 60 * 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoTrack, locate]);

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
              style={{ background: "var(--color-surface-light, #f0f3f8)" }}
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
              style={{ background: "rgba(75,108,246,.10)" }}
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
              <p className="font-label text-[10px] tracking-wider mb-2" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                {t("КООРДИНАТЫ", "KOORDINATALAR")}
              </p>
              <p className="font-data text-primary text-sm">
                {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                {t("Точность:", "Aniqlik:")} ±{Math.round(coords.accuracy)} м
              </p>
            </div>
            {mapsUrl && (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium"
                style={{ color: "#4b6cf6" }}
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
        onClick={locate}
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
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
            {t("Отправлять местоположение каждые 2 минуты", "Har 2 daqiqada joylashuv yuborish")}
          </p>
        </div>
        <button
          onClick={() => setAutoTrack(v => !v)}
          className="w-12 h-6 rounded-full relative transition-colors flex-shrink-0"
          style={{ background: autoTrack ? "#4b6cf6" : "var(--color-surface-light, #f0f3f8)", border: autoTrack ? "none" : "1px solid var(--color-border, #dde2ec)" }}
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
        <p className="text-xs text-center" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
          ✓ {t("Местоположение отправлено в", "Joylashuv yuborildi")} {format(lastSent, "HH:mm:ss")}
        </p>
      )}
    </div>
  );
}
