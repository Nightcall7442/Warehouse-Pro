import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { Users, CheckCircle2, Circle } from "lucide-react";
import { CardDots, Card, KpiCard, PageHeader, SectionTitle } from "@/components/DashboardLayout";
import { ProgressRing } from "@/components/ProgressRing";

export default function SupervisorPlans() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: plans, isLoading } = trpc.supervisor.plans.useQuery() as { data: any; isLoading: boolean };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader title={t("Планы агентов", "Agentlar rejasi")} subtitle={t("Выполнение планов по визитам", "Tashrif rejasini bajarish")} />

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {isLoading ? (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>...</div>
        ) : (plans ?? []).length === 0 ? (
          <Card><p style={{ textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)", padding: "32px 0" }}>{t("Нет данных", "Ma'lumot yo'q")}</p></Card>
        ) : (plans ?? []).map((p: any) => {
          const pct = Math.min(100, Math.round((Number(p.visited ?? 0) / Math.max(1, Number(p.total ?? 0))) * 100));
          return (
            <Card key={p.agentId} style={{ display: "flex", alignItems: "center", gap: "16px", padding: "16px 20px" }}>
              <ProgressRing value={pct} color={pct >= 80 ? "#4ade80" : pct >= 50 ? "#fbbf24" : "#f87171"} size={56} strokeWidth={5} label={`${pct}%`} />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary, #111827)", margin: 0 }}>{p.agentName ?? `Агент #${p.agentId}`}</p>
                <p style={{ fontSize: "12px", color: "var(--color-text-secondary, #6b7280)", margin: "2px 0 0" }}>{p.visited ?? 0} / {p.total ?? 0} {t("визитов", "tashrif")}</p>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
