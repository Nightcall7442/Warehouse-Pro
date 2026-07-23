import { useState, useRef, useCallback } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { Package, Search, ShoppingCart, Plus, Minus, Trash2 } from "lucide-react";
import { unitLabel } from "./types";
import type { OrderItem } from "./types";

interface ProductSelectorProps {
  items: OrderItem[];
  onChange: (items: OrderItem[]) => void;
}

export function ProductSelector({ items, onChange }: ProductSelectorProps) {
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { data: products } = trpc.product.listAll.useQuery(undefined) as { data: any };
  const [search, setSearch] = useState("");
  const [quickQty, setQuickQty] = useState<Record<number, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = (products ?? []).filter((p: any) =>
    !search || p.name?.toLowerCase().includes(search.toLowerCase()) || (p.code ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const addToCart = useCallback((product: any, qty?: number) => {
    const addQty = qty ?? 1;
    const existing = items.findIndex(i => i.productId === (product.id as number));
    if (existing >= 0) {
      const next = [...items];
      next[existing] = { ...next[existing], quantity: String(Number(next[existing].quantity) + addQty) };
      onChange(next);
    } else {
      onChange([...items, {
        productId: product.id as number,
        productName: product.name as string,
        unitPrice: product.unitPrice as string,
        quantity: String(addQty),
        available: (product.available as string) ?? "0",
        unit: (product.unit as string) ?? "pcs",
        unitWeight: Number(product.unitWeight ?? 0),
      }]);
    }
    setQuickQty(prev => ({ ...prev, [product.id]: "" }));
  }, [items, onChange]);

  const updateQuantity = useCallback((productId: number, delta: number) => {
    const next = [...items];
    const itemIdx = next.findIndex(i => i.productId === productId);
    if (itemIdx === -1) return;
    const newQty = Math.max(0, Number(next[itemIdx].quantity) + delta);
    if (newQty === 0) {
      next.splice(itemIdx, 1);
    } else {
      next[itemIdx] = { ...next[itemIdx], quantity: String(newQty) };
    }
    onChange(next);
  }, [items, onChange]);

  const setQuantityDirect = useCallback((productId: number, value: string) => {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) return;
    const next = [...items];
    const itemIdx = next.findIndex(i => i.productId === productId);
    if (itemIdx === -1) return;
    if (num === 0) {
      next.splice(itemIdx, 1);
    } else {
      next[itemIdx] = { ...next[itemIdx], quantity: String(num) };
    }
    onChange(next);
  }, [items, onChange]);

  const removeItem = useCallback((productId: number) => {
    onChange(items.filter(i => i.productId !== productId));
  }, [items, onChange]);

  const handleQuickAdd = useCallback((product: any) => {
    const qty = parseFloat(quickQty[product.id] || "1");
    if (isNaN(qty) || qty <= 0) return;
    addToCart(product, qty);
    searchRef.current?.focus();
  }, [quickQty, addToCart]);

  const validItems = items.filter(i => i.productId > 0);
  const totalWeightKg = validItems.reduce((s, i) => s + Number(i.quantity) * (i.unitWeight || 1), 0);
  const subtotal = validItems.reduce((s, i) => s + Number(i.unitPrice) * Number(i.quantity), 0);

  return (
    <div className="animate-fade-up order-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px", alignItems: "start" }}>
      <style>{`@media (min-width: 768px) { .order-grid { grid-template-columns: 1fr 320px !important; } }`}</style>

      {/* Product catalog */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="font-label text-[10px] text-secondary tracking-wider">
            {t("КАТАЛОГ ТОВАРОВ", "MAHSULOTLAR KATALOGI")}
          </p>
          <span className="text-xs text-tertiary">{filtered.length} {t("товаров", "mahsulot")}</span>
        </div>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: "12px" }}>
          <Search size={14} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)", pointerEvents: "none" }} />
          <input
            ref={searchRef}
            className="neo-input"
            style={{ paddingLeft: "36px", width: "100%" }}
            placeholder={t("Поиск по названию или коду…", "Nomi yoki kodi bo'yicha qidirish…")}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Product list */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "520px", overflowY: "auto", touchAction: "manipulation" }}>
          {filtered.map((product: any) => {
            const inCart = items.find(i => i.productId === product.id);
            const lowStock = Number(product.available ?? 0) < 10;
            const inputVal = quickQty[product.id] || "";
            return (
              <div
                key={product.id}
                className="neo-card-sm"
                style={{
                  display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px",
                  cursor: "pointer", transition: "all 0.15s",
                  borderLeft: inCart ? "3px solid var(--color-primary)" : "3px solid transparent",
                }}
                onClick={() => !inCart && addToCart(product)}
              >
                {/* Product icon */}
                <div style={{
                  width: "36px", height: "36px", borderRadius: "8px", display: "flex",
                  alignItems: "center", justifyContent: "center", flexShrink: 0,
                  background: inCart ? "var(--color-primary-subtle)" : "var(--color-surface-light)",
                }}>
                  <Package size={16} style={{ color: inCart ? "var(--color-primary)" : "var(--color-text-tertiary)" }} />
                </div>

                {/* Product info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 500, fontSize: "13px", color: "var(--color-text-primary)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {product.name}
                  </p>
                  <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", margin: "2px 0 0" }}>
                    {fmt(product.unitPrice)}/{unitLabel(product.unit, lang)}
                    {lowStock && <span style={{ color: "var(--color-warning)", marginLeft: "6px" }}>⚠ {t("мало", "kam")}</span>}
                  </p>
                </div>

                {/* Quantity controls */}
                {inCart ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                    <button onClick={(e) => { e.stopPropagation(); updateQuantity(product.id, -1); }}
                      style={{ width: "44px", height: "44px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-surface)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--color-text-secondary)" }}>
                      <Minus size={16} />
                    </button>
                    <input
                      type="number"
                      min="0"
                      value={inCart.quantity}
                      onChange={(e) => { e.stopPropagation(); setQuantityDirect(product.id, e.target.value); }}
                      onClick={(e) => e.stopPropagation()}
                      style={{ width: "44px", height: "44px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-surface)", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)", fontFamily: "'DM Sans', sans-serif", outline: "none" }}
                    />
                    <button onClick={(e) => { e.stopPropagation(); updateQuantity(product.id, 1); }}
                      style={{ width: "44px", height: "44px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-surface)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--color-text-secondary)" }}>
                      <Plus size={16} />
                    </button>
                  </div>
                ) : (
                  /* Quick add: input qty + Enter */
                  <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="number"
                      min="1"
                      placeholder="1"
                      value={inputVal}
                      onChange={(e) => setQuickQty(prev => ({ ...prev, [product.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") handleQuickAdd(product); }}
                      style={{ width: "44px", height: "44px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-surface)", textAlign: "center", fontSize: "12px", color: "var(--color-text-primary)", fontFamily: "'DM Sans', sans-serif", outline: "none" }}
                    />
                    <button onClick={() => handleQuickAdd(product)}
                      style={{ width: "44px", height: "44px", borderRadius: "6px", border: "none", background: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff" }}>
                      <Plus size={16} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Cart */}
      <div className="neo-card" style={{ padding: "20px", position: "sticky", top: "20px" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
            {t("Корзина", "Savat")} ({validItems.length})
          </h3>
          {validItems.length > 0 && (
            <button onClick={() => onChange([])} style={{
              fontSize: "11px", color: "var(--color-danger)", background: "none",
              border: "none", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
            }}>
              {t("Очистить", "Tozalash")}
            </button>
          )}
        </div>

        {validItems.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--color-text-tertiary)" }}>
            <ShoppingCart size={32} style={{ margin: "0 auto 8px", opacity: 0.3 }} />
            <p style={{ fontSize: "13px" }}>{t("Корзина пуста", "Savat bo'sh")}</p>
            <p style={{ fontSize: "11px", marginTop: "4px" }}>{t("Введите количество и нажмите +", "Miqdorni kiriting va + bosing")}</p>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px", maxHeight: "320px", overflowY: "auto", touchAction: "manipulation" }}>
              {validItems.map((item) => (
                <div key={item.productId} style={{
                  display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px",
                  borderRadius: "8px", background: "var(--color-surface-light)",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.productName}
                    </p>
                    <p style={{ fontSize: "10px", color: "var(--color-text-secondary)", margin: "1px 0 0" }}>
                      {fmt(item.unitPrice)}/{unitLabel(item.unit, lang)}
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                    <button onClick={() => updateQuantity(item.productId, -1)} style={{
                      width: "44px", height: "44px", borderRadius: "6px", border: "1px solid var(--color-border)",
                      background: "var(--color-surface)", display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", fontSize: "14px", color: "var(--color-text-secondary)",
                    }}>−</button>
                    <input
                      type="number"
                      min="0"
                      value={item.quantity}
                      onChange={(e) => setQuantityDirect(item.productId, e.target.value)}
                      style={{ width: "44px", height: "44px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-surface)", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)", fontFamily: "'DM Sans', sans-serif", outline: "none" }}
                    />
                    <button onClick={() => updateQuantity(item.productId, 1)} style={{
                      width: "44px", height: "44px", borderRadius: "6px", border: "1px solid var(--color-border)",
                      background: "var(--color-surface)", display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", fontSize: "14px", color: "var(--color-text-secondary)",
                    }}>+</button>
                  </div>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-primary)", minWidth: "55px", textAlign: "right" }}>
                    {fmt((Number(item.unitPrice) * Number(item.quantity)).toFixed(2))}
                  </span>
                  <button onClick={() => removeItem(item.productId)} style={{
                    width: "44px", height: "44px", borderRadius: "6px", border: "none",
                    background: "none", display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", color: "var(--color-text-tertiary)", flexShrink: 0,
                  }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>{t("Подитого", "Jami")}</span>
                <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)" }}>{fmt(subtotal.toFixed(2))}</span>
              </div>
              {totalWeightKg > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>{t("Вес", "Og'irlik")}</span>
                  <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)" }}>{totalWeightKg.toFixed(1)} кг</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "8px", borderTop: "1px solid var(--color-border)" }}>
                <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)" }}>{t("ИТОГО", "JAMI")}</span>
                <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-primary)" }}>{fmt(subtotal.toFixed(2))}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
