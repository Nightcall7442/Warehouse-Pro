import { useState, useRef, useCallback } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { Package, Search, ShoppingCart, Plus, Minus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { unitLabel } from "./types";
import type { OrderItem } from "./types";
import { formatQty } from "@/lib/format";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../api/router";

type CatalogProduct = inferRouterOutputs<AppRouter>["product"]["listAll"][number];

interface ProductSelectorProps {
  items: OrderItem[];
  onChange: (items: OrderItem[]) => void;
}

export function ProductSelector({ items, onChange }: ProductSelectorProps) {
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { data: products } = trpc.product.listAll.useQuery(undefined);
  const [search, setSearch] = useState("");
  const [quickQty, setQuickQty] = useState<Record<number, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = (products ?? []).filter((p) =>
    !search || p.name?.toLowerCase().includes(search.toLowerCase()) || (p.code ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const addToCart = useCallback((product: CatalogProduct, qty?: number) => {
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

  const moveItem = useCallback((productId: number, direction: -1 | 1) => {
    const validOnly = items.filter(i => i.productId > 0);
    const posInValid = validOnly.findIndex(i => i.productId === productId);
    const newPos = posInValid + direction;
    if (newPos < 0 || newPos >= validOnly.length) return;

    const targetProductId = validOnly[newPos].productId;
    const fromIdx = items.findIndex(i => i.productId === productId);
    const toIdx = items.findIndex(i => i.productId === targetProductId);
    const next = [...items];
    [next[fromIdx], next[toIdx]] = [next[toIdx], next[fromIdx]];
    onChange(next);
  }, [items, onChange]);

  const handleQuickAdd = useCallback((product: CatalogProduct) => {
    const qty = parseFloat(quickQty[product.id] || "1");
    if (isNaN(qty) || qty <= 0) return;
    addToCart(product, qty);
    searchRef.current?.focus();
  }, [quickQty, addToCart]);

  const validItems = items.filter(i => i.productId > 0);
  const totalWeightKg = validItems.reduce((s, i) => s + Number(i.quantity) * (i.unitWeight || 1), 0);
  const subtotal = validItems.reduce((s, i) => s + Number(i.unitPrice) * Number(i.quantity), 0);

  return (
    <div className="animate-fade-up order-grid">

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
            data-testid="product-search"
            ref={searchRef}
            className="neo-input"
            style={{ paddingLeft: "36px", width: "100%" }}
            placeholder={t("Поиск по названию или коду…", "Nomi yoki kodi bo'yicha qidirish…")}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Product list.
            Раньше здесь стоял maxHeight: 520px, overflowY: auto — отдельная
            прокрутка внутри карточки, поверх обычной прокрутки страницы. При
            двухстах товарах в списке это давало вложенный скролл: пролистав
            520 пикселей до упора, пользователь упирался в невидимую
            границу, а не в конец списка, и должен был сообразить прокрутить
            уже саму страницу, чтобы список продолжился. Список теперь течёт
            в общей прокрутке страницы, как и всё остальное на ней. */}
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", touchAction: "manipulation" }}>
          {filtered.map((product) => {
            const inCart = items.find(i => i.productId === product.id);
            const lowStock = Number(product.available ?? 0) < 10;
            const inputVal = quickQty[product.id] || "";
            return (
              <div
                key={product.id}
                data-testid={`product-row-${product.id}`}
                className="neo-card-sm"
                style={{
                  display: "flex", flexDirection: "column", gap: "8px", padding: "10px 12px",
                  cursor: "pointer", transition: "all 0.15s",
                  borderLeft: inCart ? "3px solid var(--color-primary)" : "3px solid transparent",
                }}
                onClick={() => !inCart && addToCart(product)}
              >
                {/* Строка 1: значок, название, цена — во всю ширину карточки.
                    Раньше эта строка делила место с блоком количества, и на
                    длинных названиях (в этом каталоге они бывают за 40
                    знаков) колонка названия сжималась до ~150px и обрезалась
                    почти сразу после первого слова. Количество переехало
                    строкой ниже — здесь ему делить ширину не с кем. */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {/* Фотография товара, если она есть.
                      photoUrl приходит из product.listAll готовым адресом
                      (api/lib/photo-url.ts: либо ссылка на /api/photos/…, либо
                      внешний адрес как есть) — здесь его достаточно подставить.
                      Раньше на этом месте всегда рисовался значок-коробка, и
                      каталог выглядел одинаково серым, хотя фото у товаров
                      есть — в мобильном приложении они показываются.

                      Не ProductPhoto из components/products: тот компонент
                      предназначен для правки — клик по нему открывает выбор
                      файла и грузит снимок через product.uploadPhoto, а это
                      право оператора. Агенту в каталоге нужен только просмотр.

                      loading="lazy" обязателен: в списке две сотни строк, и без
                      него браузер полез бы за всеми снимками сразу. */}
                  <div style={{
                    width: "40px", height: "40px", borderRadius: "8px", display: "flex",
                    alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden",
                    background: inCart ? "var(--color-primary-subtle)" : "var(--color-surface-light)",
                  }}>
                    {product.photoUrl ? (
                      <img
                        src={product.photoUrl as string}
                        alt=""
                        loading="lazy"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <Package size={16} style={{ color: inCart ? "var(--color-primary-text)" : "var(--color-text-tertiary)" }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 500, fontSize: "13px", color: "var(--color-text-primary)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {product.name}
                    </p>
                    <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", margin: "2px 0 0" }}>
                      {fmt(product.unitPrice)}/{unitLabel(product.unit, lang)}
                      {lowStock && <span style={{ color: "var(--color-warning-text)", marginLeft: "6px" }}>⚠ {t("мало", "kam")}</span>}
                    </p>
                  </div>
                </div>

                {/* Строка 2: количество — всегда одна и та же сетка справа.
                    grid из трёх колонок 44/52/44, а не flex: у товара в
                    корзине элементов три (−, поле, +), а у ещё не
                    добавленного — два (поле, +). На flex они прижимались
                    вправо каждый по-своему, и в списке, где соседние строки
                    в разном состоянии, кнопки «+» стояли на разной высоте и
                    на разном отступе от края — именно эта рассинхронность и
                    читается как «неровно». Сетка фиксирует колонки, поэтому
                    поле ввода и «+» стоят на одном месте в любой строке;
                    у не добавленного товара первая колонка просто пустая. */}
                <div style={{ display: "grid", gridTemplateColumns: "44px 52px 44px", gap: "4px", justifyContent: "end", alignItems: "center" }}>
                  {inCart ? (
                    <>
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
                        style={{ width: "52px", height: "44px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-surface)", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)", fontFamily: "'DM Sans', sans-serif", outline: "none" }}
                      />
                      <button onClick={(e) => { e.stopPropagation(); updateQuantity(product.id, 1); }}
                        style={{ width: "44px", height: "44px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-surface)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--color-text-secondary)" }}>
                        <Plus size={16} />
                      </button>
                    </>
                  ) : (
                    /* Quick add: input qty + Enter. Первая колонка пустая —
                       кнопки «−» тут нет, но место под неё держится, чтобы
                       поле и «+» не съезжали относительно соседних строк. */
                    <>
                      <span />
                      <input
                        data-testid={`product-qty-${product.id}`}
                        type="number"
                        min="1"
                        placeholder="1"
                        value={inputVal}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setQuickQty(prev => ({ ...prev, [product.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") handleQuickAdd(product); }}
                        style={{ width: "52px", height: "44px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-surface)", textAlign: "center", fontSize: "12px", color: "var(--color-text-primary)", fontFamily: "'DM Sans', sans-serif", outline: "none" }}
                      />
                      <button data-testid={`product-add-${product.id}`} onClick={(e) => { e.stopPropagation(); handleQuickAdd(product); }}
                        style={{ width: "44px", height: "44px", borderRadius: "6px", border: "none", background: "var(--color-primary)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--color-on-primary, #ffffff)" }}>
                        <Plus size={16} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cart.
          position/top переехали в класс order-cart-panel (index.css): sticky
          нужен только на десктопе, где корзина — боковая колонка грида. На
          мобильном она безусловно прилипала под мобильной шапкой (z-40) и
          пряталась под ней при прокрутке верхними ~36 пикселями. */}
      <div className="neo-card order-cart-panel" style={{ padding: "20px" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
            {t("Корзина", "Savat")} ({validItems.length})
          </h3>
          {validItems.length > 0 && (
            <button onClick={() => onChange([])} style={{
              fontSize: "11px", color: "var(--color-danger-text)", background: "none",
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
            {/* Раньше вся строка — название, шаг количества (3×44px), сумма,
                стрелки порядка, корзина — стояла в один ряд. На узком экране
                это тот же зажим, что был у строки каталога: имени оставалось
                места меньше, чем самим кнопкам управления им. Теперь имя с
                ценой и сумма строки — наверху во всю ширину, управление —
                отдельной строкой ниже, где ему не тесно.

                maxHeight: 320px, overflowY: auto тоже убраны — по той же
                причине, что и у списка каталога: своя прокрутка внутри
                карточки поверх прокрутки страницы путает, где заканчивается
                список, а не сама страница. */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px", touchAction: "manipulation" }}>
              {validItems.map((item) => (
                <div key={item.productId} style={{
                  display: "flex", flexDirection: "column", gap: "6px", padding: "10px",
                  borderRadius: "8px", background: "var(--color-surface-light)",
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.productName}
                      </p>
                      <p style={{ fontSize: "10px", color: "var(--color-text-secondary)", margin: "1px 0 0" }}>
                        {fmt(item.unitPrice)}/{unitLabel(item.unit, lang)}
                      </p>
                    </div>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)", flexShrink: 0 }}>
                      {fmt((Number(item.unitPrice) * Number(item.quantity)).toFixed(2))}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
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
                        style={{ width: "52px", height: "44px", borderRadius: "6px", border: "1px solid var(--color-border)", background: "var(--color-surface)", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)", fontFamily: "'DM Sans', sans-serif", outline: "none" }}
                      />
                      <button onClick={() => updateQuantity(item.productId, 1)} style={{
                        width: "44px", height: "44px", borderRadius: "6px", border: "1px solid var(--color-border)",
                        background: "var(--color-surface)", display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer", fontSize: "14px", color: "var(--color-text-secondary)",
                      }}>+</button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "3px", flexShrink: 0 }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
                        <button onClick={() => moveItem(item.productId, -1)} style={{
                          width: "24px", height: "21px", borderRadius: "4px 4px 0 0", border: "1px solid var(--color-border)",
                          background: "var(--color-surface)", display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer", color: "var(--color-text-tertiary)",
                        }}>
                          <ChevronUp size={12} />
                        </button>
                        <button onClick={() => moveItem(item.productId, 1)} style={{
                          width: "24px", height: "21px", borderRadius: "0 0 4px 4px", border: "1px solid var(--color-border)",
                          background: "var(--color-surface)", display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer", color: "var(--color-text-tertiary)",
                        }}>
                          <ChevronDown size={12} />
                        </button>
                      </div>
                      <button onClick={() => removeItem(item.productId)} style={{
                        width: "44px", height: "44px", borderRadius: "6px", border: "none",
                        background: "none", display: "flex", alignItems: "center", justifyContent: "center",
                        cursor: "pointer", color: "var(--color-text-tertiary)",
                      }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
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
                  <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)" }}>{formatQty(totalWeightKg)} кг</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "8px", borderTop: "1px solid var(--color-border)" }}>
                <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)" }}>{t("ИТОГО", "JAMI")}</span>
                <span style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-primary-text)" }}>{fmt(subtotal.toFixed(2))}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
