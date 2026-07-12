import { useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useNavigate } from "react-router";
import { format } from "date-fns";
import { MapPin, ShoppingCart, TrendingUp, Clock, Store, CheckCircle2, AlertTriangle } from "lucide-react";
import { CardDots, Card, KpiCard, PageHeader, SectionTitle } from "@/components/DashboardLayout";
import { ProgressRing } from "@/components/ProgressRing";

const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };

export default function AgentDashboard() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const navigate = useNavigate();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: stats, isLoading } = trpc.agent.stats.useQuery() as { data: any; isLoading: boolean };
  const { data: plan } = trpc.agent.todayPlan.useQuery() as { data: any; isLoading: boolean };

  const planPct = plan ? Math.min(100, Math.round((plan.visited / Math.max(1, plan.total)) * 100)) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader title={t("Мой день", "Bugunim")} subtitle={format(new Date(), "EEEE, d MMMM yyyy")} />

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px" }}>
        <KpiCard label={t("ВЫРУЧКА СЕГОДНЯ", "BUGUNGI TUSHUM")} value={fmt(stats?.todayRevenue ?? 0)} icon={<TrendingUp size={18} color="#4ade80" />} gradient="rgba(74,222,128,.10)" />
        <KpiCard label={t("ЗАКАЗЫ", "BUYURTMA")} value={String(stats?.todayOrders ?? 0)} icon={<ShoppingCart size={18} color="#fb923c" />} gradient="rgba(251,146,60,.10)" />
        <KpiCard label={t("ВИЗИТЫ", "TASHRIF")} value={String(stats?.visitsToday ?? 0)} icon={<MapPin size={18} color="#818cf8" />} gradient="rgba(129,140,248,.10)" />
        <KpiCard label={t("МАГАЗИНЫ", "DO'KONLAR")} value={String(stats?.totalShops ?? 0)} icon={<Store size={18} color="#2dd4bf" />} gradient="rgba(45,212,191,.10)" />
      </div>

      {/* Today Plan */}
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <ProgressRing value={planPct} color={planPct >= 80 ? "#4ade80" : planPct >= 50 ? "#fbbf24" : "#f87171"} size={72} strokeWidth={6} label={`${planPct}%`} />
          <div style={{ flex: 1 }}>
            <SectionTitle title={t("План сегодня", "Bugungi reja")} />
            <p style={{ fontSize: "13px", color: "var(--color-text-secondary, #6b7280)", margin: "4px 0 0" }}>
              {plan?.visited ?? 0} / {plan?.total ?? 0} {t("визитов", "tashrif")}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
