import { Coins, Package, Truck, Wallet } from "lucide-react";
import { KpiCard } from "./KpiCard";

interface Totals {
  revenue?: number;
  cogs?: number;
  grossProfit?: number;
  operatingExpenses?: number;
  netProfit?: number;
}

interface PnLSummaryCardsProps {
  current: Totals | undefined;
  previous: Totals | null | undefined;
  deltas:
    | {
        revenue?: number | null;
        cogs?: number | null;
        grossProfit?: number | null;
        operatingExpenses?: number | null;
      }
    | undefined;
  fmt: (value: number) => string;
  t: (ru: string, uz: string) => string;
}

/**
 * Четыре слагаемых периода. Чистая прибыль отсюда ушла наверх, в заголовок:
 * пять одинаковых карточек в ряд не давали понять, какая из них ответ, и
 * директор читал их слева направо, как таблицу. Ответ на странице один, и
 * набран он крупно.
 */
export function PnLSummaryCards({ current, previous, deltas, fmt, t }: PnLSummaryCardsProps) {
  const prevOf = (pick: (p: Totals) => number | undefined) =>
    previous ? fmt(pick(previous) ?? 0) : null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "16px",
      }}
    >
      <KpiCard
        label={t("ВЫРУЧКА", "TUSHUM")}
        value={fmt(current?.revenue ?? 0)}
        delta={deltas?.revenue ?? null}
        prev={prevOf((p) => p.revenue)}
        icon={<Coins size={19} />}
        accent="var(--kpi-blue)"
        higherIsBetter
        noBaseLabel={t("нет прошлого периода", "oldingi davr yo'q")}
        prevLabel={t("было", "edi")}
      />
      <KpiCard
        label={t("СЕБЕСТОИМОСТЬ", "TANNARX")}
        value={fmt(current?.cogs ?? 0)}
        delta={deltas?.cogs ?? null}
        prev={prevOf((p) => p.cogs)}
        icon={<Package size={19} />}
        accent="var(--kpi-orange)"
        higherIsBetter={false}
        noBaseLabel={t("нет прошлого периода", "oldingi davr yo'q")}
        prevLabel={t("было", "edi")}
      />
      <KpiCard
        label={t("ВАЛОВАЯ ПРИБЫЛЬ", "YALPI FOYDA")}
        value={fmt(current?.grossProfit ?? 0)}
        delta={deltas?.grossProfit ?? null}
        prev={prevOf((p) => p.grossProfit)}
        icon={<Wallet size={19} />}
        // Прибыль — состояние, поэтому оттенок смысловой, а не фирменный:
        // на жёлтом или салатовом фирменном цвете убыток выглядел бы удачей.
        accent={(current?.grossProfit ?? 0) >= 0 ? "var(--color-success)" : "var(--color-danger)"}
        higherIsBetter
        noBaseLabel={t("нет прошлого периода", "oldingi davr yo'q")}
        prevLabel={t("было", "edi")}
      />
      <KpiCard
        label={t("РАСХОДЫ НА ДОСТАВКУ", "YETKAZISH XARAJATI")}
        value={fmt(current?.operatingExpenses ?? 0)}
        delta={deltas?.operatingExpenses ?? null}
        prev={prevOf((p) => p.operatingExpenses)}
        icon={<Truck size={19} />}
        accent="var(--kpi-amber)"
        higherIsBetter={false}
        noBaseLabel={t("нет прошлого периода", "oldingi davr yo'q")}
        prevLabel={t("было", "edi")}
      />
    </div>
  );
}
