import React from "react";
import { TrendingUp, DollarSign, Truck, Package, ShoppingCart } from "lucide-react";
import { KpiCard } from "./KpiCard";

interface PnLSummaryCardsProps {
  current: {
    revenue?: number;
    cogs?: number;
    grossProfit?: number;
    operatingExpenses?: number;
    netProfit?: number;
  } | undefined;
  deltas: {
    revenue?: number | null;
    cogs?: number | null;
    grossProfit?: number | null;
    operatingExpenses?: number | null;
    netProfit?: number | null;
  } | undefined;
  fmt: (value: number) => string;
  t: (ru: string, uz: string) => string;
}

export function PnLSummaryCards({
  current,
  deltas,
  fmt,
  t,
}: PnLSummaryCardsProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: "16px",
      }}
    >
      <KpiCard
        label={t("ВЫРУЧКА", "TUSHUM")}
        value={fmt(current?.revenue ?? 0)}
        delta={deltas?.revenue ?? null}
        icon={<TrendingUp size={20} color="#fff" />}
        gradient="linear-gradient(135deg, var(--kpi-green), var(--kpi-green))"
        delay={0}
      />
      <KpiCard
        label={t("СЕБЕСТОИМОСТЬ", "TANNARX")}
        value={fmt(current?.cogs ?? 0)}
        delta={deltas?.cogs ?? null}
        icon={<Package size={20} color="#fff" />}
        gradient="linear-gradient(135deg, var(--kpi-orange), var(--kpi-orange))"
        delay={0.05}
      />
      <KpiCard
        label={t("ВАЛОВАЯ ПРИБЫЛЬ", "YALPI FOYDA")}
        value={fmt(current?.grossProfit ?? 0)}
        delta={deltas?.grossProfit ?? null}
        icon={<DollarSign size={20} color="#fff" />}
        gradient={
          (current?.grossProfit ?? 0) >= 0
            ? "linear-gradient(135deg, var(--kpi-indigo), var(--kpi-indigo))"
            : "linear-gradient(135deg, var(--kpi-red), var(--kpi-red))"
        }
        delay={0.1}
      />
      <KpiCard
        label={t("РАСХОДЫ ДОСТАВКА", "YETKAZISH XARAJAT")}
        value={fmt(current?.operatingExpenses ?? 0)}
        delta={deltas?.operatingExpenses ?? null}
        icon={<Truck size={20} color="#fff" />}
        gradient="linear-gradient(135deg, var(--kpi-red), var(--kpi-red))"
        delay={0.15}
      />
      <KpiCard
        label={t("ЧИСТАЯ ПРИБЫЛЬ", "TOZA FOYDA")}
        value={fmt(current?.netProfit ?? 0)}
        delta={deltas?.netProfit ?? null}
        icon={<ShoppingCart size={20} color="#fff" />}
        gradient={
          (current?.netProfit ?? 0) >= 0
            ? "linear-gradient(135deg, var(--kpi-teal), var(--kpi-teal))"
            : "linear-gradient(135deg, var(--kpi-red), var(--kpi-red))"
        }
        delay={0.2}
      />
    </div>
  );
}
