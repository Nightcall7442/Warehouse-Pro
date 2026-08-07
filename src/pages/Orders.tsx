import { useCallback, useMemo, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { useCurrency } from "@/hooks/useCurrency";
import { trpc } from "@/providers/trpc";
import { useInvalidateOrderCaches } from "@/hooks/useOrderCacheSync";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { useNavigate, useSearchParams } from "react-router";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import {
  Plus, FileDown, ChevronRight, Store, User,
  ShoppingCart, Clock, CheckCircle2, XCircle, DollarSign,
  Trash2, RotateCcw, Printer,
  CheckSquare, Square, LayoutGrid, Table as TableIcon, Eye, Users,
  RefreshCw, Truck,
} from "lucide-react";
import { format, startOfMonth } from "date-fns";
import { exportToExcel, formatOrdersForExport } from "@/lib/excel";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { exportToPDF } from "@/lib/export";
import { PremiumSelect } from "@/components/PremiumSelect";
import { ColumnSettings } from "@/components/orders/ColumnSettings";
import { useOrderColumns } from "@/hooks/useOrderColumns";
import type { ColumnId } from "@/components/orders/order-columns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/ConfirmDialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrderFilterChips, type ActiveFilters } from "@/components/orders/OrderFilterChips";
import { OrderBulkActions } from "@/components/orders/OrderBulkActions";
import { InvoicePrintModal } from "@/components/orders/InvoicePrintModal";
import { LoadingListModal } from "@/components/orders/LoadingListModal";
import { OrderSlideOver } from "@/components/orders/OrderSlideOver";
import { OrderKanbanBoard } from "@/components/orders/OrderKanbanBoard";
import { OrderAgentGroups } from "@/components/orders/OrderAgentGroups";
import { QuickOrderModal } from "@/components/orders/QuickOrderModal";
import { CompletionFlowModal } from "@/components/orders/CompletionFlowModal";
import type { CompletionData, CompletionMode } from "@/components/orders/CompletionFlowModal";
import { F, COLORS, SHADOW, OPEN_STATUSES, PAYMENT, STATUS, KpiCard, StatusBadge } from "@/components/orders/theme";
import { colorMix } from "@/lib/color-mix";

import { SearchInput } from "@/components/SearchInput";
export default function Orders() {
  const [page, setPage]     = useState(1);
  const { fmt, symbol }     = useCurrency();
  const { lang }            = useLang();
  // Строка поиска НЕ хранится на этой странице. Компонент SearchInput держит её
  // у себя и отдаёт сюда, когда набор остановился: иначе каждая буква
  // перерисовывала бы страницу целиком — тысяча строк разметки и таблица на
  // полторы сотни заказов, — и между нажатиями появлялась ощутимая пауза.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const handleSearch = useCallback((value: string) => {
    setDebouncedSearch(value);
    setPage(1);
  }, []);
  const [dateFrom, setDateFrom] = useState(format(startOfMonth(new Date()), "yyyy-MM-dd"));
  const [dateTo, setDateTo] = useState(format(new Date(), "yyyy-MM-dd"));
  const isMobile            = useIsMobile();
  const navigate            = useNavigate();
  const [searchParams]      = useSearchParams();
  const utils               = trpc.useUtils();
  const invalidateOrderCaches = useInvalidateOrderCaches();
  const { user }            = useAuth();
  const isCeo               = user?.role === "ceo";
  const isOperator          = user?.role === "operator";
  const isOperatorOrCeo     = isCeo || isOperator;
  const cols                = useOrderColumns(user?.tenantId, user?.id);
  // Persist selection in sessionStorage so it survives navigation
  const [selected, setSelectedRaw] = useState<Set<number>>(() => {
    try {
      const saved = sessionStorage.getItem("order_selection");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const setSelected = useCallback((fn: Set<number> | ((prev: Set<number>) => Set<number>)) => {
    setSelectedRaw(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      try { sessionStorage.setItem("order_selection", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => {
    setSelectedRaw(new Set());
    try { sessionStorage.removeItem("order_selection"); } catch {}
  }, []);
  const { confirm, dialog } = useConfirm();
  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);

  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  // Several agents at once: the operators compare a territory's worth of work
  // side by side, and one-at-a-time meant re-picking the filter for each name.
  const [agentFilter, setAgentFilter] = useState<string[]>([]);
  const [section, setSection] = useState<"active" | "archive">("active");

  // ── New feature state ──
  const [viewMode, setViewMode] = useState<"table" | "kanban" | "agents">("table");
  // Only one agent's orders are loaded at a time — see OrderAgentGroups.
  const [expandedAgentId, setExpandedAgentId] = useState<number | null>(null);
  const [chipFilters, setChipFilters] = useState<ActiveFilters>({});
  const [slideOverOrderId, setSlideOverOrderId] = useState<number | null>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showLoadingListModal, setShowLoadingListModal] = useState(false);
  const [showQuickOrder, setShowQuickOrder] = useState(false);

  const switchSection = useCallback((next: "active" | "archive") => {
    setSection(next);
    setStatus("");
    setChipFilters(prev => ({ ...prev, status: undefined }));
    setPage(1);
  }, []);

  const { data: savedFilters } = trpc.order.listFilters.useQuery();
  const saveFilterMut = trpc.order.saveFilter.useMutation({
    onSuccess: () => { utils.order.listFilters.invalidate(); notify.success(t("Фильтр сохранён", "Filter saqlandi")); },
  });
  const deleteFilterMut = trpc.order.deleteFilter.useMutation({
    onSuccess: () => utils.order.listFilters.invalidate(),
  });
  const bulkUpdateStatus = trpc.order.bulkUpdateStatus.useMutation({
    onSuccess: (r) => {
      invalidateOrderCaches();
      clearSelection();
      if (r.failed.length === 0) {
        notify.success(t(`Обновлено: ${r.updated}`, `Yangilandi: ${r.updated}`));
      } else {
        notify.error(t(
          `Обновлено: ${r.updated}, не удалось: ${r.failed.length} (${r.failed.map(f => `#${f.orderId}: ${f.error}`).join("; ")})`,
          `Yangilandi: ${r.updated}, muvaffaqiyatsiz: ${r.failed.length} (${r.failed.map(f => `#${f.orderId}: ${f.error}`).join("; ")})`,
        ));
      }
    },
    onError: (e) => notify.error(e.message),
  });
  const bulkCompleteWithPayment = trpc.order.bulkCompleteWithPayment.useMutation({
    onSuccess: (r) => {
      invalidateOrderCaches();
      clearSelection();
      if (r.failed.length === 0) {
        notify.success(t(`Выполнено и оплачено: ${r.updated}`, `Bajarildi va to'landi: ${r.updated}`));
      } else {
        notify.error(t(
          `Готово: ${r.updated}, не удалось: ${r.failed.length} (${r.failed.map(f => `#${f.orderId}: ${f.error}`).join("; ")})`,
          `Tayyor: ${r.updated}, muvaffaqiyatsiz: ${r.failed.length} (${r.failed.map(f => `#${f.orderId}: ${f.error}`).join("; ")})`,
        ));
      }
    },
    onError: (e) => notify.error(e.message),
  });
  const bulkAssignAgent = trpc.order.bulkAssignAgent.useMutation({
    onSuccess: (r) => { invalidateOrderCaches(); clearSelection(); notify.success(t(`Назначено: ${r.updated}`, `Tayinlandi: ${r.updated}`)); },
    onError: (e) => notify.error(e.message),
  });
  const bulkAssignCourier = trpc.order.bulkAssignCourier.useMutation({
    onSuccess: (r) => { invalidateOrderCaches(); clearSelection(); notify.success(t(`Курьер назначен: ${r.updated}`, `Kuryer tayinlandi: ${r.updated}`)); },
    onError: (e) => notify.error(e.message),
  });
  const { data: agentsData } = trpc.user.list.useQuery({ role: "agent", pageSize: 200 });
  const { data: couriersData } = trpc.user.list.useQuery({ role: "courier", pageSize: 100 });

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
    search: debouncedSearch || undefined,
    status: (effectiveStatus || undefined) as "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned" | undefined,
    // Always scoped to the open tab; a status filter now narrows within it
    // rather than replacing it, so the archive keeps showing archive content.
    archived: section === "archive",
    dateFrom: effectiveDateFrom || undefined,
    dateTo: effectiveDateTo || undefined,
    paymentMethod: effectivePaymentMethod as "cash" | "card" | "transfer" | "debt" | undefined,
    agentIds: agentFilter.length > 0 ? agentFilter.map(Number) : undefined,
  }, {
    // Прошлый список остаётся на экране, пока грузится новый: без этого
    // смена запроса обнуляет data, и страница падает в скелетон на каждый
    // ввод — именно это и выглядело как перезагрузка.
    placeholderData: keepPreviousData,
  });

  const { refetch: refetchAllOrders } = trpc.order.list.useQuery(
    { page: 1, pageSize: 5000, showDeleted: false, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined },
    { enabled: false }
  );

  // ── "By agent" view ────────────────────────────────────────────────────────
  // Both queries share the page's own date/section filters so the grouping
  // always describes the same slice of work the other views show.
  const { data: agentSummary, isLoading: agentsLoading } = trpc.order.agentSummary.useQuery(
    {
      dateFrom: effectiveDateFrom || undefined,
      dateTo: effectiveDateTo || undefined,
      archived: section === "archive",
      search: debouncedSearch || undefined,
    },
    // Also feeds the "Агент" filter in the toolbar, so it stays loaded in
    // every view — not just the by-agent one.
    { enabled: isOperatorOrCeo },
  );

  const agentFilterOptions = useMemo(
    () => (agentSummary ?? [])
      .filter(a => a.orderCount > 0)
      .map(a => ({ value: String(a.agentId), label: `${a.agentName.trim()} (${a.orderCount})` })),
    [agentSummary],
  );

  const { data: expandedAgentOrders, isLoading: expandedOrdersLoading } = trpc.order.list.useQuery(
    {
      page: 1,
      pageSize: 200,
      agentId: expandedAgentId ?? undefined,
      archived: section === "archive",
      dateFrom: effectiveDateFrom || undefined,
      dateTo: effectiveDateTo || undefined,
      search: debouncedSearch || undefined,
    },
    { enabled: viewMode === "agents" && expandedAgentId !== null },
  );

  const updateStatus = trpc.order.updateStatus.useMutation({
    onSuccess: () => { invalidateOrderCaches(); notify.success("Заказ обновлён"); },
    onError:   (e) => notify.error(e.message),
  });

  // ── Completion flow for status changes ─────────────────────────────────
  const [showCompletion, setShowCompletion] = useState(false);
  const [completionMode, setCompletionMode] = useState<CompletionMode>("partial_return");
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [completionOrderId, setCompletionOrderId] = useState<number | null>(null);

  const { data: completionOrderData } = trpc.order.getById.useQuery(
    { id: completionOrderId! },
    { enabled: !!completionOrderId && showCompletion },
  );

  const COMPLETION_STATUSES: Record<string, CompletionMode> = {
    delivered: "partial_payment",
  };

  const recordPartialDelivery = trpc.order.recordPartialDelivery.useMutation({
    onSuccess: () => { invalidateOrderCaches(); },
    onError: (e) => notify.error(e.message),
  });

  const recordDeliveryAndPayment = trpc.order.recordDeliveryAndPayment.useMutation({
    onSuccess: () => { invalidateOrderCaches(); },
    onError: (e) => notify.error(e.message),
  });

  const completionSaving = recordPartialDelivery.isPending || recordDeliveryAndPayment.isPending || updateStatus.isPending;

  function handleStatusChange(orderId: number, newStatus: string) {
    const mode = COMPLETION_STATUSES[newStatus];
    if (mode) {
      setCompletionMode(mode);
      setPendingStatus(newStatus);
      setCompletionOrderId(orderId);
      setShowCompletion(true);
      return;
    }
    updateStatus.mutate({ id: orderId, status: newStatus as "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned" });
  }

  async function handleCompletionSave(data: CompletionData) {
    if (!completionOrderId || !completionOrderData) return;
    const hasReturns = data.items.some(it => it.deliveredQuantity === 0 || it.returnReason);
    const hasPayment = data.paidAmount && Number(data.paidAmount) > 0;

    try {
      if (hasReturns && hasPayment) {
        await recordDeliveryAndPayment.mutateAsync({
          orderId: completionOrderId,
          deliveredItems: data.items,
          payment: { paidAmount: data.paidAmount!, method: data.paymentMethod || "cash", notes: data.notes },
        });
      } else if (hasReturns) {
        await recordPartialDelivery.mutateAsync({ orderId: completionOrderId, items: data.items });
      } else if (hasPayment) {
        await recordDeliveryAndPayment.mutateAsync({
          orderId: completionOrderId,
          deliveredItems: data.items,
          payment: { paidAmount: data.paidAmount!, method: data.paymentMethod || "cash", notes: data.notes },
        });
      }

      if (pendingStatus) {
        await updateStatus.mutateAsync({
          id: completionOrderId,
          status: pendingStatus as "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned",
        });
      }

      notify.success("Заказ завершён");
      setShowCompletion(false);
      setPendingStatus(null);
      setCompletionOrderId(null);
    } catch {
      // errors handled by individual mutations
    }
  }

  const deleteOrder = trpc.order.delete.useMutation({
    onSuccess: () => { invalidateOrderCaches(); notify.success("Заказ удалён"); },
    onError:   (e) => notify.error(e.message),
  });

  const restoreOrder = trpc.order.restore.useMutation({
    onSuccess: () => { invalidateOrderCaches(); notify.success("Заказ восстановлен"); },
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
    setSelected(prev => {
      const next = new Set(prev);
      if (allSelected) {
        // Deselect only current page items
        for (const id of allVisibleIds) next.delete(id);
      } else {
        // Select all current page items (preserving other pages)
        for (const id of allVisibleIds) next.add(id);
      }
      return next;
    });
  }, [allSelected, allVisibleIds]);

  const handleExportSelected = useCallback(async () => {
    const result = await refetchAllOrders();
    if (!result.data?.data) return;
    const rows = result.data.data.filter((o: { id: number }) => selected.has(o.id));
    if (rows.length === 0) return;
    await exportToExcel(formatOrdersForExport(rows), `orders-selected`, "Заказы", `Выбранные заказы`);
  }, [refetchAllOrders, selected]);

  /* ─── Server-side KPI stats (all orders matching filters) ─── */
  const { data: stats } = trpc.order.stats.useQuery({
    dateFrom: effectiveDateFrom || undefined,
    dateTo: effectiveDateTo || undefined,
    status: effectiveStatus || undefined,
    paymentMethod: effectivePaymentMethod || undefined,
    search: debouncedSearch || undefined,
    // The tiles have to describe the same slice the table below them shows.
    // They previously ignored the agent filter entirely, so narrowing to one
    // agent left the totals reading for the whole company.
    agentIds: agentFilter.length > 0 ? agentFilter.map(Number) : undefined,
  });

  /**
   * Cells whose own controls must not also open the slide-over.
   *
   * The row is clickable; a select or a delete button inside it is not a place
   * where "open the order" is the intended outcome.
   */
  const CELL_STOPS_ROW_CLICK = new Set<ColumnId>(["status", "actions"]);

  /** A row exactly as orders.list returns it — no parallel type to drift. */
  type OrderRow = NonNullable<typeof data>["data"][number];

  const dateOnly = (v: unknown) => (v ? format(new Date(v as string), "dd.MM.yyyy") : "—");
  const dateTime = (v: unknown) => (v ? format(new Date(v as string), "dd.MM.yyyy HH:mm") : "—");

  const PRIORITY: Record<string, { ru: string; uz: string; color: string }> = {
    low:    { ru: "Низкий",  uz: "Past",   color: COLORS.textTertiary },
    normal: { ru: "Обычный", uz: "Oddiy",  color: COLORS.textSecondary },
    high:   { ru: "Высокий", uz: "Yuqori", color: COLORS.danger },
  };

  const DELIVERY: Record<string, { ru: string; uz: string }> = {
    not_assigned:     { ru: "Не назначена", uz: "Tayinlanmagan" },
    assigned:         { ru: "Назначена",    uz: "Tayinlangan" },
    out_for_delivery: { ru: "В пути",       uz: "Yo'lda" },
    delivered:        { ru: "Доставлена",   uz: "Yetkazildi" },
    failed:           { ru: "Не удалась",   uz: "Muvaffaqiyatsiz" },
  };

  /**
   * One cell, chosen by column id.
   *
   * Lives beside the header rather than in the column config so it can reach
   * the page's own handlers and mutations; both are driven by the same
   * `cols.columns` array, which is what stops a header and its cell from ever
   * drifting apart.
   */
  const renderCell = (id: ColumnId, o: OrderRow) => {
    const row = o as unknown as Record<string, unknown>;
    switch (id) {
      case "orderNumber":
        return (
          <span className="flex items-center gap-1" style={{ fontFamily: F.display, fontWeight: 600, color: COLORS.primaryText }}>
            {o.orderNumber} <Eye className="h-3 w-3 opacity-0 group-hover:opacity-50" />
          </span>
        );
      case "createdAt":
        return dateOnly(o.createdAt);
      case "shopName":
        return <span style={{ color: COLORS.textPrimary }}>{o.shopName ?? "—"}</span>;
      case "agentName":
        return o.agentName ?? "—";
      case "territoryName":
        return <span style={{ fontSize: "12px", color: COLORS.textTertiary }}>{(row.territoryName as string) ?? "—"}</span>;
      case "paymentMethod":
        return o.paymentMethod && PAYMENT[o.paymentMethod] ? (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: "4px",
            fontSize: "11px", fontWeight: 600, color: PAYMENT[o.paymentMethod].color,
            background: colorMix(PAYMENT[o.paymentMethod].color, 7),
            padding: "3px 8px", borderRadius: "6px",
          }}>
            {PAYMENT[o.paymentMethod][lang]}
          </span>
        ) : "—";
      case "total":
        return <span style={{ fontFamily: F.display, fontWeight: 600, color: COLORS.textPrimary }}>{fmt(o.total)}</span>;
      case "subtotal":
        return <span style={{ fontFamily: F.display }}>{fmt(row.subtotal as string)}</span>;
      case "discount":
        return Number(row.discount ?? 0) > 0
          ? <span style={{ fontFamily: F.display, color: COLORS.warning }}>{fmt(row.discount as string)}</span>
          : "—";
      case "itemCount":
        return <span style={{ fontFamily: F.display }}>{Number(row.itemCount ?? 0)}</span>;
      case "priority": {
        const p = PRIORITY[String(row.priority ?? "normal")];
        return p ? <span style={{ fontSize: "12px", color: p.color }}>{lang === "uz" ? p.uz : p.ru}</span> : "—";
      }
      case "deliveryStatus": {
        const d = DELIVERY[String(row.deliveryStatus ?? "")];
        return d ? <span style={{ fontSize: "12px" }}>{lang === "uz" ? d.uz : d.ru}</span> : "—";
      }
      case "courierName":
        return (row.courierName as string) ?? "—";
      case "deliveredAt":
        return dateTime(row.deliveredAt);
      case "updatedAt":
        return dateTime(row.updatedAt);
      case "notes":
        return row.notes
          ? <span title={String(row.notes)} style={{ display: "inline-block", maxWidth: "220px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{String(row.notes)}</span>
          : "—";
      case "status":
        return isOperatorOrCeo && !o.deletedAt ? (
          <Select value={o.status} onValueChange={(newStatus) => {
            if (newStatus !== o.status) handleStatusChange(o.id, newStatus);
          }}>
            <SelectTrigger style={{
              height: "28px", padding: "0 8px", fontSize: "11px", fontWeight: 600,
              borderRadius: "9999px", border: "none", width: "auto",
              background: colorMix(STATUS[o.status]?.dot ?? "#5b6d8a", 8),
              color: STATUS[o.status]?.dot ?? "#5b6d8a",
            }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(STATUS).map(([key, val]) => (
                <SelectItem key={key} value={key} style={{ fontSize: "12px" }}>
                  {lang === "uz" ? val.uz : val.ru}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <StatusBadge status={o.status} lang={lang} />
        );
      case "actions":
        return renderActions(o);
      default:
        return "—";
    }
  };

  const askDelete = async (id: number) => {
    const ok = await confirm({
      title: t("Удалить заказ?", "Buyurtmani o'chirish?"),
      message: t("Это действие нельзя отменить", "Bu amalni qaytarib bo'lmaydi"),
      danger: true,
      confirmText: t("Удалить", "O'chirish"),
    });
    if (ok) deleteOrder.mutate({ id });
  };

  const deleteButton = (id: number) => (
    <button
      onClick={() => askDelete(id)}
      style={{
        display: "flex", alignItems: "center", gap: "4px",
        padding: "4px 10px", fontSize: "11px", fontWeight: 500, fontFamily: F.body,
        borderRadius: "8px", border: `1px solid ${colorMix(COLORS.danger, 25)}`, cursor: "pointer",
        background: colorMix(COLORS.danger, 6), color: COLORS.danger,
      }}
    >
      <Trash2 size={11} />
    </button>
  );

  const renderActions = (o: OrderRow) => {
    if (o.deletedAt) {
      return isOperatorOrCeo ? (
        <button
          onClick={() => restoreOrder.mutate({ id: o.id })}
          style={{
            display: "flex", alignItems: "center", gap: "4px",
            padding: "4px 10px", fontSize: "11px", fontWeight: 500, fontFamily: F.body,
            borderRadius: "8px", border: `1px solid ${colorMix(COLORS.success, 25)}`, cursor: "pointer",
            background: colorMix(COLORS.success, 8), color: COLORS.success,
          }}
        >
          <RotateCcw size={11} />
          {t("Восстановить", "Tiklash")}
        </button>
      ) : null;
    }

    if (OPEN_STATUSES.includes(o.status)) {
      return (
        <div style={{ display: "flex", gap: "6px" }}>
          {o.status === "new" && (
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
          )}
          <button
            onClick={() => handleStatusChange(o.id, "delivered")}
            style={{
              padding: "4px 10px", fontSize: "11px", fontWeight: 600, fontFamily: F.body,
              borderRadius: "8px", border: "none", cursor: "pointer",
              background: "var(--color-primary)", color: "var(--color-on-primary)",
            }}
          >
            {t("Выполнен", "Bajarildi")}
          </button>
          {isOperatorOrCeo && deleteButton(o.id)}
        </div>
      );
    }

    const deletable = o.status === "new" || o.status === "processing" || o.status === "cancelled";
    return deletable && isOperatorOrCeo ? deleteButton(o.id) : null;
  };

  if (isError) return <QueryErrorFallback onRetry={refetch} />;

  return (
    <>
    {/* Extra bottom space while the floating bulk-actions bar is up, so it
        doesn't sit on top of the very rows it's acting on — the bar is
        position:fixed and otherwise overlaps whatever the page scrolls under it. */}
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", paddingBottom: selected.size > 0 ? "88px" : undefined }}>
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

      {/* ─── Active / Archive ─── */}
      <div style={{ display: "inline-flex", borderRadius: "10px", overflow: "hidden", border: `1px solid ${COLORS.border}`, width: "fit-content" }}>
        <button onClick={() => switchSection("active")}
          style={{
            padding: "8px 16px", fontSize: "13px", fontWeight: 600, fontFamily: F.body, border: "none", cursor: "pointer",
            background: section === "active" ? COLORS.primary : COLORS.surface,
            color: section === "active" ? COLORS.onPrimary : COLORS.textSecondary,
            transition: "all 0.2s",
          }}>
          {t("Активные", "Faol")}
        </button>
        <button onClick={() => switchSection("archive")}
          style={{
            padding: "8px 16px", fontSize: "13px", fontWeight: 600, fontFamily: F.body, border: "none", cursor: "pointer",
            background: section === "archive" ? COLORS.primary : COLORS.surface,
            color: section === "archive" ? COLORS.onPrimary : COLORS.textSecondary,
            transition: "all 0.2s",
          }}>
          {t("Архив", "Arxiv")}
        </button>
      </div>

      {/* ─── KPI Cards (server-side aggregation) ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
        <KpiCard
          label={t("ВСЕГО", "JAMI")}
          value={(stats?.total ?? 0).toLocaleString()}
          delta={null}
          icon={<ShoppingCart size={20} color="#fff" />}
          gradient="var(--color-primary)"
          delay={0}
        />
        <KpiCard
          label={t("НОВЫЕ", "YANGI")}
          value={(stats?.newCount ?? 0).toLocaleString()}
          delta={null}
          icon={<Clock size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #60a5fa, #3b82f6)"
          delay={0.05}
        />
        <KpiCard
          label={t("В ОБРАБОТКЕ", "JARAYONDA")}
          value={(stats?.processingCount ?? 0).toLocaleString()}
          delta={null}
          icon={<RefreshCw size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #e07b39, #e07b39)"
          delay={0.1}
        />
        <KpiCard
          label={t("ОТГРУЖЕНЫ", "YUKLANDI")}
          value={(stats?.shippedCount ?? 0).toLocaleString()}
          delta={null}
          icon={<Truck size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #9b59b6, #8e44ad)"
          delay={0.15}
        />
        <KpiCard
          label={t("ДОСТАВЛЕНЫ", "YETKAZILDI")}
          value={(stats?.deliveredCount ?? 0).toLocaleString()}
          delta={null}
          icon={<CheckCircle2 size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #10B981, #059669)"
          delay={0.2}
        />
        <KpiCard
          label={t("ОТМЕНЕНЫ", "BEKOR")}
          value={(stats?.cancelledCount ?? 0).toLocaleString()}
          delta={null}
          icon={<XCircle size={20} color="#fff" />}
          gradient="linear-gradient(135deg, var(--color-danger), var(--color-danger))"
          delay={0.25}
        />
        <KpiCard
          label={t("ВЫРУЧКА", "TUSHUM")}
          value={fmt(stats?.totalRevenue ?? 0)}
          delta={null}
          icon={<DollarSign size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #16a34a, #22c47a)"
          delay={0.3}
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
              <TabsTrigger value="table" className="px-2.5 h-6 text-xs" title={t("Таблица", "Jadval")}><TableIcon className="h-3.5 w-3.5" /></TabsTrigger>
              <TabsTrigger value="kanban" className="px-2.5 h-6 text-xs" title={t("Доска", "Doska")}><LayoutGrid className="h-3.5 w-3.5" /></TabsTrigger>
              {isOperatorOrCeo && (
                <TabsTrigger value="agents" className="px-2.5 h-6 text-xs" title={t("По агентам", "Agentlar bo'yicha")}><Users className="h-3.5 w-3.5" /></TabsTrigger>
              )}
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
        <SearchInput
          placeholder={t("Поиск заказов…", "Buyurtma qidirish…")}
          onSearch={handleSearch}
          style={{ flex: "1 1 160px" }}
        />
        <PremiumSelect value={status} onChange={v => { setStatus(v); setPage(1); }}
          options={[{value:"",label:t("Все статусы","Barcha holatlar")},...Object.entries(STATUS).map(([k,v])=>({value:k,label:lang==="uz"?v.uz:v.ru}))]}
          width="180px" />
        {isOperatorOrCeo && (
          <PremiumSelect
            multiple
            value={agentFilter}
            onChange={v => { setAgentFilter(v); setPage(1); }}
            aria-label={t("Агент", "Agent")}
            placeholder={t("Все агенты", "Barcha agentlar")}
            summarize={n => t(`Агентов: ${n}`, `Agentlar: ${n}`)}
            options={[
              { value: "", label: t("Все агенты", "Barcha agentlar") },
              // Sourced from the same rollup the by-agent view uses, so the
              // list covers everyone who actually placed an order — including
              // an operator or CEO who entered one directly, or a since-
              // deactivated agent. A plain role='agent' list would quietly
              // offer no way to filter to those orders.
              ...agentFilterOptions,
            ]}
            width="200px" />
        )}

        {/* Only the desktop table has columns to configure; the card and kanban
            views have no such thing, so the control follows the table. */}
        {viewMode === "table" && (
          <ColumnSettings
            all={cols.all}
            hidden={cols.layout.hidden}
            onToggle={cols.toggle}
            onMove={cols.move}
            onReset={cols.reset}
            isCustomised={cols.isCustomised}
            t={t}
            lang={lang}
          />
        )}
      </div>

      {/* By-agent view */}
      {viewMode === "agents" && isOperatorOrCeo && (
        agentsLoading ? (
          <div style={{
            background: COLORS.surface, borderRadius: "16px", padding: "48px",
            textAlign: "center", boxShadow: SHADOW,
            fontFamily: F.body, fontSize: "13px", color: COLORS.textTertiary,
          }}>
            {t("Загрузка…", "Yuklanmoqda…")}
          </div>
        ) : (
          <OrderAgentGroups
            agents={agentSummary ?? []}
            expandedAgentId={expandedAgentId}
            expandedOrders={(expandedAgentOrders?.data ?? []).map(o => ({
              id: o.id as number,
              orderNumber: o.orderNumber,
              status: o.status,
              total: o.total ?? "0",
              shopName: o.shopName ?? null,
              paymentMethod: o.paymentMethod ?? "cash",
              createdAt: o.createdAt as string | Date,
            }))}
            expandedLoading={expandedOrdersLoading}
            // Collapsing clears the selection: those orders are no longer on
            // screen, and acting on an invisible selection is how an operator
            // ends up changing something they didn't mean to.
            onToggleAgent={(agentId) => {
              setExpandedAgentId(prev => (prev === agentId ? null : agentId));
              clearSelection();
            }}
            selected={selected}
            onToggleOrder={toggleSelect}
            onToggleAllForAgent={(ids) => {
              const allOn = ids.length > 0 && ids.every(id => selected.has(id));
              setSelected(prev => {
                const next = new Set(prev);
                for (const id of ids) allOn ? next.delete(id) : next.add(id);
                return next;
              });
            }}
            onOrderClick={setSlideOverOrderId}
            fmt={fmt}
            t={t}
            lang={lang}
          />
        )
      )}

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
            territoryName: (o as Record<string, unknown>).territoryName as string | null,
            paymentMethod: o.paymentMethod ?? "cash",
          }))}
          onOrderClick={setSlideOverOrderId}
          onStatusChange={(orderId, newStatus) => handleStatusChange(orderId, newStatus)}
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
                                background: colorMix(PAYMENT[o.paymentMethod].color, 7),
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
      ) : viewMode === "kanban" || viewMode === "agents" ? null : (
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
                      ? <CheckSquare size={16} style={{ color: COLORS.primaryText }} />
                      : <Square size={16} style={{ color: COLORS.textTertiary }} />
                    }
                  </button>
                </th>
                {cols.columns.map(c => (
                  <th key={c.id} style={{
                    textAlign: c.align === "right" ? "right" : "left", padding: "12px 16px",
                    fontFamily: F.display, fontSize: "10px", fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "0.08em",
                    color: COLORS.textTertiary, borderBottom: `1px solid ${COLORS.border}`,
                  }}>
                    {lang === "uz" ? c.label.uz : c.label.ru}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                      <td colSpan={cols.columns.length + 1} style={{ padding: "16px" }}>
                        <div style={{ height: "16px", borderRadius: "6px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease forwards` }} />
                      </td>
                    </tr>
                  ))
                : data?.data.length === 0
                ? <tr><td colSpan={cols.columns.length + 1} style={{ padding: "56px 16px", textAlign: "center", color: COLORS.textSecondary, fontSize: "13px", fontFamily: F.body }}>{t("Нет заказов", "Buyurtma yo'q")}</td></tr>
                : data?.data.map(o => (
                    <tr
                      key={o.id}
                      style={{
                        borderBottom: `1px solid ${COLORS.border}`,
                        cursor: "pointer", transition: "background 0.15s",
                        opacity: o.deletedAt ? 0.5 : 1,
                        background: o.deletedAt ? colorMix(COLORS.danger, 3) : "transparent",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = colorMix(COLORS.surfaceLight, 50))}
                      onMouseLeave={e => (e.currentTarget.style.background = o.deletedAt ? colorMix(COLORS.danger, 3) : "transparent")}
                      onClick={() => setSlideOverOrderId(o.id as number)}
                    >
                      <td style={{ padding: "14px 8px 14px 16px", textAlign: "center" }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => toggleSelect(o.id as number)}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {selected.has(o.id as number)
                            ? <CheckSquare size={16} style={{ color: COLORS.primaryText }} />
                            : <Square size={16} style={{ color: COLORS.textTertiary }} />
                          }
                        </button>
                      </td>
                      {cols.columns.map(c => (
                        <td
                          key={c.id}
                          style={{
                            padding: "14px 16px",
                            textAlign: c.align === "right" ? "right" : "left",
                            fontSize: "13px",
                            color: COLORS.textSecondary,
                          }}
                          onClick={CELL_STOPS_ROW_CLICK.has(c.id) ? (e => e.stopPropagation()) : undefined}
                        >
                          {renderCell(c.id, o)}
                        </td>
                      ))}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Pagination ─── */}
      {/* Paging belongs to the flat list; the agent view pages within each
          expanded agent instead, and the board shows the current page as-is. */}
      {viewMode === "table" && data && data.total > 25 && (
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
      onClearSelection={() => clearSelection()}
      onPrintInvoices={() => setShowInvoiceModal(true)}
      onCreateLoadingList={() => setShowLoadingListModal(true)}
      onChangeStatus={(newStatus) => {
        const ids = Array.from(selected);
        bulkUpdateStatus.mutate({ orderIds: ids, status: newStatus as "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned" });
      }}
      onComplete={async () => {
        const ids = Array.from(selected);
        // Bulk completion only marks the goods as handed over — it deliberately
        // records no payment, since the amount differs per order. Money is
        // settled per order via the completion modal or "Новый долг".
        // Orders placed on credit ("Долг") had their full total booked to the
        // shop's debt the moment they were created — completing them here
        // doesn't add to that debt, but it doesn't clear it either, so the
        // operator needs to know which of their selection will still be owed.
        const allResult = await refetchAllOrders();
        const selectedRows = (allResult.data?.data ?? []).filter((o: { id: number }) => selected.has(o.id));
        const debtRows = selectedRows.filter((o: { paymentMethod?: string }) => o.paymentMethod === "debt");
        const debtTotal = debtRows.reduce((s: number, o: { total: string }) => s + Number(o.total), 0);

        const baseMessage = t(
          "Заказы получат статус «Доставлен», товар спишется со склада. Оплата не записывается.",
          "Buyurtmalar «Yetkazildi» holatini oladi, tovar omboridan yechiladi. To'lov yozilmaydi.",
        );
        const debtWarning = debtRows.length > 0
          ? t(
              ` Из них ${debtRows.length} в долг (${fmt(debtTotal)}) — после выполнения долг магазинов за них останется, оплату нужно записать отдельно.`,
              ` Ulardan ${debtRows.length} tasi qarzga (${fmt(debtTotal)}) — bajarilgandan keyin ham do'konlar qarzi saqlanadi, to'lovni alohida yozib qo'ying.`,
            )
          : "";

        const ok = await confirm({
          title: t(`Выполнить ${ids.length} заказ(ов)?`, `${ids.length} ta buyurtma bajarilsinmi?`),
          message: baseMessage + debtWarning,
          confirmText: t("Выполнить", "Bajarish"),
        });
        if (ok) bulkUpdateStatus.mutate({ orderIds: ids, status: "delivered" });
      }}
      onCompleteWithPayment={async () => {
        const ids = Array.from(selected);
        const allResult = await refetchAllOrders();
        const selectedRows = (allResult.data?.data ?? []).filter((o: { id: number }) => selected.has(o.id));
        const total = selectedRows.reduce((s: number, o: { total: string }) => s + Number(o.total), 0);

        const ok = await confirm({
          title: t(`Выполнить с оплатой ${ids.length} заказ(ов)?`, `${ids.length} ta buyurtma to'lov bilan bajarilsinmi?`),
          message: t(
            `Заказы получат статус «Доставлен», товар спишется со склада, и для каждого будет записана оплата на полную сумму — всего ${fmt(total)}. Используйте только если деньги уже получены.`,
            `Buyurtmalar «Yetkazildi» holatini oladi, tovar omboridan yechiladi, va har biri uchun to'liq summa bo'yicha to'lov yoziladi — jami ${fmt(total)}. Faqat pul allaqachon olingan bo'lsa ishlating.`,
          ),
          confirmText: t("Выполнить с оплатой", "To'lov bilan bajarish"),
        });
        if (ok) bulkCompleteWithPayment.mutate({ orderIds: ids });
      }}
      onAssignAgent={(agentId) => {
        const ids = Array.from(selected);
        bulkAssignAgent.mutate({ orderIds: ids, agentId });
      }}
      onAssignCourier={(courierId) => {
        const ids = Array.from(selected);
        bulkAssignCourier.mutate({ orderIds: ids, courierId });
      }}
      onExportExcel={handleExportSelected}
      agents={agentsData?.data?.map(a => ({ id: a.id, name: a.name }))}
      couriers={couriersData?.data?.map(c => ({ id: c.id, name: c.name }))}
    />

    {/* ── Invoice Print Modal ── */}
    <InvoicePrintModal
      open={showInvoiceModal}
      onOpenChange={setShowInvoiceModal}
      orderIds={Array.from(selected)}
      onDone={() => { invalidateOrderCaches(); }}
    />

    {/* ── Loading List Modal ── */}
    <LoadingListModal
      open={showLoadingListModal}
      onOpenChange={setShowLoadingListModal}
      orderIds={Array.from(selected)}
      onDone={() => { invalidateOrderCaches(); }}
    />

    {/* ── Order Slide-Over ── */}
    <OrderSlideOver
      open={!!slideOverOrderId}
      onOpenChange={(v) => { if (!v) setSlideOverOrderId(null); }}
      orderId={slideOverOrderId}
      currency={symbol}
    />

    {/* ── Quick Order Modal ── */}
    <QuickOrderModal
      open={showQuickOrder}
      onOpenChange={setShowQuickOrder}
      onCreated={() => { invalidateOrderCaches(); }}
    />

    {dialog}

    {/* ── Completion Flow Modal ── */}
    {completionOrderData && (
      <CompletionFlowModal
        open={showCompletion}
        onClose={() => { setShowCompletion(false); setPendingStatus(null); setCompletionOrderId(null); }}
        mode={completionMode}
        orderNumber={completionOrderData.orderNumber}
        orderTotal={completionOrderData.total}
        items={(completionOrderData.items ?? []).map(i => ({
          id: i.id,
          productName: i.productName ?? "",
          productCode: i.productCode ?? undefined,
          quantity: Number(i.quantity),
          unitPrice: i.unitPrice,
          unit: i.unit ?? undefined,
          subtotal: i.subtotal,
          deliveredQuantity: i.deliveredQuantity === null ? null : Number(i.deliveredQuantity),
          returnReason: i.returnReason,
        }))}
        currency={symbol}
        saving={completionSaving}
        onSave={handleCompletionSave}
      />
    )}
    </>
  );
}
