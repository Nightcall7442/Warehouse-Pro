import { useParams, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { format } from "date-fns";
import { ru as dateRu } from "date-fns/locale";
import {
  ArrowLeft, Printer, FileDown, CheckCircle2, XCircle, RefreshCw,
  ChevronDown, Truck, Trash2, Edit3, Save, X, CreditCard, MapPin,
  Phone, Package, User, Clock, AlertTriangle, ChevronRight, Store,
} from "lucide-react";
import { useState, useCallback } from "react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { exportToExcel } from "@/lib/excel";
import { printUzWaybill, printTorg12, printInvoice } from "@/lib/documents";
import type { OrderDocData, CompanyInfo } from "@/lib/documents";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { CompletionFlowModal } from "@/components/orders/CompletionFlowModal";
import type { CompletionData, CompletionMode } from "@/components/orders/CompletionFlowModal";
import { useCompletionFlow } from "@/hooks/useCompletionFlow";
import { useInvalidateOrderCaches } from "@/hooks/useOrderCacheSync";
import { colorMix } from "@/lib/color-mix";

/** Statuses where the goods have not been handed over yet — these can still be completed. */
const OPEN_STATUSES = ["new", "processing", "shipped", "pending"];

const STATUS_STYLES: Record<string, string> = {
  new:                  "bg-info/15 text-info border-info/30",
  processing:           "bg-warning/15 text-warning border-warning/30",
  shipped:              "bg-purple-100 text-purple-700 border-purple-300",
  pending:              "bg-orange-100 text-orange-700 border-orange-300",
  delivered:            "bg-success/15 text-success border-success/30",
  cancelled:            "bg-danger/15 text-danger border-danger/30",
  returned:             "bg-red-100 text-red-700 border-red-300",
};

const STATUS_LABELS: Record<string, { ru: string; uz: string }> = {
  new:                  { ru: "Новый",              uz: "Yangi" },
  processing:           { ru: "В обработке",        uz: "Jarayonda" },
  shipped:              { ru: "Отгружён",           uz: "Yuklandi" },
  pending:              { ru: "В ожидании",         uz: "Kutishda" },
  delivered:            { ru: "Доставлен",          uz: "Yetkazildi" },
  cancelled:            { ru: "Отменён",            uz: "Bekor qilindi" },
  returned:             { ru: "Возврат",            uz: "Qaytarildi" },
};

const UNIT_LABELS: Record<string, { ru: string; uz: string }> = {
  kg:   { ru: "кг",   uz: "kg" },
  l:    { ru: "л",    uz: "l" },
  pcs:  { ru: "шт",   uz: "dona" },
  box:  { ru: "блок",  uz: "blok" },
  pack: { ru: "упак",  uz: "upk" },
  m:    { ru: "м",    uz: "m" },
  block:{ ru: "блок",  uz: "blok" },
};

const PAYMENT_METHODS: Record<string, { ru: string; uz: string; color: string }> = {
  cash:     { ru: "Наличные",     uz: "Naqd",       color: "var(--color-success-text)" },
  transfer: { ru: "Перечисление", uz: "O'tkazma",   color: "var(--color-primary-text)" },
  debt:     { ru: "Долг",         uz: "Qarz",       color: "var(--color-warning-text)" },
  card:     { ru: "Карта",        uz: "Plastik",    color: "#9b59b6" },
};

/** Format number without trailing zeros: 70.00 → 70, 70.50 → 70.5, 70.12 → 70.12 */
function cleanNum(val: string | number | null | undefined): string {
  const n = Number(val ?? 0);
  if (n === 0) return "0";
  // If integer, no decimals
  if (n === Math.floor(n)) return n.toLocaleString("ru-RU");
  // Otherwise show up to 2 decimals, strip trailing zeros
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export default function OrderDetail() {
  const { id }      = useParams<{ id: string }>();
  const navigate    = useNavigate();
  const { fmt, currency, symbol } = useCurrency();
  const { t, lang } = useLang();
  const { user }    = useAuth();
  const invalidateOrderCaches = useInvalidateOrderCaches();
  const [printMenu, setPrintMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editNotes, setEditNotes] = useState("");
  const [editDiscount, setEditDiscount] = useState("0");
  const [editPaymentMethod, setEditPaymentMethod] = useState<string>("cash");

  // ── Completion flow state ───────────────────────────────────────────────
  const [showCompletion, setShowCompletion] = useState(false);
  const [completionMode, setCompletionMode] = useState<CompletionMode>("partial_return");
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);

  const isOperatorOrCeo = user?.role === "ceo" || user?.role === "operator";
  const { confirm, dialog } = useConfirm();

  const { data: order, isLoading, isError, refetch } = trpc.order.getById.useQuery(
    { id: Number(id) }, { enabled: !!id }
  );

  const { data: settings } = trpc.settings.get.useQuery();

  const { data: couriers } = trpc.user.list.useQuery(
    { role: "courier" },
    { enabled: isOperatorOrCeo && !!order && (order.status === "new" || order.status === "processing") }
  );

  const { data: adjustments } = trpc.order.getAdjustments.useQuery(
    { orderId: Number(id) },
    { enabled: !!id }
  );

  const { data: orderPayments } = trpc.order.getOrderPayments.useQuery(
    { orderId: Number(id) },
    { enabled: !!id }
  );

  const updateStatus = trpc.order.updateStatus.useMutation({
    onSuccess: () => {
      invalidateOrderCaches();
      notify.success(lang === "uz" ? "Holat yangilandi" : "Статус обновлён");
    },
    onError: (e) => notify.error(e.message),
  });

  const updateOrder = trpc.order.update.useMutation({
    onSuccess: () => {
      invalidateOrderCaches();
      setEditing(false);
      notify.success(lang === "uz" ? "Buyurtma yangilandi" : "Заказ обновлён");
    },
    onError: (e) => notify.error(e.message),
  });

  const assignCourier = trpc.courier.assignCourier.useMutation({
    onSuccess: () => {
      invalidateOrderCaches();
      notify.success(lang === "uz" ? "Kuryer tayinlandi" : "Курьер назначен");
    },
    onError: (e) => notify.error(e.message),
  });

  const deleteOrder = trpc.order.delete.useMutation({
    onSuccess: () => {
      invalidateOrderCaches();
      notify.success(lang === "uz" ? "Buyurtma o'chirildi" : "Заказ удалён");
      navigate("/orders");
    },
    onError: (e) => notify.error(e.message),
  });

  // ── Completion flow (shared hook) ───────────────────────────────────────
  const { saving: completionSaving, handleCompletionSave: baseHandleCompletionSave, isCompletionStatus, getCompletionMode } = useCompletionFlow({
    orderId: Number(id),
    // useCompletionFlow refreshes the caches itself; nothing extra to do here.
  });

  async function handleCompletionSave(data: CompletionData) {
    const ok = await baseHandleCompletionSave(data, pendingStatus);
    if (ok) {
      setShowCompletion(false);
      setPendingStatus(null);
    }
  }

  const startEditing = useCallback(() => {
    if (!order) return;
    setEditNotes(order.notes ?? "");
    setEditDiscount(String(Number(order.discount ?? 0)));
    setEditPaymentMethod(order.paymentMethod ?? "cash");
    setEditing(true);
  }, [order]);

  const saveEditing = useCallback(() => {
    if (!order) return;
    const subtotal = Number(order.subtotal ?? 0);
    const newDiscount = Number(editDiscount);
    if (newDiscount < 0 || newDiscount > 100) {
      notify.error(lang === "uz" ? "Chegirma 0-100 oralig'ida bo'lishi kerak" : "Скидка должна быть от 0 до 100");
      return;
    }
    updateOrder.mutate({
      id: order.id,
      notes: editNotes || undefined,
      discount: editDiscount !== "0" ? editDiscount : undefined,
    });
  }, [order, editNotes, editDiscount, updateOrder, lang]);

  const buildDocData = (): OrderDocData | null => {
    if (!order) return null;
    const seller: CompanyInfo = {
      name:    settings?.companyName ?? "Warehouse Pro",
      address: settings?.companyAddress ?? "",
      inn:     settings?.companyInn ?? "",
      director:settings?.companyDirector ?? "",
      bank:    settings?.companyBank ?? "",
      account: settings?.companyBankAccount ?? "",
      mfo:     settings?.companyMfo ?? "",
    };
    const shopExtra = order.shop as Record<string, unknown> | undefined;
    const buyer: CompanyInfo = {
      name:    order.shop?.name ?? "",
      address: (shopExtra?.address as string) ?? "",
      inn:     (shopExtra?.inn as string) ?? "",
    };
    const pm = PAYMENT_METHODS[order.paymentMethod ?? "cash"];
    return {
      number:   order.orderNumber,
      date:     order.createdAt
        ? format(new Date(order.createdAt), "dd.MM.yyyy", { locale: dateRu })
        : "",
      seller,
      buyer,
      items:    (order.items ?? []).map((i) => ({
        name:  i.productName ?? "",
        code:  i.productCode ?? "",
        unit:  UNIT_LABELS[i.unit ?? "pcs"]?.ru ?? "шт",
        qty:   Number(i.deliveredQuantity ?? i.quantity),
        price: Number(i.unitPrice),
        total: Number(i.subtotal),
        orderedQty: Number(i.quantity),
        deliveredQty: i.deliveredQuantity != null ? Number(i.deliveredQuantity) : undefined,
        returnReason: i.returnReason ?? undefined,
      })),
      subtotal: Number(order.subtotal),
      discount: Number(order.discount ?? 0),
      total:    Number(order.total),
      notes:    order.notes ?? "",
      currency,
      paymentMethodLabel: pm ? (lang === "uz" ? pm.uz : pm.ru) : undefined,
      paymentMethodColor: pm?.color,
      shopOwner:  order.shop?.ownerName ?? undefined,
      shopPhone:  ((order.shop as Record<string, unknown>)?.phone as string) ?? undefined,
      territoryName: (order.shop as Record<string, unknown>)?.territoryName as string ?? undefined,
    };
  };

  const handleExport = async () => {
    if (!order) return;
    const rows = (order.items ?? []).map((i) => {
      const ul = UNIT_LABELS[i.unit ?? "pcs"] ?? { ru: "шт", uz: "dona" };
      return {
        [lang === "uz" ? "Buyurtma" : "Заказ"]:    order.orderNumber,
        [lang === "uz" ? "Do'kon" : "Магазин"]:     order.shop?.name ?? "",
        [lang === "uz" ? "Agent" : "Агент"]:         order.agent?.name ?? "",
        [lang === "uz" ? "Holat" : "Статус"]:        STATUS_LABELS[order.status]?.[lang] ?? order.status,
        [lang === "uz" ? "Mahsulot" : "Товар"]:      i.productName ?? "",
        [lang === "uz" ? "Kod" : "Код"]:             i.productCode ?? "",
        [lang === "uz" ? `Miqdor (${ul.uz})` : `Кол-во (${ul.ru})`]: cleanNum(i.quantity),
        "Цена":   cleanNum(i.unitPrice),
        [lang === "uz" ? "Summa" : "Сумма"]:         cleanNum(i.subtotal),
      };
    });
    await exportToExcel(rows, `order-${order.orderNumber}`);
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!order) return;
    const mode = getCompletionMode(newStatus);
    if (mode) {
      setCompletionMode(mode);
      setPendingStatus(newStatus);
      setShowCompletion(true);
      return;
    }
    const label = STATUS_LABELS[newStatus]?.[lang] ?? newStatus;
    const ok = await confirm({
      title: lang === "uz" ? "Holatni o'zgartirish?" : "Изменить статус?",
      message: `${STATUS_LABELS[order.status]?.[lang] ?? order.status} → ${label}`,
      confirmText: lang === "uz" ? "O'zgartirish" : "Изменить",
    });
    if (ok) updateStatus.mutate({ id: order.id, status: newStatus as "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned" });
  };

  if (isError) return <QueryErrorFallback onRetry={refetch} />;
  if (isLoading) return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="h-8 w-48 bg-surface-light animate-pulse rounded"/>
      <div className="h-64 bg-surface-light animate-pulse rounded"/>
    </div>
  );

  if (!order) return <div className="text-center py-20 text-secondary">{lang === "uz" ? "Buyurtma topilmadi" : "Заказ не найден"}</div>;

  const subtotal = Number(order.subtotal ?? 0);
  const discount = Number(order.discount ?? 0);
  const total    = Number(order.total ?? 0);
  const shopDebt = Number((order.shop as Record<string, unknown>)?.debt ?? 0);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {dialog}

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <button onClick={() => navigate("/orders")} className="neo-btn flex items-center gap-2 py-1.5 px-3 text-sm">
          <ArrowLeft size={18}/><span>{lang === "uz" ? "Orqaga" : "Назад"}</span>
        </button>
        <div className="flex gap-2 relative">
          <button onClick={handleExport} className="neo-btn flex items-center gap-2 text-sm py-2">
            <FileDown size={15}/> Excel
          </button>
          {/* Print menu */}
          <div className="relative">
            <button onClick={() => setPrintMenu(v => !v)} className="neo-btn flex items-center gap-2 text-sm py-2">
              <Printer size={15}/> {lang === "uz" ? "Chop etish" : "Печать"} <ChevronDown size={13}/>
            </button>
            {printMenu && (
              <div className="absolute right-0 top-full mt-1 w-64 panel py-1 z-20 shadow-lg rounded-lg border">
                <p className="px-4 py-1.5 text-[10px] font-label text-secondary tracking-wider uppercase">
                  {lang === "uz" ? "Hujjatlar" : "Документы"}
                </p>
                {[
                  { label: lang === "uz" ? "Chiqim nakladnaya (O'Z)" : "Расходная накладная (УЗ)", fn: () => { const d = buildDocData(); if(d) printUzWaybill(d); } },
                  { label: lang === "uz" ? "Hisob-faktura" : "Счёт на оплату",                   fn: () => { const d = buildDocData(); if(d) printInvoice(d);  } },
                  { label: lang === "uz" ? "TORg-12 (RF)" : "ТОРГ-12 (РФ)",                     fn: () => { const d = buildDocData(); if(d) printTorg12(d);   } },
                ].map(item => (
                  <button key={item.label} onClick={() => { item.fn(); setPrintMenu(false); }}
                    className="w-full text-left px-4 py-2 text-sm text-primary hover:bg-surface-light flex items-center gap-2">
                    <Printer size={13} className="text-secondary"/>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Main Card ── */}
      <div className="neo-card p-6 space-y-6">
        {/* Title + Status + Edit */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-primary tracking-tight">
              {lang === "uz" ? "BUYURTMA" : "ЗАКАЗ"} {order.orderNumber}
            </h1>
            <p className="text-sm text-secondary mt-1">
              {order.createdAt ? format(new Date(order.createdAt), "d MMMM yyyy, HH:mm", { locale: dateRu }) : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Status dropdown */}
            {isOperatorOrCeo && !order.deletedAt ? (
              <Select value={order.status} onValueChange={handleStatusChange}>
                <SelectTrigger className="h-8 text-xs rounded-full w-auto px-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([key, labels]) => (
                    <SelectItem key={key} value={key} className="text-xs">
                      {lang === "uz" ? labels.uz : labels.ru}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className={`badge ${STATUS_STYLES[order.status]}`}>
                {STATUS_LABELS[order.status]?.[lang] ?? order.status}
              </span>
            )}

            {/* Payment badge */}
            {(() => {
              const pm = PAYMENT_METHODS[order.paymentMethod ?? "cash"];
              if (!pm) return null;
              return (
                <span style={{
                  display: "inline-flex", padding: "4px 12px", borderRadius: "9999px",
                  fontSize: "11px", fontWeight: 600,
                  background: colorMix(pm.color, 8), color: pm.color, border: `1px solid ${colorMix(pm.color, 19)}`,
                }}>
                  {lang === "uz" ? pm.uz : pm.ru}
                </span>
              );
            })()}

            {editing && (
              <button onClick={() => setEditing(false)} style={{
                padding: "6px 12px", fontSize: "12px", fontWeight: 500,
                borderRadius: "10px", border: "1px solid #e0e0e0", cursor: "pointer",
                background: "#fff", color: "#6a7290",
              }}>
                {lang === "uz" ? "Bekor" : "Отмена"}
              </button>
            )}
          </div>
        </div>

        {/* Total + Edit button */}
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold text-primary">{cleanNum(total)}</span>
            <span className="text-lg text-secondary">{symbol}</span>
          </div>
          {isOperatorOrCeo && !order.deletedAt && (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Complete stays available for every status the goods have not
                  left on yet, so the order can be finished from here too. */}
              {OPEN_STATUSES.includes(order.status) && (
                <button
                  onClick={() => handleStatusChange("delivered")}
                  style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "10px 24px", fontSize: "14px", fontWeight: 700,
                    fontFamily: "'DM Sans', sans-serif",
                    borderRadius: "14px", border: "none", cursor: "pointer",
                    background: "linear-gradient(135deg, var(--color-success), #28a862)",
                    color: "#fff",
                    boxShadow: "0 4px 12px rgba(52,196,115,0.25)",
                  }}
                >
                  <CheckCircle2 size={16} />
                  {lang === "uz" ? "Buyurtmani yakunlash" : "Завершить заказ"}
                </button>
              )}
              <button
                onClick={editing ? saveEditing : startEditing}
                disabled={editing && updateOrder.isPending}
                style={{
                  display: "flex", alignItems: "center", gap: "8px",
                  padding: "10px 24px", fontSize: "14px", fontWeight: 700,
                  fontFamily: "'DM Sans', sans-serif",
                  borderRadius: "14px", border: "none", cursor: "pointer",
                  background: editing ? "var(--color-success)" : "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))",
                  color: "#fff",
                  boxShadow: "0 4px 12px rgba(91,109,138,0.25)",
                  opacity: editing && updateOrder.isPending ? 0.7 : 1,
                }}
              >
                <Edit3 size={16} />
                {editing ? (lang === "uz" ? "Saqlash" : "Сохранить изменения") : (lang === "uz" ? "Tahrirlash" : "Изменить заказ")}
              </button>
            </div>
          )}
        </div>

        <Separator />

        {/* ── Meta Grid ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-3 rounded-lg bg-muted/20">
            <p className="font-label text-secondary text-[10px] tracking-wider mb-1 flex items-center gap-1">
              <Store size={12}/> {lang === "uz" ? "XARIDOR" : "ПОКУПАТЕЛЬ"}
            </p>
            <p className="text-sm font-medium text-primary">{order.shop?.name ?? "—"}</p>
            {(order.shop as Record<string, unknown>)?.phone && (
              <p className="text-xs text-secondary flex items-center gap-1 mt-0.5">
                <Phone size={10}/> {(order.shop as Record<string, unknown>).phone as string}
              </p>
            )}
            {shopDebt > 0 && (
              <p className="text-xs text-danger font-medium mt-1 flex items-center gap-1">
                <AlertTriangle size={10}/> {lang === "uz" ? "Qarz:" : "Долг:"} {cleanNum(shopDebt)} {symbol}
              </p>
            )}
          </div>
          <div className="p-3 rounded-lg bg-muted/20">
            <p className="font-label text-secondary text-[10px] tracking-wider mb-1 flex items-center gap-1">
              <User size={12}/> {lang === "uz" ? "AGENT" : "АГЕНТ"}
            </p>
            <p className="text-sm text-primary">{order.agent?.name ?? "—"}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/20">
            <p className="font-label text-secondary text-[10px] tracking-wider mb-1 flex items-center gap-1">
              <CreditCard size={12}/> {lang === "uz" ? "TO'LOV" : "ОПЛАТА"}
            </p>
            <p className="text-sm text-primary">{PAYMENT_METHODS[order.paymentMethod ?? "cash"]?.[lang] ?? "—"}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/20">
            <p className="font-label text-secondary text-[10px] tracking-wider mb-1 flex items-center gap-1">
              <Truck size={12}/> {lang === "uz" ? "YETKAZIB BERISH" : "ДОСТАВКА"}
            </p>
            <p className="text-sm text-primary">
              {order.deliveryStatus === "delivered" ? (lang === "uz" ? "Yetkazildi" : "Доставлен") :
               order.deliveryStatus === "out_for_delivery" ? (lang === "uz" ? "Yo'lda" : "В пути") :
               order.deliveryStatus === "assigned" ? (lang === "uz" ? "Tayinlangan" : "Назначен") :
               (lang === "uz" ? "Tayinlanmagan" : "Не назначен")}
            </p>
          </div>
        </div>

        <Separator />

        {/* ── Items Table ── */}
        <div>
          <h3 className="font-label text-secondary text-xs tracking-wider mb-3 flex items-center gap-1">
            <Package size={13}/> {lang === "uz" ? "MAHSULOTLAR" : "ТОВАРЫ"} ({order.items?.length ?? 0})
          </h3>
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-light">
                  <th className="text-left px-3 py-2 font-h3 text-secondary text-xs">№</th>
                  <th className="text-left px-3 py-2 font-h3 text-secondary text-xs">
                    {lang === "uz" ? "MAHSULOT" : "ТОВАР"}
                  </th>
                  <th className="text-left px-3 py-2 font-h3 text-secondary text-xs">
                    {lang === "uz" ? "KOD" : "КОД"}
                  </th>
                  <th className="text-right px-3 py-2 font-h3 text-secondary text-xs">
                    {(() => {
                      const firstUnit = order.items?.[0]?.unit;
                      const ul = firstUnit ? UNIT_LABELS[firstUnit] : null;
                      return ul ? (lang === "uz" ? ul.uz : ul.ru).toUpperCase() : (lang === "uz" ? "MIQDOR" : "КОЛ-ВО");
                    })()}
                  </th>
                  <th className="text-right px-3 py-2 font-h3 text-secondary text-xs">
                    {lang === "uz" ? "NARX" : "ЦЕНА"}
                  </th>
                  <th className="text-right px-3 py-2 font-h3 text-secondary text-xs">
                    {lang === "uz" ? "SUMMA" : "СУММА"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {order.items?.map((item, i) => {
                  const ul = UNIT_LABELS[item.unit ?? "pcs"] ?? { ru: "шт", uz: "dona" };
                  const unitLabel = lang === "uz" ? ul.uz : ul.ru;
                  const hasPartial = item.deliveredQuantity != null && Number(item.deliveredQuantity) < Number(item.quantity);
                  return (
                    <tr key={item.id ?? i} className="border-b border-border-subtle hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2.5 text-xs text-secondary">{i + 1}</td>
                      <td className="px-3 py-2.5 text-sm text-primary">
                        {item.productName ?? "—"}
                        {hasPartial && (
                          <div className="text-xs text-amber-600 mt-0.5 flex items-center gap-1">
                            <AlertTriangle size={10}/>
                            {lang === "uz" ? "Qisman yetkazildi" : "Частичная доставка"}
                            {item.returnReason && ` — ${item.returnReason}`}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-data text-xs text-secondary">{item.productCode ?? "—"}</td>
                      <td className="px-3 py-2.5 font-data text-sm text-right">
                        {hasPartial ? (
                          <span>
                            <span className="line-through text-muted-foreground">{cleanNum(item.quantity)}</span>
                            <span className="ml-1 text-amber-600 font-medium">{cleanNum(item.deliveredQuantity)}</span>
                            <span className="text-xs text-muted-foreground ml-0.5">{unitLabel}</span>
                          </span>
                        ) : (
                          <span>{cleanNum(item.quantity)} <span className="text-xs text-muted-foreground">{unitLabel}</span></span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-data text-sm text-right text-secondary">{cleanNum(item.unitPrice)}</td>
                      <td className="px-3 py-2.5 font-data text-sm text-right font-medium">{cleanNum(item.subtotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Totals ── */}
        <div className="flex justify-end">
          <div className="w-72 space-y-1.5 p-3 rounded-lg bg-muted/20">
            <div className="flex justify-between text-sm">
              <span className="text-secondary">{lang === "uz" ? "Oraliq summa" : "Подитог"}</span>
              <span className="font-data">{cleanNum(subtotal)} {symbol}</span>
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-secondary">
                  {lang === "uz" ? "Chegirma" : "Скидка"}
                  {subtotal > 0 && ` (${((discount / subtotal) * 100).toFixed(1)}%)`}
                </span>
                <span className="font-data text-success">−{cleanNum(discount)} {symbol}</span>
              </div>
            )}
            <Separator />
            <div className="flex justify-between font-bold text-lg">
              <span>{lang === "uz" ? "JAMI" : "ИТОГО"}</span>
              <span className="font-data text-primary">{cleanNum(total)} {symbol}</span>
            </div>
          </div>
        </div>

        {/* ── Notes ── */}
        {(order.notes || editing) && (
          <div className="pt-4 border-t border-border-subtle">
            <p className="font-label text-secondary text-[10px] tracking-wider mb-1">
              {lang === "uz" ? "IZOH" : "ПРИМЕЧАНИЕ"}
            </p>
            {editing ? (
              <Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} className="text-sm" rows={3}
                placeholder={lang === "uz" ? "Izoh..." : "Комментарий..."} />
            ) : (
              <p className="text-sm text-secondary">{order.notes || (lang === "uz" ? "Izoh yo'q" : "Нет примечания")}</p>
            )}
          </div>
        )}
      </div>

      {/* ── Edit Form (shows when editing=true, triggered by header button) ── */}
      {isOperatorOrCeo && editing && (
        <div className="neo-card p-4">
          <div className="space-y-3">
            <p className="font-label text-secondary text-xs tracking-wider">
              {lang === "uz" ? "BUYURTMANI TAHRIRLASH" : "РЕДАКТИРОВАНИЕ ЗАКАЗА"}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-secondary mb-1 block">{lang === "uz" ? "Chegirma (%)" : "Скидка (%)"}</label>
                <Input type="number" min="0" max="100" value={editDiscount} onChange={e => setEditDiscount(e.target.value)} className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-xs text-secondary mb-1 block">{lang === "uz" ? "To'lov usuli" : "Метод оплаты"}</label>
                <Select value={editPaymentMethod} onValueChange={setEditPaymentMethod}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_METHODS).map(([key, pm]) => (
                      <SelectItem key={key} value={key} className="text-sm">{lang === "uz" ? pm.uz : pm.ru}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-xs text-secondary mb-1 block">{lang === "uz" ? "Izoh" : "Примечания"}</label>
              <Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} className="text-sm" rows={3} />
            </div>
          </div>
        </div>
      )}

      {/* ── Courier Assignment ── */}
      {isOperatorOrCeo && (order.status === "new" || order.status === "processing") && (
        <div className="neo-card p-4">
          <p className="font-label text-secondary text-xs tracking-wider mb-3 flex items-center gap-2">
            <Truck size={14}/> {lang === "uz" ? "KURYERNI TAYINLASH" : "НАЗНАЧИТЬ КУРЬЕРА"}
          </p>
          <div className="flex items-center gap-3">
            <PremiumSelect
              value={order.courierId ? String(order.courierId) : ""}
              options={[
                { value: "", label: lang === "uz" ? "Kuryer tanlang" : "Выберите курьера" },
                ...(couriers?.data?.map((c) => ({ value: String(c.id), label: c.name })) ?? []),
              ]}
              onChange={(val) => {
                const courierId = Number(val);
                if (courierId) assignCourier.mutate({ orderId: order.id, courierId });
              }}
              width="100%"
            />
          </div>
        </div>
      )}

      {/* ── Payments History ── */}
      {orderPayments && orderPayments.length > 0 && (
        <div className="neo-card p-4">
          <p className="font-label text-secondary text-xs tracking-wider mb-3 flex items-center gap-2">
            <CreditCard size={14}/> {lang === "uz" ? "TO'LOVLAR TARIXI" : "ИСТОРИЯ ОПЛАТ"}
          </p>
          <div className="space-y-2">
            {orderPayments.map(p => (
              <div key={p.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/20 text-sm">
                <div>
                  <span className="font-medium">{cleanNum(p.paidAmount ?? p.amount)} {symbol}</span>
                  <span className="text-xs text-secondary ml-2">
                    {p.paymentMethod && PAYMENT_METHODS[p.paymentMethod]?.[lang]}
                  </span>
                  {p.debtAmount && Number(p.debtAmount) > 0 && (
                    <span className="text-xs text-danger ml-2">
                      {lang === "uz" ? "Qarz:" : "Долг:"} {cleanNum(p.debtAmount)} {symbol}
                    </span>
                  )}
                </div>
                <span className="text-xs text-secondary">
                  {p.createdAt ? format(new Date(p.createdAt), "dd.MM.yyyy HH:mm") : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Adjustments History ── */}
      {adjustments && adjustments.length > 0 && (
        <div className="neo-card p-4">
          <p className="font-label text-secondary text-xs tracking-wider mb-3 flex items-center gap-2">
            <Clock size={14}/> {lang === "uz" ? "TUZATMALAR TARIXI" : "ИСТОРИЯ КОРРЕКТИРОВОК"}
          </p>
          <div className="space-y-2">
            {adjustments.map(adj => {
              const typeLabels: Record<string, { ru: string; uz: string }> = {
                partial_delivery: { ru: "Частичная доставка", uz: "Qisman yetkazib berish" },
                partial_payment: { ru: "Частичная оплата", uz: "Qisman to'lov" },
                price_change: { ru: "Изменение цены", uz: "Narx o'zgarishi" },
                quantity_change: { ru: "Изменение количества", uz: "Miqdor o'zgarishi" },
              };
              const label = typeLabels[adj.type] ?? { ru: adj.type, uz: adj.type };
              return (
                <div key={adj.id} className="p-2 rounded-lg bg-muted/20 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{lang === "uz" ? label.uz : label.ru}</span>
                    <span className="text-xs text-secondary">
                      {adj.createdAt ? format(new Date(adj.createdAt), "dd.MM.yyyy HH:mm") : ""}
                      {adj.adjustedByName && ` • ${adj.adjustedByName}`}
                    </span>
                  </div>
                  {adj.reason && <p className="text-xs text-secondary mt-1 italic">"{adj.reason}"</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Delete ── */}
      {isOperatorOrCeo && (order.status === "new" || order.status === "processing" || order.status === "cancelled") && (
        <div className="neo-card p-4">
          <button
            onClick={async () => {
              const ok = await confirm({
                title: lang === "uz" ? "Buyurtmani o'chirish?" : "Удалить заказ?",
                message: lang === "uz" ? "Bu amalni qaytarib bo'lmaydi" : "Это действие нельзя отменить",
                confirmText: lang === "uz" ? "O'chirish" : "Удалить",
                danger: true,
              });
              if (ok) deleteOrder.mutate({ id: order.id });
            }}
            className="neo-btn flex items-center gap-2 text-sm text-danger border-danger/30"
          >
            <Trash2 size={14}/> {lang === "uz" ? "Buyurtmani o'chirish" : "Удалить заказ"}
          </button>
        </div>
      )}
      {/* ── Completion Flow Modal ── */}
      <CompletionFlowModal
        open={showCompletion}
        onClose={() => { setShowCompletion(false); setPendingStatus(null); }}
        mode={completionMode}
        orderNumber={order.orderNumber}
        orderTotal={order.total}
        items={(order.items ?? []).map(i => ({
          id: i.id,
          productName: i.productName ?? "",
          productCode: i.productCode ?? undefined,
          quantity: Number(i.quantity),
          unitPrice: i.unitPrice,
          unit: i.unit ?? undefined,
          subtotal: i.subtotal,
          deliveredQuantity: i.deliveredQuantity,
          returnReason: i.returnReason,
        }))}
        currency={symbol}
        saving={completionSaving}
        onSave={handleCompletionSave}
      />
    </div>
  );
}
