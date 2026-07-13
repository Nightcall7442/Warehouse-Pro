import { useState, useMemo } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate, useSearchParams } from "react-router";
import { useLang } from "@/i18n";
import {
  CheckCircle2, Loader2, WifiOff,
  Store, Package, Search, AlertCircle, ShoppingCart,
} from "lucide-react";
import { savePendingOrder } from "./OfflineOrders.helpers";

interface OrderItem {
  productId:   number;
  quantity:    string;
  unitPrice:   string;
  productName: string;
  available:   string;
  unit:        string;    // "pcs", "kg", "l", "box", "pack", "m"
  unitWeight:  number;    // вес 1 единицы в кг (для штучных товаров)
}

const UNIT_LABELS: Record<string, { ru: string; uz: string; short: string }> = {
  kg:   { ru: "кг",      uz: "kg",   short: "кг" },
  l:    { ru: "литр",    uz: "litr", short: "л" },
  pcs:  { ru: "шт",      uz: "dona", short: "шт" },
  box:  { ru: "ящ",      uz: "quti", short: "ящ" },
  pack: { ru: "упак",    uz: "pach", short: "упак" },
  m:    { ru: "метр",    uz: "metr", short: "м" },
};

function unitLabel(unit: string | undefined, lang: "ru" | "uz"): string {
  const e = UNIT_LABELS[unit ?? "pcs"];
  return e ? (lang === "uz" ? e.uz : e.ru) : (unit ?? "шт");
}

const EMPTY_ITEM: OrderItem = {
  productId: 0, quantity: "", unitPrice: "",
  productName: "", available: "0", unit: "pcs", unitWeight: 0,
};

