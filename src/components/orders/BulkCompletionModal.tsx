import { useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, Banknote, Repeat, CreditCard } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useTranslate, useLang } from "@/i18n";
import { AppModal, modalSectionLabel } from "@/components/ui/AppModal";
import { colorMix } from "@/lib/color-mix";

/**
 * Массовое завершение заказов: у каждого своя оплата и свой возврат.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Массовые действия умели только крайности: «оплачено полностью» или «не
 * оплачено вовсе». Середины — магазин отдал часть денег, часть товара вернул —
 * не было, хотя именно так чаще всего и происходит. Пачку приходилось
 * разбирать по одному заказу, а когда их два десятка, это полдня.
 *
 * ── Почему таблица, а не череда окон ────────────────────────────────────────
 *
 * Деньги правятся там, где их видно рядом с суммой заказа, а итог по всей
 * пачке — на экране до нажатия, а не после. Массовую запись денег нельзя
 * отменить: одно нажатие пишет оплаты по полусотне заказов. Поэтому итог
 * внизу — не украшение, а главная часть окна.
 */

export interface BulkOrderLine {
  id: number;
  productName: string | null;
  quantity: string;
  unitPrice: string;
  unit?: string | null;
}

export interface BulkOrder {
  id: number;
  orderNumber: string;
  shopName: string | null;
  total: string;
  subtotal: string;
  discount: string;
  alreadyPaid: string;
  paymentMethod: string | null;
  items: BulkOrderLine[];
}

export interface BulkEntry {
  orderId: number;
  deliveredItems: Array<{ itemId: number; deliveredQuantity: number }>;
  paidAmount: string;
  paymentMethod: "cash" | "card" | "transfer";
}

interface Props {
  open: boolean;
  onClose: () => void;
  orders: BulkOrder[];
  currency: string;
  saving: boolean;
  onSave: (entries: BulkEntry[]) => void;
}

/** Сколько осталось по строке после возврата и сколько это стоит. */
function lineValue(line: BulkOrderLine, returnedQty: number): number {
  const kept = Math.max(0, Number(line.quantity) - returnedQty);
  return kept * Number(line.unitPrice);
}

/**
 * Сумма заказа после возврата.
 *
 * Скидка пересчитывается долей от первоначальной суммы — так же, как это
 * делает сервер в applyPartialDelivery. Вычесть прежнюю скидку целиком из
 * уменьшенной суммы значило бы увести итог в минус.
 */
function orderTotalAfterReturns(order: BulkOrder, returns: Record<number, number>): number {
  const newSubtotal = order.items.reduce((s, l) => s + lineValue(l, returns[l.id] ?? 0), 0);
  const originalSubtotal = Number(order.subtotal);
  const discountPct = originalSubtotal > 0 ? (Number(order.discount) / originalSubtotal) * 100 : 0;
  return Math.max(0, newSubtotal - newSubtotal * (discountPct / 100));
}

const PM_OPTIONS = [
  { value: "cash" as const, icon: Banknote, ru: "Наличные", uz: "Naqd" },
  { value: "card" as const, icon: CreditCard, ru: "Карта", uz: "Karta" },
  { value: "transfer" as const, icon: Repeat, ru: "Перевод", uz: "O'tkazma" },
];

