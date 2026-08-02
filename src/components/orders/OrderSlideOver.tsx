import { useState } from "react";
import { createPortal } from "react-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Store, User, Truck, CreditCard, MapPin, Phone, Printer, Edit3, Save, X,
  AlertTriangle, Package, ChevronDown, FileDown,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useTranslate, useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
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
import type { CompletionData, CompletionMode } from "./CompletionFlowModal";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number | null;
  currency?: string;
}

const STATUS_LABELS: Record<string, { ru: string; uz: string }> = {
  new:                  { ru: "Новый",              uz: "Yangi" },
  processing:           { ru: "В обработке",        uz: "Jarayonda" },
  shipped:              { ru: "Отгружён",           uz: "Yuklandi" },
  pending:              { ru: "В ожидании",         uz: "Kutishda" },
  delivered:            { ru: "Доставлен",          uz: "Yetkazildi" },
  cancelled:            { ru: "Отменён",            uz: "Bekor qilindi" },
  returned:             { ru: "Возврат",            uz: "Qaytarildi" },
  partially_returned:   { ru: "Возврат частично",  uz: "Qisman qaytarildi" },
  partial_return_kept:  { ru: "Возврат (магазин)",  uz: "Qaytarish (do'kon qoldi)" },
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  processing: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  shipped: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  pending: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  delivered: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  returned: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  partially_returned: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  partial_return_kept: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
};

const PAYMENT_METHODS: Record<string, { ru: string; uz: string; color: string }> = {
  cash:     { ru: "Наличные",     uz: "Naqd",      color: "#34c473" },
  transfer: { ru: "Перечисление", uz: "O'tkazma",  color: "#5b6d8a" },
  debt:     { ru: "Долг",         uz: "Qarz",      color: "#d4973a" },
  card:     { ru: "Карта",        uz: "Plastik",   color: "#9b59b6" },
};

const UNIT_LABELS_MAP: Record<string, string> = {
  kg: "кг", l: "л", pcs: "шт", box: "блок", pack: "упак", m: "м", block: "блок",
};

