import { useState, useEffect } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { MapPin, Navigation, Clock } from "lucide-react";
import { CardDots, Card, PageHeader } from "@/components/DashboardLayout";

export default function AgentGps() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        pos => setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {}
      );
    }
  }, []);

  const reportLocation = trpc.agent.reportLocation.useMutation();

  useEffect(() => {
    if (!location) return;
    const interval = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        pos => {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          reportLocation.mutate({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {}
      );
    }, 30000);
    return () => clearInterval(interval);
  }, [location]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader title={t("GPS трекинг", "GPS kuzatuv")} subtitle={t("Отслеживание местоположения", "Joylashuvni kuzatish")} />

      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "rgba(74,222,128,.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Navigation size={20} color="#4ade80" />
          </div>
          <div>
            <p style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", margin: 0 }}>
              {t("ТЕКУЩЕЕ ПОЛОЖЕНИЕ", "JORIY JOYLASHUV")}
            </p>
            <p style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-primary, #111827)", margin: "4px 0 0" }}>
              {location ? `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}` : t("Определяется...", "Aniqlanmoqda...")}
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #6b7280)", textAlign: "center", padding: "24px 0" }}>
          {t("GPS обновляется каждые 30 секунд", "GPS har 30 soniyada yangilanadi")}
        </p>
      </Card>
    </div>
  );
}
