import type { LucideIcon } from "lucide-react";
import { Package, Store, Wallet, CreditCard, Award, Users, Boxes, Truck, TrendingUp, Coins, MapPin, ArrowLeftRight } from "lucide-react";
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

const PAYMENT_LABEL: Record<string, string> = {
  cash: "Наличные", transfer: "Перечисление", debt: "Долг", card: "Карта",
};


const ROLE_LABEL: Record<string, string> = {
  ceo: "Руководитель", operator: "Оператор", supervisor: "Супервайзер",
  agent: "Агент", merchandiser: "Мерчендайзер", courier: "Курьер",
};

/** Excel reads a date far better than an ISO timestamp with a T in it. */
function formatDate(v: unknown): string {
  if (!v) return "—";
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
}

const PLAN_STATUS_LABEL: Record<string, string> = {
  planned: "Запланирован", visited: "Посещён", skipped: "Пропущен",
};

const MOVEMENT_LABEL: Record<string, string> = {
  in: "Приход", out: "Расход", adjustment: "Корректировка",
};

/** Date with the time, for logs where the hour is the point. */
function formatDateTime(v: unknown): string {
  if (!v) return "—";
  const d = new Date(v as string);
  if (Number.isNaN(d.getTime())) return String(v);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

/**
 * agentEfficiency counts back N days instead of taking a range. Converting
 * here keeps that quirk out of the card, which only knows about two dates.
 */
function daysBetween(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(ms) ? Math.max(1, Math.round(ms / 86_400_000) + 1) : 30;
}


/**
 * Which slice a file holds, in its name.
 *
 * Two exports of the same report for different agents otherwise land in the
 * downloads folder as "sales-by-shop-…(1).xlsx", and by the time anyone opens
 * them there is nothing to say which is which.
 */
function suffix(p: ReportParams): string {
  const parts: string[] = [];
  if (p.agentId) parts.push(`agent${p.agentId}`);
  if (p.territoryId) parts.push(`terr${p.territoryId}`);
  if (p.shopId) parts.push(`shop${p.shopId}`);
  if (p.category) parts.push(p.category.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-"));
  return parts.length ? `-${parts.join("-")}` : "";
}

export const REPORTS: ReportDef[] = [
  {
    id: "sales-by-product",
    category: "sales",
    title: { ru: "Продажи по товарам", uz: "Mahsulotlar bo'yicha sotuv" },
    description: { ru: "Объём и выручка по каждому товару", uz: "Har bir mahsulot bo'yicha hajm va tushum" },
    icon: Package,
    needsPeriod: true,
    filters: ["agent", "category"],
    useQuery: (p, opts) => trpc.analytics.topProducts.useQuery(
      { dateFrom: p.from, dateTo: p.to, agentId: p.agentId, category: p.category, limit: EXPORT_LIMIT },
      { enabled: opts.enabled },
    ),
    toRows: (data) => (data as Array<{ productName: string | null; productCode: string | null; totalQty: string; totalRevenue: string }>)
      .map(r => ({
        "Товар": r.productName ?? "—",
        "Код": r.productCode ?? "—",
        "Объём": num(r.totalQty),
        "Выручка": num(r.totalRevenue),
      })),
    filename: (p) => `sales-by-product-${p.from}_${p.to}${suffix(p)}`,
    sheet: { ru: "Продажи по товарам", uz: "Mahsulotlar bo'yicha" },
  },
  {
    id: "sales-by-shop",
    category: "sales",
    title: { ru: "Продажи по магазинам", uz: "Do'konlar bo'yicha sotuv" },
    description: { ru: "Выручка и число заказов по каждому магазину", uz: "Har bir do'kon bo'yicha tushum va buyurtmalar" },
    icon: Store,
    needsPeriod: true,
    filters: ["agent", "territory"],
    useQuery: (p, opts) => trpc.analytics.salesByShop.useQuery(
      { dateFrom: p.from, dateTo: p.to, agentId: p.agentId, territoryId: p.territoryId, limit: EXPORT_LIMIT },
      { enabled: opts.enabled },
    ),
    toRows: (data) => (data as Array<{ shopName: string | null; revenue: string; orderCount: number }>)
      .map(r => ({
        "Магазин": r.shopName ?? "—",
        "Выручка": num(r.revenue),
        "Заказов": num(r.orderCount),
      })),
    filename: (p) => `sales-by-shop-${p.from}_${p.to}${suffix(p)}`,
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
    filters: ["agent", "territory"],
    useQuery: (p, opts) => trpc.analytics.debtReport.useQuery(
      { agentId: p.agentId, territoryId: p.territoryId },
      { enabled: opts.enabled },
    ),
    toRows: (data) => (data as Array<{ shopName: string | null; city: string | null; debt: string; agentName: string | null }>)
      .map(r => ({
        "Магазин": r.shopName ?? "—",
        "Город": r.city ?? "—",
        "Агент": r.agentName ?? "—",
        "Долг": num(r.debt),
      })),
    filename: (p) => `debt-report${suffix(p)}`,
    sheet: { ru: "Долги магазинов", uz: "Do'konlar qarzi" },
  },
  {
    id: "sales-by-payment",
    category: "sales",
    title: { ru: "Продажи по способу оплаты", uz: "To'lov usuli bo'yicha sotuv" },
    description: { ru: "Выручка, себестоимость и маржа по каждому способу", uz: "Har bir usul bo'yicha tushum va marja" },
    icon: CreditCard,
    // Carries gross margin, so it lives behind financeQuery on the server.
    roles: ["ceo"],
    needsPeriod: true,
    filters: ["agent"],
    useQuery: (p, opts) => trpc.analytics.pnlByPaymentMethod.useQuery(
      { from: p.from, to: p.to, agentId: p.agentId },
      { enabled: opts.enabled },
    ),
    toRows: (data) => (data as Array<{ paymentMethod: string | null; revenue: number; orderCount: number; cogs: number; grossProfit: number; grossMarginPct: number }>)
      .map(r => ({
        "Способ оплаты": PAYMENT_LABEL[r.paymentMethod ?? ""] ?? r.paymentMethod ?? "—",
        "Выручка": num(r.revenue),
        "Заказов": num(r.orderCount),
        "Себестоимость": num(r.cogs),
        "Валовая прибыль": num(r.grossProfit),
        "Маржа, %": Number(num(r.grossMarginPct).toFixed(1)),
      })),
    filename: (p) => `sales-by-payment-${p.from}_${p.to}${suffix(p)}`,
    sheet: { ru: "По способу оплаты", uz: "To'lov usuli bo'yicha" },
  },
  {
    id: "shops-directory",
    category: "shops",
    title: { ru: "Справочник магазинов", uz: "Do'konlar ma'lumotnomasi" },
    description: { ru: "Все магазины с контактами, агентом и долгом", uz: "Barcha do'konlar, agent va qarz bilan" },
    icon: Store,
    roles: ["ceo", "supervisor"],
    needsPeriod: false,
    filters: ["agent", "territory"],
    useQuery: (p, opts) => trpc.shop.list.useQuery(
      { page: 1, pageSize: EXPORT_LIMIT, agentId: p.agentId, territoryId: p.territoryId },
      { enabled: opts.enabled },
    ),
    toRows: (data) => ((data as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? [])
      .map(r => ({
        "Магазин": String(r.name ?? "—"),
        "Владелец": String(r.ownerName ?? "—"),
        "Телефон": String(r.phone ?? "—"),
        "Город": String(r.city ?? "—"),
        "Адрес": String(r.address ?? "—"),
        "Агент": String(r.agentName ?? "—"),
        "Долг": num(r.debt),
        "Статус": String(r.status ?? "—"),
      })),
    filename: (p) => `shops-directory${suffix(p)}`,
    sheet: { ru: "Магазины", uz: "Do'konlar" },
  },
  {
    id: "agent-efficiency",
    category: "agents",
    title: { ru: "Эффективность агентов", uz: "Agentlar samaradorligi" },
    description: { ru: "Визиты, заказы, выручка и конверсия по каждому", uz: "Tashriflar, buyurtmalar va konversiya" },
    icon: Award,
    needsPeriod: true,
    filters: ["territory"],
    // This endpoint counts back N days rather than taking a range, so the
    // card's dates are converted to a span. Same slice, different shape.
    useQuery: (p, opts) => trpc.analytics.agentEfficiency.useQuery(
      { days: daysBetween(p.from, p.to), territoryId: p.territoryId },
      { enabled: opts.enabled },
    ),
    toRows: (data) => (data as Array<{ agentName: string | null; visits: number; orders: number; revenue: string; avgOrderValue: string; conversionRate: string }>)
      .map(r => ({
        "Агент": r.agentName ?? "—",
        "Визиты": num(r.visits),
        "Заказы": num(r.orders),
        "Выручка": num(r.revenue),
        "Средний чек": num(r.avgOrderValue),
        "Конверсия, %": num(r.conversionRate),
      })),
    filename: (p) => `agent-efficiency-${p.from}_${p.to}${suffix(p)}`,
    sheet: { ru: "Эффективность агентов", uz: "Agentlar samaradorligi" },
  },
  {
    id: "agent-product-sales",
    category: "agents",
    title: { ru: "Агент × Товар", uz: "Agent × Mahsulot" },
    description: { ru: "Что и сколько продал каждый агент", uz: "Har bir agent nima sotgani" },
    icon: Users,
    needsPeriod: true,
    filters: ["agent", "category"],
    useQuery: (p, opts) => trpc.analytics.agentProductSales.useQuery(
      { dateFrom: p.from, dateTo: p.to, agentId: p.agentId, category: p.category },
      { enabled: opts.enabled },
    ),
    toRows: (data) => (data as Array<{ agentName: string | null; productName: string | null; productCode: string | null; totalQty: string; totalRevenue: string }>)
      .map(r => ({
        "Агент": r.agentName ?? "—",
        "Товар": r.productName ?? "—",
        "Код": r.productCode ?? "—",
        "Объём": num(r.totalQty),
        "Выручка": num(r.totalRevenue),
      })),
    filename: (p) => `agent-product-sales-${p.from}_${p.to}${suffix(p)}`,
    sheet: { ru: "Агент × Товар", uz: "Agent × Mahsulot" },
  },
  {
    id: "stock-balances",
    category: "warehouse",
    title: { ru: "Остатки на складе", uz: "Ombor qoldiqlari" },
    description: { ru: "Текущий остаток, резерв и доступно по каждому товару", uz: "Har bir mahsulot bo'yicha qoldiq va rezerv" },
    icon: Boxes,
    roles: ["ceo", "operator"],
    needsPeriod: false,
    filters: ["category"],
    useQuery: (p, opts) => trpc.warehouse.list.useQuery(
      { page: 1, pageSize: EXPORT_LIMIT, category: p.category },
      { enabled: opts.enabled },
    ),
    toRows: (data) => ((data as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? [])
      .map(r => ({
        "Товар": String(r.productName ?? "—"),
        "Код": String(r.productCode ?? "—"),
        "Категория": String(r.category ?? "—"),
        "Остаток": num(r.currentStock),
        "В резерве": num(r.reserved),
        "Доступно": num(r.available),
        "Ед.": String(r.unit ?? "—"),
        "Цена": num(r.unitPrice),
      })),
    filename: (p) => `stock-balances${suffix(p)}`,
    sheet: { ru: "Остатки склада", uz: "Ombor qoldiqlari" },
  },
  {
    id: "arrivals",
    category: "warehouse",
    title: { ru: "Приходы", uz: "Kirimlar" },
    description: { ru: "Поставки с машиной, водителем и расходами", uz: "Yetkazib berishlar va xarajatlar" },
    icon: Truck,
    roles: ["ceo", "operator"],
    needsPeriod: false,
    useQuery: (_p, opts) => trpc.arrival.list.useQuery(
      { page: 1, pageSize: EXPORT_LIMIT },
      { enabled: opts.enabled },
    ),
    toRows: (data) => ((data as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? [])
      .map(r => ({
        "Номер": String(r.arrivalNumber ?? "—"),
        "Дата": formatDate(r.arrivalDate),
        "Машина": String(r.truckId ?? "—"),
        "Водитель": String(r.driverName ?? "—"),
        "Статус": String(r.status ?? "—"),
        "Топливо": num(r.fuelCost),
        "Пошлины": num(r.tollCost),
        "Прочее": num(r.otherCost),
        "Итого расход": num(r.totalExpense),
      })),
    filename: () => "arrivals",
    sheet: { ru: "Приходы", uz: "Kirimlar" },
  },
  {
    id: "pnl",
    category: "finance",
    title: { ru: "P&L по месяцам", uz: "Oylar bo'yicha P&L" },
    description: { ru: "Выручка, себестоимость, расходы и прибыль помесячно", uz: "Oylik tushum, tannarx va foyda" },
    icon: TrendingUp,
    roles: ["ceo"],
    needsPeriod: true,
    useQuery: (p, opts) => trpc.analytics.pnl.useQuery(
      { from: p.from, to: p.to },
      { enabled: opts.enabled },
    ),
    // pnl answers with one object, not a list. The monthly trend is the part
    // worth a spreadsheet — the summary above it is a single row anyone can
    // read on the page itself, and mixing the two onto one sheet is exactly
    // what made the old combined export awkward to filter.
    toRows: (data) => ((data as { trend?: Array<Record<string, unknown>> } | undefined)?.trend ?? [])
      .map(r => ({
        "Месяц": String(r.month ?? "—"),
        "Выручка": num(r.revenue),
        "Себестоимость": num(r.cogs),
        "Валовая прибыль": num(r.grossProfit),
        "Операционные расходы": num(r.operatingExpenses),
        "Чистая прибыль": num(r.netProfit),
        "Заказов": num(r.orderCount),
      })),
    filename: (p) => `pnl-${p.from}_${p.to}`,
    sheet: { ru: "P&L по месяцам", uz: "Oylik P&L" },
  },
  {
    id: "cogs-by-product",
    category: "finance",
    title: { ru: "Себестоимость по товарам", uz: "Mahsulot tannarxi" },
    description: { ru: "Выручка, себестоимость и маржа по каждому товару", uz: "Har bir mahsulot bo'yicha marja" },
    icon: Coins,
    roles: ["ceo"],
    needsPeriod: true,
    filters: ["category"],
    useQuery: (p, opts) => trpc.analytics.cogsByProduct.useQuery(
      { dateFrom: p.from, dateTo: p.to, category: p.category },
      { enabled: opts.enabled },
    ),
    toRows: (data) => (data as Array<Record<string, unknown>>)
      .map(r => {
        const revenue = num(r.totalRevenue);
        const cost = num(r.totalCost);
        return {
          "Товар": String(r.productName ?? "—"),
          "Код": String(r.productCode ?? "—"),
          "Объём": num(r.totalQty),
          "Выручка": revenue,
          "Себестоимость": cost,
          "Валовая прибыль": revenue - cost,
          "Маржа, %": revenue > 0 ? Number((((revenue - cost) / revenue) * 100).toFixed(1)) : 0,
        };
      }),
    filename: (p) => `cogs-by-product-${p.from}_${p.to}${suffix(p)}`,
    sheet: { ru: "Себестоимость", uz: "Tannarx" },
  },
  {
    id: "staff",
    category: "users",
    title: { ru: "Сотрудники", uz: "Xodimlar" },
    description: { ru: "Роли, контакты и последний вход", uz: "Rollar, kontaktlar va oxirgi kirish" },
    icon: Users,
    roles: ["ceo"],
    needsPeriod: false,
    useQuery: (_p, opts) => trpc.user.list.useQuery(
      { page: 1, pageSize: EXPORT_LIMIT },
      { enabled: opts.enabled },
    ),
    toRows: (data) => ((data as { data?: Array<Record<string, unknown>> } | undefined)?.data ?? [])
      .map(r => ({
        "Имя": String(r.name ?? "—"),
        "Email": String(r.email ?? "—"),
        "Телефон": String(r.phone ?? "—"),
        "Роль": ROLE_LABEL[String(r.role)] ?? String(r.role ?? "—"),
        "Статус": String(r.status ?? "—"),
        "Последний вход": formatDate(r.lastSignInAt),
      })),
    filename: () => "staff",
    sheet: { ru: "Сотрудники", uz: "Xodimlar" },
  },
  {
    id: "visits-log",
    category: "shops",
    title: { ru: "Журнал визитов", uz: "Tashriflar jurnali" },
    description: { ru: "Каждый запланированный визит: статус, время и фото", uz: "Har bir tashrif: holati, vaqti va foto" },
    icon: MapPin,
    needsPeriod: true,
    filters: ["agent", "shop"],
    useQuery: (p, opts) => trpc.reports.getVisitsLog.useQuery(
      { dateFrom: p.from, dateTo: p.to, agentId: p.agentId, shopId: p.shopId, limit: EXPORT_LIMIT },
      { enabled: opts.enabled },
    ),
    toRows: (data) => (data as Array<Record<string, unknown>>)
      .map(r => ({
        "Дата плана": formatDate(r.planDate),
        "Статус": PLAN_STATUS_LABEL[String(r.status)] ?? String(r.status ?? "—"),
        // Blank for plans recorded before visited_at existed — an absent time
        // is the truth there, and filling it from updated_at would be a guess
        // presented as a fact.
        "Время визита": formatDateTime(r.visitedAt),
        "Агент": String(r.agentName ?? "—"),
        "Магазин": String(r.shopName ?? "—"),
        "Город": String(r.shopCity ?? "—"),
        "Адрес": String(r.shopAddress ?? "—"),
        "Фото": num(r.hasPhoto) > 0 ? "да" : "нет",
        "Заметка": String(r.notes ?? ""),
      })),
    filename: (p) => `visits-log-${p.from}_${p.to}${suffix(p)}`,
    sheet: { ru: "Журнал визитов", uz: "Tashriflar jurnali" },
  },
  {
    id: "stock-movements",
    category: "warehouse",
    title: { ru: "Движения склада", uz: "Ombor harakatlari" },
    description: { ru: "Приход, расход и корректировки за период", uz: "Davr uchun kirim, chiqim va tuzatishlar" },
    icon: ArrowLeftRight,
    needsPeriod: true,
    useQuery: (p, opts) => trpc.reports.getStockMovements.useQuery(
      { dateFrom: p.from, dateTo: p.to, limit: EXPORT_LIMIT },
      { enabled: opts.enabled },
    ),
    toRows: (data) => (data as Array<Record<string, unknown>>)
      .map(r => ({
        "Дата": formatDateTime(r.createdAt),
        "Товар": String(r.productName ?? "—"),
        "Код": String(r.productCode ?? "—"),
        "Тип": MOVEMENT_LABEL[String(r.type)] ?? String(r.type ?? "—"),
        "Количество": num(r.quantity),
        "Основание": String(r.referenceType ?? "—"),
        "Документ": r.referenceId ? num(r.referenceId) : "—",
        "Примечание": String(r.notes ?? ""),
      })),
    filename: (p) => `stock-movements-${p.from}_${p.to}`,
    sheet: { ru: "Движения склада", uz: "Ombor harakatlari" },
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
