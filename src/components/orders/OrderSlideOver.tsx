import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Store, User, Truck, CreditCard, MapPin, Phone, Printer, Edit, X, AlertTriangle } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useTranslate } from "@/i18n";
import { OrderComments } from "./OrderComments";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number | null;
  currency?: string;
}

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
  const { data: order, isLoading } = trpc.order.getById.useQuery(
    { id: orderId! },
    { enabled: !!orderId && open },
  );

  if (!orderId) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[600px] sm:max-w-[600px] p-0 flex flex-col">
        <SheetHeader className="px-5 pt-5 pb-3">
          <SheetTitle className="flex items-center gap-2">
            {isLoading ? t("Загрузка...", "Yuklanmoqda...") : (
              <>
                <span className="font-display">{order?.orderNumber}</span>
                <Badge className={STATUS_COLORS[order?.status ?? "new"]}>
                  {order?.status}
                </Badge>
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
                <div className="space-y-4">
                  {/* Shop */}
                  {order.shop && (
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                      <Store className="h-5 w-5 text-muted-foreground mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{order.shopName}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          {order.shop.address && <><MapPin className="h-3 w-3" />{order.shop.address}</>}
                          {order.shop.city && `, ${order.shop.city}`}
                        </div>
                        {order.shop.phone && (
                          <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Phone className="h-3 w-3" />{order.shop.phone}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Agent */}
                  {order.agent && (
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                      <User className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <div className="font-medium">{order.agent.name}</div>
                        <div className="text-xs text-muted-foreground">{t("Агент", "Agent")}</div>
                      </div>
                    </div>
                  )}

                  {/* Items */}
                  <div>
                    <h4 className="font-label text-xs mb-2">{t("Товары", "Tovarlar")} ({order.items.length})</h4>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="p-2 text-left font-label">{t("Товар", "Tovar")}</th>
                            <th className="p-2 text-right font-label">{t("Кол-во", "Miqdor")}</th>
                            <th className="p-2 text-right font-label">{t("Цена", "Narx")}</th>
                            <th className="p-2 text-right font-label">{t("Сумма", "Summa")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.items.map((item) => {
                            const unitMap: Record<string, string> = { kg: "кг", l: "л", pcs: "шт", box: "блок", pack: "упак", m: "м", block: "блок" };
                            const unit = unitMap[item.unit ?? "pcs"] ?? "шт";
                            const hasPartial = item.deliveredQuantity != null && Number(item.deliveredQuantity) < Number(item.quantity);
                            return (
                              <tr key={item.id} className="border-t">
                                <td className="p-2">
                                  <div className="font-medium">{item.productName}</div>
                                  {item.productCode && <div className="text-muted-foreground">{item.productCode}</div>}
                                  {hasPartial && <div className="text-xs text-amber-600">{t("Частичная доставка", "Qisman yetkazib berish")}{item.returnReason ? ` — ${item.returnReason}` : ""}</div>}
                                </td>
                                <td className="p-2 text-right font-data">
                                  {hasPartial ? (
                                    <>
                                      <span className="line-through text-muted-foreground">{Number(item.quantity).toFixed(2)}</span>
                                      <span className="ml-1 text-amber-600 font-medium">{Number(item.deliveredQuantity).toFixed(2)}</span>
                                      <span className="text-xs text-muted-foreground ml-0.5">{unit}</span>
                                    </>
                                  ) : (
                                    <>{Number(item.quantity).toFixed(2)} <span className="text-xs text-muted-foreground">{unit}</span></>
                                  )}
                                </td>
                                <td className="p-2 text-right font-data">{Number(item.unitPrice).toLocaleString("ru")}</td>
                                <td className="p-2 text-right font-data font-medium">{Number(item.subtotal).toLocaleString("ru")}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Totals */}
                  <div className="flex justify-end">
                    <div className="w-48 space-y-1 text-xs">
                      <div className="flex justify-between"><span className="text-muted-foreground">{t("Подитог", "Oraliq jami")}:</span><span className="font-data">{Number(order.subtotal).toLocaleString("ru")} {currency}</span></div>
                      {Number(order.discount) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">{t("Скидка", "Chegirma")}:</span><span className="font-data text-green-600">−{Number(order.discount).toLocaleString("ru")} {currency}</span></div>}
                      <Separator />
                      <div className="flex justify-between font-bold"><span>{t("Итого", "Jami")}:</span><span className="font-data text-sm">{Number(order.total).toLocaleString("ru")} {currency}</span></div>
                    </div>
                  </div>

                  {/* Debt block */}
                  {order.shop && (
                    <DebtBlock debt={(order.shop as unknown as { debt?: string }).debt ?? "0"} orderTotal={order.total} currency={currency} />
                  )}

                  {/* Payment */}
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                    <CreditCard className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="font-medium capitalize">{order.paymentMethod}</div>
                      <div className="text-xs text-muted-foreground">{t("Метод оплаты", "To'lov usuli")}</div>
                    </div>
                  </div>
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
                      <div>
                        <div className="text-sm font-medium">{t("Выполнен", "Bajarildi")}</div>
                      </div>
                    </div>
                  )}
                  {order.status === "cancelled" && (
                    <div className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-red-500 mt-2" />
                      <div>
                        <div className="text-sm font-medium">{t("Отменён", "Bekor qilingan")}</div>
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="documents" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full px-5 pb-5">
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div>
                      <div className="text-sm font-medium">{t("Накладная", "Naklad")}</div>
                      <div className="text-xs text-muted-foreground">
                        {order.invoicePrintedAt
                          ? `${t("Печаталась", "Chop etilgan")}: ${new Date(order.invoicePrintedAt).toLocaleString("ru")}`
                          : t("Не печаталась", "Chop etilmagan")}
                      </div>
                    </div>
                    <Button variant="outline" size="sm">
                      <Printer className="h-3.5 w-3.5 mr-1" />
                      {t("Печать", "Chop etish")}
                    </Button>
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
