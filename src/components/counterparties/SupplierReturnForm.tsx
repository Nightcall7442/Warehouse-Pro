import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { AppModal, modalFieldLabel } from "@/components/ui/AppModal";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { trpc } from "@/providers/trpc";
import { formatQty } from "@/lib/format";
import type { PayableSupply } from "./PaymentForm";

/**
 * Возврат товара поставщику.
 *
 * Брак и просрочку возвращали на завод, а в системе это выглядело как
 * «корректировка склада» плюс «платёж наличными»: в акте сверки — деньги,
 * которых не было. Здесь одно действие: строки товара с себестоимостью, итог
 * гасит долг по поставке как «возврат товара», товар уходит со склада.
 */
export interface ReturnValues {
  supplyId: number;
  items: Array<{ productId: number; quantity: string; unitCost?: string }>;
  notes?: string;
  idempotencyKey: string;
}

type Line = { productId: number; name: string; quantity: string; unitCost: string };

export function SupplierReturnForm({ open, supply, isPending, lang, onSubmit, onClose }: {
  open: boolean;
  supply: PayableSupply | null;
  isPending: boolean;
  lang: string;
  onSubmit: (values: ReturnValues) => void;
  onClose: () => void;
}) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const { data: found } = trpc.product.list.useQuery({ page: 1, pageSize: 8, search: search || undefined }, { enabled: search.trim().length > 1 });

  if (!supply) return null;

  const total = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitCost || 0), 0);
  const valid = lines.length > 0 && lines.every(l => Number(l.quantity) > 0);

  return (
    <AppModal
      open={open}
      onClose={onClose}
      maxWidth={640}
      title={t("Возврат товара поставщику", "Yetkazib beruvchiga mahsulot qaytarish")}
      subtitle={`${supply.supplierName} · ${supply.supplyNumber} · ${t("остаток долга", "qarz qoldig'i")} ${formatQty(supply.debt)} ${supply.currency}`}
      footer={
        <>
          <button
            data-testid="supplier-return-submit"
            onClick={() => valid && !isPending && onSubmit({
              supplyId: supply.id,
              items: lines.map(l => ({ productId: l.productId, quantity: l.quantity, unitCost: l.unitCost || undefined })),
              notes: notes || undefined, idempotencyKey,
            })}
            disabled={!valid || isPending}
            className="neo-btn-primary flex-1 h-11 text-sm flex items-center justify-center gap-2"
            style={{ opacity: valid && !isPending ? 1 : 0.5 }}
          >
            {isPending && <Loader2 size={15} className="animate-spin" />}
            {t("Вернуть и списать с долга", "Qaytarish va qarzdan chiqarish")}
          </button>
          <button onClick={onClose} className="neo-btn flex-1 h-11 text-sm">{t("Отмена", "Bekor qilish")}</button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={modalFieldLabel}>{t("Добавить товар", "Mahsulot qo'shish")}</label>
          <input className="neo-input" placeholder={t("Название, код или штрих-код…", "Nomi, kodi yoki shtrix-kodi…")} value={search} onChange={e => setSearch(e.target.value)} data-testid="supplier-return-search" />
          {search.trim().length > 1 && (found?.data ?? []).length > 0 && (
            <div className="mt-1 rounded-xl overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
              {(found?.data ?? []).map(p => (
                <button key={p.id} type="button" className="w-full text-left row-hover" style={{ padding: "8px 12px", background: "transparent", border: "none", cursor: "pointer" }}
                  onClick={() => {
                    setLines(ls => ls.some(l => l.productId === p.id) ? ls : [...ls, { productId: p.id, name: p.name, quantity: "1", unitCost: String(Number(p.costPrice ?? 0)) }]);
                    setSearch("");
                  }}>
                  <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>{p.name}</span>
                  <span className="text-xs ml-2" style={{ color: "var(--color-text-tertiary)" }}>{p.code} · {t("себест.", "tannarx")} {formatQty(p.costPrice ?? 0)} · {t("свободно", "bo'sh")} {formatQty(p.available ?? 0)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {lines.length > 0 && (
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={l.productId} className="grid gap-2 items-center" style={{ gridTemplateColumns: "1fr 90px 120px 32px" }} data-testid={`supplier-return-line-${l.productId}`}>
                <span className="text-sm truncate" style={{ color: "var(--color-text-primary)" }}>{l.name}</span>
                <DecimalInput className="neo-input" style={{ textAlign: "right", padding: "6px 8px" }} value={l.quantity} onValueChange={v => setLines(ls => ls.map((x, k) => k === i ? { ...x, quantity: v } : x))} />
                <DecimalInput className="neo-input" style={{ textAlign: "right", padding: "6px 8px" }} value={l.unitCost} onValueChange={v => setLines(ls => ls.map((x, k) => k === i ? { ...x, unitCost: v } : x))} />
                <button type="button" onClick={() => setLines(ls => ls.filter((_, k) => k !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-danger-text)" }} aria-label={t("Убрать", "Olib tashlash")}><Trash2 size={14} /></button>
              </div>
            ))}
            <div className="flex justify-between text-sm pt-2" style={{ borderTop: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
              <span>{t("Итого по себестоимости, сум", "Tannarx bo'yicha jami, so'm")}</span>
              <span className="font-bold" style={{ color: "var(--color-text-primary)" }}>{formatQty(total)}</span>
            </div>
            {supply.currency === "USD" && (
              <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>{t("Долг в долларах — сумма возврата пересчитается по курсу поставки.", "Qarz dollarda — qaytarish summasi yetkazib berish kursi bo'yicha qayta hisoblanadi.")}</p>
            )}
          </div>
        )}

        <div>
          <label className={modalFieldLabel}>{t("Причина / примечание", "Sabab / izoh")}</label>
          <input className="neo-input" placeholder={t("брак, просрочка, пересорт…", "brak, muddati o'tgan…")} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
        <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
          {t("Товар уйдёт со склада (с просроченных партий первым), долг по поставке уменьшится на сумму по себестоимости — не больше остатка.", "Mahsulot ombordan chiqadi, yetkazib berish bo'yicha qarz tannarx summasiga kamayadi — qoldiqdan ko'p emas.")}
        </p>
      </div>
    </AppModal>
  );
}
