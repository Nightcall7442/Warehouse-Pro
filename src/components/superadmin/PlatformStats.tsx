import { Building2, Users, ShoppingCart, TrendingUp, BarChart3 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { F, COLORS, fmt, money } from "./types";
import { KpiCard, Section, PlanBadge, StatusBadge } from "./ui";

export function PlatformStats() {
  const { data: stats, isLoading } = trpc.tenant.platformStats.useQuery();
  const cards = [
    { label: "Организаций", value: stats?.tenants ?? 0, icon: Building2, gradient: "linear-gradient(135deg, #5b6d8a, #5b6d8a)" },
    { label: "Пользователей", value: stats?.users ?? 0, icon: Users, gradient: "linear-gradient(135deg, #60a5fa, #3b82f6)" },
    { label: "Заказов", value: fmt(stats?.orders ?? 0), icon: ShoppingCart, gradient: "linear-gradient(135deg, #34c473, #16a34a)" },
    { label: "Выручка", value: money(stats?.revenue ?? 0) + " сум", icon: TrendingUp, gradient: "linear-gradient(135deg, #d4973a, #d97706)" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
      {cards.map(c => <KpiCard key={c.label} label={c.label} value={c.value} icon={c.icon} gradient={c.gradient} loading={isLoading} />)}
      {stats && (
        <Section title="По тарифам" icon={BarChart3}>
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap", alignItems: "center" }}>
            {(["trial", "basic", "pro", "exclusive"] as const).map(plan => (
              <div key={plan} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <PlanBadge plan={plan} />
                <span style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: COLORS.textPrimary }}>{stats.byPlan[plan] ?? 0}</span>
              </div>
            ))}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "10px" }}>
              <StatusBadge status="suspended" />
              <span style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: COLORS.textPrimary }}>{stats.byStatus.suspended ?? 0}</span>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}
