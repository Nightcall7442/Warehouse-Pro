import { useState } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { Package, Search, ShoppingCart } from "lucide-react";
import { OrderItem, unitLabel } from "./types";

interface ProductSelectorProps {
  items: OrderItem[];
  onChange: (items: OrderItem[]) => void;
}

export function ProductSelector({ items, onChange }: ProductSelectorProps) {
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { data: products } = trpc.product.list.useQuery({ page: 1, pageSize: 200 }) as { data: any };
  const [search, setSearch] = useState("");

  const filtered = (products?.data ?? []).filter((p: any) =>
    !search || p.name?.toLowerCase().includes(search.toLowerCase()) || (p.code ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const addToCart = (product: any) => {
    const existing = items.findIndex(i => i.productId === (product.id as number));
    if (existing >= 0) {
      const next = [...items];
      next[existing] = { ...next[existing], quantity: String(Number(next[existing].quantity) + 1) };
      onChange(next);
    } else {
      onChange([...items, {
        productId: product.id as number,
        productName: product.name as string,
        unitPrice: product.unitPrice as string,
        quantity: "1",
        available: (product.available as string) ?? "0",
        unit: (product.unit as string) ?? "pcs",
        unitWeight: Number(product.unitWeight ?? 0),
      }]);
    }
  };

  const updateQuantity = (productId: number, delta: number) => {
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
  };

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
          <Search size={14} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #98a0b8)", pointerEvents: "none" }} />
          <input
            className="neo-input"
            style={{ paddingLeft: "36px", width: "100%" }}
            placeholder={t("Поиск товаров…", "Mahsulot qidirish…")}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Product list */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "8px", maxHeight: "480px", overflowY: "auto" }}>
          {filtered.map((product: any) => {
            const inCart = items.find(i => i.productId === product.id);
            const lowStock = Number(product.available ?? 0) < 10;
            return (
              <div
                key={product.id}
                style={{
                  display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px",
                  borderRadius: "12px", cursor: "pointer", transition: "all 0.15s ease",
                  background: inCart ? "var(--color-primary-subtle, rgba(75,108,246,.10))" : "var(--color-surface, #ffffff)",
                  border: inCart ? "1px solid rgba(75,108,246,.30)" : "1px solid var(--color-border, #f0f3f8)",
                }}
                onClick={() => addToCart(product)}
              >
                <div style={{
                  width: "40px", height: "40px", borderRadius: "10px", display: "flex",
                  alignItems: "center", justifyContent: "center", flexShrink: 0,
                  background: inCart ? "rgba(75,108,246,.15)" : "var(--color-surface-light, #f0f3f8)",
                }}>
                  <Package size={18} style={{ color: inCart ? "#5b6d8a" : "var(--color-text-tertiary, #98a0b8)" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 500, fontSize: "13px", color: "var(--color-text-primary, #2b3450)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {product.name}
                  </p>
                  <p style={{ fontSize: "11px", color: "var(--color-text-secondary, #6a7290)", margin: "2px 0 0" }}>
                    {fmt(product.unitPrice)}/{unitLabel(product.unit, lang)}
                    {lowStock && <span style={{ color: "#d4973a", marginLeft: "8px" }}>⚠</span>}
                  </p>
                </div>
                {inCart ? (
                  <span style={{
                    background: "#5b6d8a", color: "#fff", borderRadius: "8px",
                    padding: "4px 10px", fontSize: "12px", fontWeight: 600,
                  }}>
                    ×{inCart.quantity}
                  </span>
                ) : (
                  <span style={{
                    background: "var(--color-surface-light, #f0f3f8)", color: "var(--color-text-secondary, #6a7290)",
                    borderRadius: "8px", padding: "4px 10px", fontSize: "12px", fontWeight: 500,
                  }}>
                    + {t("Добавить", "Qo'shish")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Cart */}
      <div style={{
        background: "var(--color-surface, #ffffff)", borderRadius: "24px", padding: "20px",
        boxShadow: "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06))",
        position: "sticky", top: "20px",
      }}>
        <div className="flex items-center justify-between mb-4">
          <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600, color: "var(--color-text-primary, #2b3450)", margin: 0 }}>
            {t("Корзина", "Savat")} ({validItems.length})
          </h3>
          {validItems.length > 0 && (
            <button onClick={() => onChange([])} style={{
              fontSize: "11px", color: "#d45050", background: "none",
              border: "none", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
            }}>
              {t("Очистить", "Tozalash")}
            </button>
          )}
        </div>

        {validItems.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "var(--color-text-tertiary, #98a0b8)" }}>
            <ShoppingCart size={32} style={{ margin: "0 auto 8px", opacity: 0.3 }} />
            <p style={{ fontSize: "13px" }}>{t("Корзина пуста", "Savat bo'sh")}</p>
            <p style={{ fontSize: "11px", marginTop: "4px" }}>{t("Нажмите на товар чтобы добавить", "Mahsulotni bosib qo'shing")}</p>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
              {validItems.map((item) => (
                <div key={item.productId} style={{
                  display: "flex", alignItems: "center", gap: "10px", padding: "10px",
                  borderRadius: "10px", background: "var(--color-surface-light, #f0f3f8)",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary, #2b3450)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.productName}
                    </p>
                    <p style={{ fontSize: "11px", color: "var(--color-text-secondary, #6a7290)", margin: "2px 0 0" }}>
                      {fmt(item.unitPrice)}/{unitLabel(item.unit, lang)}
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <button onClick={() => updateQuantity(item.productId, -1)} style={{
                      width: "24px", height: "24px", borderRadius: "6px", border: "1px solid var(--color-border, #dde2ec)",
                      background: "var(--color-surface, #ffffff)", display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", fontSize: "14px", color: "var(--color-text-secondary, #6a7290)",
                    }}>−</button>
                    <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #2b3450)", minWidth: "20px", textAlign: "center" }}>
                      {item.quantity}
                    </span>
                    <button onClick={() => updateQuantity(item.productId, 1)} style={{
                      width: "24px", height: "24px", borderRadius: "6px", border: "1px solid var(--color-border, #dde2ec)",
                      background: "var(--color-surface, #ffffff)", display: "flex", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", fontSize: "14px", color: "var(--color-text-secondary, #6a7290)",
                    }}>+</button>
                  </div>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary, #2b3450)", minWidth: "60px", textAlign: "right" }}>
                    {fmt((Number(item.unitPrice) * Number(item.quantity)).toFixed(0))}
                  </span>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div style={{ borderTop: "1px solid var(--color-border, #f0f3f8)", paddingTop: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                <span style={{ fontSize: "13px", color: "var(--color-text-secondary, #6a7290)" }}>{t("Подитого", "Jami")}</span>
                <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary, #2b3450)" }}>{fmt(subtotal.toFixed(0))}</span>
              </div>
              {totalWeightKg > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ fontSize: "13px", color: "var(--color-text-secondary, #6a7290)" }}>{t("Вес", "Og'irlik")}</span>
                  <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary, #2b3450)" }}>{totalWeightKg.toFixed(1)} кг</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "8px", borderTop: "1px solid var(--color-border, #f0f3f8)" }}>
                <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary, #2b3450)" }}>{t("ИТОГО", "JAMI")}</span>
                <span style={{ fontSize: "15px", fontWeight: 700, color: "#5b6d8a" }}>{fmt(subtotal.toFixed(0))}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
