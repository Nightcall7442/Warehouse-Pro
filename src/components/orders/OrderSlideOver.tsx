import { useState } from "react";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { discountMoneyToPct } from "@/lib/order-discount";
import { createPortal } from "react-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Store, User, Truck, MapPin, Phone, Printer, Edit3, Save, X,
  AlertTriangle, Package, ChevronDown, FileDown, Plus, Trash2,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useTranslate, useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { unitShort } from "@/lib/units";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { useCompletionFlow } from "@/hooks/useCompletionFlow";
import { printUzWaybill, printTorg12, printInvoice } from "@/lib/documents";
import type { OrderDocData, CompanyInfo } from "@/lib/documents";
import { exportToExcel } from "@/lib/excel";
import { format } from "date-fns";
import { ru as dateRu } from "date-fns/locale";
import { OrderComments } from "./OrderComments";
import { CompletionFlowModal } from "./CompletionFlowModal";
import { useInvalidateOrderCaches } from "@/hooks/useOrderCacheSync";
import { useSellerCompany } from "@/hooks/useSellerCompany";
import type { CompletionData, CompletionMode } from "./CompletionFlowModal";
import { StatusBadge, InfoCard, PillButton } from "./theme";
import { F, COLORS, STATUS, PAYMENT } from "./theme-tokens";
import { labelled, PAYMENT_METHOD_LABEL, ADJUSTMENT_TYPE_LABEL } from "@/lib/entity-labels";
import { colorMix } from "@/lib/color-mix";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number | null;
  currency?: string;
}

/** A line being edited. `itemId` is absent for a product added during this edit. */
interface EditLine {
  key: string;
  itemId?: number;
  productId: number;
  productName: string;
  quantity: string;
  unitPrice: string;
}