export function BulkCompletionModal({ open, onClose, orders, currency, saving, onSave }: Props) {
  const t = useTranslate();
  const { lang } = useLang();

  const [paid, setPaid] = useState<Record<number, string>>({});
  const [returns, setReturns] = useState<Record<number, Record<number, number>>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [method, setMethod] = useState<"cash" | "card" | "transfer">("cash");

  /**
   * Сброс при открытии и при смене набора заказов.
   *
   * Начальное значение — null, а НЕ текущий ключ. useState(ключ) запоминает
   * его при первой отрисовке, и окно, появившееся сразу открытым, пропускало
   * бы заполнение: ровно так ломалось окно завершения одного заказа, и в
   * запрос уходил пустой список позиций.
   */
  const key = open ? orders.map(o => o.id).join(",") : null;
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (lastKey !== key) {
    setLastKey(key);
    if (open) {
      const next: Record<number, string> = {};
      for (const o of orders) {
        // По умолчанию — остаток к оплате, а не полная сумма: часть денег по
        // заказу могла быть принята раньше, и предлагать взять её повторно
        // нельзя.
        next[o.id] = Math.max(0, Number(o.total) - Number(o.alreadyPaid)).toFixed(0);
      }
      setPaid(next);
      setReturns({});
      setExpanded({});
      setMethod("cash");
    }
  }

  const money = (n: number) => n.toLocaleString("ru") + " " + currency;

  const rows = orders.map((o) => {
    const ret = returns[o.id] ?? {};
    const total = orderTotalAfterReturns(o, ret);
    const already = Number(o.alreadyPaid);
    const maxPay = Math.max(0, total - already);
    const pay = Math.min(Math.max(0, Number(paid[o.id] ?? 0) || 0), maxPay);
    const returnedValue = Number(o.total) - total;
    return { order: o, total, already, maxPay, pay, debt: Math.max(0, maxPay - pay), returnedValue };
  });

  const sum = {
    total: rows.reduce((s, r) => s + r.total, 0),
    pay: rows.reduce((s, r) => s + r.pay, 0),
    debt: rows.reduce((s, r) => s + r.debt, 0),
    returned: rows.reduce((s, r) => s + r.returnedValue, 0),
  };

  function setReturnedQty(orderId: number, itemId: number, qty: number, ordered: number) {
    setReturns(prev => ({
      ...prev,
      [orderId]: { ...(prev[orderId] ?? {}), [itemId]: Math.max(0, Math.min(qty, ordered)) },
    }));
  }

  function handleSave() {
    const entries: BulkEntry[] = rows.map(({ order, pay }) => {
      const ret = returns[order.id] ?? {};
      return {
        orderId: order.id,
        // Сервер требует ВСЕ строки заказа: «не указана» одинаково читается и
        // как «доставлена полностью», и как «возвращена целиком».
        deliveredItems: order.items.map(l => ({
          itemId: l.id,
          deliveredQuantity: Math.max(0, Number(l.quantity) - (ret[l.id] ?? 0)),
        })),
        paidAmount: pay.toFixed(2),
        paymentMethod: method,
      };
    });
    onSave(entries);
  }

  const footer = (
    <div className="flex flex-col gap-3 w-full">
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: t("Принято", "Olindi"), value: sum.pay, color: "var(--color-success-text)" },
          { label: t("В долг", "Qarzga"), value: sum.debt, color: "var(--color-warning-text)" },
          { label: t("Возвращено", "Qaytarildi"), value: sum.returned, color: "var(--color-text-secondary)" },
        ].map(box => (
          <div key={box.label} className="rounded-xl text-center" style={{ padding: "8px", background: "var(--color-surface-light)" }}>
            <p className="text-[11px]" style={{ color: "var(--color-text-secondary)" }}>{box.label}</p>
            <p className="text-[15px] font-bold font-data" style={{ color: box.color }}>{money(box.value)}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button type="button" className="neo-btn flex-1" onClick={onClose} disabled={saving}>
          {t("Отмена", "Bekor qilish")}
        </button>
        <button type="button" className="neo-btn neo-btn-primary flex-1" onClick={handleSave} disabled={saving || rows.length === 0}>
          {saving ? t("Записываю…", "Yozilmoqda…") : t(`Записать ${rows.length}`, `${rows.length} tasini yozish`)}
        </button>
      </div>
    </div>
  );

  return (
    <AppModal
      open={open}
      onClose={onClose}
      title={t("Завершение заказов", "Buyurtmalarni yakunlash")}
      subtitle={t(`${orders.length} заказ(ов) на ${money(sum.total)}`, `${orders.length} ta buyurtma, ${money(sum.total)}`)}
      maxWidth={860}
      footer={footer}
    >
      <div
        className="flex items-start gap-2.5 rounded-xl mb-3"
        style={{ padding: "12px", background: colorMix("var(--color-warning)", 7), border: `1px solid ${colorMix("var(--color-warning)", 19)}` }}
      >
        <AlertTriangle size={16} style={{ color: "var(--color-warning)" }} className="shrink-0 mt-0.5" />
        <p className="text-[12px]" style={{ color: "var(--color-text-secondary)" }}>
          {t(
            "Заказы получат статус «Доставлен», товар спишется со склада. Отменить массовую запись нельзя — проверьте суммы внизу.",
            "Buyurtmalar «Yetkazildi» holatini oladi, tovar omboridan yechiladi. Ommaviy yozuvni bekor qilib bo'lmaydi — pastdagi summalarni tekshiring.",
          )}
        </p>
      </div>

      <p className={modalSectionLabel}>{t("СПОСОБ ОПЛАТЫ", "TO'LOV USULI")}</p>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {PM_OPTIONS.map(pm => {
          const Icon = pm.icon;
          const active = method === pm.value;
          return (
            <button
              key={pm.value}
              type="button"
              onClick={() => setMethod(pm.value)}
              className="neo-btn flex items-center justify-center gap-1.5 text-[13px]"
              style={active ? { borderColor: "var(--color-primary)", color: "var(--color-primary)" } : undefined}
            >
              <Icon size={14} /> {lang === "uz" ? pm.uz : pm.ru}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-1.5">
        {rows.map(({ order, total, already, maxPay, debt }) => {
          const isOpen = !!expanded[order.id];
          const ret = returns[order.id] ?? {};
          const returnedCount = Object.values(ret).reduce((s, q) => s + q, 0);
          return (
            <div key={order.id} className="neo-card-sm" style={{ padding: "10px 12px" }}>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setExpanded(p => ({ ...p, [order.id]: !isOpen }))}
                  className="flex items-center gap-1 text-left min-w-0 flex-1"
                  aria-expanded={isOpen}
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="truncate">
                    <span className="text-[13px] font-semibold" style={{ color: "var(--color-text-primary)" }}>
                      {order.shopName ?? "—"}
                    </span>
                    <span className="text-[11px] ml-1.5" style={{ color: "var(--color-text-secondary)" }}>
                      {order.orderNumber}
                      {returnedCount > 0 && ` · ${t("возврат", "qaytarish")} ${returnedCount}`}
                    </span>
                  </span>
                </button>

                <span className="text-[13px] font-data shrink-0" style={{ color: "var(--color-text-secondary)" }}>
                  {money(total)}
                </span>

                <label className="sr-only" htmlFor={`pay-${order.id}`}>
                  {t("Оплачено", "To'landi")} {order.orderNumber}
                </label>
                <Input
                  id={`pay-${order.id}`}
                  type="number"
                  min={0}
                  max={maxPay}
                  value={paid[order.id] ?? ""}
                  onChange={e => setPaid(p => ({ ...p, [order.id]: e.target.value }))}
                  className="h-8 w-28 text-[13px] font-data shrink-0"
                />

                <span
                  className="text-[13px] font-bold font-data shrink-0 w-28 text-right"
                  style={{ color: debt > 0 ? "var(--color-warning-text)" : "var(--color-text-secondary)" }}
                >
                  {debt > 0 ? money(debt) : "—"}
                </span>
              </div>

              {already > 0 && (
                <p className="text-[11px] mt-1" style={{ color: "var(--color-text-secondary)" }}>
                  {t("Ранее принято", "Avval olingan")}: {money(already)}
                </p>
              )}

              {isOpen && (
                <div className="mt-2 flex flex-col gap-1.5">
                  {order.items.map(line => {
                    const ordered = Number(line.quantity);
                    return (
                      <div key={line.id} className="flex items-center gap-2 text-[12px]">
                        <span className="flex-1 truncate" style={{ color: "var(--color-text-secondary)" }}>
                          {line.productName ?? "—"} · {ordered} {line.unit ?? ""} × {Number(line.unitPrice).toLocaleString("ru")}
                        </span>
                        <label className="sr-only" htmlFor={`ret-${order.id}-${line.id}`}>
                          {t("Вернули", "Qaytarildi")} {line.productName ?? ""}
                        </label>
                        <Input
                          id={`ret-${order.id}-${line.id}`}
                          type="number"
                          min={0}
                          max={ordered}
                          placeholder={t("вернули", "qaytarildi")}
                          value={ret[line.id] ?? ""}
                          onChange={e => setReturnedQty(order.id, line.id, Number(e.target.value) || 0, ordered)}
                          className="h-7 w-20 text-[12px] font-data"
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AppModal>
  );
}
