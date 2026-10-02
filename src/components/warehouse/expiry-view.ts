/*
  «Сроки» — то, что экран делает со строками сервера: группы плиток,
  порядок, подписи вердиктов и строки выгрузки. Отдельно от разметки, чтобы
  проверять без отрисовки (expiry-view.test.ts).
*/
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../api/router";
import { expiryReasonText, needsAction, EXPIRY_RULES, type ExpiryVerdict } from "@contracts/expiry";
import { formatQty } from "@/lib/format";
import { unitShort } from "@/lib/units";

/** Неразрывный пробел — между числом и единицей. */
const NBSP = String.fromCharCode(160);

export type ExpiryRowServer = inferRouterOutputs<AppRouter>["warehouseReports"]["expiring"][number];
export type ExpiryRowView = ExpiryRowServer & { unitLabel: string };

/** Плитки экрана — три группы по действию. */
export type ExpiryGroup = "risk" | "expired" | "sells";

export function groupOf(v: ExpiryVerdict): ExpiryGroup {
  if (v === "expired") return "expired";
  if (v === "sells") return "sells";
  return "risk";
}

/**
 * Сколько денег у строки на экране: директору — по закупке (столько сгорит),
 * остальным — по цене продажи (закупку они не видят).
 */
export function moneyOf(r: Pick<ExpiryRowServer, "atRiskCost" | "atRiskSale">): number {
  return r.atRiskCost ?? r.atRiskSale;
}

/**
 * Порядок внутри группы: «не успеют» и «просрочено» — по деньгам, сверху то,
 * что дороже всего; при равных — что раньше сгорит. «Успевают» — по сроку.
 */
export function sortRows<T extends Pick<ExpiryRowServer, "verdict" | "atRiskCost" | "atRiskSale" | "daysLeft" | "batchId">>(rows: readonly T[], group: ExpiryGroup): T[] {
  const list = rows.filter(r => groupOf(r.verdict) === group);
  return list.sort((a, b) => group === "sells"
    ? a.daysLeft - b.daysLeft || a.batchId - b.batchId
    : moneyOf(b) - moneyOf(a) || a.daysLeft - b.daysLeft || a.batchId - b.batchId);
}

/** Какую группу открыть первой: где есть что делать. */
export function firstGroup(rows: ReadonlyArray<Pick<ExpiryRowServer, "verdict">>): ExpiryGroup {
  if (rows.some(r => needsAction(r.verdict))) return "risk";
  if (rows.some(r => r.verdict === "expired")) return "expired";
  return "sells";
}

export const VERDICT_LABEL: Record<ExpiryVerdict, { ru: string; uz: string; tone: "danger" | "warning" | "success" }> = {
  expired:   { ru: "Просрочено", uz: "Muddati o'tgan", tone: "danger" },
  elsewhere: { ru: "Не на основном складе", uz: "Asosiy omborda emas", tone: "warning" },
  no_sales:  { ru: "Нет продаж", uz: "Sotuv yo'q", tone: "danger" },
  short:     { ru: "Не успеет", uz: "Ulgurmaydi", tone: "warning" },
  sells:     { ru: "Успеет", uz: "Ulguradi", tone: "success" },
};

/** Дата «ГГГГ-ММ-ДД» как её читают: 12.10.2026. */
export function showDay(day: string): string {
  const [y, m, d] = day.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

export function withUnit<T extends { unit: string | null }>(r: T, lang: string): T & { unitLabel: string } {
  return { ...r, unitLabel: unitShort(r.unit ?? undefined, lang) };
}

/** Фраза «почему» — та же, что на экране; количество с единицей. */
export function reasonOf(r: ExpiryRowServer, lang: string): string {
  const u = unitShort(r.unit ?? undefined, lang);
  // Число и единица — неразрывным пробелом: «70 шт» не рвётся между строками.
  return expiryReasonText(r, lang, n => `${formatQty(n, 1)}${NBSP}${u}`);
}

/**
 * Строки выгрузки — по-русски всегда: это бумага, а не экран. Закупка и
 * маржа — только если сервер их отдал (директору).
 */
export function excelRows(rows: readonly ExpiryRowServer[]) {
  return rows.map(r => ({
    product: r.productName ?? "",
    code: r.productCode ?? "",
    warehouse: r.warehouseName ?? "",
    batch: r.batchNumber ?? "",
    expires: showDay(r.expiresAt),
    daysLeft: r.daysLeft,
    quantity: r.quantity,
    unit: unitShort(r.unit ?? undefined, "ru"),
    pace: r.pacePerDay,
    sold: r.sold,
    unsold: r.unsold,
    verdict: VERDICT_LABEL[r.verdict].ru,
    reason: reasonOf(r, "ru"),
    pct: r.advice?.pct ?? "",
    advicePrice: r.advice?.price ?? "",
    markdown: r.markdown ? `${r.markdown.price} до ${showDay(r.markdown.endsOn)}` : "",
    atRiskSale: r.atRiskSale,
    cost: r.costPrice ?? "",
    atRiskCost: r.atRiskCost ?? "",
    margin: r.adviceMoney?.costKnown ? r.adviceMoney.unitMargin : "",
  }));
}

export function excelColumns(seesCost: boolean) {
  const base = [
    { key: "product", header: "Товар", width: 30 },
    { key: "code", header: "Код", width: 12 },
    { key: "warehouse", header: "Склад", width: 16 },
    { key: "batch", header: "Партия", width: 14 },
    { key: "expires", header: "Годен до", width: 12 },
    { key: "daysLeft", header: "Осталось дней", width: 12 },
    { key: "quantity", header: "Количество", width: 12 },
    { key: "unit", header: "Ед.", width: 6 },
    { key: "pace", header: `Продаётся в день (за ${EXPIRY_RULES.PACE_WINDOW_DAYS} дн.)`, width: 16 },
    { key: "sold", header: "Продастся до срока", width: 14 },
    { key: "unsold", header: "Останется", width: 12 },
    { key: "verdict", header: "Состояние", width: 18 },
    { key: "reason", header: "Почему", width: 60 },
    { key: "pct", header: "Скидка, %", width: 10 },
    { key: "advicePrice", header: "Цена со скидкой", width: 14 },
    { key: "markdown", header: "Уценка", width: 20 },
    { key: "atRiskSale", header: "Не продастся, по цене продажи", width: 18 },
  ];
  return seesCost
    ? [...base,
        { key: "cost", header: "Закупка за ед.", width: 14 },
        { key: "atRiskCost", header: "Сгорит, по закупке", width: 16 },
        { key: "margin", header: "Маржа со скидкой за ед.", width: 16 }]
    : base;
}