function DebtBlock({ debt, orderTotal, currency }: { debt: string; orderTotal: string; currency: string }) {
  const t = useTranslate();
  const debtAmount = Number(debt);
  const totalAmount = Number(orderTotal);

  let color = COLORS.success;
  let label = t("Оплачено полностью", "To'liq to'langan");
  if (debtAmount > 1_000_000) {
    color = COLORS.danger;
    label = t("КРИТИЧЕСКИЙ ДОЛГ!", "KRITIK QARZ!");
  } else if (debtAmount > 500_000) {
    color = COLORS.danger;
    label = t("Крупная задолженность", "Katta qarz");
  } else if (debtAmount > 0) {
    color = COLORS.warning;
    label = t("Небольшая задолженность", "Kichik qarz");
  }

  return (
    <div style={{ padding: "12px", borderRadius: "12px", background: colorMix(color, 5), border: `1px solid ${colorMix(color, 19)}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
        <span style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.textTertiary }}>{t("Задолженность магазина", "Do'kon qarzi")}</span>
        {debtAmount > 500_000 && <AlertTriangle size={14} color={color} />}
      </div>
      <div style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color }}>
        {debtAmount.toLocaleString("ru")} {currency}
      </div>
      <div style={{ fontFamily: F.body, fontSize: "11px", fontWeight: 600, color, marginTop: "2px" }}>{label}</div>
      {debtAmount > 0 && totalAmount > 0 && (
        <div style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.textTertiary, marginTop: "8px", lineHeight: 1.6 }}>
          <div>{t("По текущему заказу", "Joriy buyurtma bo'yicha")}: <b style={{ color: COLORS.textSecondary }}>{totalAmount.toLocaleString("ru")} {currency}</b></div>
          <div>{t("Рекомендуемая оплата", "Tavsiya etilgan to'lov")}: <b style={{ color }}>{(debtAmount + totalAmount).toLocaleString("ru")} {currency}</b></div>
        </div>
      )}
    </div>
  );
}

/** Clickable list-row card used in the Documents tab. */
function DocRow({ icon, iconBg, label, onClick }: {
  icon: React.ReactNode; iconBg: string; label: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px", borderRadius: "12px", border: `1px solid ${COLORS.border}`,
        background: COLORS.surface, cursor: "pointer",
      }}
      // Наведение — правилом, а не двумя обработчиками на каждую карточку:
      // руками оно не гаснет при уходе пальца на сенсорном экране и не знает
      // про prefers-reduced-motion.
      className="hover-lift"
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <div style={{ width: "32px", height: "32px", borderRadius: "10px", background: iconBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon}
        </div>
        <span style={{ fontFamily: F.body, fontSize: "13px", fontWeight: 500, color: COLORS.textPrimary }}>{label}</span>
      </div>
      <ChevronDown size={14} color={COLORS.textTertiary} style={{ transform: "rotate(-90deg)" }} />
    </button>
  );
}

export function OrderSlideOver({ open, onOpenChange, orderId, currency = "сум" }: Props) {
  const t = useTranslate();
  const { user } = useAuth();
  const { confirm, dialog } = useConfirm();
  const invalidateOrderCaches = useInvalidateOrderCaches();
  const { lang } = useLang();
  const { symbol } = useCurrency();
  const isOperatorOrCeo = user?.role === "ceo" || user?.role === "operator";

  const { data: order, isLoading } = trpc.order.getById.useQuery(
    { id: orderId! },
    { enabled: !!orderId && open },
  );

  const { company: seller, footerNote } = useSellerCompany();

  // ── Edit state ─────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editNotes, setEditNotes] = useState("");
  const [editDiscount, setEditDiscount] = useState("0");
  const [editPaymentMethod, setEditPaymentMethod] = useState<string>("cash");
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [addProductId, setAddProductId] = useState<string>("");

  // ── New-debt modal ─────────────────────────────────────────────────────
  const [showDebtModal, setShowDebtModal] = useState(false);
  // Метка одной записи долга. Здесь окно не пересоздаётся — панель заказа
  // остаётся смонтированной, — поэтому метка обновляется при каждом открытии
  // окна, а не один раз на монтирование: иначе вторая запись долга подряд
  // ушла бы с той же меткой и сервер отбросил бы её как повтор.
  const [debtIdempotencyKey, setDebtIdempotencyKey] = useState(() => crypto.randomUUID());
  const [debtAmount, setDebtAmount] = useState("");
  const [debtNotes, setDebtNotes] = useState("");

  // ── Completion flow (shared hook) ──────────────────────────────────────
  const [showCompletion, setShowCompletion] = useState(false);
  const [completionMode, setCompletionMode] = useState<CompletionMode>("partial_return");
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);

  const { saving: completionSaving, handleCompletionSave: baseHandleCompletionSave, directStatusChange, getCompletionMode } = useCompletionFlow({
    orderId: orderId ?? 0,
    // useCompletionFlow refreshes the caches itself; nothing extra to do here.
  });

  async function handleCompletionSave(data: CompletionData) {
    const ok = await baseHandleCompletionSave(data, pendingStatus);
    if (ok) {
      setShowCompletion(false);
      setPendingStatus(null);
    }
  }

  // ── Build document data for printing ──────────────────────────────────
  function buildDocData(): OrderDocData | null {
    if (!order) return null;
    // Реквизиты ещё не прочитаны — печатать нечего: документ ушёл бы
    // покупателю арендатора с именем поставщика системы в шапке.
    if (!seller.name) return null;
    const shopExtra = order.shop as Record<string, unknown> | undefined;
    const buyer: CompanyInfo = {
      name:    order.shop?.name ?? "",
      address: (shopExtra?.address as string) ?? "",
      inn:     (shopExtra?.inn as string) ?? "",
    };
    return {
      number:   order.orderNumber,
      date:     order.createdAt ? format(new Date(order.createdAt), "dd.MM.yyyy", { locale: dateRu }) : "",
      seller,
      buyer,
      items:    (order.items ?? []).map((i) => ({
        name:  i.productName ?? "",
        code:  i.productCode ?? "",
        unit:  unitShort(i.unit),
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
      currency: symbol,
      paymentMethodLabel: PAYMENT[order.paymentMethod ?? "cash"]?.ru,
      shopOwner:  order.shop?.ownerName ?? undefined,
      shopPhone:  ((order.shop as Record<string, unknown>)?.phone as string) ?? undefined,
      territoryName: (order.shop as Record<string, unknown>)?.territoryName as string ?? undefined,
      footerNote,
    };
  }

  async function handleExport() {
    if (!order) return;
    const rows = (order.items ?? []).map((i) => ({
      "Заказ": order.orderNumber,
      "Магазин": order.shopName ?? "",
      "Товар": i.productName ?? "",
      "Код": i.productCode ?? "",
      "Кол-во": Number(i.quantity),
      "Цена": Number(i.unitPrice),
      "Сумма": Number(i.subtotal),
    }));
    await exportToExcel(rows, `order-${order.orderNumber}`);
  }

  // ── Mutations ──────────────────────────────────────────────────────────
  const updateOrder = trpc.order.update.useMutation({
    onSuccess: () => {
      invalidateOrderCaches();
      setEditing(false);
      notify.success(t("Заказ обновлён", "Buyurtma yangilandi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const updateItems = trpc.order.updateItems.useMutation({
    onSuccess: () => invalidateOrderCaches(),
    onError: (e) => notify.error(e.message),
  });

  const addDebt = trpc.shop.addPayment.useMutation({
    onSuccess: () => {
      invalidateOrderCaches();
      setShowDebtModal(false);
      setDebtAmount("");
      setDebtNotes("");
      notify.success(t("Долг добавлен", "Qarz qo'shildi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const assignCourier = trpc.courier.assignCourier.useMutation({
    onSuccess: () => {
      invalidateOrderCaches();
      notify.success(t("Курьер назначен", "Kuryer tayinlandi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const { data: productsRaw } = trpc.product.list.useQuery(
    { pageSize: 500 },
    { enabled: isOperatorOrCeo && editing },
  );
  const pickerProducts = productsRaw?.data ?? [];

  const { data: couriers } = trpc.user.list.useQuery(
    { role: "courier" },
    { enabled: isOperatorOrCeo && !!order && (order.status === "new" || order.status === "processing") },
  );

  // ── Status change handler ─────────────────────────────────────────────
  async function handleStatusChange(newStatus: string) {
    if (!order) return;
    const mode = getCompletionMode(newStatus);
    if (mode) {
      setCompletionMode(mode);
      setPendingStatus(newStatus);
      setShowCompletion(true);
      return;
    }
    const label = STATUS[newStatus]?.[lang] ?? newStatus;
    const ok = await confirm({
      title: t("Изменить статус?", "Holatni o'zgartirish?"),
      message: `${STATUS[order.status]?.[lang] ?? order.status} → ${label}`,
      confirmText: t("Изменить", "O'zgartirish"),
    });
    if (ok) directStatusChange(newStatus);
  }

  // ── Edit handlers ──────────────────────────────────────────────────────
  function startEditing() {
    if (!order) return;
    setEditNotes(order.notes ?? "");
    // В базе скидка в деньгах, ручка принимает проценты. Пересчёт общий:
    // здесь он был верным, а в OrderDetail — нет, и заказы там резались
    // вдвое. Одна функция на оба места, проверена тестом.
    setEditDiscount(String(discountMoneyToPct(order)));
    setEditPaymentMethod(order.paymentMethod ?? "cash");
    setEditLines((order.items ?? []).map((i) => ({
      key: `item-${i.id}`,
      itemId: i.id,
      productId: i.productId,
      productName: i.productName ?? "",
      quantity: String(Number(i.quantity)),
      unitPrice: String(Number(i.unitPrice)),
    })));
    setAddProductId("");
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setEditLines([]);
    setAddProductId("");
  }

  function updateLine(key: string, patch: Partial<EditLine>) {
    setEditLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setEditLines(prev => prev.filter(l => l.key !== key));
  }

  function addLine(productId: string) {
    const p = pickerProducts.find(x => String(x.id) === productId);
    if (!p) return;
    setEditLines(prev => [...prev, {
      key: `new-${p.id}-${Date.now()}`,
      productId: p.id,
      productName: p.name,
      quantity: "1",
      unitPrice: String(Number(p.unitPrice ?? 0)),
    }]);
    setAddProductId("");
  }

  const editSubtotal = editLines.reduce(
    (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0,
  );
  const editTotal = editSubtotal - editSubtotal * ((Number(editDiscount) || 0) / 100);

  async function saveEditing() {
    if (!order) return;

    if (editLines.length === 0) {
      notify.error(t("В заказе должна остаться хотя бы одна позиция", "Buyurtmada kamida bitta pozitsiya qolishi kerak"));
      return;
    }
    if (editLines.some(l => !(Number(l.quantity) > 0))) {
      notify.error(t("Количество должно быть больше нуля", "Miqdor noldan katta bo'lishi kerak"));
      return;
    }
    if (editLines.some(l => Number(l.unitPrice) < 0 || !Number.isFinite(Number(l.unitPrice)))) {
      notify.error(t("Неверная цена", "Noto'g'ri narx"));
      return;
    }

    const original = order.items ?? [];
    // Lines dropped in the editor are sent as quantity 0 so the server releases
    // their stock, rather than silently leaving them on the order.
    const removed = original
      .filter(o => !editLines.some(l => l.itemId === o.id))
      .map(o => ({ itemId: o.id, quantity: 0 }));

    const lines = [
      ...editLines.map(l => (
        l.itemId !== undefined
          ? { itemId: l.itemId, quantity: Number(l.quantity), unitPrice: l.unitPrice }
          : { productId: l.productId, quantity: Number(l.quantity), unitPrice: l.unitPrice }
      )),
      ...removed,
    ];

    try {
      // Items first: it rewrites subtotal, which the discount percentage applies to.
      await updateItems.mutateAsync({ id: order.id, items: lines });
      await updateOrder.mutateAsync({
        id: order.id,
        notes: editNotes || undefined,
        discount: editDiscount,
        paymentMethod: editPaymentMethod as "cash" | "card" | "transfer" | "debt",
      });
      setEditLines([]);
      setAddProductId("");
    } catch {
      // Both mutations surface their own error toast.
    }
  }

  function submitDebt() {
    if (!order?.shopId) return;
    const amt = Number(debtAmount);
    if (!(amt > 0)) {
      notify.error(t("Введите сумму больше нуля", "Noldan katta summa kiriting"));
      return;
    }
    addDebt.mutate({
      shopId: order.shopId,
      amount: amt.toFixed(2),
      type: "debt",
      notes: debtNotes || undefined,
      idempotencyKey: debtIdempotencyKey,
    });
  }

  if (!orderId) return null;

  const th: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontFamily: F.body, fontSize: "11px", fontWeight: 600, color: COLORS.textTertiary, background: COLORS.surfaceLight };
  const thRight: React.CSSProperties = { ...th, textAlign: "right" };
  const td: React.CSSProperties = { padding: "10px 12px", fontFamily: F.body, fontSize: "13px", color: COLORS.textPrimary, borderTop: `1px solid ${COLORS.border}` };
  const tdRight: React.CSSProperties = { ...td, textAlign: "right", fontFamily: F.display };

  return (
    <>
    <Sheet open={open} onOpenChange={(v) => { if (!showCompletion) onOpenChange(v); }}>
      <SheetContent className="w-full sm:w-[600px] sm:max-w-[600px] p-0 flex flex-col">
        {/*
          Шапка панели заказа.

          Здесь стояла «латунная» полоса: диагональный градиент от фирменного к
          #4a5c78 и два белых круга поверх него «для объёма». Три беды разом.

          Литерал #4a5c78 равен светлому фирменному, и в тёмной теме, где
          фирменный золотой, полоса оставалась сине-стальной — чужой на своём же
          экране. Белый текст задан словом, а не из палитры: на золотом это
          2.4:1 при норме 4.5 — ровно та ошибка, которую уже разбирали у кнопки
          подтверждения и у переключателя периода в KPI. И сама полоса не несла
          ни одной новой мысли: то же, что ниже, но крупнее и на цвете.

          Теперь шапка — обычная поверхность приложения, а работу делает
          расстановка: слева кто это (номер, состояние, способ оплаты), справа
          сколько. Ровно те два вопроса, ради которых панель и открывают.
        */}
        <SheetHeader
          className="shrink-0 p-0"
          style={{
            padding: "20px 52px 18px 24px",
            background: COLORS.surface,
            borderBottom: `1px solid ${COLORS.border}`,
          }}
        >
          <SheetTitle>
            {isLoading ? (
              <span style={{ fontFamily: F.body, fontSize: "14px", fontWeight: 500, color: COLORS.textTertiary }}>
                {t("Загрузка…", "Yuklanmoqda…")}
              </span>
            ) : (
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "18px", flexWrap: "wrap" }}>

                {/* Кто это */}
                <div style={{ display: "flex", flexDirection: "column", gap: "9px", minWidth: 0 }}>
                  <span className="font-data" style={{ fontSize: "15px", fontWeight: 700, letterSpacing: "-0.01em", color: COLORS.textPrimary }}>
                    {order?.orderNumber}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    {/* Директор и оператор меняют статус прямо отсюда, остальные видят плашку. */}
                    {isOperatorOrCeo && order && !order.deletedAt ? (
                      <Select value={order.status} onValueChange={handleStatusChange}>
                        <SelectTrigger style={{
                          height: "32px", padding: "0 12px", fontFamily: F.body, fontSize: "11.5px", fontWeight: 600,
                          borderRadius: "999px", width: "auto", color: STATUS[order.status]?.dot ?? COLORS.textSecondary,
                        }}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(STATUS).map(([key, labels]) => (
                            <SelectItem key={key} value={key} style={{ fontSize: "12px" }}>
                              {lang === "uz" ? labels.uz : labels.ru}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : order ? (
                      <StatusBadge status={order.status} lang={lang} />
                    ) : null}

                    {(() => {
                      const pm = PAYMENT[order?.paymentMethod ?? "cash"];
                      if (!pm) return null;
                      return (
                        <span
                          className="inline-flex items-center px-3 rounded-full text-[11px] font-semibold"
                          style={{
                            height: "32px", background: colorMix(pm.color, 10),
                            border: `1px solid ${colorMix(pm.color, 18)}`, color: pm.color,
                          }}
                        >
                          {t(pm.ru, pm.uz)}
                        </span>
                      );
                    })()}
                  </div>
                </div>

                {/* Сколько. Сумма была тут же дважды — в полосе и сразу под
                    ней, крупнее, — и глаз каждый раз проверял, сходятся ли два
                    числа. Она осталась в одном месте. */}
                <div style={{ flexShrink: 0, textAlign: "right" }}>
                  <p className="font-label" style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: COLORS.textTertiary }}>
                    {t("Сумма заказа", "Buyurtma summasi")}
                  </p>
                  <p className="font-data" style={{ fontSize: "25px", fontWeight: 700, lineHeight: 1.15, marginTop: "3px", color: COLORS.textPrimary, fontVariantNumeric: "tabular-nums" }}>
                    {Number(order?.total ?? 0).toLocaleString("ru")}
                    <span style={{ fontSize: "13px", fontWeight: 600, marginLeft: "5px", color: COLORS.textTertiary }}>{currency}</span>
                  </p>
                </div>
              </div>
            )}
          </SheetTitle>
        </SheetHeader>

        {order && (
          <Tabs defaultValue="details" className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="mx-5">
              <TabsTrigger value="details">{t("Детали", "Tafsilotlar")}</TabsTrigger>
              <TabsTrigger value="history">{t("История", "Tarix")}</TabsTrigger>
              <TabsTrigger value="documents">{t("Документы", "Hujjatlar")}</TabsTrigger>
              <TabsTrigger value="adjustments">{t("Корректировки", "Tuzatmalar")}</TabsTrigger>
              <TabsTrigger value="payments">{t("Оплаты", "To'lovlar")}</TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full px-5 pb-5">
                <div style={{ display: "flex", flexDirection: "column", gap: "18px", paddingTop: "4px" }}>

                  {/* Total and payment method now live in the header band above. */}

                  {/* ── Meta Grid ── */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                    <InfoCard label={t("ПОКУПАТЕЛЬ", "XARIDOR")} icon={<Store size={12} />}>
                      <p style={{ fontFamily: F.body, fontSize: "13px", fontWeight: 500, color: COLORS.textPrimary }}>{order.shopName ?? "—"}</p>
                      {order.shop?.phone && (
                        <p style={{ display: "flex", alignItems: "center", gap: "4px", fontFamily: F.body, fontSize: "11px", color: COLORS.textSecondary, marginTop: "2px" }}>
                          <Phone size={10}/> {order.shop.phone}
                        </p>
                      )}
                      {order.shop?.address && (
                        <p style={{ display: "flex", alignItems: "center", gap: "4px", fontFamily: F.body, fontSize: "11px", color: COLORS.textSecondary, marginTop: "2px" }}>
                          <MapPin size={10}/> {order.shop.address}{order.shop.city ? `, ${order.shop.city}` : ""}
                        </p>
                      )}
                    </InfoCard>

                    <InfoCard label={t("АГЕНТ", "AGENT")} icon={<User size={12} />}>
                      <p style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textPrimary }}>{order.agent?.name ?? "—"}</p>
                    </InfoCard>
                  </div>

                  {/* ── Courier assignment for CEO/operator ── */}
                  {isOperatorOrCeo && (order.status === "new" || order.status === "processing") && (
                    <InfoCard label={t("КУРЬЕР", "KURYER")} icon={<Truck size={12} />}>
                      <Select
                        value={order.courierId ? String(order.courierId) : ""}
                        onValueChange={(val) => {
                          const courierId = Number(val);
                          if (courierId) assignCourier.mutate({ orderId: order.id, courierId });
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs" style={{ marginTop: "4px" }}>
                          <SelectValue placeholder={t("Выберите курьера", "Kuryer tanlang")} />
                        </SelectTrigger>
                        <SelectContent>
                          {(couriers?.data ?? []).map((c) => (
                            <SelectItem key={c.id} value={String(c.id)} className="text-xs">{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </InfoCard>
                  )}

                  {/* ── Items Table ── */}
                  <div>
                    <h4 style={{
                      display: "flex", alignItems: "center", gap: "4px", marginBottom: "8px",
                      fontFamily: F.body, fontSize: "11px", fontWeight: 600, letterSpacing: "0.06em",
                      textTransform: "uppercase", color: COLORS.textTertiary,
                    }}>
                      <Package size={12}/> {t("ТОВАРЫ", "MAHSULOTLAR")} ({editing ? editLines.length : (order.items ?? []).length})
                    </h4>
                    {editing ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        <div style={{ borderRadius: "12px", overflow: "hidden", border: `1px solid ${COLORS.border}` }}>
                          <table style={{ width: "100%", borderCollapse: "collapse" }}>
                            <thead>
                              <tr>
                                <th style={th}>{t("Товар", "Tovar")}</th>
                                <th style={{ ...thRight, width: "96px" }}>{t("Кол-во", "Miqdor")}</th>
                                <th style={{ ...thRight, width: "128px" }}>{t("Цена", "Narx")}</th>
                                <th style={{ ...thRight, width: "112px" }}>{t("Сумма", "Summa")}</th>
                                <th style={{ ...th, width: "32px" }} />
                              </tr>
                            </thead>
                            <tbody>
                              {editLines.map((line) => (
                                <tr key={line.key}>
                                  <td style={td}>{line.productName}</td>
                                  <td style={{ ...td, padding: "6px 8px" }}>
                                    <Input
                                      type="text" inputMode="decimal" value={line.quantity}
                                      onChange={e => updateLine(line.key, { quantity: normalizeDecimalInput(e.target.value) })}
                                      className="h-8 text-sm text-right"
                                    />
                                  </td>
                                  <td style={{ ...td, padding: "6px 8px" }}>
                                    <Input
                                      type="text" inputMode="decimal" value={line.unitPrice}
                                      onChange={e => updateLine(line.key, { unitPrice: normalizeDecimalInput(e.target.value) })}
                                      className="h-8 text-sm text-right"
                                    />
                                  </td>
                                  <td style={{ ...tdRight, fontWeight: 600 }}>
                                    {((Number(line.quantity) || 0) * (Number(line.unitPrice) || 0)).toLocaleString("ru")}
                                  </td>
                                  <td style={{ ...td, padding: "6px 4px" }}>
                                    <button
                                      onClick={() => removeLine(line.key)}
                                      aria-label={t("Удалить позицию", "Pozitsiyani o'chirish")}
                                      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "28px", height: "28px", borderRadius: "8px", border: "none", background: "transparent", color: COLORS.danger, cursor: "pointer" }}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <Select value={addProductId} onValueChange={addLine}>
                            <SelectTrigger className="h-8 text-sm flex-1">
                              <SelectValue placeholder={t("Добавить товар...", "Tovar qo'shish...")} />
                            </SelectTrigger>
                            <SelectContent>
                              {pickerProducts
                                .filter(p => !editLines.some(l => l.productId === p.id))
                                .map(p => (
                                  <SelectItem key={p.id} value={String(p.id)}>
                                    {p.name} — {Number(p.unitPrice ?? 0).toLocaleString("ru")}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                          <Plus size={16} color={COLORS.textSecondary} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "flex-end", gap: "16px", fontFamily: F.body, fontSize: "13px", paddingTop: "2px" }}>
                          <span style={{ color: COLORS.textSecondary }}>{t("Подитог", "Oraliq jami")}: <span style={{ fontFamily: F.display, color: COLORS.textPrimary }}>{editSubtotal.toLocaleString("ru")}</span></span>
                          <span style={{ color: COLORS.textSecondary }}>{t("Итого", "Jami")}: <span style={{ fontFamily: F.display, color: COLORS.textPrimary, fontWeight: 700 }}>{editTotal.toLocaleString("ru")} {currency}</span></span>
                        </div>
                      </div>
                    ) : (
                    <div style={{ borderRadius: "12px", overflow: "hidden", border: `1px solid ${COLORS.border}` }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr>
                            <th style={{ ...th, width: "28px" }}>№</th>
                            <th style={th}>{t("Товар", "Tovar")}</th>
                            <th style={thRight}>{t("Кол-во", "Miqdor")}</th>
                            <th style={thRight}>{t("Цена", "Narx")}</th>
                            <th style={thRight}>{t("Сумма", "Summa")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(order.items ?? []).map((item, i) => {
                            const unit = unitShort(item.unit);
                            const hasPartial = item.deliveredQuantity != null && Number(item.deliveredQuantity) < Number(item.quantity);
                            return (
                              <tr key={item.id}>
                                <td style={{ ...td, fontSize: "11px", color: COLORS.textTertiary }}>{i + 1}</td>
                                <td style={td}>
                                  <div style={{ fontWeight: 500 }}>{item.productName ?? "—"}</div>
                                  {item.productCode && <div style={{ fontFamily: F.display, fontSize: "10px", color: COLORS.textTertiary }}>{item.productCode}</div>}
                                  {hasPartial && (
                                    <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: COLORS.warning, marginTop: "2px" }}>
                                      <AlertTriangle size={10}/>
                                      {t("Частичная доставка", "Qisman yetkazib berish")}{item.returnReason ? ` — ${item.returnReason}` : ""}
                                    </div>
                                  )}
                                </td>
                                <td style={tdRight}>
                                  {hasPartial ? (
                                    <span>
                                      <span style={{ textDecoration: "line-through", color: COLORS.textTertiary }}>{Number(item.quantity).toFixed(0)}</span>
                                      <span style={{ marginLeft: "4px", color: COLORS.warning, fontWeight: 600 }}>{Number(item.deliveredQuantity).toFixed(0)}</span>
                                      <span style={{ fontSize: "11px", color: COLORS.textTertiary, marginLeft: "2px" }}>{unit}</span>
                                    </span>
                                  ) : (
                                    <span>{Number(item.quantity).toFixed(0)} <span style={{ fontSize: "11px", color: COLORS.textTertiary }}>{unit}</span></span>
                                  )}
                                </td>
                                <td style={{ ...tdRight, color: COLORS.textSecondary }}>{Number(item.unitPrice).toLocaleString("ru")}</td>
                                <td style={{ ...tdRight, fontWeight: 600 }}>{Number(item.subtotal).toLocaleString("ru")}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    )}
                  </div>

                  {/* ── Totals ── */}
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <div style={{ width: "230px", display: "flex", flexDirection: "column", gap: "6px", padding: "12px", borderRadius: "12px", background: COLORS.surfaceLight }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.body, fontSize: "13px" }}>
                        <span style={{ color: COLORS.textSecondary }}>{t("Подитог", "Oraliq jami")}</span>
                        <span style={{ fontFamily: F.display, color: COLORS.textPrimary }}>{Number(order.subtotal).toLocaleString("ru")} {currency}</span>
                      </div>
                      {Number(order.discount) > 0 && (
                        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.body, fontSize: "13px" }}>
                          <span style={{ color: COLORS.textSecondary }}>{t("Скидка", "Chegirma")}</span>
                          <span style={{ fontFamily: F.display, color: COLORS.success }}>−{Number(order.discount).toLocaleString("ru")} {currency}</span>
                        </div>
                      )}
                      <Separator />
                      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.body, fontSize: "14px", fontWeight: 700 }}>
                        <span style={{ color: COLORS.textPrimary }}>{t("Итого", "Jami")}</span>
                        <span style={{ fontFamily: F.display, color: COLORS.textPrimary }}>{Number(order.total).toLocaleString("ru")} {currency}</span>
                      </div>
                    </div>
                  </div>

                  {/* ── Debt block ── */}
                  {order.shop && Number((order.shop as unknown as { debt?: string }).debt ?? 0) > 0 && (
                    <DebtBlock debt={(order.shop as unknown as { debt?: string }).debt ?? "0"} orderTotal={order.total} currency={currency} />
                  )}
                  {isOperatorOrCeo && !order.deletedAt && (
                    <div>
                      <PillButton tone="neutral" onClick={() => { setDebtIdempotencyKey(crypto.randomUUID()); setShowDebtModal(true); }}>
                        <Plus size={14} />{t("Новый долг", "Yangi qarz")}
                      </PillButton>
                    </div>
                  )}

                  {/* ── Notes (editable for CEO/operator) ── */}
                  {(order.notes || editing) && (
                    <InfoCard label={t("ПРИМЕЧАНИЕ", "ESLATMA")} icon={null}>
                      {editing ? (
                        <Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} className="text-sm" rows={2} placeholder={t("Комментарий...", "Izoh...")} style={{ marginTop: "4px" }} />
                      ) : (
                        <p style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textSecondary }}>{order.notes || t("Нет примечания", "Izoh yo'q")}</p>
                      )}
                    </InfoCard>
                  )}

                  {/* ── Edit form for CEO/operator ── */}
                  {isOperatorOrCeo && editing && (
                    <div style={{ padding: "14px", borderRadius: "12px", border: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column", gap: "10px" }}>
                      <p style={{ fontFamily: F.body, fontSize: "11px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.textTertiary }}>
                        {t("РЕДАКТИРОВАНИЕ ЗАКАЗА", "BUYURTMANI TAHRIRLASH")}
                      </p>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div>
                          <label style={{ display: "block", fontFamily: F.body, fontSize: "11px", color: COLORS.textSecondary, marginBottom: "4px" }}>{t("Скидка (%)", "Chegirma (%)")}</label>
                          <Input type="text" inputMode="decimal" value={editDiscount} onChange={e => setEditDiscount(normalizeDecimalInput(e.target.value))} className="h-8 text-sm" />
                        </div>
                        <div>
                          <label style={{ display: "block", fontFamily: F.body, fontSize: "11px", color: COLORS.textSecondary, marginBottom: "4px" }}>{t("Метод оплаты", "To'lov usuli")}</label>
                          <Select value={editPaymentMethod} onValueChange={setEditPaymentMethod}>
                            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(PAYMENT).map(([key, pm]) => (
                                <SelectItem key={key} value={key} className="text-sm">{t(pm.ru, pm.uz)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Action buttons for CEO/operator ── */}
                  {isOperatorOrCeo && !order.deletedAt && (
                    <div style={{ display: "flex", gap: "8px" }}>
                      <PillButton tone={editing ? "success" : "neutral"} onClick={editing ? saveEditing : startEditing} disabled={editing && updateOrder.isPending}>
                        {editing ? <><Save size={14} />{t("Сохранить", "Saqlash")}</> : <><Edit3 size={14} />{t("Изменить заказ", "Buyurtmani tahrirlash")}</>}
                      </PillButton>
                      {editing && (
                        <PillButton tone="ghost" onClick={cancelEditing}>
                          {t("Отмена", "Bekor")}
                        </PillButton>
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="history" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full px-5 pb-5">
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", paddingTop: "8px" }}>
                  <HistoryRow dot={COLORS.primary} title={t("Заказ создан", "Buyurtma yaratildi")} time={new Date(order.createdAt).toLocaleString("ru")} />
                  {order.status !== "new" && (
                    <HistoryRow dot={COLORS.warning} title={t("В обработку", "Jarayonga")} time={new Date(order.updatedAt).toLocaleString("ru")} />
                  )}
                  {order.status === "delivered" && (
                    <HistoryRow dot={COLORS.success} title={t("Выполнен", "Bajarildi")} />
                  )}
                  {order.status === "cancelled" && (
                    <HistoryRow dot={COLORS.danger} title={t("Отменён", "Bekor qilingan")} />
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="documents" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full px-5 pb-5">
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: "8px" }}>
                  <p style={{ fontFamily: F.body, fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: COLORS.textTertiary }}>
                    {t("ДОКУМЕНТЫ ДЛЯ ПЕЧАТИ", "CHOP ETISH UCHUN HUJJATLAR")}
                  </p>
                  {[
                    { label: t("Расходная накладная (УЗ)", "Chiqim nakladnaya (O'Z)"), fn: () => { const d = buildDocData(); if (d) printUzWaybill(d); } },
                    { label: t("Счёт на оплату", "Hisob-faktura"),                    fn: () => { const d = buildDocData(); if (d) printInvoice(d); } },
                    { label: t("ТОРГ-12 (РФ)", "TORg-12 (RF)"),                       fn: () => { const d = buildDocData(); if (d) printTorg12(d); } },
                  ].map(item => (
                    <DocRow key={item.label} label={item.label} onClick={item.fn}
                      icon={<Printer size={14} color={COLORS.primary} />} iconBg={colorMix(COLORS.primary, 8)} />
                  ))}

                  <Separator />

                  <DocRow label={t("Экспорт в Excel", "Excelga eksport")} onClick={handleExport}
                    icon={<FileDown size={14} color={COLORS.success} />} iconBg={colorMix(COLORS.success, 8)} />

                  {/* Print history */}
                  <InfoCard label={t("СТАТУС ПЕЧАТИ", "CHOP ETISH HOLATI")} icon={null}>
                    <p style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textPrimary }}>
                      {order.invoicePrintedAt
                        ? `${t("Печаталась", "Chop etilgan")}: ${new Date(order.invoicePrintedAt).toLocaleString("ru")}`
                        : t("Не печаталась", "Chop etilmagan")}
                    </p>
                  </InfoCard>
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="adjustments" className="flex-1 overflow-hidden">
              <AdjustmentsTab orderId={orderId} currency={currency} />
            </TabsContent>

            <TabsContent value="payments" className="flex-1 overflow-hidden">
              <PaymentsTab orderId={orderId} currency={currency} orderTotal={order.total} orderStatus={order.status} />
            </TabsContent>
          </Tabs>
        )}

        {/* Comments at bottom */}
        {orderId && (
          <div style={{ borderTop: `1px solid ${COLORS.border}` }}>
            <OrderComments orderId={orderId} />
          </div>
        )}
      </SheetContent>
    </Sheet>

    {/* Completion Flow Modal — portals itself to document.body */}
    {order && (
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
          deliveredQuantity: i.deliveredQuantity != null ? Number(i.deliveredQuantity) : null,
          returnReason: i.returnReason,
        }))}
        currency={currency}
        saving={completionSaving}
        onSave={handleCompletionSave}
      />
    )}

    {/* New-debt modal — portal for the same z-index reason as the completion flow */}
    {order && showDebtModal && createPortal(
      <div
        // pointer-events-auto is required: Radix sets pointer-events:none on
        // <body> while the Sheet is open, which this portal would otherwise
        // inherit — leaving the dialog visible but unclickable.
        className="pointer-events-auto"
        style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--overlay-scrim)", padding: "16px" }}
        onClick={() => setShowDebtModal(false)}
        role="presentation"
      >
        <div
          className="pointer-events-auto"
          style={{ position: "relative", zIndex: 10, width: "100%", maxWidth: "384px", borderRadius: "16px", background: COLORS.surface, padding: "20px", boxShadow: "var(--shadow-overlay)" }}
          onClick={e => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={t("Новый долг", "Yangi qarz")}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <h3 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 700, color: COLORS.textPrimary }}>{t("Новый долг", "Yangi qarz")}</h3>
            <button
              onClick={() => setShowDebtModal(false)} aria-label={t("Закрыть", "Yopish")}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "28px", height: "28px", borderRadius: "8px", border: "none", background: "transparent", color: COLORS.textSecondary, cursor: "pointer" }}
            >
              <X size={16} />
            </button>
          </div>
          <p style={{ fontFamily: F.body, fontSize: "12px", color: COLORS.textSecondary, marginBottom: "12px" }}>
            {order.shopName ?? order.shop?.name ?? ""}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div>
              <label style={{ display: "block", fontFamily: F.body, fontSize: "11px", color: COLORS.textSecondary, marginBottom: "4px" }}>{t("Сумма", "Summa")}</label>
              <Input
                type="text" inputMode="decimal" value={debtAmount} autoFocus
                onChange={e => setDebtAmount(normalizeDecimalInput(e.target.value))}
                placeholder="0"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <label style={{ display: "block", fontFamily: F.body, fontSize: "11px", color: COLORS.textSecondary, marginBottom: "4px" }}>{t("Примечание", "Izoh")}</label>
              <Textarea
                value={debtNotes} rows={2}
                onChange={e => setDebtNotes(e.target.value)}
                placeholder={t("Необязательно...", "Ixtiyoriy...")}
                className="text-sm"
              />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px" }}>
            <PillButton tone="ghost" onClick={() => setShowDebtModal(false)}>
              {t("Отмена", "Bekor")}
            </PillButton>
            <PillButton tone="primary" onClick={submitDebt} disabled={addDebt.isPending}>
              {addDebt.isPending ? t("Сохранение...", "Saqlanmoqda...") : t("Добавить долг", "Qarz qo'shish")}
            </PillButton>
          </div>
        </div>
      </div>,
      document.body
    )}
    {dialog}
    </>
  );
}

function HistoryRow({ dot, title, time }: { dot: string; title: string; time?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
      <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: dot, marginTop: "6px", flexShrink: 0 }} />
      <div>
        <div style={{ fontFamily: F.body, fontSize: "13px", fontWeight: 500, color: COLORS.textPrimary }}>{title}</div>
        {time && <div style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.textTertiary }}>{time}</div>}
      </div>
    </div>
  );
}

function AdjustmentsTab({ orderId, currency }: { orderId: number; currency: string }) {
  const t = useTranslate();
  const { data: adjustments, isLoading } = trpc.order.getAdjustments.useQuery({ orderId });

  if (isLoading) return <div style={{ padding: "16px", fontFamily: F.body, fontSize: "13px", color: COLORS.textTertiary }}>{t("Загрузка...", "Yuklanmoqda...")}</div>;
  if (!adjustments || adjustments.length === 0) return <div style={{ padding: "16px", fontFamily: F.body, fontSize: "13px", color: COLORS.textTertiary }}>{t("Нет корректировок", "Tuzatmalar yo'q")}</div>;

  // Слово — из общего словаря, здесь только цвет.
  const TYPE_COLOR: Record<string, string> = {
    partial_delivery: COLORS.warning,
    partial_payment:  COLORS.primaryText,
    price_change:     "var(--color-info-text, var(--color-info))",
    quantity_change:  COLORS.success,
  };
  const typeLabels: Record<string, { ru: string; uz: string; color: string }> =
    Object.fromEntries(Object.entries(ADJUSTMENT_TYPE_LABEL).map(
      ([k, v]) => [k, { ...v, color: TYPE_COLOR[k] ?? COLORS.textTertiary }],
    ));

  return (
    <ScrollArea className="h-full px-5 pb-5">
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: "8px" }}>
        {adjustments.map(adj => {
          const label = typeLabels[adj.type] ?? { ru: adj.type, uz: adj.type, color: COLORS.textTertiary };
          const oldVal = adj.oldValue as Record<string, unknown>;
          const newVal = adj.newValue as Record<string, unknown>;
          return (
            <div key={adj.id} style={{ padding: "12px", borderRadius: "12px", border: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column", gap: "4px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontFamily: F.body, fontSize: "11px", fontWeight: 600, color: label.color }}>{t(label.ru, label.uz)}</span>
                <span style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.textTertiary }}>{new Date(adj.createdAt).toLocaleString("ru")}</span>
              </div>
              {adj.adjustedByName && <div style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.textTertiary }}>{adj.adjustedByName}</div>}
              {oldVal?.total !== undefined && newVal?.total !== undefined && (
                <div style={{ fontFamily: F.body, fontSize: "12px", color: COLORS.textSecondary }}>
                  {t("Сумма", "Summa")}: {Number(oldVal.total).toLocaleString("ru")} → {Number(newVal.total).toLocaleString("ru")} {currency}
                </div>
              )}
              {adj.reason && <div style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.textTertiary, fontStyle: "italic" }}>"{adj.reason}"</div>}
              {adj.photos && adj.photos.length > 0 && (
                <div style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.primaryText }}>{t("Фото", "Rasm")}: {adj.photos.length}</div>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function PaymentsTab({ orderId, currency, orderTotal, orderStatus }: { orderId: number; currency: string; orderTotal: string; orderStatus: string }) {
  const t = useTranslate();
  const { lang } = useLang();
  const { data: payments, isLoading } = trpc.order.getOrderPayments.useQuery({ orderId });

  const totalPaid = (payments ?? []).reduce((s, p) => s + Number(p.paidAmount ?? p.amount), 0);
  // Mirrors the server-side rule in recalcShopDebt: nothing is owed for goods
  // that never stayed with the shop. Without this check, a cancelled or
  // returned order with no payments read as "остаток долга: <full total>" —
  // the shop's real aggregate debt (shops.debt) already excludes these
  // orders correctly, but this tab computed its own number straight from
  // orderTotal and never looked at status, so it disagreed with the number
  // everywhere else in the app.
  const owesNothing = orderStatus === "cancelled" || orderStatus === "returned";
  const debt = owesNothing ? 0 : Number(orderTotal) - totalPaid;

  if (isLoading) return <div style={{ padding: "16px", fontFamily: F.body, fontSize: "13px", color: COLORS.textTertiary }}>{t("Загрузка...", "Yuklanmoqda...")}</div>;

  return (
    <ScrollArea className="h-full px-5 pb-5">
      <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: "8px" }}>
        {(!payments || payments.length === 0) ? (
          <div style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textTertiary }}>{t("Нет платежей", "To'lovlar yo'q")}</div>
        ) : (
          payments.map(p => (
            <div key={p.id} style={{ padding: "12px", borderRadius: "12px", border: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column", gap: "4px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontFamily: F.body, fontSize: "11px", fontWeight: 600, color: p.status === "partially_paid" ? COLORS.warning : COLORS.success }}>
                  {p.status === "partially_paid" ? t("Частичная оплата", "Qisman to'lov") : t("Оплата", "To'lov")}
                </span>
                <span style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.textTertiary }}>{new Date(p.createdAt).toLocaleString("ru")}</span>
              </div>
              <div style={{ fontFamily: F.body, fontSize: "13px", color: COLORS.textPrimary }}>
                {t("Получено", "Olingan")}: <b>{Number(p.paidAmount ?? p.amount).toLocaleString("ru")} {currency}</b>
                {p.paymentMethod && <span style={{ fontSize: "11px", color: COLORS.textTertiary, marginLeft: "6px" }}>({labelled(PAYMENT_METHOD_LABEL, p.paymentMethod, lang)})</span>}
              </div>
              {/* debtAmount is what was still outstanding at the moment this
                  payment was taken — a historical figure, not a live one. Once
                  the order is cancelled or returned that balance was settled by
                  the goods going back, not by money, so rendering it in red
                  here says the shop owes something it doesn't. */}
              {!owesNothing && Number(p.debtAmount ?? 0) > 0 && (
                <div style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.danger }}>
                  {t("Долг", "Qarz")}: {Number(p.debtAmount).toLocaleString("ru")} {currency}
                  {p.debtDueDate && <span style={{ color: COLORS.textTertiary, marginLeft: "4px" }}>до {new Date(p.debtDueDate).toLocaleDateString("ru")}</span>}
                </div>
              )}
              {p.notes && <div style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.textTertiary, fontStyle: "italic" }}>"{p.notes}"</div>}
              {p.createdByName && <div style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.textTertiary }}>{p.createdByName}</div>}
            </div>
          ))
        )}

        {/* Summary */}
        <div style={{ padding: "12px", borderRadius: "12px", background: COLORS.surfaceLight, display: "flex", flexDirection: "column", gap: "4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.body, fontSize: "13px" }}>
            <span style={{ color: COLORS.textSecondary }}>{t("Заказ на", "Buyurtma")}</span>
            <span style={{ fontFamily: F.display, color: COLORS.textPrimary }}>{Number(orderTotal).toLocaleString("ru")} {currency}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.body, fontSize: "13px" }}>
            <span style={{ color: COLORS.textSecondary }}>{t("Оплачено", "To'langan")}</span>
            <span style={{ fontFamily: F.display, color: COLORS.success }}>{totalPaid.toLocaleString("ru")} {currency} ({Math.round(totalPaid / Number(orderTotal) * 100)}%)</span>
          </div>
          {debt > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.body, fontSize: "13px", fontWeight: 700, borderTop: `1px solid ${COLORS.border}`, paddingTop: "6px", marginTop: "2px" }}>
              <span style={{ color: COLORS.danger }}>{t("ОСТАТОК ДОЛГА", "QARZ QOLDIG'I")}</span>
              <span style={{ fontFamily: F.display, color: COLORS.danger }}>{debt.toLocaleString("ru")} {currency}</span>
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
