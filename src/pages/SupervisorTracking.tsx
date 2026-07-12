import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { Users, MapPin, Clock } from "lucide-react";
import { CardDots, Card, KpiCard, PageHeader, SectionTitle } from "@/components/DashboardLayout";

export default function SupervisorTracking() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: agents, isLoading } = trpc.supervisor.tracking.useQuery() as { data: any; isLoading: boolean };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader title={t("Слежение за агентами", "Agentlarni kuzatish")} subtitle={t("Местоположение и активность", "Joylashuv va faollik")} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
        <KpiCard label={t("ВСЕГО АГЕНТОВ", "JAMI AGENT")} value={String((agents ?? []).length)} icon={<Users size={18} color="#818cf8" />} gradient="rgba(129,140,248,.10)" />
        <KpiCard label={t("ОНЛАЙН", "ONLAYN")} value={String((agents ?? []).filter((a: any) => a.isOnline).length)} icon={<MapPin size={18} color="#4ade80" />} gradient="rgba(74,222,128,.10)" />
        <KpiCard label={t("ОФЛАЙН", "OFFLAYN")} value={String((agents ?? []).filter((a: any) => !a.isOnline).length)} icon={<Clock size={18} color="#fbbf24" />} gradient="rgba(251,191,36,.10)" />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {isLoading ? (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>...</div>
        ) : (agents ?? []).length === 0 ? (
          <Card><p style={{ textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)", padding: "32px 0" }}>{t("Нет агентов", "Agent yo'q")}</p></Card>
        ) : (agents ?? []).map((a: any) => (
          <Card key={a.id} style={{ display: "flex", alignItems: "center", gap: "14px", padding: "16px 20px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: a.isOnline ? "#4ade80" : "#fbbf24", flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary, #111827)", margin: 0 }}>{a.name}</p>
              <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #9ca3af)", margin: "2px 0 0" }}>
                {a.lastLocation ? `${a.lastLocation.lat?.toFixed(4)}, ${a.lastLocation.lng?.toFixed(4)}` : t("Нет данных", "Ma'lumot yo'q")}
              </p>
            </div>
            <span style={{ padding: "3px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, background: a.isOnline ? "rgba(74,222,128,.10)" : "rgba(251,191,36,.10)", color: a.isOnline ? "#4ade80" : "#fbbf24" }}>
              {a.isOnline ? t("Онлайн", "Onlayn") : t("Офлайн", "Offlayn")}
            </span>
          </Card>
        ))}
      </div>
    </div>
  );
}