// ── Step indicator — premium Apple-style ──────────────────────────────────────
function Steps({ current, labels }: { current: number; labels: string[] }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: "32px" }}>
      {labels.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", flex: 1 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", flexShrink: 0 }}>
              <div style={{
                width: "36px", height: "36px", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "13px", fontWeight: 700, fontFamily: "'DM Sans', sans-serif",
                transition: "all 0.3s ease",
                background: done ? "#4b6cf6" : active ? "var(--color-primary-subtle, rgba(75,108,246,.10))" : "var(--color-surface-light, #f0f3f8)",
                color: done ? "#fff" : active ? "#4b6cf6" : "var(--color-text-tertiary, #98a0b8)",
                boxShadow: done ? "0 4px 12px rgba(75,108,246,0.3)" : active ? "0 0 0 3px rgba(75,108,246,.15)" : "none",
              }}>
                {done ? <CheckCircle2 size={18} /> : step}
              </div>
              <span style={{
                fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em",
                fontFamily: "'DM Sans', sans-serif", textTransform: "uppercase",
                color: active ? "#4b6cf6" : done ? "#4b6cf6" : "var(--color-text-tertiary, #98a0b8)",
              }}>
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div style={{
                flex: 1, height: "2px", margin: "0 8px", marginBottom: "20px",
                borderRadius: "1px", transition: "all 0.3s ease",
                background: step < current ? "#4b6cf6" : "var(--color-border, #f0f3f8)",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Выбор магазина — premium design ───────────────────────────────────
function StepShop({
  shopId, onSelect,
}: {
  shopId: number;
  onSelect: (id: number, name: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { user } = useAuth();
  const isAgent = user?.role === "agent" || user?.role === "merchandiser";

  const { data: myShops, isLoading: myShopsLoading } = trpc.agent.myShops.useQuery(undefined, { enabled: isAgent }) as { data: any; isLoading: boolean };
  const { data: allShopsData, isLoading: allShopsLoading } = trpc.shop.list.useQuery({ page: 1, pageSize: 200 }, { enabled: !isAgent }) as { data: any; isLoading: boolean };

  const shops = isAgent ? myShops : allShopsData?.data;
  const isLoading = isAgent ? myShopsLoading : allShopsLoading;

  const cities = useMemo(() => {
    const set = new Set<string>();
    (shops ?? []).forEach((s: any) => { if (s.city) set.add(s.city); });
    return Array.from(set).sort();
  }, [shops]);

  const filtered = useMemo(() => {
    return (shops ?? []).filter((s: any) => {
      const matchCity = !selectedCity || s.city === selectedCity;
      const matchSearch = !search ||
        s.name?.toLowerCase().includes(search.toLowerCase()) ||
        s.ownerName?.toLowerCase().includes(search.toLowerCase()) ||
        s.district?.toLowerCase().includes(search.toLowerCase());
      return matchCity && matchSearch;
    });
  }, [shops, selectedCity, search]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Заголовок */}
      <div>
        <h2 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "20px", fontWeight: 700, color: "var(--color-text-primary, #2b3450)", margin: "0 0 4px", letterSpacing: "-0.02em" }}>
          {t("Выберите магазин", "Do'kon tanlang")}
        </h2>
        <p style={{ fontSize: "13px", color: "var(--color-text-tertiary, #98a0b8)", margin: 0 }}>
          {t("Для которого оформляем заказ", "Buyurtma uchun do'kon")}
        </p>
      </div>

      {/* Города — premium pills */}
      {cities.length > 0 && (
        <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "4px" }}>
          <button onClick={() => setSelectedCity(null)} style={{
            flexShrink: 0, padding: "8px 18px", borderRadius: "24px", fontSize: "13px", fontWeight: 600,
            fontFamily: "'DM Sans', sans-serif", cursor: "pointer", transition: "all 0.25s ease",
            background: !selectedCity ? "linear-gradient(135deg, #4b6cf6, #4b6cf6)" : "var(--color-surface-light, #f0f3f8)",
            color: !selectedCity ? "#fff" : "var(--color-text-secondary, #6a7290)",
            border: "none", boxShadow: !selectedCity ? "0 4px 12px rgba(75,108,246,0.3)" : "none",
          }}>
            {t("Все", "Barchasi")}
          </button>
          {cities.map(city => (
            <button key={city} onClick={() => setSelectedCity(selectedCity === city ? null : city)} style={{
              flexShrink: 0, padding: "8px 18px", borderRadius: "24px", fontSize: "13px", fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif", cursor: "pointer", transition: "all 0.25s ease",
              background: selectedCity === city ? "linear-gradient(135deg, #4b6cf6, #4b6cf6)" : "var(--color-surface-light, #f0f3f8)",
              color: selectedCity === city ? "#fff" : "var(--color-text-secondary, #6a7290)",
              border: "none", boxShadow: selectedCity === city ? "0 4px 12px rgba(75,108,246,0.3)" : "none",
            }}>
              {city}
            </button>
          ))}
        </div>
      )}

      {/* Поиск */}
      <div style={{ position: "relative" }}>
        <Search size={16} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #98a0b8)", pointerEvents: "none" }} />
        <input
          style={{
            width: "100%", padding: "12px 14px 12px 42px", borderRadius: "14px",
            background: "var(--color-surface-light, #f0f3f8)", border: "2px solid transparent",
            fontSize: "14px", fontFamily: "'DM Sans', sans-serif", color: "var(--color-text-primary, #2b3450)",
            outline: "none", transition: "all 0.2s ease",
          }}
          placeholder={t("Поиск магазинов…", "Do'kon qidirish…")}
          value={search}
          onChange={e => setSearch(e.target.value)}
          onFocus={e => { e.currentTarget.style.borderColor = "#4b6cf6"; e.currentTarget.style.boxShadow = "0 0 0 4px rgba(75,108,246,0.1)"; e.currentTarget.style.background = "var(--color-surface, #ffffff)"; }}
          onBlur={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.boxShadow = "none"; e.currentTarget.style.background = "var(--color-surface-light, #f0f3f8)"; }}
        />
      </div>

      {/* Счётчик */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #98a0b8)", fontFamily: "'DM Sans', sans-serif", margin: 0 }}>
          {filtered?.length ?? 0} {t("магазинов", "do'kon")}
        </p>
        {selectedCity && (
          <button onClick={() => setSelectedCity(null)} style={{
            fontSize: "11px", color: "#4b6cf6", background: "none", border: "none",
            cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 600, padding: 0,
          }}>
            {t("Сбросить", "Tozalash")} ×
          </button>
        )}
      </div>

      {/* Список магазинов */}
      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ height: "72px", background: "var(--color-surface-light, #f0f3f8)", borderRadius: "16px" }} className="animate-pulse" />
          ))}
        </div>
      ) : filtered?.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0" }}>
          <div style={{
            width: "64px", height: "64px", borderRadius: "24px", display: "flex",
            alignItems: "center", justifyContent: "center", margin: "0 auto 12px",
            background: "var(--color-surface-light, #f0f3f8)",
          }}>
            <Store size={28} style={{ color: "var(--color-text-tertiary, #98a0b8)", opacity: 0.4 }} />
          </div>
          <p style={{ fontSize: "14px", fontWeight: 500, color: "var(--color-text-secondary, #6a7290)", margin: "0 0 4px" }}>
            {selectedCity ? t("Нет магазинов в этом городе", "Bu shaharda do'kon yo'q") : t("Магазины не найдены", "Do'kon topilmadi")}
          </p>
          <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #98a0b8)" }}>
            {t("Попробуйте другой фильтр", "Boshqa filtringizni sinab ko'ring")}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "420px", overflowY: "auto", paddingBottom: "4px" }}>
          {filtered?.map((shop: any) => (
            <button
              key={shop.id}
              onClick={() => onSelect(shop.id, shop.name ?? "")}
              style={{
                width: "100%", padding: "16px", textAlign: "left", display: "flex", alignItems: "center", gap: "14px",
                borderRadius: "16px", cursor: "pointer", transition: "all 0.25s cubic-bezier(0.25,0.46,0.45,0.94)",
                border: shopId === shop.id ? "2px solid #4b6cf6" : "2px solid transparent",
                background: shopId === shop.id ? "var(--color-primary-subtle, rgba(75,108,246,.10))" : "var(--color-surface, #ffffff)",
                boxShadow: shopId === shop.id
                  ? "0 4px 16px rgba(75,108,246,0.12)"
                  : "0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)",
              }}
            >
              <div style={{
                width: "44px", height: "44px", borderRadius: "12px", display: "flex",
                alignItems: "center", justifyContent: "center", flexShrink: 0,
                background: shopId === shop.id ? "linear-gradient(135deg, #4b6cf6, #4b6cf6)" : "var(--color-surface-light, #f0f3f8)",
                boxShadow: shopId === shop.id ? "0 4px 12px rgba(75,108,246,0.25)" : "none",
              }}>
                <Store size={20} style={{ color: shopId === shop.id ? "#fff" : "var(--color-text-secondary, #6a7290)" }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 600, fontSize: "14px", color: "var(--color-text-primary, #2b3450)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {shop.name}
                </p>
                <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "12px", color: "var(--color-text-secondary, #6a7290)", margin: "3px 0 0" }}>
                  {shop.ownerName ?? "—"}
                  {shop.district ? ` · ${shop.district}` : ""}
                  {shop.city ? `, ${shop.city}` : ""}
                </p>
                {Number(shop.debt ?? 0) > 0 && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginTop: "6px", padding: "3px 8px", borderRadius: "6px", background: "rgba(232,80,80,0.08)" }}>
                    <AlertCircle size={10} style={{ color: "#e85050" }} />
                    <span style={{ fontSize: "11px", fontWeight: 600, color: "#e85050" }}>
                      {fmt(shop.debt)} {t("долг", "qarz")}
                    </span>
                  </div>
                )}
              </div>
              {shopId === shop.id && (
                <div style={{
                  width: "28px", height: "28px", borderRadius: "50%", flexShrink: 0,
                  background: "#4b6cf6", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Step 2: Каталог + Корзина ─────────────────────────────────────────────────
function StepItems({
  items, onChange,
}: {
  items: OrderItem[];
  onChange: (items: OrderItem[]) => void;
}) {
  const { fmt }  = useCurrency();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { data: products } = trpc.product.list.useQuery({ page: 1, pageSize: 200 }) as { data: any };
  const [search, setSearch] = useState("");

  const filtered = (products?.data ?? []).filter((p: any) =>
    !search || p.name?.toLowerCase().includes(search.toLowerCase()) || (p.code ?? "").toLowerCase().includes(search.toLowerCase())
  );

  // Добавить товар в корзину
  const addToCart = (product: any) => {
    const existing = items.findIndex(i => i.productId === (product.id as number));
    if (existing >= 0) {
      // Уже в корзине — увеличить количество на 1
      const next = [...items];
      next[existing] = { ...next[existing], quantity: String(Number(next[existing].quantity) + 1) };
      onChange(next);
    } else {
      // Новый товар — добавить с количеством 1
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

  // Обновить количество в корзине по productId
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

  // Только валидные товары
  const validItems = items.filter(i => i.productId > 0);

  // Общий вес
  const totalWeightKg = validItems.reduce((s, i) => s + Number(i.quantity) * (i.unitWeight || 1), 0);

  // Итого
  const subtotal = validItems.reduce((s, i) => s + Number(i.unitPrice) * Number(i.quantity), 0);

  return (
    <div className="animate-fade-up order-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: "20px", alignItems: "start" }}>
      <style>{`@media (min-width: 768px) { .order-grid { grid-template-columns: 1fr 320px !important; } }`}</style>
      {/* ── Каталог товаров ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="font-label text-[10px] text-text-secondary tracking-wider">
            {t("КАТАЛОГ ТОВАРОВ", "MAHSULOTLAR KATALOGI")}
          </p>
          <span className="text-xs text-text-tertiary">{filtered.length} {t("товаров", "mahsulot")}</span>
        </div>

        {/* Поиск */}
        <div style={{ position: "relative", marginBottom: "12px" }}>
          <Search size={14} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #98a0b8)", pointerEvents: "none" }} />
          <input
            className="input-field"
            style={{ paddingLeft: "36px", width: "100%" }}
            placeholder={t("Поиск товаров…", "Mahsulot qidirish…")}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Список товаров */}
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
                  <Package size={18} style={{ color: inCart ? "#4b6cf6" : "var(--color-text-tertiary, #98a0b8)" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontWeight: 500, fontSize: "13px", color: "var(--color-text-primary, #2b3450)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {product.name}
                  </p>
                  <p style={{ fontSize: "11px", color: "var(--color-text-secondary, #6a7290)", margin: "2px 0 0" }}>
                    {fmt(product.unitPrice)}/{unitLabel(product.unit, lang)}
                    {lowStock && <span style={{ color: "#e8a830", marginLeft: "8px" }}>⚠</span>}
                  </p>
                </div>
                {inCart ? (
                  <span style={{
                    background: "#4b6cf6", color: "#fff", borderRadius: "8px",
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

      {/* ── Корзина ── */}
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
              fontSize: "11px", color: "#e85050", background: "none",
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

            {/* Итого */}
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
                <span style={{ fontSize: "15px", fontWeight: 700, color: "#4b6cf6" }}>{fmt(subtotal.toFixed(0))}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Step 3: Проверка ──────────────────────────────────────────────────────────
function StepReview({
  shopName, items, notes, onNotesChange, discount, onDiscountChange,
}: {
  shopName: string; items: OrderItem[];
  notes: string; onNotesChange: (v: string) => void;
  discount: string; onDiscountChange: (v: string) => void;
}) {
  const { fmt }  = useCurrency();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const validItems = items.filter(i => i.productId > 0 && Number(i.quantity) > 0);
  const subtotal   = validItems.reduce((s, i) => s + Number(i.unitPrice) * Number(i.quantity), 0);
  const disc       = Math.min(Number(discount || 0), subtotal);
  const total      = subtotal - disc;

  // Общий вес
  const totalWeightKg = validItems.reduce((s, i) => {
    return s + Number(i.quantity) * (i.unitWeight || 1);
  }, 0);

  return (
    <div className="space-y-4 animate-fade-up">
      <p className="font-label text-[10px] text-text-secondary tracking-wider">
        {t("ПОДТВЕРЖДЕНИЕ ЗАКАЗА", "BUYURTMANI TASDIQLASH")}
      </p>

      <div className="panel p-4 space-y-3">
        {/* Shop */}
        <div className="flex items-center gap-2.5 pb-3" style={{ borderBottom: "1px solid var(--color-border, #f0f3f8)" }}>
          <Store size={14} className="text-text-secondary flex-shrink-0"/>
          <span className="text-sm text-text-primary font-medium">{shopName}</span>
        </div>

        {/* Items */}
        <div className="space-y-2.5">
          {validItems.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-sm gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-text-primary truncate">{item.productName}</p>
                <p className="text-xs text-text-secondary font-data mt-0.5">
                  {item.quantity} {unitLabel(item.unit, lang)} × {fmt(item.unitPrice)}
                </p>
              </div>
              <span className="font-data text-text-primary font-medium flex-shrink-0">
                {fmt((Number(item.unitPrice) * Number(item.quantity)).toFixed(2))}
              </span>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="space-y-2 pt-3" style={{ borderTop: "1px solid var(--color-border, #f0f3f8)" }}>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">{t("Подитого", "Jami")}</span>
            <span className="font-data text-text-primary">{fmt(subtotal.toFixed(2))}</span>
          </div>
          {/* Discount field */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-text-secondary flex-shrink-0">{t("Скидка", "Chegirma")}</span>
            <div className="relative w-28">
              <input
                className="input-field text-right font-data py-1.5 text-sm"
                type="number"
                min="0"
                max={subtotal}
                step="0.01"
                placeholder="0.00"
                value={discount}
                onChange={e => onDiscountChange(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-between pt-1">
            <span className="font-semibold text-text-primary">{t("ИТОГО", "JAMI")}</span>
            <span className="font-data text-xl font-bold text-primary">{fmt(total.toFixed(2))}</span>
          </div>
          {totalWeightKg > 0 && (
            <div className="flex justify-between pt-1">
              <span className="text-sm text-text-secondary">{t("Общий вес", "Umumiy og'irlik")}</span>
              <span className="font-data text-sm font-semibold text-primary">{totalWeightKg.toFixed(2)} кг</span>
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">
          {t("ПРИМЕЧАНИЯ (ОПЦИОНАЛЬНО)", "ESLATMALAR (IXTIYORIY)")}
        </label>
        <textarea
          className="input-field w-full resize-none"
          rows={3}
          placeholder={t("Особые инструкции…", "Maxsus ko'rsatmalar…")}
          value={notes}
          onChange={e => onNotesChange(e.target.value)}
        />
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
const LABELS_RU = ["Магазин", "Товары", "Итог"];
const LABELS_UZ = ["Do'kon", "Mahsulotlar", "Xulosa"];

export default function NewOrder() {
  const { user }       = useAuth();
  const { lang }       = useLang();
  const navigate       = useNavigate();
  const [searchParams] = useSearchParams();

  const initialShopId = Number(searchParams.get("shopId") ?? 0);
  const [step,     setStep]     = useState(initialShopId > 0 ? 2 : 1);
  const [shopId,   setShopId]   = useState(initialShopId);
  const [shopName, setShopName] = useState("");
  const [items,    setItems]    = useState<OrderItem[]>([{ ...EMPTY_ITEM }]);
  const [notes,    setNotes]    = useState("");
  const [discount, setDiscount] = useState("0");
  // #FIX1-IDEMPOTENCY: Generate key once per form session, survives retries
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const LABELS = lang === "uz" ? LABELS_UZ : LABELS_RU;

  const utils = trpc.useUtils();
  const createOrder = trpc.order.create.useMutation({
    onSuccess: () => {
      utils.order.list.invalidate();
      notify.success(t("Заказ создан!", "Buyurtma yaratildi!"));
      navigate("/agent");
    },
    onError: (e) => notify.error(e.message),
  });

  // shopId из URL обрабатывается при инициализации state выше

  const canNext = () => {
    if (step === 1) return shopId > 0;
    if (step === 2) return items.some(i => i.productId > 0 && Number(i.quantity) > 0);
    return true;
  };

  const handleNext = () => {
    if (step < 3) { setStep(s => s + 1); return; }

    const payload = {
      shopId,
      agentId: user?.id ?? 0,
      idempotencyKey,
      items:   items
        .filter(i => i.productId > 0 && Number(i.quantity) > 0)
        .map(i => ({ productId: i.productId, quantity: i.quantity })),
      notes:    notes || undefined,
      discount: discount || "0",
    };

    if (!navigator.onLine) {
      savePendingOrder({ ...payload, shopName })
        .then(() => {
          notify.success(t("Заказ сохранён офлайн", "Buyurtma oflayn saqlandi"));
          navigate("/agent");
        })
        .catch(() => notify.error(t("Ошибка сохранения", "Saqlashda xato")));
      return;
    }

    createOrder.mutate(payload);
  };

  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

  return (
    <div className="max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => step > 1 ? setStep(s => s - 1) : navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-lg border btn-ghost flex-shrink-0"
          style={{ borderColor: "var(--color-border, #dde2ec)" }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M10 3L5 8l5 5"/>
          </svg>
        </button>
        <div>
          <h1 className="font-display text-xl font-bold text-text-primary tracking-tight">
            {t("Новый заказ", "Yangi buyurtma")}
          </h1>
          {shopName && step > 1 && (
            <p className="text-xs text-text-secondary mt-0.5">{shopName}</p>
          )}
        </div>
        {isOffline && (
          <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
            style={{ background: "var(--color-warning-subtle, rgba(251,191,36,.10))", color: "#e8a830" }}>
            <WifiOff size={12}/>
            {t("Офлайн", "Oflayn")}
          </div>
        )}
      </div>

      <Steps current={step} labels={LABELS}/>

      {/* Content */}
      <div className="min-h-[320px]">
        {step === 1 && (
          <StepShop
            shopId={shopId}
            onSelect={(id, name) => { setShopId(id); setShopName(name); }}
          />
        )}
        {step === 2 && <StepItems items={items} onChange={setItems}/>}
        {step === 3 && (
          <StepReview
            shopName={shopName}
            items={items}
            notes={notes}
            onNotesChange={setNotes}
            discount={discount}
            onDiscountChange={setDiscount}
          />
        )}
      </div>

      {/* Sticky CTA */}
      <div className="mt-6" style={{ marginBottom: "calc(60px + env(safe-area-inset-bottom, 0px) + 16px)" }}>
        <button
          onClick={handleNext}
          disabled={!canNext() || createOrder.isPending}
          className="btn-primary w-full py-3.5 text-[15px] disabled:opacity-40"
        >
          {createOrder.isPending
            ? <><Loader2 size={16} className="animate-spin inline mr-2"/>
                {t("Отправка…", "Yuborilmoqda…")}</>
            : step === 3
            ? t(isOffline ? "Сохранить офлайн" : "Подтвердить заказ",
                isOffline ? "Oflayn saqlash" : "Buyurtmani tasdiqlash")
            : t("Продолжить →", "Davom etish →")}
        </button>
      </div>
    </div>
  );
}
