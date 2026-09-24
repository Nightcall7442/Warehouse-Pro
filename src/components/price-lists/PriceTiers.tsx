import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { DecimalInput } from "@/components/ui/DecimalInput";

type Tier = { id: number; productId: number; productName: string | null; price: string; minQuantity: string; unitPrice: string | null };
type Product = { id: number; name: string; code?: string | null; unitPrice?: string | null };

/**
 * Цена от количества: «от 10 штук — по 11 000».
 *
 * Сетка правит цену от одной штуки; ступени — отдельно и по одной: их
 * мало, а у каждой два числа. Резолвер берёт ступень с наибольшим «от»,
 * до которой дотянул заказ (pickTier).
 */
export function PriceTiers({ listId, tiers, products }: { listId: number; tiers: Tier[]; products: Product[] }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();
  const utils = trpc.useUtils();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Product | null>(null);
  const [minQty, setMinQty] = useState("10");
  const [price, setPrice] = useState("");

  const refresh = () => Promise.all([utils.priceList.getById.invalidate({ id: listId }), utils.priceList.list.invalidate()]);
  const upsert = trpc.priceList.upsertItem.useMutation({
    onSuccess: async () => { await refresh(); setPicked(null); setQ(""); setPrice(""); notify.success(t("Ступень сохранена", "Pog'ona saqlandi")); },
    onError: e => notify.error(e.message),
  });
  const removeItem = trpc.priceList.removeItem.useMutation({ onSuccess: () => void refresh(), onError: e => notify.error(e.message) });

  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2 || picked) return [];
    return products.filter(p => p.name.toLowerCase().includes(s) || (p.code ?? "").toLowerCase().includes(s)).slice(0, 8);
  }, [q, picked, products]);

  const add = () => {
    if (!picked) return notify.error(t("Выберите товар", "Mahsulotni tanlang"));
    const n = Number(minQty), p = Number(price);
    if (!(n > 1)) return notify.error(t("Ступень — от 2 штук и больше", "Pog'ona — 2 donadan"));
    if (!(p >= 0) || price.trim() === "") return notify.error(t("Укажите цену", "Narxni kiriting"));
    upsert.mutate({ priceListId: listId, productId: picked.id, price: p, minQuantity: n });
  };

  return (
    <details className="neo-card neo-card-static" style={{ borderRadius: 20, padding: 16 }} data-testid="price-tiers">
      <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>
        {t(`Цена от количества · ${tiers.length}`, `Miqdordan narx · ${tiers.length}`)}
      </summary>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(200px, 2fr) 110px 140px auto", gap: 8, marginTop: 12, alignItems: "start" }}>
        <div style={{ position: "relative" }}>
          <input className="neo-input" placeholder={t("Товар…", "Mahsulot…")} value={picked ? picked.name : q}
            onChange={e => { setQ(e.target.value); setPicked(null); }} data-testid="price-tier-product" />
          {found.length > 0 && (
            <div className="neo-card" style={{ position: "absolute", zIndex: 10, left: 0, right: 0, top: "100%", marginTop: 4, padding: 4, borderRadius: 12 }}>
              {found.map(p => (
                <button key={p.id} onClick={() => { setPicked(p); setPrice(String(Number(p.unitPrice ?? 0) || "")); }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", border: "none", background: "transparent", cursor: "pointer", fontSize: 13, borderRadius: 8 }}>
                  {p.name} <span style={{ color: "var(--color-text-tertiary)" }}>· {p.code}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <DecimalInput className="neo-input" value={minQty} onValueChange={setMinQty} placeholder={t("от, шт", "dan, dona")} data-testid="price-tier-min" />
        <DecimalInput className="neo-input" value={price} onValueChange={setPrice} placeholder={t("цена", "narx")} data-testid="price-tier-price" />
        <button className="neo-btn-primary" onClick={add} disabled={upsert.isPending} aria-label={t("Добавить ступень", "Pog'ona qo'shish")} data-testid="price-tier-add"><Plus size={15} /></button>
      </div>
      {tiers.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          {tiers.map(tr => (
            <div key={tr.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <span style={{ flex: 1, color: "var(--color-text-secondary)" }}>{tr.productName ?? "—"} · {t("от", "dan")} {Number(tr.minQuantity)}</span>
              <span style={{ color: "var(--color-text-tertiary)", textDecoration: "line-through" }}>{fmt(Number(tr.unitPrice ?? 0))}</span>
              <b style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(Number(tr.price))}</b>
              <button onClick={() => removeItem.mutate({ id: tr.id })} aria-label={t("Убрать", "Olib tashlash")}
                style={{ border: "none", background: "transparent", color: "var(--color-text-tertiary)", cursor: "pointer" }}><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
