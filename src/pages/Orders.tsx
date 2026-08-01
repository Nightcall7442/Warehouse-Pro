import { memo, useCallback, useMemo, useState } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { useNavigate, useSearchParams } from "react-router";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import {
  Search, Plus, FileDown, ChevronRight, Store, User,
  ShoppingCart, Clock, CheckCircle2, XCircle, DollarSign,
  ArrowUpRight, ArrowDownRight, Minus, Trash2, RotateCcw, Printer,
  CheckSquare, Square, LayoutGrid, Table as TableIcon, Eye,
} from "lucide-react";
import { format, startOfMonth } from "date-fns";
import { exportToExcel, formatOrdersForExport } from "@/lib/excel";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { exportToPDF } from "@/lib/export";
import { PremiumSelect } from "@/components/PremiumSelect";
import { useConfirm } from "@/components/ConfirmDialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrderFilterChips, type ActiveFilters } from "@/components/orders/OrderFilterChips";
import { OrderBulkActions } from "@/components/orders/OrderBulkActions";
import { InvoicePrintModal } from "@/components/orders/InvoicePrintModal";
import { LoadingListModal } from "@/components/orders/LoadingListModal";
import { OrderSlideOver } from "@/components/orders/OrderSlideOver";
import { OrderKanbanBoard } from "@/components/orders/OrderKanbanBoard";
import { QuickOrderModal } from "@/components/orders/QuickOrderModal";

/* ─── Premium Design Constants ─── */
const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };
const COLORS = {
  primary: "#5b6d8a", success: "#34c473",
  warning: "#d4973a", danger: "#d45050",
  surface: "var(--color-surface, #ffffff)", surfaceLight: "var(--color-surface-light, #f0f3f8)",
  textPrimary: "var(--color-text-primary, #2b3450)", textSecondary: "var(--color-text-secondary, #6a7290)",
  textTertiary: "var(--color-text-tertiary, #98a0b8)", border: "var(--color-border, #f0f3f8)",
};
const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

/* ─── Payment Method Config ─── */
const PAYMENT: Record<string, { ru: string; uz: string; color: string }> = {
  cash:     { ru: "Наличные",     uz: "Naqd",      color: "#34c473" },
  transfer: { ru: "Перечисление", uz: "O'tkazma",  color: "#5b6d8a" },
  debt:     { ru: "Долг",         uz: "Qarz",      color: "#d4973a" },
  card:     { ru: "Карта",        uz: "Plastik",   color: "#9b59b6" },
};

/* ─── Status Config ─── */
const STATUS: Record<string, { ru: string; uz: string; dot: string; bg: string; text: string; border: string }> = {
  new:                  { ru: "Новый",            uz: "Yangi",              dot: "#5b6d8a", bg: "bg-info/10",    text: "text-info",    border: "border-info/25" },
  processing:           { ru: "В обработке",      uz: "Jarayonda",          dot: "#d4973a", bg: "bg-warning/10", text: "text-warning", border: "border-warning/25" },
  completed:            { ru: "Выполнен",         uz: "Bajarildi",          dot: "#34c473", bg: "bg-success/10", text: "text-success", border: "border-success/25" },
  cancelled:            { ru: "Отменён",          uz: "Bekor qilindi",      dot: "#d45050", bg: "bg-danger/10",  text: "text-danger",  border: "border-danger/25" },
  partially_delivered:  { ru: "Част. доставка",   uz: "Qisman yetkazildi",  dot: "#d4973a", bg: "bg-warning/10", text: "text-warning", border: "border-warning/25" },
  partially_paid:       { ru: "Част. оплата",     uz: "Qisman to'landi",    dot: "#5b6d8a", bg: "bg-info/10",    text: "text-info",    border: "border-info/25" },
};

