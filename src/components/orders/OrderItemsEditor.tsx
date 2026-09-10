import { useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { unitShort } from "@/lib/units";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { PremiumSelect } from "@/components/PremiumSelect";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import {
  linesFromOrder, linesToPayload, validateLines,
  type EditLine, type OrderLine,
} from "@/lib/order-item-edit";
import { useInvalidateOrderCaches } from "@/hooks/useOrderCacheSync";
import { Loader2, Plus, Trash2 } from "lucide-react";

/**
 * Состав заказа: добавить товар, убрать, изменить количество.
 *
 * ── Зачем появилось ─────────────────────────────────────────────────────────
 *
 * Просьба владельца: состав своего заказа должен править и агент. Заказ
 * оформляет он, и «добавьте ещё две коробки, а это уберите» слышит он же, стоя
 * в магазине, — а единственным выходом был звонок в офис.
 *
 * Правка состава в вебе жила только в панели заказа у оператора
 * (OrderSlideOver), а карточка заказа — та, куда попадает агент из своего
 * списка, — умела менять лишь скидку, способ оплаты и примечание.
 *
 * ── Что здесь НЕ решается ───────────────────────────────────────────────────
 *
 * Кому и когда это можно, решает сервер: свой заказ (assertOrderVisible) и
 * пока он не уехал (assertItemsEditableBy). Экран лишь не показывает кнопку
 * там, где ответом будет отказ, — но проверка не здесь, и обойти её, минуя
 * экран, нельзя.
 *
 * Скидка пересчитывается сервером пропорционально новому размеру заказа, и
 * трогать её здесь незачем — на это есть соседний блок.
 */
export function OrderItemsEditor({ orderId, items, onSaved }: {
  orderId: number;
  items: OrderLine[];
  onSaved: () => void;
}) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();

  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [addId, setAddId] = useState("");

  /*
    Сброс кэшей — общим приёмом, а не одним refetch карточки.

    Правка состава меняет сумму заказа, остаток на складе и долг магазина: со
    своим refetch обновилась бы только эта карточка, а список заказов, склад и
    сводки остались бы со старыми числами до перезагрузки. На это в наборе есть
    отдельная проверка, и она эту ошибку и нашла.
  */
  const invalidateOrderCaches = useInvalidateOrderCaches();

  const save = trpc.order.updateItems.useMutation({
    onSuccess: () => {
      notify.success(t("Состав заказа изменён", "Buyurtma tarkibi o'zgartirildi"));
      invalidateOrderCaches();
      setOpen(false);
      onSaved();
    },
    onError: (e) => notify.error(e.message),
  });

  // Каталог тянется только когда его открыли: у организации это пятьсот строк,
  // и грузить их при каждом открытии карточки заказа незачем.
  const { data: catalog } = trpc.product.list.useQuery({ pageSize: 500 }, { enabled: open });
  const products = useMemo(() => catalog?.data ?? [], [catalog]);

  const start = () => {
    setLines(linesFromOrder(items));
    setAddId("");
    setOpen(true);
  };

  const patch = (key: string, next: Partial<EditLine>) =>
    setLines(prev => prev.map(l => (l.key === key ? { ...l, ...next } : l)));

  const drop = (key: string) => setLines(prev => prev.filter(l => l.key !== key));

  const add = (productId: string) => {
    const p = products.find(x => String(x.id) === productId);
    if (!p) return;
    setLines(prev => [...prev, {
      // Метка времени в ключе: тот же товар могли убрать и вернуть, и без неё
      // React принял бы новую строку за старую вместе с её состоянием.
      key: `new-${p.id}-${Date.now()}`,
      productId: p.id,
      productName: p.name,
      quantity: "1",
      unitPrice: String(Number(p.unitPrice ?? 0)),
    }]);
    setAddId("");
  };

  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0), 0);

  const submit = () => {
    const wrong = validateLines(lines);
    if (wrong) { notify.error(wrong); return; }
    /*
      Поле называется `id`, а не `orderId` — так его назвала ручка. Здесь
      стояло `{ orderId, … } as never`, и приведение молча съело несоответствие:
      сервер получил бы запрос без номера заказа. Приведений в вызовах ручек
      быть не должно ровно поэтому.
    */
    save.mutate({ id: orderId, items: linesToPayload(items, lines) });
  };

  if (!open) {
    return (
      <button onClick={start} className="neo-btn tap flex items-center gap-2 text-sm py-2">
        <Plus size={15} /> {t("Изменить состав", "Tarkibni o'zgartirish")}
      </button>
    );
  }

  const inCart = new Set(lines.map(l => l.productId));
  /*
    Единица берётся у строки заказа, а для добавленной — у товара из каталога:
    в строке её ещё нет, она появится только после сохранения.
  */
  const unitOf = new Map<number, string | null | undefined>([
    ...items.map(i => [i.productId, i.unit] as const),
    ...products.map(p => [p.id, (p as { unit?: string | null }).unit] as const),
  ]);

  return (
    <div className="neo-card p-4 space-y-3">
      <p className="font-label text-secondary text-xs tracking-wider">
        {t("СОСТАВ ЗАКАЗА", "BUYURTMA TARKIBI")}
      </p>

      <div className="space-y-2">
        {lines.map(l => (
          <div key={l.key} className="flex items-center gap-2 flex-wrap">
            <span className="flex-1 truncate text-sm text-primary" style={{ minWidth: "140px" }}>
              {l.productName}
            </span>
            <DecimalInput
              value={l.quantity}
              onValueChange={v => patch(l.key, { quantity: v })}
              inputMode="decimal"
              aria-label={t(`Количество: ${l.productName}`, `Miqdor: ${l.productName}`)}
              className="neo-input text-right"
              style={{ width: "78px", fontVariantNumeric: "tabular-nums" }}
            />
            {/* Единица товара, а не «шт» всем подряд: у товара, который
                продают литрами, это прямая ложь рядом с количеством. */}
            <span className="text-xs text-tertiary shrink-0" style={{ width: "34px" }}>
              {unitShort(unitOf.get(l.productId), lang)}
            </span>
            <DecimalInput
              value={l.unitPrice}
              onValueChange={v => patch(l.key, { unitPrice: normalizeDecimalInput(v) })}
              inputMode="decimal"
              aria-label={t(`Цена: ${l.productName}`, `Narx: ${l.productName}`)}
              className="neo-input text-right"
              style={{ width: "112px", fontVariantNumeric: "tabular-nums" }}
            />
            <button
              onClick={() => drop(l.key)}
              aria-label={t(`Убрать ${l.productName}`, `${l.productName} olib tashlash`)}
              className="tap shrink-0 p-2 rounded-lg"
              style={{ color: "var(--color-danger-text)" }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>

      {/* ── Добавить товар ─────────────────────────────────────────────── */}
      <PremiumSelect
        value={addId}
        onChange={v => { setAddId(v); add(v); }}
        width="100%"
        aria-label={t("Добавить товар", "Tovar qo'shish")}
        options={[
          { value: "", label: t("Добавить товар…", "Tovar qo'shish…") },
          // Уже добавленные из списка убраны: сервер отвергает второй ряд с тем
          // же товаром, и предлагать его значит вести человека в отказ.
          ...products
            .filter(p => !inCart.has(p.id))
            .map(p => ({ value: String(p.id), label: p.name })),
        ]}
      />

      <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
        <span className="text-xs text-secondary">{t("Сумма позиций", "Pozitsiyalar summasi")}</span>
        <span className="text-sm font-semibold text-primary" style={{ fontVariantNumeric: "tabular-nums" }}>
          {fmt(subtotal)}
        </span>
      </div>
      {/*
        Скидка не показана намеренно: сервер пересчитывает её пропорционально
        новому размеру заказа. Второе поле здесь означало бы два места, где её
        задают, и рано или поздно они разойдутся.
      */}

      <div className="flex gap-2">
        <button onClick={submit} disabled={save.isPending} className="neo-btn-primary tap flex-1 flex items-center justify-center gap-2">
          {save.isPending && <Loader2 size={14} className="animate-spin" />}
          {t("Сохранить состав", "Tarkibni saqlash")}
        </button>
        <button onClick={() => setOpen(false)} className="neo-btn tap">
          {t("Отмена", "Bekor qilish")}
        </button>
      </div>
    </div>
  );
}
