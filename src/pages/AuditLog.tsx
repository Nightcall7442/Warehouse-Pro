import { useEffect, useState } from "react";
import { useScrollTopOnChange } from "@/hooks/useScrollTopOnChange";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { format } from "date-fns";
import { ru as dateRu } from "date-fns/locale";
import {
  Shield, Filter, ChevronLeft, ChevronRight, Search, BookOpen,
  User, Package, Settings, AlertTriangle, Key,
  RefreshCw, Download,
  ShoppingCart, CreditCard, Store, Building2, Truck, ClipboardList,
  Undo2, Printer, Tag, Database, Wallet, Boxes, Trash2, ClipboardCheck, Link2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { notify } from "@/lib/toast";
import { PremiumSelect } from "@/components/PremiumSelect";
import { type Label, type Lang } from "@/lib/entity-labels";
import { describeMeta, AUDIT_ACTION_LABEL } from "@/lib/audit-text";

/*
  Журнал действий директора.

  ── Что было ────────────────────────────────────────────────────────────────

  Запись читалась как «Принята оплата · order #1234 · amount: 150000 ·
  method: cash» — номер строки базы и ключи из кода. Отбор — только по виду
  действия; ни по человеку, ни по периоду, ни по слову, хотя сервер всё это
  умел. Директор посмотрел и сказал, что журналом пользоваться нельзя.

  ── Что теперь ──────────────────────────────────────────────────────────────

  Каждая запись — «кто · что сделал — с чем · подробности словами»: имя
  объекта приходит с сервера (targetLabel), подробности переведены здесь
  (describeMeta). Сверху: поиск по слову, сотрудник, период (сегодня / 7 /
  30 дней / всё / свой), ниже — вид действия. Техническое — по клику.
*/

// ── Premium design tokens ─────────────────────────────────────────────────────
const F = { display: "'Manrope', -apple-system, sans-serif", body: "'Manrope', -apple-system, sans-serif" };
const COLORS = {
  primary: "var(--color-primary)",
  // Accent-coloured *text* (a price, a code, a link). The fill colour above
  // is a hair under 4.5:1 as text on a light card, so semantic text uses
  // this darker sibling instead. See --color-primary-text in index.css.
  primaryText: "var(--color-primary-text)", success: "var(--color-success)",
  warning: "var(--color-warning)", danger: "var(--color-danger)",
  surface: "var(--color-surface, #efedea)", surfaceLight: "var(--color-surface-light, #f6f4f0)",
  textPrimary: "var(--color-text-primary, #2b2a28)", textSecondary: "var(--color-text-secondary, #5e5b54)",
  textTertiary: "var(--color-text-tertiary, #6b6760)", border: "var(--color-border, #d8d5cd)",
  info: "#60a5fa",
};
const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

// ── Keyframes ─────────────────────────────────────────────────────────────────
const slideUpKeyframe = `
@keyframes slideUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;
if (typeof document !== "undefined" && !document.getElementById("auditlog-keyframes")) {
  const style = document.createElement("style");
  style.id = "auditlog-keyframes";
  style.textContent = slideUpKeyframe;
  document.head.appendChild(style);
}

// ── Action config ─────────────────────────────────────────────────────────────
/*
  Словарь знал шесть действий из сорока с лишним, которые пишет сервер:
  директор видел в журнале «order.payment_recorded» и «stock_count.apply» —
  кодом из базы. Здесь каждое действие, которое пишет api; страж
  audit-actions-are-named проверяет, что новое действие сюда попало.

  Заливка — токенами: числа темы не знают.
*/
const PRIMARY = "var(--color-primary)";
const DANGER  = "var(--color-danger)";
const WARNING = "var(--color-warning)";
const SUCCESS = "var(--color-success)";
const INFO    = "var(--color-info)";

/* Подписи действий живут в contracts/audit-text.ts (AUDIT_ACTION_LABEL): те же
   слова идут в CSV с сервера. Здесь — только значок и цвет. */
const ACTION_CONFIG: Record<string, { icon: LucideIcon; gradient: string }> = {
  // Люди и доступ
  "user.updated":                    { icon: User, gradient: PRIMARY },
  "user.deactivated":                { icon: User, gradient: DANGER },
  "user.password_reset_by_admin":    { icon: Key, gradient: WARNING },
  "user.credentials_transferred":    { icon: Key, gradient: WARNING },
  "user.login_changed":              { icon: Key, gradient: WARNING },
  "user.totp_enable":                { icon: Shield, gradient: SUCCESS },
  "user.totp_disable":               { icon: Shield, gradient: WARNING },
  "access.operator":                 { icon: Shield, gradient: PRIMARY },
  "api_key.created":                 { icon: Link2, gradient: PRIMARY },
  "api_key.revoked":                 { icon: Link2, gradient: DANGER },
  "api_key.status":                  { icon: Link2, gradient: WARNING },
  // Заказы и оплаты
  "order.create":                    { icon: ShoppingCart, gradient: PRIMARY },
  "order.cancelled":                 { icon: ShoppingCart, gradient: DANGER },
  "order.bulk_status_change":        { icon: ClipboardList, gradient: WARNING },
  "order.invoices_printed":          { icon: Printer, gradient: PRIMARY },
  "order.payment_recorded":          { icon: CreditCard, gradient: SUCCESS },
  "order.reopened":                  { icon: Undo2, gradient: WARNING },
  // Четыре действия писались в журнал (traceOrderChange), но подписи не имели
  // и показывались кодом — «order.update_items».
  "order.update":                    { icon: ShoppingCart, gradient: PRIMARY },
  "order.update_items":              { icon: ShoppingCart, gradient: PRIMARY },
  "order.delete":                    { icon: ShoppingCart, gradient: DANGER },
  "order.restore":                   { icon: Undo2, gradient: SUCCESS },
  "order.revenue_reversed":          { icon: Undo2, gradient: DANGER },
  "payment.reverse":                 { icon: Undo2, gradient: DANGER },
  "payment.bank_confirm":            { icon: Wallet, gradient: SUCCESS },
  // Касса
  "cash.handover":                   { icon: Wallet, gradient: SUCCESS },
  "cash.expense":                    { icon: Wallet, gradient: WARNING },
  "cash.deposit":                    { icon: Wallet, gradient: SUCCESS },
  "cash.withdrawal":                 { icon: Wallet, gradient: WARNING },
  "cash.write_off":                  { icon: Wallet, gradient: DANGER },
  "cash.storno":                     { icon: Undo2, gradient: DANGER },
  "cash.day_closed":                 { icon: Wallet, gradient: PRIMARY },
  "cash.day_reopened":               { icon: Undo2, gradient: WARNING },
  "return.status":                   { icon: Undo2, gradient: WARNING },
  // Магазины и цены
  "shop.credit_limit_changed":       { icon: Store, gradient: WARNING },
  "product.updated":                 { icon: Tag, gradient: PRIMARY },
  "product.deleted":                 { icon: Trash2, gradient: DANGER },
  "price_list.item_set":             { icon: Tag, gradient: PRIMARY },
  "price_list.deleted":              { icon: Trash2, gradient: DANGER },
  // Склад
  "stock.adjusted":                  { icon: Package, gradient: WARNING },
  "stock.transfer_completed":        { icon: Boxes, gradient: PRIMARY },
  // Ван-селлинг
  "van.enabled":                     { icon: Truck, gradient: SUCCESS },
  "van.disabled":                    { icon: Truck, gradient: WARNING },
  "van.created":                     { icon: Truck, gradient: PRIMARY },
  "van.updated":                     { icon: Truck, gradient: PRIMARY },
  "van.loaded":                      { icon: Truck, gradient: SUCCESS },
  "van.unloaded":                    { icon: Truck, gradient: PRIMARY },
  "van.counted":                     { icon: Truck, gradient: WARNING },
  "van.sale":                        { icon: Truck, gradient: SUCCESS },
  // Тара
  "tare.enabled":                    { icon: Boxes, gradient: SUCCESS },
  "tare.disabled":                   { icon: Boxes, gradient: WARNING },
  "tare.type_created":               { icon: Boxes, gradient: PRIMARY },
  "tare.type_updated":               { icon: Boxes, gradient: PRIMARY },
  "tare.product_set":                { icon: Boxes, gradient: PRIMARY },
  "tare.returned":                   { icon: Boxes, gradient: SUCCESS },
  "tare.charged":                    { icon: Boxes, gradient: DANGER },
  "stock_count.create":              { icon: ClipboardCheck, gradient: PRIMARY },
  "stock_count.apply":               { icon: ClipboardCheck, gradient: SUCCESS },
  "stock_count.cancel":              { icon: ClipboardCheck, gradient: DANGER },
  "arrival.completed":               { icon: Truck, gradient: SUCCESS },
  "product.cost_averaged":           { icon: Package, gradient: PRIMARY },
  "supplier.return_goods":           { icon: Truck, gradient: WARNING },
  "loading_list.created":            { icon: ClipboardList, gradient: PRIMARY },
  "loading_list.picked":             { icon: ClipboardList, gradient: SUCCESS },
  // Зарплата
  "salary.rate_set":                 { icon: Wallet, gradient: PRIMARY },
  "salary.fraud_deduction":          { icon: Wallet, gradient: DANGER },
  // Организация и система
  "settings.updated":                { icon: Settings, gradient: PRIMARY },
  "onec.config_saved":               { icon: Settings, gradient: INFO },
  "integration.onec_secret_rotated": { icon: Settings, gradient: INFO },
  "tenant.updated":                  { icon: Building2, gradient: DANGER },
  "tenant.extra_limits":             { icon: Building2, gradient: WARNING },
  "tenant.sandbox.create":           { icon: Building2, gradient: INFO },
  "tenant.manual_granted":           { icon: BookOpen, gradient: SUCCESS },
  "tenant.manual_revoked":           { icon: BookOpen, gradient: WARNING },
  "system.backup_downloaded":        { icon: Database, gradient: DANGER },
  "audit.purged":                    { icon: AlertTriangle, gradient: DANGER },
};

/*
  Ключ отбора без точки сервер понимает как «действие содержит слово»:
  «payment» ловит и order.payment_recorded, и payment.reverse; «stock» —
  и stock.adjusted, и stock_count.apply. Раньше сервер сравнивал точно, и
  все три кнопки отбора отдавали пустой журнал.
*/
const ACTION_FILTERS = [
  { key: "all",      label: { ru: "Все",           uz: "Hammasi" } },
  { key: "user",     label: { ru: "Пользователи",  uz: "Foydalanuvchilar" } },
  { key: "order",    label: { ru: "Заказы",        uz: "Buyurtmalar" } },
  { key: "payment",  label: { ru: "Оплаты",        uz: "To'lovlar" } },
  { key: "shop",     label: { ru: "Магазины",      uz: "Do'konlar" } },
  { key: "stock",    label: { ru: "Склад",          uz: "Ombor" } },
  { key: "tenant",   label: { ru: "Организация",   uz: "Tashkilot" } },
];

function formatTime(date: Date | string, lang: string): string {
  return format(new Date(date), "dd MMM yyyy, HH:mm", { locale: lang === "ru" ? dateRu : undefined });
}

/** Начало периода по кнопке: сегодня / 7 дней / 30 дней — по местному времени. */
function periodFrom(preset: string): string | undefined {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (preset === "today") return d.toISOString();
  if (preset === "week") { d.setDate(d.getDate() - 6); return d.toISOString(); }
  if (preset === "month") { d.setDate(d.getDate() - 29); return d.toISOString(); }
  return undefined;
}

const btn = (active: boolean): React.CSSProperties => ({
  display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
  fontSize: "12px", fontWeight: 600, fontFamily: F.body, borderRadius: "10px",
  border: "none", cursor: "pointer", transition: "all 0.2s", whiteSpace: "nowrap",
  background: active ? COLORS.primary : COLORS.surfaceLight,
  color: active ? "#fff" : COLORS.textSecondary,
  boxShadow: active ? "0 2px 8px color-mix(in srgb, var(--color-primary) 25%, transparent)" : "none",
});

// ── Main component ────────────────────────────────────────────────────────────
export default function AuditLog() {
  const { lang } = useLang();
  const L: Lang = lang === "uz" ? "uz" : "ru";
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [actionFilter, setActionFilter] = useState("");
  const [actorId, setActorId] = useState("");
  const [period, setPeriod] = useState<"all" | "today" | "week" | "month" | "custom">("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  useScrollTopOnChange(page);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const limit = 50;

  /*
    Поиск уходит на сервер с задержкой: журнал ищет по подписям, людям и
    подробностям, и запрос на каждую букву — лишние обращения к базе.
  */
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const h = setTimeout(() => { setDebounced(search.trim()); setPage(0); }, 300); return () => clearTimeout(h); }, [search]);

  const filters = {
    action: actionFilter || undefined,
    actorId: actorId ? Number(actorId) : undefined,
    search: debounced || undefined,
    dateFrom: period === "custom" ? (dateFrom ? new Date(dateFrom).toISOString() : undefined) : periodFrom(period),
    dateTo: period === "custom" && dateTo ? new Date(`${dateTo}T23:59:59.999`).toISOString() : undefined,
  };
  const { data, isLoading, refetch, isRefetching } = trpc.audit.list.useQuery({ ...filters, limit, offset: page * limit });
  const { data: actors } = trpc.audit.actors.useQuery();
  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;
  const reset = () => setPage(0);

  /*
    Выгрузка аудита — с теми же отборами, что на экране: разбирают спор по
    бумаге и целиком, но за нужный период и по нужному человеку. CSV собирает
    СЕРВЕР, здесь его только сохраняют.
  */
  const [exporting, setExporting] = useState(false);
  const utils = trpc.useUtils();
  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await utils.audit.exportCsv.fetch(filters);
      if (!res.rows) { notify.info(t("Нечего выгружать", "Yuklab olish uchun hech narsa yo'q")); return; }
      // BOM — иначе Excel читает кириллицу в UTF-8 как знаки вопроса.
      const blob = new Blob(["﻿" + res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      URL.revokeObjectURL(url);
      notify.success(t(`Выгружено записей: ${res.rows}`, `Yozuvlar yuklandi: ${res.rows}`));
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const PERIODS: Array<{ key: typeof period; label: Label }> = [
    { key: "today", label: { ru: "Сегодня", uz: "Bugun" } },
    { key: "week", label: { ru: "7 дней", uz: "7 kun" } },
    { key: "month", label: { ru: "30 дней", uz: "30 kun" } },
    { key: "all", label: { ru: "Всё время", uz: "Hamma vaqt" } },
    { key: "custom", label: { ru: "Период…", uz: "Davr…" } },
  ];
  const inputStyle: React.CSSProperties = {
    padding: "8px 12px", fontSize: "13px", fontFamily: F.body, borderRadius: "10px",
    border: `1px solid ${COLORS.border}`, background: COLORS.surface, color: COLORS.textPrimary,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.025em", margin: 0, display: "flex", alignItems: "center", gap: "10px" }}>
            <Shield size={24} style={{ color: COLORS.primaryText }} />
            {t("Журнал действий", "Harakatlar jurnali")}
          </h1>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: "4px 0 0" }}>
            {t("Кто, что и когда сделал в вашей организации", "Tashkilotingizda kim, nima va qachon qildi")}
            {data ? ` · ${t("записей", "yozuvlar")}: ${data.total}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={() => refetch()} disabled={isRefetching} style={{ ...inputStyle, display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", color: COLORS.textSecondary, opacity: isRefetching ? 0.6 : 1 }}>
            <RefreshCw size={14} style={{ animation: isRefetching ? "spin 1s linear infinite" : undefined }} />
            {t("Обновить", "Yangilash")}
          </button>
          <button onClick={handleExport} disabled={exporting} style={{ ...inputStyle, display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", color: COLORS.textSecondary, opacity: exporting ? 0.6 : 1 }}>
            <Download size={14} />
            {t("Выгрузить CSV", "CSV yuklab olish")}
          </button>
        </div>
      </div>

      {/* Отбор: слово, человек, период */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 260px", minWidth: "200px" }}>
          <Search size={15} style={{ position: "absolute", left: "11px", top: "10px", color: COLORS.textTertiary, pointerEvents: "none" }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t("Магазин, номер заказа, товар, сотрудник…", "Do'kon, buyurtma raqami, tovar, xodim…")}
            aria-label={t("Поиск по журналу", "Jurnal bo'yicha qidiruv")}
            style={{ ...inputStyle, width: "100%", paddingLeft: "34px" }}
          />
        </div>
        <PremiumSelect
          aria-label={t("Сотрудник", "Xodim")}
          value={actorId}
          onChange={v => { setActorId(v); reset(); }}
          width="220px"
          options={[{ value: "", label: t("Все сотрудники", "Barcha xodimlar") }, ...(actors ?? []).map(a => ({ value: String(a.id), label: a.name }))]}
        />
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => { setPeriod(p.key); reset(); }} style={btn(period === p.key)}>{p.label[L]}</button>
          ))}
        </div>
        {period === "custom" && (
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); reset(); }} aria-label={t("С даты", "Sanadan")} style={inputStyle} />
            <span style={{ color: COLORS.textTertiary }}>—</span>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); reset(); }} aria-label={t("По дату", "Sanagacha")} style={inputStyle} />
          </div>
        )}
      </div>

      {/* Отбор по виду действия */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", overflowX: "auto", paddingBottom: "4px" }}>
        {ACTION_FILTERS.map((f) => {
          const active = (f.key === "all" && !actionFilter) || actionFilter === f.key;
          return (
            <button key={f.key} onClick={() => { setActionFilter(f.key === "all" ? "" : f.key); reset(); }} style={btn(active)}>
              {f.key === "all" && <Filter size={12} />}
              {f.label[L]}
            </button>
          );
        })}
      </div>

      {/* Записи */}
      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} style={{ height: "72px", borderRadius: "24px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease` }} />
          ))}
        </div>
      ) : !data?.data || data.data.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 0", background: COLORS.surface, borderRadius: "24px", boxShadow: SHADOW }}>
          <Shield size={40} style={{ margin: "0 auto 14px", opacity: 0.15, color: COLORS.textTertiary }} />
          <p style={{ fontSize: "14px", color: COLORS.textSecondary, fontFamily: F.body, margin: 0 }}>
            {debounced || actorId || actionFilter || period !== "all"
              ? t("По этому отбору записей нет — расширьте период или уберите слово", "Bu tanlov bo'yicha yozuvlar yo'q — davrni kengaytiring yoki so'zni olib tashlang")
              : t("Записей пока нет", "Yozuvlar hali yo'q")}
          </p>
        </div>
      ) : (
        <div style={{ background: COLORS.surface, borderRadius: "24px", boxShadow: SHADOW, overflow: "hidden" }}>
          {data.data.map((entry, i) => {
            const config = ACTION_CONFIG[entry.action] ?? { icon: Shield, gradient: "var(--color-text-tertiary)" };
            const actionLabel = AUDIT_ACTION_LABEL[entry.action]?.[L] ?? entry.action;
            const Icon = config.icon;
            const isLast = i === data.data.length - 1;
            const isExpanded = expandedId === entry.id;
            const details = describeMeta(entry.meta as Record<string, unknown> | null, L, entry.targetLabel);

            return (
              <div key={entry.id} style={{ borderBottom: isLast ? "none" : `1px solid ${COLORS.border}`, animation: `slideUp ${0.4 + i * 0.03}s ease` }}>
                <div
                  role="button" tabIndex={0}
                  style={{ display: "flex", alignItems: "flex-start", gap: "14px", padding: "14px 20px", cursor: "pointer", transition: "background 0.15s" }}
                  onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandedId(isExpanded ? null : entry.id); } }}
                  onMouseEnter={e => (e.currentTarget.style.background = "color-mix(in srgb, var(--color-primary) 2%, transparent)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: config.gradient, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon size={16} color="#fff" />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                      <p style={{ fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, fontFamily: F.display, margin: 0 }}>
                        {actionLabel}
                        {entry.targetLabel && <span style={{ fontWeight: 500, color: COLORS.textSecondary }}> — {entry.targetLabel}</span>}
                      </p>
                      <p style={{ fontSize: "12px", color: COLORS.textTertiary, margin: 0, whiteSpace: "nowrap" }}>
                        {entry.createdAt ? formatTime(entry.createdAt, lang) : ""}
                      </p>
                    </div>
                    {/* Кто и что именно: без ключей из кода */}
                    <p style={{ fontSize: "12.5px", color: COLORS.textSecondary, margin: "4px 0 0", fontFamily: F.body, overflowWrap: "anywhere" }}>
                      <span style={{ fontWeight: 600 }}>{entry.actorName ?? t("Система", "Tizim")}</span>
                      {details ? ` · ${details}` : ""}
                    </p>

                    {isExpanded && (
                      <div style={{ marginTop: "10px", padding: "10px 14px", borderRadius: "12px", background: COLORS.surfaceLight, border: `1px solid ${COLORS.border}`, fontSize: "11.5px", color: COLORS.textTertiary, fontFamily: "monospace", overflowWrap: "anywhere" }}>
                        <div>{t("Запись", "Yozuv")} #{entry.id} · {entry.action}{entry.targetType ? ` · ${entry.targetType} #${entry.targetId}` : ""}{entry.ip ? ` · IP ${entry.ip}` : ""}</div>
                        {entry.meta !== null && Object.keys(entry.meta as object).length > 0 ? <div style={{ marginTop: "4px" }}>{JSON.stringify(entry.meta)}</div> : null}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Страницы */}
      {data && data.total > limit && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", background: COLORS.surface, borderRadius: "16px", padding: "12px", boxShadow: SHADOW }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ ...inputStyle, display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", color: COLORS.textSecondary, opacity: page === 0 ? 0.4 : 1 }}>
            <ChevronLeft size={14} /> {t("Назад", "Orqaga")}
          </button>
          <span style={{ fontSize: "12px", fontWeight: 600, color: COLORS.textSecondary, fontFamily: F.display }}>{page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={{ ...inputStyle, display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", color: COLORS.textSecondary, opacity: page >= totalPages - 1 ? 0.4 : 1 }}>
            {t("Далее", "Keyingi")} <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