/* ─── Premium KpiCard Component ─── */
function KpiCard({ label, value, delta, icon, gradient, delay }: {
  label: string; value: string; delta: number | null;
  icon: React.ReactNode; gradient: string; delay: number;
}) {
  const isPositive = delta !== null && delta > 0;
  const isNegative = delta !== null && delta < 0;
  return (
    <div className="kpi-hero" style={{
      borderRadius: "24px", padding: "24px",
      position: "relative", overflow: "hidden",
      animation: `slideUp ${0.5 + delay}s ease forwards`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>
          {label}
        </span>
        <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon}
        </div>
      </div>
      <div style={{ fontFamily: F.display, fontSize: "32px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
        {value}
      </div>
      {delta !== null && (
        <div style={{
          display: "flex", alignItems: "center", gap: "4px", marginTop: "10px",
          fontSize: "12px", fontWeight: 600, fontFamily: F.body,
          color: isPositive ? "#34c473" : isNegative ? "#d45050" : COLORS.textTertiary,
        }}>
          {isPositive ? <ArrowUpRight size={14} /> : isNegative ? <ArrowDownRight size={14} /> : <Minus size={14} />}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

/* ─── Status Badge ─── */
const StatusBadge = memo(function StatusBadge({ status, lang }: { status: string; lang: "ru" | "uz" }) {
  const s = STATUS[status] ?? STATUS.new;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "6px",
      padding: "4px 10px", borderRadius: "9999px", fontSize: "11px", fontWeight: 500,
      fontFamily: F.body, border: `1px solid ${s.dot}25`,
      background: `${s.dot}15`, color: s.dot,
    }}>
      <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: s.dot, flexShrink: 0 }} />
      {lang === "uz" ? s.uz : s.ru}
    </span>
  );
});

export default function Orders() {
  const [page, setPage]     = useState(1);
  const { fmt, symbol }     = useCurrency();
  const { lang }            = useLang();
  const [search, setSearch] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const isMobile            = useIsMobile();
  const navigate            = useNavigate();
  const [searchParams]      = useSearchParams();
  const utils               = trpc.useUtils();
  const { user }            = useAuth();
  const isCeo               = user?.role === "ceo";
  const isOperator          = user?.role === "operator";
  const isOperatorOrCeo     = isCeo || isOperator;
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { confirm, dialog } = useConfirm();
  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);

  const [status, setStatus] = useState(searchParams.get("status") ?? "");

  // ── New feature state ──
  const [viewMode, setViewMode] = useState<"table" | "kanban">("table");
  const [chipFilters, setChipFilters] = useState<ActiveFilters>({});
  const [slideOverOrderId, setSlideOverOrderId] = useState<number | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showLoadingListModal, setShowLoadingListModal] = useState(false);
  const [showQuickOrder, setShowQuickOrder] = useState(false);

  const { data: savedFilters } = trpc.order.listFilters.useQuery();
  const saveFilterMut = trpc.order.saveFilter.useMutation({
    onSuccess: () => { utils.order.listFilters.invalidate(); notify.success(t("Фильтр сохранён", "Filter saqlandi")); },
  });
  const deleteFilterMut = trpc.order.deleteFilter.useMutation({
    onSuccess: () => utils.order.listFilters.invalidate(),
  });
  const bulkUpdateStatus = trpc.order.bulkUpdateStatus.useMutation({
    onSuccess: (r) => { utils.order.list.invalidate(); setSelected(new Set()); notify.success(t(`Обновлено: ${r.updated}`, `Yangilandi: ${r.updated}`)); },
    onError: (e) => notify.error(e.message),
  });
  const bulkAssignAgent = trpc.order.bulkAssignAgent.useMutation({
    onSuccess: (r) => { utils.order.list.invalidate(); setSelected(new Set()); notify.success(t(`Назначено: ${r.updated}`, `Tayinlandi: ${r.updated}`)); },
    onError: (e) => notify.error(e.message),
  });
  const { data: agentsData } = trpc.user.list.useQuery({ role: "agent", pageSize: 200 });

  // Apply chip filters to date range
  const effectiveDateFrom = useMemo(() => {
    if (chipFilters.datePreset === "today") return format(new Date(), "yyyy-MM-dd");
    if (chipFilters.datePreset === "yesterday") { const d = new Date(); d.setDate(d.getDate() - 1); return format(d, "yyyy-MM-dd"); }
    if (chipFilters.datePreset === "week") { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return format(d, "yyyy-MM-dd"); }
    if (chipFilters.datePreset === "month") return format(startOfMonth(new Date()), "yyyy-MM-dd");
    return dateFrom;
  }, [chipFilters.datePreset, dateFrom]);
  const effectiveDateTo = useMemo(() => {
    if (chipFilters.datePreset) return format(new Date(), "yyyy-MM-dd");
    return dateTo;
  }, [chipFilters.datePreset, dateTo]);
  const effectiveStatus = chipFilters.status ?? status;
  const effectivePaymentMethod = chipFilters.paymentMethod;

  const { data, isLoading, isError, refetch } = trpc.order.list.useQuery({
    page, pageSize: 25,
    search: search || undefined,
    status: (effectiveStatus || undefined) as "new" | "processing" | "completed" | "cancelled" | undefined,
    showDeleted: isOperatorOrCeo && showDeleted ? true : undefined,
    dateFrom: effectiveDateFrom || undefined,
    dateTo: effectiveDateTo || undefined,
    paymentMethod: effectivePaymentMethod as "cash" | "card" | "transfer" | "debt" | undefined,
  });

  const { data: allOrders, refetch: refetchAllOrders } = trpc.order.list.useQuery(
    { page: 1, pageSize: 5000, showDeleted: false, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
    { enabled: false }
  );

  const updateStatus = trpc.order.updateStatus.useMutation({
    onSuccess: () => { utils.order.list.invalidate(); notify.success("Заказ обновлён"); },
    onError:   (e) => notify.error(e.message),
  });

  const deleteOrder = trpc.order.delete.useMutation({
    onSuccess: () => { utils.order.list.invalidate(); notify.success("Заказ удалён"); },
    onError:   (e) => notify.error(e.message),
  });

  const restoreOrder = trpc.order.restore.useMutation({
    onSuccess: () => { utils.order.list.invalidate(); notify.success("Заказ восстановлен"); },
    onError:   (e) => notify.error(e.message),
  });

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const handleExport = useCallback(async () => {
    const result = await refetchAllOrders();
    if (!result.data?.data) return;
    await exportToExcel(formatOrdersForExport(result.data.data), `orders-${dateFrom}-${dateTo}`, "Заказы", `Заказы ${dateFrom} — ${dateTo}`);
  }, [refetchAllOrders, dateFrom, dateTo]);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const handleExportPDF = useCallback(async () => {
    const result = await refetchAllOrders();
    if (!result.data?.data) return;
    const fmtNum = (n: number) => n.toLocaleString("ru");
    let html = `<div class="section"><h2>Заказы за ${dateFrom} — ${dateTo}</h2>
      <table><thead><tr><th>№</th><th>Дата</th><th>Магазин</th><th>Агент</th><th>Статус</th><th class="right">Сумма</th></tr></thead><tbody>`;
    for (const o of result.data.data) {
      const dateStr = o.createdAt ? format(new Date(o.createdAt), "dd.MM.yyyy") : "—";
      html += `<tr><td>${o.orderNumber}</td><td>${dateStr}</td><td>${o.shopName ?? "—"}</td><td>${o.agentName ?? "—"}</td><td>${o.status}</td><td class="right bold">${fmtNum(Number(o.total ?? 0))}</td></tr>`;
    }
    html += `</tbody></table></div>`;
    const total = result.data.data.reduce((s: number, o: { total?: string | null }) => s + Number(o.total ?? 0), 0);
    html += `<div style="margin-top:16px;text-align:right;font-size:14px;font-weight:700">Итого: ${fmtNum(total)} сум · ${result.data.data.length} заказов</div>`;
    exportToPDF(`Заказы ${dateFrom} — ${dateTo}`, html);
  }, [refetchAllOrders, dateFrom, dateTo]);

  const handleNewOrder = useCallback(() => navigate("/orders/new"), [navigate]);

  const allVisibleIds = useMemo(() => (data?.data ?? []).map(o => o.id as number), [data]);
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => selected.has(id));

  const toggleSelect = useCallback((id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(allVisibleIds));
  }, [allSelected, allVisibleIds]);

  const selectedNewIds = useMemo(
    () => (data?.data ?? []).filter(o => selected.has(o.id as number) && o.status === "new").map(o => o.id as number),
    [data, selected],
  );
  const selectedProcessingIds = useMemo(
    () => (data?.data ?? []).filter(o => selected.has(o.id as number) && o.status === "processing").map(o => o.id as number),
    [data, selected],
  );

  const handleBulkStatus = useCallback(async (ids: number[], status: string) => {
    if (ids.length === 0) return;
    for (const id of ids) {
      await updateStatus.mutateAsync({ id, status });
    }
    setSelected(new Set());
  }, [updateStatus]);

  const handleExportSelected = useCallback(async () => {
    const result = await refetchAllOrders();
    if (!result.data?.data) return;
    const rows = result.data.data.filter((o: { id: number }) => selected.has(o.id));
    if (rows.length === 0) return;
    await exportToExcel(formatOrdersForExport(rows), `orders-selected`, "Заказы", `Выбранные заказы`);
  }, [refetchAllOrders, selected]);

  /* ─── Compute KPI stats from current page data ─── */
  const stats = useMemo(() => {
    const orders = data?.data ?? [];
    const total = orders.length;
    const newCount = orders.filter(o => o.status === "new").length;
    const processingCount = orders.filter(o => o.status === "processing").length;
    const completedCount = orders.filter(o => o.status === "completed").length;
    const cancelledCount = orders.filter(o => o.status === "cancelled").length;
    const totalRevenue = orders.reduce((sum, o) => sum + Number(o.total ?? 0), 0);
    return { total, newCount, processingCount, completedCount, cancelledCount, totalRevenue };
  }, [data?.data]);

  if (isError) return <QueryErrorFallback onRetry={refetch} />;

  return (
    <>
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* ─── Header ─── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.025em", margin: 0 }}>
            {t("Заказы", "Buyurtmalar")}
          </h1>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: "4px 0 0" }}>
            {t("Управление заказами и отслеживание статусов", "Buyurtmalarni boshqarish va holatni kuzatish")}
            {data && (
              <span style={{ marginLeft: "8px", fontSize: "12px", color: COLORS.textTertiary }}>
                {data.total} {t("всего", "jami")}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: "6px 10px", borderRadius: "8px", border: `1px solid ${COLORS.border}`, fontSize: "12px", fontFamily: F.body, color: COLORS.textPrimary, background: COLORS.surface }} />
          <span style={{ color: COLORS.textTertiary, fontSize: "12px" }}>—</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: "6px 10px", borderRadius: "8px", border: `1px solid ${COLORS.border}`, fontSize: "12px", fontFamily: F.body, color: COLORS.textPrimary, background: COLORS.surface }} />
          <button onClick={handleExport} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
            border: `1px solid ${COLORS.border}`, cursor: "pointer",
            background: COLORS.surface, color: COLORS.textSecondary,
          }}>
            <FileDown size={14} /> Excel
          </button>
          <button onClick={handleExportPDF} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
            border: `1px solid ${COLORS.border}`, cursor: "pointer",
            background: COLORS.surface, color: COLORS.textSecondary,
          }}>
            <Printer size={14} /> PDF
          </button>
          <button onClick={() => setShowQuickOrder(true)} className="neo-btn-primary neo-btn-sm">
            <Plus size={16} />
            <span>{t("Новый заказ", "Yangi buyurtma")}</span>
          </button>
        </div>
      </div>

      {/* ─── KPI Cards ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        <KpiCard
          label={t("ВСЕГО ЗАКАЗОВ", "JAMI BUYURTMA")}
          value={stats.total.toLocaleString()}
          delta={null}
          icon={<ShoppingCart size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #5b6d8a, #5b6d8a)"
          delay={0}
        />
        <KpiCard
          label={t("НОВЫЕ", "YANGI")}
          value={stats.newCount.toLocaleString()}
          delta={null}
          icon={<Clock size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #60a5fa, #3b82f6)"
          delay={0.05}
        />
        <KpiCard
          label={t("В РАБОТЕ", "JARAYONDA")}
          value={stats.processingCount.toLocaleString()}
          delta={null}
          icon={<Clock size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #d4973a, #f59e0b)"
          delay={0.1}
        />
        <KpiCard
          label={t("ВЫПОЛНЕНЫ", "BAJARILDI")}
          value={stats.completedCount.toLocaleString()}
          delta={null}
          icon={<CheckCircle2 size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #10B981, #059669)"
          delay={0.15}
        />
        <KpiCard
          label={t("ОТМЕНЕНЫ", "BEKOR QILINDI")}
          value={stats.cancelledCount.toLocaleString()}
          delta={null}
          icon={<XCircle size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #d45050, #d45050)"
          delay={0.2}
        />
        <KpiCard
          label={t("ВЫРУЧКА", "TUSHUM")}
          value={fmt(stats.totalRevenue)}
          delta={null}
          icon={<DollarSign size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #16a34a, #22c47a)"
          delay={0.25}
        />
      </div>

      {/* ─── View Mode Toggle + Filter Chips ─── */}
      {!isMobile && (
        <div className="flex items-center justify-between">
          <OrderFilterChips
            filters={chipFilters}
            onChange={setChipFilters}
            savedFilters={savedFilters?.map(f => ({ id: f.id, name: f.name, filterConfig: f.filterConfig }))}
            onSave={(name, config) => saveFilterMut.mutate({ name, config: config as Record<string, unknown> })}
            onDelete={(id) => deleteFilterMut.mutate({ id })}
            onLoad={setChipFilters}
          />
          <Tabs value={viewMode} onValueChange={v => setViewMode(v as typeof viewMode)}>
            <TabsList className="h-8">
              <TabsTrigger value="table" className="px-2.5 h-6 text-xs"><TableIcon className="h-3.5 w-3.5" /></TabsTrigger>
              <TabsTrigger value="kanban" className="px-2.5 h-6 text-xs"><LayoutGrid className="h-3.5 w-3.5" /></TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* ─── Filters ─── */}
      <div style={{
        display: "flex", gap: "12px", flexWrap: "wrap",
        background: COLORS.surface, borderRadius: "16px", padding: "16px 20px",
        boxShadow: SHADOW,
      }}>
        <div style={{ position: "relative", flex: "1 1 160px" }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: COLORS.textSecondary }} />
          <input
            style={{
              width: "100%", padding: "10px 12px 10px 36px", fontSize: "13px", fontFamily: F.body,
              borderRadius: "10px", border: `1px solid ${COLORS.border}`,
              background: COLORS.surfaceLight, color: COLORS.textPrimary, outline: "none",
            }}
            placeholder={t("Поиск заказов…", "Buyurtma qidirish…")}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <PremiumSelect value={status} onChange={v => { setStatus(v); setPage(1); }}
          options={[{value:"",label:t("Все статусы","Barcha holatlar")},...Object.entries(STATUS).map(([k,v])=>({value:k,label:lang==="uz"?v.uz:v.ru}))]}
          width="180px" />
        {isOperatorOrCeo && (
          <button
            onClick={() => setShowDeleted(v => !v)}
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
              fontSize: "12px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
              border: `1px solid ${showDeleted ? COLORS.danger : COLORS.border}`, cursor: "pointer",
              background: showDeleted ? `${COLORS.danger}15` : COLORS.surfaceLight,
              color: showDeleted ? COLORS.danger : COLORS.textSecondary,
            }}
          >
            <Trash2 size={13} />
            {showDeleted ? t("Скрыть удалённые", "O'chirilganlarni yashirish") : t("Показать удалённые", "O'chirilganlarni ko'rsatish")}
          </button>
        )}
      </div>

      {/* Kanban view */}
      {viewMode === "kanban" && !isMobile && (
        <OrderKanbanBoard
          orders={(data?.data ?? []).map(o => ({
            id: o.id as number,
            orderNumber: o.orderNumber,
            status: o.status,
            total: o.total ?? "0",
            shopName: o.shopName,
            agentName: o.agentName,
            paymentMethod: o.paymentMethod ?? "cash",
          }))}
          onOrderClick={setSlideOverOrderId}
          onStatusChange={(orderId, newStatus) => updateStatus.mutate({ id: orderId, status: newStatus as "new" | "processing" | "completed" | "cancelled" })}
          currency={symbol}
        />
      )}

      {/* ─── Mobile Cards ─── */}
      {isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ height: "88px", borderRadius: "16px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease forwards` }} />
              ))
            : data?.data.length === 0
            ? <p style={{ textAlign: "center", color: COLORS.textSecondary, padding: "56px 0", fontSize: "13px", fontFamily: F.body }}>{t("Нет заказов", "Buyurtma yo'q")}</p>
            : data?.data.map(o => {
                const s = STATUS[o.status] ?? STATUS.new;
                return (
                  <div
                    key={o.id}
                    style={{
                      background: COLORS.surface, borderRadius: "16px", overflow: "hidden",
                      cursor: "pointer", boxShadow: SHADOW, transition: "transform 0.15s",
                      animation: `slideUp ${0.4 + 0.02}s ease forwards`,
                    }}
                    onClick={() => navigate(`/orders/${o.id}`)}
                  >
                    <div style={{ display: "flex" }}>
                      <div style={{ width: "4px", flexShrink: 0, borderRadius: "16px 0 0 16px", background: s.dot }} />
                      <div style={{ flex: 1, padding: "14px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                          <span style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary }}>
                            {o.orderNumber}
                          </span>
                          <StatusBadge status={o.status} lang={lang} />
                        </div>
                        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <Store size={12} style={{ color: COLORS.textSecondary, flexShrink: 0 }} />
                              <span style={{ fontSize: "13px", color: COLORS.textPrimary, maxWidth: "160px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {o.shopName ?? "—"}
                              </span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                              <User size={12} style={{ color: COLORS.textSecondary, flexShrink: 0 }} />
                              <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>
                                {o.agentName ?? "—"} · {o.createdAt ? format(new Date(o.createdAt), "d MMM") : ""}
                              </span>
                            </div>
                            {o.paymentMethod && PAYMENT[o.paymentMethod] && (
                              <span style={{
                                display: "inline-flex", alignItems: "center", gap: "4px", marginTop: "4px",
                                fontSize: "10px", fontWeight: 600, color: PAYMENT[o.paymentMethod].color,
                                background: `${PAYMENT[o.paymentMethod].color}12`,
                                padding: "2px 6px", borderRadius: "4px",
                              }}>
                                {PAYMENT[o.paymentMethod][lang]}
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 700, color: COLORS.textPrimary }}>
                              {fmt(o.total)}
                            </span>
                            <ChevronRight size={15} style={{ color: COLORS.textSecondary }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
        </div>
      ) : viewMode === "kanban" ? null : (
        /* ─── Desktop Table ─── */
        <div style={{
          background: COLORS.surface, borderRadius: "24px", overflow: "hidden",
          boxShadow: SHADOW,
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: COLORS.surfaceLight }}>
                <th style={{ width: "40px", padding: "12px 8px 12px 16px", textAlign: "center" }}>
                  <button onClick={toggleSelectAll} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {allSelected
                      ? <CheckSquare size={16} style={{ color: COLORS.primary }} />
                      : <Square size={16} style={{ color: COLORS.textTertiary }} />
                    }
                  </button>
                </th>
                {[
                  t("ЗАКАЗ",  "BUYURTMA"),
                  t("ДАТА",   "SANA"),
                  t("МАГАЗИН","DO'KON"),
                  t("АГЕНТ",  "AGENT"),
                  t("ОПЛАТА", "TO'LOV"),
                  t("ИТОГО",  "JAMI"),
                  t("СТАТУС", "HOLAT"),
                  t("ДЕЙСТВИЯ","AMALLAR"),
                ].map(h => (
                  <th key={h} style={{
                    textAlign: "left", padding: "12px 16px",
                    fontFamily: F.display, fontSize: "10px", fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "0.08em",
                    color: COLORS.textTertiary, borderBottom: `1px solid ${COLORS.border}`,
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                      <td colSpan={9} style={{ padding: "16px" }}>
                        <div style={{ height: "16px", borderRadius: "6px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease forwards` }} />
                      </td>
                    </tr>
                  ))
                : data?.data.length === 0
                ? <tr><td colSpan={9} style={{ padding: "56px 16px", textAlign: "center", color: COLORS.textSecondary, fontSize: "13px", fontFamily: F.body }}>{t("Нет заказов", "Buyurtma yo'q")}</td></tr>
                : data?.data.map(o => (
                    <tr
                      key={o.id}
                      style={{
                        borderBottom: `1px solid ${COLORS.border}`,
                        cursor: "pointer", transition: "background 0.15s",
                        opacity: o.deletedAt ? 0.5 : 1,
                        background: o.deletedAt ? `${COLORS.danger}08` : "transparent",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = `${COLORS.surfaceLight}80`)}
                      onMouseLeave={e => (e.currentTarget.style.background = o.deletedAt ? `${COLORS.danger}08` : "transparent")}
                      onClick={() => setSlideOverOrderId(o.id as number)}
                    >
                      <td style={{ padding: "14px 8px 14px 16px", textAlign: "center" }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => toggleSelect(o.id as number)}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {selected.has(o.id as number)
                            ? <CheckSquare size={16} style={{ color: COLORS.primary }} />
                            : <Square size={16} style={{ color: COLORS.textTertiary }} />
                          }
                        </button>
                      </td>
                      <td style={{ padding: "14px 16px", fontFamily: F.display, fontSize: "13px", fontWeight: 600, color: COLORS.primary }}>
                        <span className="flex items-center gap-1">{o.orderNumber} <Eye className="h-3 w-3 opacity-0 group-hover:opacity-50" /></span>
                      </td>
                      <td style={{ padding: "14px 16px", fontSize: "13px", color: COLORS.textSecondary }}>
                        {o.createdAt ? format(new Date(o.createdAt), "dd.MM.yyyy") : ""}
                      </td>
                      <td style={{ padding: "14px 16px", fontSize: "13px", color: COLORS.textPrimary }}>{o.shopName ?? "—"}</td>
                      <td style={{ padding: "14px 16px", fontSize: "13px", color: COLORS.textSecondary }}>{o.agentName ?? "—"}</td>
                      <td style={{ padding: "14px 16px" }}>
                        {o.paymentMethod && PAYMENT[o.paymentMethod] ? (
                          <span style={{
                            display: "inline-flex", alignItems: "center", gap: "4px",
                            fontSize: "11px", fontWeight: 600, color: PAYMENT[o.paymentMethod].color,
                            background: `${PAYMENT[o.paymentMethod].color}12`,
                            padding: "3px 8px", borderRadius: "6px",
                          }}>
                            {PAYMENT[o.paymentMethod][lang]}
                          </span>
                        ) : "—"}
                      </td>
                      <td style={{ padding: "14px 16px", fontFamily: F.display, fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary }}>{fmt(o.total)}</td>
                      <td style={{ padding: "14px 16px" }}>
                        <StatusBadge status={o.status} lang={lang} />
                      </td>
                      <td style={{ padding: "14px 16px" }} onClick={e => e.stopPropagation()}>
                        {o.deletedAt ? (
                          isOperatorOrCeo && (
                            <button
                              onClick={() => restoreOrder.mutate({ id: o.id })}
                              style={{
                                display: "flex", alignItems: "center", gap: "4px",
                                padding: "4px 10px", fontSize: "11px", fontWeight: 500, fontFamily: F.body,
                                borderRadius: "8px", border: `1px solid ${COLORS.success}40`, cursor: "pointer",
                                background: `${COLORS.success}15`, color: COLORS.success,
                              }}
                            >
                              <RotateCcw size={11} />
                              {t("Восстановить", "Tiklash")}
                            </button>
                          )
                        ) : o.status === "new" ? (
                          <div style={{ display: "flex", gap: "6px" }}>
                            <button
                              onClick={() => updateStatus.mutate({ id: o.id, status: "processing" })}
                              style={{
                                padding: "4px 10px", fontSize: "11px", fontWeight: 500, fontFamily: F.body,
                                borderRadius: "8px", border: `1px solid ${COLORS.border}`, cursor: "pointer",
                                background: COLORS.surface, color: COLORS.textSecondary,
                              }}
                            >
                              {t("В работу", "Jarayonga")}
                            </button>
                            <button
                              onClick={() => updateStatus.mutate({ id: o.id, status: "completed" })}
                              style={{
                                padding: "4px 10px", fontSize: "11px", fontWeight: 600, fontFamily: F.body,
                                borderRadius: "8px", border: "none", cursor: "pointer",
                                background: "linear-gradient(135deg, #5b6d8a, #5b6d8a)",
                                color: "#fff",
                              }}
                            >
                              {t("Выполнен", "Bajarildi")}
                            </button>
                            {isOperatorOrCeo && (
                              <button
                                onClick={async () => {
                                  const ok = await confirm({ title: t("Удалить заказ?", "Buyurtmani o'chirish?"), danger: true, confirmText: t("Удалить", "O'chirish") });
                                  if (ok) deleteOrder.mutate({ id: o.id });
                                }}
                                style={{
                                  display: "flex", alignItems: "center", gap: "4px",
                                  padding: "4px 10px", fontSize: "11px", fontWeight: 500, fontFamily: F.body,
                                  borderRadius: "8px", border: `1px solid ${COLORS.danger}40`, cursor: "pointer",
                                  background: `${COLORS.danger}10`, color: COLORS.danger,
                                }}
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        ) : (
                          (o.status === "new" || o.status === "processing" || o.status === "cancelled") && isOperatorOrCeo && (
                            <button
                              onClick={async () => {
                                const ok = await confirm({ title: t("Удалить заказ?", "Buyurtmani o'chirish?"), danger: true, confirmText: t("Удалить", "O'chirish") });
                                if (ok) deleteOrder.mutate({ id: o.id });
                              }}
                              style={{
                                display: "flex", alignItems: "center", gap: "4px",
                                padding: "4px 10px", fontSize: "11px", fontWeight: 500, fontFamily: F.body,
                                borderRadius: "8px", border: `1px solid ${COLORS.danger}40`, cursor: "pointer",
                                background: `${COLORS.danger}10`, color: COLORS.danger,
                              }}
                            >
                              <Trash2 size={11} />
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Pagination ─── */}
      {data && data.total > 25 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "13px", color: COLORS.textSecondary, fontFamily: F.body }}>{data.total} {t("всего", "jami")}</span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{
              padding: "6px 12px", fontSize: "13px", fontFamily: F.body, borderRadius: "8px",
              border: `1px solid ${COLORS.border}`, cursor: "pointer",
              background: COLORS.surface, color: COLORS.textSecondary,
              opacity: page === 1 ? 0.4 : 1,
            }}>
              {t("Назад", "Orqaga")}
            </button>
            <button onClick={() => setPage(p => p + 1)} disabled={page * 25 >= data.total} style={{
              padding: "6px 12px", fontSize: "13px", fontFamily: F.body, borderRadius: "8px",
              border: `1px solid ${COLORS.border}`, cursor: "pointer",
              background: COLORS.surface, color: COLORS.textSecondary,
              opacity: page * 25 >= data.total ? 0.4 : 1,
            }}>
              {t("Далее", "Keyingi")}
            </button>
          </div>
        </div>
      )}
    </div>
    {/* ── Bulk Actions Bar ── */}
    <OrderBulkActions
      selectedCount={selected.size}
      onClearSelection={() => setSelected(new Set())}
      onPrintInvoices={() => setShowInvoiceModal(true)}
      onCreateLoadingList={() => setShowLoadingListModal(true)}
      onChangeStatus={(newStatus) => {
        const ids = Array.from(selected);
        bulkUpdateStatus.mutate({ orderIds: ids, status: newStatus as "new" | "processing" | "completed" | "cancelled" });
      }}
      onAssignAgent={(agentId) => {
        const ids = Array.from(selected);
        bulkAssignAgent.mutate({ orderIds: ids, agentId });
      }}
      onExportExcel={handleExportSelected}
      agents={agentsData?.data?.map(a => ({ id: a.id, name: a.name }))}
    />

    {/* ── Invoice Print Modal ── */}
    <InvoicePrintModal
      open={showInvoiceModal}
      onOpenChange={setShowInvoiceModal}
      orderIds={Array.from(selected)}
      onDone={() => { setSelected(new Set()); utils.order.list.invalidate(); }}
    />

    {/* ── Loading List Modal ── */}
    <LoadingListModal
      open={showLoadingListModal}
      onOpenChange={setShowLoadingListModal}
      orderIds={Array.from(selected)}
      onDone={() => { setSelected(new Set()); utils.order.list.invalidate(); }}
    />

    {/* ── Order Slide-Over ── */}
    <OrderSlideOver
      open={!!slideOverOrderId}
      onOpenChange={(v) => { if (!v) setSlideOverOrderId(null); }}
      orderId={slideOverOrderId}
      currency={currency}
    />

    {/* ── Quick Order Modal ── */}
    <QuickOrderModal
      open={showQuickOrder}
      onOpenChange={setShowQuickOrder}
      onCreated={() => utils.order.list.invalidate()}
    />

    {dialog}
    </>
  );
}
