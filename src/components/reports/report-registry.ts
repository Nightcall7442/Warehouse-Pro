import type { LucideIcon } from "lucide-react";
import { Package, Store, Wallet } from "lucide-react";
import { trpc } from "@/providers/trpc";

/**
 * Every report the hub can produce, described rather than coded.
 *
 * The alternative — a component per report, each with its own copy of
 * "fetch → map to rows → call exportToExcel" — is how the ten existing export
 * buttons ended up with ten slightly different handlers. Adding the fifteenth
 * report should be one entry in this array, not another file to keep in step.
 */

export type ReportCategory = "sales" | "shops" | "agents" | "warehouse" | "finance" | "users";

export type FilterKind = "agent" | "shop" | "territory" | "category";

/** What the card has collected from the user when Excel is pressed. */
export interface ReportParams {
  from: string;
  to: string;
  agentId?: number;
  shopId?: number;
  territoryId?: number;
  category?: string;
}

/** A single spreadsheet row: header text → cell value. */
export type Row = Record<string, string | number>;

/**
 * The registry hands the card a hook, and the card calls it — once, at the top
 * of its own render, so the rules of hooks hold. `enabled` matters: opening the
 * tab must not fire fourteen of the heaviest aggregate queries in the product
 * at once. Each card stays idle until its own button is pressed.
 */
export interface ReportDef {
  id: string;
  category: ReportCategory;
  title: { ru: string; uz: string };
  description: { ru: string; uz: string };
  icon: LucideIcon;
  /** Who sees the card. Empty means everyone the page itself admits. */
  roles?: string[];
  needsPeriod: boolean;
  filters?: FilterKind[];
  useQuery: (p: ReportParams, opts: { enabled: boolean }) => {
    refetch: () => Promise<{ data?: unknown }>;
    isFetching: boolean;
  };
  toRows: (data: unknown) => Row[];
  filename: (p: ReportParams) => string;
  sheet: { ru: string; uz: string };
}

/** Every report exports the full set, never the dashboard's top-N slice. */
const EXPORT_LIMIT = 10000;

const num = (v: unknown) => Number(v ?? 0);

export const REPORTS: ReportDef[] = [
  {
    id: "sales-by-product",
    category: "sales",
    title: { ru: "Продажи по товарам", uz: "Mahsulotlar bo'yicha sotuv" },
    description: { ru: "Объём и выручка по каждому товару", uz: "Har bir mahsulot bo'yicha hajm va tushum" },
    icon: Package,
    needsPeriod: true,
    useQuery: (p, opts) => trpc.analytics.topProducts.useQuery(
      { dateFrom: p.from, dateTo: p.to, limit: EXPORT_LIMIT },
      { enabled: opts.enabled },
    ),
    toRows: (data) => (data as Array<{ productName: string | null; productCode: string | null; totalQty: string; totalRevenue: string }>)
      .map(r => ({
        "Товар": r.productName ?? "—",
        "Код": r.productCode ?? "—",
        "Объём": num(r.totalQty),
        "Выручка": num(r.totalRevenue),
      })),
    filename: (p) => `sales-by-product-${p.from}_${p.to}`,
    sheet: { ru: "Продажи по товарам", uz: "Mahsulotlar bo'yicha" },
  },
  {
    id: "sales-by-shop",
    category: "sales",
    title: { ru: "Продажи по магазинам", uz: "Do'konlar bo'yicha sotuv" },
    description: { ru: "Выручка и число заказов по каждому магазину", uz: "Har bir do'kon bo'yicha tushum va buyurtmalar" },
    icon: Store,
    needsPeriod: true,
    useQuery: (p, opts) => trpc.analytics.salesByShop.useQuery(
      { dateFrom: p.from, dateTo: p.to, limit: EXPORT_LIMIT },
      { enabled: opts.enabled },
    ),
    toRows: (data) => (data as Array<{ shopName: string | null; revenue: string; orderCount: number }>)
      .map(r => ({
        "Магазин": r.shopName ?? "—",
        "Выручка": num(r.revenue),
        "Заказов": num(r.orderCount),
      })),
    filename: (p) => `sales-by-shop-${p.from}_${p.to}`,
    sheet: { ru: "Продажи по магазинам", uz: "Do'konlar bo'yicha" },
  },
  {
    id: "debt-report",
    category: "shops",
    title: { ru: "Долги магазинов", uz: "Do'konlar qarzi" },
    description: { ru: "Все магазины с долгом, от большего к меньшему", uz: "Qarzi bor barcha do'konlar" },
    icon: Wallet,
    // Debt has no period: it is a balance as of now, not a flow over a range.
    needsPeriod: false,
    useQuery: (_p, opts) => trpc.analytics.debtReport.useQuery(undefined, { enabled: opts.enabled }),
    toRows: (data) => (data as Array<{ shopName: string | null; city: string | null; debt: string; agentName: string | null }>)
      .map(r => ({
        "Магазин": r.shopName ?? "—",
        "Город": r.city ?? "—",
        "Агент": r.agentName ?? "—",
        "Долг": num(r.debt),
      })),
    filename: () => "debt-report",
    sheet: { ru: "Долги магазинов", uz: "Do'konlar qarzi" },
  },
];

export const CATEGORY_TITLES: Record<ReportCategory, { ru: string; uz: string }> = {
  sales:     { ru: "Продажи",          uz: "Sotuvlar" },
  shops:     { ru: "Магазины и визиты", uz: "Do'konlar va tashriflar" },
  agents:    { ru: "Агенты",            uz: "Agentlar" },
  warehouse: { ru: "Склад и закупки",   uz: "Ombor va xaridlar" },
  finance:   { ru: "Финансы",           uz: "Moliya" },
  users:     { ru: "Сотрудники",        uz: "Xodimlar" },
};

/** Category display order — the hub renders them in this sequence. */
export const CATEGORY_ORDER: ReportCategory[] = [
  "sales", "shops", "agents", "warehouse", "finance", "users",
];

export function visibleReports(role: string | undefined): ReportDef[] {
  return REPORTS.filter(r => !r.roles || (role !== undefined && r.roles.includes(role)));
}