function DebtBlock({ debt, orderTotal, currency }: { debt: string; orderTotal: string; currency: string }) {
  const t = useTranslate();
  const debtAmount = Number(debt);
  const totalAmount = Number(orderTotal);

  let color = "text-green-600";
  let label = t("Оплачено полностью", "To'liq to'langan");
  let bgClass = "bg-green-50 border-green-200 dark:bg-green-900/10 dark:border-green-800";

  if (debtAmount > 1_000_000) {
    color = "text-red-600";
    label = t("КРИТИЧЕСКИЙ ДОЛГ!", "KRITIK QARZ!");
    bgClass = "bg-red-50 border-red-200 dark:bg-red-900/10 dark:border-red-800";
  } else if (debtAmount > 500_000) {
    color = "text-red-500";
    label = t("Крупная задолженность", "Katta qarz");
    bgClass = "bg-red-50 border-red-200 dark:bg-red-900/10 dark:border-red-800";
  } else if (debtAmount > 0) {
    color = "text-amber-600";
    label = t("Небольшая задолженность", "Kichik qarz");
    bgClass = "bg-amber-50 border-amber-200 dark:bg-amber-900/10 dark:border-amber-800";
  }

  return (
    <div className={`p-3 rounded-lg border ${bgClass}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-label text-muted-foreground">{t("Задолженность магазина", "Do'kon qarzi")}</span>
        {debtAmount > 500_000 && <AlertTriangle className={`h-4 w-4 ${color}`} />}
      </div>
      <div className={`text-xl font-data font-bold ${color}`}>
        {debtAmount.toLocaleString("ru")} {currency}
      </div>
      <div className={`text-xs ${color} font-medium mt-0.5`}>{label}</div>
      {debtAmount > 0 && totalAmount > 0 && (
        <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
          <div>{t("По текущему заказу", "Joriy buyurtma bo'yicha")}: <b>{totalAmount.toLocaleString("ru")} {currency}</b></div>
          <div>{t("Рекомендуемая оплата", "Tavsiya etilgan to'lov")}: <b className={color}>{(debtAmount + totalAmount).toLocaleString("ru")} {currency}</b></div>
        </div>
      )}
    </div>
  );
}

export function OrderSlideOver({ open, onOpenChange, orderId, currency = "сум" }: Props) {
  const t = useTranslate();
  const { user } = useAuth();
  const { confirm, dialog } = useConfirm();
  const utils = trpc.useUtils();
  const { lang } = useLang();
  const { symbol } = useCurrency();
  const isOperatorOrCeo = user?.role === "ceo" || user?.role === "operator";

  const { data: order, isLoading } = trpc.order.getById.useQuery(
    { id: orderId! },
    { enabled: !!orderId && open },
  );

  const { data: settings } = trpc.settings.get.useQuery();

  // ── Edit state ─────────────────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [editNotes, setEditNotes] = useState("");
  const [editDiscount, setEditDiscount] = useState("0");
  const [editPaymentMethod, setEditPaymentMethod] = useState<string>("cash");

  // ── Completion flow (shared hook) ──────────────────────────────────────
  const [showCompletion, setShowCompletion] = useState(false);
  const [completionMode, setCompletionMode] = useState<CompletionMode>("partial_return");
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);

  const { saving: completionSaving, handleCompletionSave: baseHandleCompletionSave, directStatusChange, getCompletionMode } = useCompletionFlow({
    orderId: orderId ?? 0,
    onSuccess: () => {
      utils.order.getById.invalidate({ id: orderId! });
      utils.order.getOrderPayments.invalidate({ orderId: orderId! });
      utils.order.getAdjustments.invalidate({ orderId: orderId! });
    },
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
    return {
      number:   order.orderNumber,
      date:     order.createdAt ? format(new Date(order.createdAt), "dd.MM.yyyy", { locale: dateRu }) : "",
      seller,
      buyer,
      items:    (order.items ?? []).map((i) => ({
        name:  i.productName ?? "",
        code:  i.productCode ?? "",
        unit:  UNIT_LABELS_MAP[i.unit ?? "pcs"] ?? "шт",
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
      paymentMethodLabel: PAYMENT_METHODS[order.paymentMethod ?? "cash"]?.ru,
      shopOwner:  order.shop?.ownerName ?? undefined,
      shopPhone:  ((order.shop as Record<string, unknown>)?.phone as string) ?? undefined,
      territoryName: (order.shop as Record<string, unknown>)?.territoryName as string ?? undefined,
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
      utils.order.getById.invalidate({ id: orderId! });
      setEditing(false);
      notify.success(t("Заказ обновлён", "Buyurtma yangilandi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const assignCourier = trpc.courier.assignCourier.useMutation({
    onSuccess: () => {
      utils.order.getById.invalidate({ id: orderId! });
      notify.success(t("Курьер назначен", "Kuryer tayinlandi"));
    },
    onError: (e) => notify.error(e.message),
  });

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
    const label = STATUS_LABELS[newStatus]?.ru ?? newStatus;
    const ok = await confirm({
      title: t("Изменить статус?", "Holatni o'zgartirish?"),
      message: `${STATUS_LABELS[order.status]?.ru ?? order.status} → ${label}`,
      confirmText: t("Изменить", "O'zgartirish"),
    });
    if (ok) directStatusChange(newStatus);
  }

  // ── Edit handlers ──────────────────────────────────────────────────────
  function startEditing() {
    if (!order) return;
    setEditNotes(order.notes ?? "");
    setEditDiscount(String(Number(order.discount ?? 0)));
    setEditPaymentMethod(order.paymentMethod ?? "cash");
    setEditing(true);
  }

  function saveEditing() {
    if (!order) return;
    updateOrder.mutate({
      id: order.id,
      notes: editNotes || undefined,
      discount: editDiscount !== "0" ? editDiscount : undefined,
    });
  }

  if (!orderId) return null;

  return (
    <>
    <Sheet open={open} onOpenChange={(v) => { if (!showCompletion) onOpenChange(v); }}>
      <SheetContent className="w-[600px] sm:max-w-[600px] p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3">
          <SheetTitle className="flex items-center gap-2">
            {isLoading ? t("Загрузка...", "Yuklanmoqda...") : (
              <>
                <span className="font-display">{order?.orderNumber}</span>
                {/* Status dropdown for CEO/operator, badge for others */}
                {isOperatorOrCeo && order && !order.deletedAt ? (
                  <Select value={order.status} onValueChange={handleStatusChange}>
                    <SelectTrigger className="h-7 text-xs rounded-full w-auto px-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([key, labels]) => (
                        <SelectItem key={key} value={key} className="text-xs">
                          {labels.ru}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge className={STATUS_COLORS[order?.status ?? "new"]}>
                    {order?.status}
                  </Badge>
                )}
                <span className="ml-auto font-data text-lg">{Number(order?.total ?? 0).toLocaleString("ru")} {currency}</span>
              </>
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
                <div className="space-y-5 pt-1">

                  {/* ── Total + Payment badge ── */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-baseline gap-2">
                      <span className="font-display text-3xl font-bold text-primary">{Number(order.total).toLocaleString("ru")}</span>
                      <span className="text-lg text-secondary">{currency}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const pm = PAYMENT_METHODS[order.paymentMethod ?? "cash"];
                        if (!pm) return null;
                        return (
                          <span style={{
                            display: "inline-flex", padding: "4px 12px", borderRadius: "9999px",
                            fontSize: "11px", fontWeight: 600,
                            background: `${pm.color}15`, color: pm.color, border: `1px solid ${pm.color}30`,
                          }}>
                            {t(pm.ru, pm.uz)}
                          </span>
                        );
                      })()}
                    </div>
                  </div>

                  <Separator />

                  {/* ── Meta Grid ── */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Shop */}
                    <div className="p-3 rounded-lg bg-muted/20">
                      <p className="font-label text-secondary text-[10px] tracking-wider mb-1 flex items-center gap-1">
                        <Store size={12}/> {t("ПОКУПАТЕЛЬ", "XARIDOR")}
                      </p>
                      <p className="text-sm font-medium text-primary">{order.shopName ?? "—"}</p>
                      {order.shop?.phone && (
                        <p className="text-xs text-secondary flex items-center gap-1 mt-0.5">
                          <Phone size={10}/> {order.shop.phone}
                        </p>
                      )}
                      {order.shop?.address && (
                        <p className="text-xs text-secondary flex items-center gap-1 mt-0.5">
                          <MapPin size={10}/> {order.shop.address}{order.shop.city ? `, ${order.shop.city}` : ""}
                        </p>
                      )}
                    </div>

                    {/* Agent */}
                    <div className="p-3 rounded-lg bg-muted/20">
                      <p className="font-label text-secondary text-[10px] tracking-wider mb-1 flex items-center gap-1">
                        <User size={12}/> {t("АГЕНТ", "AGENT")}
                      </p>
                      <p className="text-sm text-primary">{order.agent?.name ?? "—"}</p>
                    </div>
                  </div>

                  {/* ── Courier assignment for CEO/operator ── */}
                  {isOperatorOrCeo && (order.status === "new" || order.status === "processing") && (
                    <div className="p-3 rounded-lg bg-muted/20">
                      <p className="font-label text-secondary text-[10px] tracking-wider mb-2 flex items-center gap-1">
                        <Truck size={12}/> {t("КУРЬЕР", "KURYER")}
                      </p>
                      <Select
                        value={order.courierId ? String(order.courierId) : ""}
                        onValueChange={(val) => {
                          const courierId = Number(val);
                          if (courierId) assignCourier.mutate({ orderId: order.id, courierId });
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder={t("Выберите курьера", "Kuryer tanlang")} />
                        </SelectTrigger>
                        <SelectContent>
                          {(couriers?.data ?? []).map((c) => (
                            <SelectItem key={c.id} value={String(c.id)} className="text-xs">{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* ── Items Table ── */}
                  <div>
                    <h4 className="font-label text-secondary text-xs tracking-wider mb-2 flex items-center gap-1">
                      <Package size={12}/> {t("ТОВАРЫ", "MAHSULOTLAR")} ({(order.items ?? []).length})
                    </h4>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-surface-light">
                            <th className="text-left px-3 py-2 text-secondary text-[11px] font-medium">№</th>
                            <th className="text-left px-3 py-2 text-secondary text-[11px] font-medium">{t("Товар", "Tovar")}</th>
                            <th className="text-right px-3 py-2 text-secondary text-[11px] font-medium">{t("Кол-во", "Miqdor")}</th>
                            <th className="text-right px-3 py-2 text-secondary text-[11px] font-medium">{t("Цена", "Narx")}</th>
                            <th className="text-right px-3 py-2 text-secondary text-[11px] font-medium">{t("Сумма", "Summa")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(order.items ?? []).map((item, i) => {
                            const unitMap: Record<string, string> = { kg: "кг", l: "л", pcs: "шт", box: "блок", pack: "упак", m: "м", block: "блок" };
                            const unit = unitMap[item.unit ?? "pcs"] ?? "шт";
                            const hasPartial = item.deliveredQuantity != null && Number(item.deliveredQuantity) < Number(item.quantity);
                            return (
                              <tr key={item.id} className="border-t border-border-subtle">
                                <td className="px-3 py-2 text-xs text-secondary">{i + 1}</td>
                                <td className="px-3 py-2">
                                  <div className="text-sm font-medium text-primary">{item.productName ?? "—"}</div>
                                  {item.productCode && <div className="text-[11px] text-secondary font-data">{item.productCode}</div>}
                                  {hasPartial && (
                                    <div className="text-xs text-amber-600 mt-0.5 flex items-center gap-1">
                                      <AlertTriangle size={10}/>
                                      {t("Частичная доставка", "Qisman yetkazib berish")}{item.returnReason ? ` — ${item.returnReason}` : ""}
                                    </div>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right font-data text-sm">
                                  {hasPartial ? (
                                    <span>
                                      <span className="line-through text-muted-foreground">{Number(item.quantity).toFixed(0)}</span>
                                      <span className="ml-1 text-amber-600 font-medium">{Number(item.deliveredQuantity).toFixed(0)}</span>
                                      <span className="text-xs text-muted-foreground ml-0.5">{unit}</span>
                                    </span>
                                  ) : (
                                    <span>{Number(item.quantity).toFixed(0)} <span className="text-xs text-muted-foreground">{unit}</span></span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right font-data text-sm text-secondary">{Number(item.unitPrice).toLocaleString("ru")}</td>
                                <td className="px-3 py-2 text-right font-data text-sm font-medium">{Number(item.subtotal).toLocaleString("ru")}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* ── Totals ── */}
                  <div className="flex justify-end">
                    <div className="w-56 space-y-1.5 p-3 rounded-lg bg-muted/20">
                      <div className="flex justify-between text-sm">
                        <span className="text-secondary">{t("Подитог", "Oraliq jami")}</span>
                        <span className="font-data">{Number(order.subtotal).toLocaleString("ru")} {currency}</span>
                      </div>
                      {Number(order.discount) > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-secondary">{t("Скидка", "Chegirma")}</span>
                          <span className="font-data text-success">−{Number(order.discount).toLocaleString("ru")} {currency}</span>
                        </div>
                      )}
                      <Separator />
                      <div className="flex justify-between font-bold text-base">
                        <span>{t("Итого", "Jami")}</span>
                        <span className="font-data text-primary">{Number(order.total).toLocaleString("ru")} {currency}</span>
                      </div>
                    </div>
                  </div>

                  {/* ── Debt block ── */}
                  {order.shop && Number((order.shop as unknown as { debt?: string }).debt ?? 0) > 0 && (
                    <DebtBlock debt={(order.shop as unknown as { debt?: string }).debt ?? "0"} orderTotal={order.total} currency={currency} />
                  )}

                  {/* ── Notes (editable for CEO/operator) ── */}
                  {(order.notes || editing) && (
                    <div className="p-3 rounded-lg bg-muted/20">
                      <p className="font-label text-secondary text-[10px] tracking-wider mb-1">{t("ПРИМЕЧАНИЕ", "ESLATMA")}</p>
                      {editing ? (
                        <Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} className="text-sm" rows={2} placeholder={t("Комментарий...", "Izoh...")} />
                      ) : (
                        <p className="text-sm text-secondary">{order.notes || t("Нет примечания", "Izoh yo'q")}</p>
                      )}
                    </div>
                  )}

                  {/* ── Edit form for CEO/operator ── */}
                  {isOperatorOrCeo && editing && (
                    <div className="neo-card p-4 space-y-3">
                      <p className="font-label text-secondary text-xs tracking-wider">{t("РЕДАКТИРОВАНИЕ ЗАКАЗА", "BUYURTMANI TAHRIRLASH")}</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-secondary mb-1 block">{t("Скидка (%)", "Chegirma (%)")}</label>
                          <Input type="number" min="0" max="100" value={editDiscount} onChange={e => setEditDiscount(e.target.value)} className="h-8 text-sm" />
                        </div>
                        <div>
                          <label className="text-xs text-secondary mb-1 block">{t("Метод оплаты", "To'lov usuli")}</label>
                          <Select value={editPaymentMethod} onValueChange={setEditPaymentMethod}>
                            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {Object.entries(PAYMENT_METHODS).map(([key, pm]) => (
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
                    <div className="flex gap-2">
                      <Button
                        variant={editing ? "default" : "outline"}
                        size="sm"
                        onClick={editing ? saveEditing : startEditing}
                        style={editing ? { background: "linear-gradient(135deg, #34c473, #28a862)" } : undefined}
                      >
                        {editing ? <><Save className="h-3.5 w-3.5 mr-1.5" />{t("Сохранить", "Saqlash")}</> : <><Edit3 className="h-3.5 w-3.5 mr-1.5" />{t("Изменить заказ", "Buyurtmani tahrirlash")}</>}
                      </Button>
                      {editing && (
                        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                          {t("Отмена", "Bekor")}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="history" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full px-5 pb-5">
                <div className="space-y-3 pt-2">
                  <div className="flex items-start gap-3">
                    <div className="w-2 h-2 rounded-full bg-blue-500 mt-2" />
                    <div>
                      <div className="text-sm font-medium">{t("Заказ создан", "Buyurtma yaratildi")}</div>
                      <div className="text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleString("ru")}</div>
                    </div>
                  </div>
                  {order.status !== "new" && (
                    <div className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-amber-500 mt-2" />
                      <div>
                        <div className="text-sm font-medium">{t("В обработку", "Jarayonga")}</div>
                        <div className="text-xs text-muted-foreground">{new Date(order.updatedAt).toLocaleString("ru")}</div>
                      </div>
                    </div>
                  )}
                  {order.status === "delivered" && (
                    <div className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-green-500 mt-2" />
                      <div><div className="text-sm font-medium">{t("Выполнен", "Bajarildi")}</div></div>
                    </div>
                  )}
                  {order.status === "cancelled" && (
                    <div className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-red-500 mt-2" />
                      <div><div className="text-sm font-medium">{t("Отменён", "Bekor qilingan")}</div></div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="documents" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full px-5 pb-5">
                <div className="space-y-3 pt-2">
                  {/* Print documents */}
                  <p className="font-label text-secondary text-[10px] tracking-wider">{t("ДОКУМЕНТЫ ДЛЯ ПЕЧАТИ", "CHOP ETISH UCHUN HUJJATLAR")}</p>
                  {[
                    { label: t("Расходная накладная (УЗ)", "Chiqim nakladnaya (O'Z)"), fn: () => { const d = buildDocData(); if (d) printUzWaybill(d); } },
                    { label: t("Счёт на оплату", "Hisob-faktura"),                    fn: () => { const d = buildDocData(); if (d) printInvoice(d); } },
                    { label: t("ТОРГ-12 (РФ)", "TORg-12 (RF)"),                       fn: () => { const d = buildDocData(); if (d) printTorg12(d); } },
                  ].map(item => (
                    <button
                      key={item.label}
                      onClick={item.fn}
                      className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Printer size={14} className="text-primary" />
                        </div>
                        <span className="text-sm font-medium">{item.label}</span>
                      </div>
                      <ChevronDown size={14} className="text-muted-foreground rotate-[-90deg]" />
                    </button>
                  ))}

                  <Separator />

                  {/* Excel export */}
                  <button
                    onClick={handleExport}
                    className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
                        <FileDown size={14} className="text-success" />
                      </div>
                      <span className="text-sm font-medium">{t("Экспорт в Excel", "Excelga eksport")}</span>
                    </div>
                    <ChevronDown size={14} className="text-muted-foreground rotate-[-90deg]" />
                  </button>

                  {/* Print history */}
                  <div className="p-3 rounded-lg bg-muted/20">
                    <p className="font-label text-secondary text-[10px] tracking-wider mb-1">{t("СТАТУС ПЕЧАТИ", "CHOP ETISH HOLATI")}</p>
                    <p className="text-sm text-primary">
                      {order.invoicePrintedAt
                        ? `${t("Печаталась", "Chop etilgan")}: ${new Date(order.invoicePrintedAt).toLocaleString("ru")}`
                        : t("Не печаталась", "Chop etilmagan")}
                    </p>
                  </div>
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="adjustments" className="flex-1 overflow-hidden">
              <AdjustmentsTab orderId={orderId} currency={currency} />
            </TabsContent>

            <TabsContent value="payments" className="flex-1 overflow-hidden">
              <PaymentsTab orderId={orderId} currency={currency} orderTotal={order.total} />
            </TabsContent>
          </Tabs>
        )}

        {/* Comments at bottom */}
        {orderId && (
          <div className="border-t">
            <OrderComments orderId={orderId} />
          </div>
        )}
      </SheetContent>
    </Sheet>

    {/* Completion Flow Modal — rendered via portal to escape Sheet's z-index */}
    {order && createPortal(
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
        currency={currency}
        saving={completionSaving}
        onSave={handleCompletionSave}
      />,
      document.body
    )}
    {dialog}
    </>
  );
}

function AdjustmentsTab({ orderId, currency }: { orderId: number; currency: string }) {
  const t = useTranslate();
  const { data: adjustments, isLoading } = trpc.order.getAdjustments.useQuery({ orderId });

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">{t("Загрузка...", "Yuklanmoqda...")}</div>;
  if (!adjustments || adjustments.length === 0) return <div className="p-4 text-sm text-muted-foreground">{t("Нет корректировок", "Tuzatmalar yo'q")}</div>;

  const typeLabels: Record<string, { ru: string; uz: string; color: string }> = {
    partial_delivery: { ru: "Частичная доставка", uz: "Qisman yetkazib berish", color: "text-amber-600" },
    partial_payment: { ru: "Частичная оплата", uz: "Qisman to'lov", color: "text-blue-600" },
    price_change: { ru: "Изменение цены", uz: "Narx o'zgarishi", color: "text-purple-600" },
    quantity_change: { ru: "Изменение количества", uz: "Miqdor o'zgarishi", color: "text-green-600" },
  };

  return (
    <ScrollArea className="h-full px-5 pb-5">
      <div className="space-y-3 pt-2">
        {adjustments.map(adj => {
          const label = typeLabels[adj.type] ?? { ru: adj.type, uz: adj.type, color: "text-muted-foreground" };
          const oldVal = adj.oldValue as Record<string, unknown>;
          const newVal = adj.newValue as Record<string, unknown>;
          return (
            <div key={adj.id} className="p-3 rounded-lg border space-y-1">
              <div className="flex items-center justify-between">
                <span className={`text-xs font-medium ${label.color}`}>{t(label.ru, label.uz)}</span>
                <span className="text-xs text-muted-foreground">{new Date(adj.createdAt).toLocaleString("ru")}</span>
              </div>
              {adj.adjustedByName && <div className="text-xs text-muted-foreground">{adj.adjustedByName}</div>}
              <div className="text-xs">
                {oldVal?.total !== undefined && newVal?.total !== undefined && (
                  <span>{t("Сумма", "Summa")}: {Number(oldVal.total).toLocaleString("ru")} → {Number(newVal.total).toLocaleString("ru")} {currency}</span>
                )}
              </div>
              {adj.reason && <div className="text-xs text-muted-foreground italic">"{adj.reason}"</div>}
              {adj.photos && adj.photos.length > 0 && (
                <div className="text-xs text-blue-600">{t("Фото", "Rasm")}: {adj.photos.length}</div>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

function PaymentsTab({ orderId, currency, orderTotal }: { orderId: number; currency: string; orderTotal: string }) {
  const t = useTranslate();
  const { data: payments, isLoading } = trpc.order.getOrderPayments.useQuery({ orderId });

  const totalPaid = (payments ?? []).reduce((s, p) => s + Number(p.paidAmount ?? p.amount), 0);
  const debt = Number(orderTotal) - totalPaid;

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">{t("Загрузка...", "Yuklanmoqda...")}</div>;

  return (
    <ScrollArea className="h-full px-5 pb-5">
      <div className="space-y-3 pt-2">
        {(!payments || payments.length === 0) ? (
          <div className="text-sm text-muted-foreground">{t("Нет платежей", "To'lovlar yo'q")}</div>
        ) : (
          payments.map(p => (
            <div key={p.id} className="p-3 rounded-lg border space-y-1">
              <div className="flex items-center justify-between">
                <span className={`text-xs font-medium ${p.status === "partially_paid" ? "text-amber-600" : "text-green-600"}`}>
                  {p.status === "partially_paid" ? t("Частичная оплата", "Qisman to'lov") : t("Оплата", "To'lov")}
                </span>
                <span className="text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleString("ru")}</span>
              </div>
              <div className="text-sm">
                {t("Получено", "Olingan")}: <b>{Number(p.paidAmount ?? p.amount).toLocaleString("ru")} {currency}</b>
                {p.paymentMethod && <span className="text-xs text-muted-foreground ml-2">({p.paymentMethod})</span>}
              </div>
              {Number(p.debtAmount ?? 0) > 0 && (
                <div className="text-xs text-red-600">
                  {t("Долг", "Qarz")}: {Number(p.debtAmount).toLocaleString("ru")} {currency}
                  {p.debtDueDate && <span className="text-muted-foreground ml-1">до {new Date(p.debtDueDate).toLocaleDateString("ru")}</span>}
                </div>
              )}
              {p.notes && <div className="text-xs text-muted-foreground italic">"{p.notes}"</div>}
              {p.createdByName && <div className="text-xs text-muted-foreground">{p.createdByName}</div>}
            </div>
          ))
        )}

        {/* Summary */}
        <div className="p-3 rounded-lg bg-muted/30 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("Заказ на", "Buyurtma")}</span>
            <span className="font-data">{Number(orderTotal).toLocaleString("ru")} {currency}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("Оплачено", "To'langan")}</span>
            <span className="font-data text-green-600">{totalPaid.toLocaleString("ru")} {currency} ({Math.round(totalPaid / Number(orderTotal) * 100)}%)</span>
          </div>
          {debt > 0 && (
            <div className="flex justify-between text-sm font-bold border-t pt-1 mt-1">
              <span className="text-red-600">{t("ОСТАТОК ДОЛГА", "QARZ QOLDIG'I")}</span>
              <span className="text-red-600 font-data">{debt.toLocaleString("ru")} {currency}</span>
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
