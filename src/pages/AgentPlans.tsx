import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { CheckCircle2, Circle, MapPin } from "lucide-react";
import { CardDots, Card, KpiCard, PageHeader, SectionTitle } from "@/components/DashboardLayout";
import { ProgressRing } from "@/components/ProgressRing";

export default function AgentPlans() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: plans, isLoading } = trpc.agent.todayPlan.useQuery() as { data: any; isLoading: boolean };

  const visited = plans?.visited ?? 0;
  const total = plans?.total ?? 0;
  const pct = total > 0 ? Math.round((visited / total) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader title={t("План визитов", "Tashrif rejası")} subtitle={`${visited} / ${total} ${t("выполнено", "bajarildi")}`} />

      {/* Progress */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <ProgressRing value={pct} color={pct >= 80 ? "#4ade80" : pct >= 50 ? "#fbbf24" : "#f87171"} size={80} strokeWidth={6} label={`${pct}%`} />
          <div>
            <p style={{ fontSize: "24px", fontWeight: 700, color: "var(--color-text-primary, #111827)", margin: 0 }}>{visited} / {total}</p>
            <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #6b7280)", margin: "4px 0 0" }}>{t("визитов выполнено", "tashrif bajarildi")}</p>
          </div>
        </div>
      </Card>

      {/* Plan list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {(plans?.items ?? []).map((item: any, i: number) => (
          <Card key={item.shopId ?? i} style={{ display: "flex", alignItems: "center", gap: "14px", padding: "16px 20px" }}>
            {item.visited ? (
              <CheckCircle2 size={20} color="#4ade80" />
            ) : (
              <Circle size={20} color="var(--color-text-tertiary, #9ca3af)" />
            )}
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary, #111827)", margin: 0 }}>{item.shopName}</p>
              <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #9ca3af)", margin: "2px 0 0" }}>
                <MapPin size={11} style={{ display: "inline", verticalAlign: "middle" }} /> {item.city ?? ""}
              </p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
