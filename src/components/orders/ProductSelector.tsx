import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useCurrency } from "@/hooks/useCurrency";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { Package, Search, ShoppingCart, Plus, Minus, Trash2, ChevronUp, ChevronDown, X } from "lucide-react";
import { unitLabel } from "./types";
import type { OrderItem } from "./types";
import { formatQty } from "@/lib/format";
import { useOfflineCopy } from "@/hooks/useOfflineCopy";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../api/router";

type CatalogProduct = inferRouterOutputs<AppRouter>["product"]["listAll"][number];

interface ProductSelectorProps {
  items: OrderItem[];
  onChange: (items: OrderItem[]) => void;
  /** Открыта ли корзина. Признак только для мобильного: там корзина —
   *  выдвижная панель снизу, а не колонка сбоку, и открывает её кнопка-итог
   *  в нижней строке экрана «Новый заказ». Состояние живёт там же, в
   *  NewOrder, потому что кнопка и панель — в разных поддеревьях. */
  cartOpen?: boolean;
  onCartOpenChange?: (open: boolean) => void;
}

export function ProductSelector({ items, onChange, cartOpen = false, onCartOpenChange }: ProductSelectorProps) {
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { data: products, isLoading, isLoadingError, refetch } = trpc.product.listAll.useQuery(undefined);
  const [search, setSearch] = useState("");
  const [quickQty, setQuickQty] = useState<Record<number, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  // Без связи — отложенная копия каталога: иначе офлайн-заказ не из чего
  // собрать, а ради этого вкладка «Офлайн» и заведена.
  const { data: catalog, fromCopy } = useOfflineCopy<CatalogProduct[]>("catalog", products);

  const filtered = (catalog ?? []).filter((p) =>
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
    const next = [...items];
    const itemIdx = next.findIndex(i => i.productId === productId);
    if (itemIdx === -1) return;

    /*
      Пустое поле — это разрешённое промежуточное состояние, а не ошибка.

      Раньше на пустой строке parseFloat давал NaN, и функция выходила, не
      трогая состояние. Поле управляемое (value={item.quantity}), поэтому
      React возвращал в разметку прежнее число: агент жал стирание, а цифра
      не удалялась. Чтобы поменять 3 на 12, приходилось целиться курсором и
      дописывать вокруг старой цифры.

      Хранить пусто безопасно: строка с неположительным количеством и так
      отсеивается везде, где считается заказ, — и в проверке перехода на
      следующий шаг, и в итоговой сумме, и в том, что уходит на сервер
      (NewOrder.tsx, строки 174, 186, 221). Позиция просто не поедет в заказ,
      пока в ней не появится число, а «Продолжить» останется погашенной.
    */
    if (value === "") {
      next[itemIdx] = { ...next[itemIdx], quantity: "" };
      onChange(next);
      return;
    }

    const num = parseFloat(value);
    if (isNaN(num) || num < 0) return;
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

  // Пока панель корзины открыта, страница под ней стоит на месте, а Escape
  // её закрывает. overscroll-behavior: contain в стилях удерживает только
  // жест, дотянувший список корзины до края; без замка на body фон под
  // панелью всё равно уезжает вместе с пальцем.
  useEffect(() => {
    if (!cartOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCartOpenChange?.(false); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [cartOpen, onCartOpenChange]);

  /* Содержимое корзины. Одна разметка на два места вывода: боковая колонка
     на десктопе и выдвижная панель снизу на мобильном. Отличие ровно одно —
     крестик, который нужен только панели. */
  const renderCart = (inSheet: boolean) => (
    <>
      <div className="flex items-center justify-between mb-4 order-cart-head">
        <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "15px", fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
          {t("Корзина", "Savat")} ({validItems.length})
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {validItems.length > 0 && (
            <button onClick={() => onChange([])} style={{
              fontSize: "11px", color: "var(--color-danger-text)", background: "none",
              border: "none", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 500,
            }}>
              {t("Очистить", "Tozalash")}
            </button>
          )}
          {inSheet && (
            <button
              type="button"
              data-testid="cart-sheet-close"
              aria-label={t("Закрыть", "Yopish")}
              onClick={() => onCartOpenChange?.(false)}
              style={{
                width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0,
                border: "1px solid var(--color-border)", background: "var(--color-surface)",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", color: "var(--color-text-secondary)",
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>
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
              список, а не сама страница. У выдвижной панели прокрутка своя
              и уместная: панель сама и есть окно поверх страницы. */}
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
    </>
  );

  return (
    <div className="animate-fade-up order-grid">

      {/* Product catalog */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="font-label text-[10px] text-secondary tracking-wider">
            {t("КАТАЛОГ ТОВАРОВ", "MAHSULOTLAR KATALOGI")}
          </p>
          <span className="text-xs text-tertiary">
            {filtered.length} {t("товаров", "mahsulot")}
            {/* Остатки из копии могли устареть — предупреждаем прямо тут. */}
            {fromCopy && (
              <span data-testid="selector-offline-copy" style={{ color: "var(--color-warning-text)", marginLeft: "6px" }}>
                · {t("с устройства", "qurilmadan")}
              </span>
            )}
          </span>
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
        {/* Сетка карточек, а не список строк.
            Фотографии есть у 440 активных товаров из 487, но показывались
            квадратиком 40×40 в строке — разглядеть по нему бакалею нельзя,
            и агент всё равно читал название вроде «Сок 0,2 ябл.». В
            мобильном приложении карточки с крупным снимком, и веб от него
            отставал.
            auto-fill вместо жёсткого числа колонок: на телефоне помещается
            две, на широком экране — сколько влезет, при том что каталог
            здесь делит ширину с колонкой корзины. */}
        {/*
          Пока грузится и если не загрузилось — говорим об этом.

          Раньше у запроса брались только данные: на плохой связи агент видел
          «КАТАЛОГ ТОВАРОВ · 0 товаров», поиск и под ним пустоту. Грузится,
          сломалось или товаров правда нет — понять было неоткуда, и повторить
          нечем. Офлайн так и оставался навсегда, а значит и офлайновый заказ
          собрать было не из чего.

          isLoadingError, а не isError: сорванное ОБНОВЛЕНИЕ при уже
          загруженном каталоге ничего отнимать не должно — агент продолжает
          набирать заказ по тому, что в памяти.
        */}
        {isLoading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))", gap: "10px" }}>
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="animate-pulse" style={{ height: "196px", borderRadius: "12px", background: "var(--color-surface-light)" }} />
            ))}
          </div>
        )}

        {isLoadingError && !catalog?.length && (
          <div className="neo-card-static" style={{ padding: "24px", textAlign: "center" }}>
            <p style={{ margin: "0 0 12px", color: "var(--color-text-secondary)" }}>
              {t("Не удалось загрузить каталог", "Katalogni yuklab bo'lmadi")}
            </p>
            <button onClick={() => refetch()} className="neo-btn-primary tap" style={{ padding: "0 24px", borderRadius: "12px" }}>
              {t("Повторить", "Qayta urinish")}
            </button>
          </div>
        )}

        {!isLoading && !isLoadingError && filtered.length === 0 && (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-text-tertiary)" }}>
            <Package size={32} style={{ margin: "0 auto 10px", display: "block" }} />
            <p style={{ margin: 0 }}>
              {search
                ? t("Ничего не нашлось", "Hech narsa topilmadi")
                : t("Каталог пуст", "Katalog bo'sh")}
            </p>
          </div>
        )}

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
          gap: "10px",
          touchAction: "manipulation",
        }}>
          {filtered.map((product) => {
            const inCart = items.find(i => i.productId === product.id);
            const stock = Number(product.available ?? 0);
            const lowStock = stock < 10;
            /*
              Товара нет — в корзину он не идёт.

              Остаток резервируется при СОЗДАНИИ заказа, и при нехватке сервер
              отклоняет весь заказ целиком. То есть агент набирал корзину,
              договаривался с владельцем магазина, обещал привезти — и только
              на «Оформить» узнавал, что товара нет. Стоял он при этом уже у
              прилавка, а отказ приходил на весь заказ, а не на одну строку.

              Остаток здесь — со склада по умолчанию, и списывается заказ
              оттуда же (resolveOrderWarehouse в api/services/order.ts): число
              на экране и число, по которому решает сервер, — одно и то же.
            */
            const out = stock <= 0;
            const inputVal = quickQty[product.id] || "";
            return (
              <div
                key={product.id}
                data-testid={`product-row-${product.id}`}
                className="neo-card-sm"
                style={{
                  display: "flex", flexDirection: "column", gap: "8px", padding: "8px",
                  cursor: out ? "not-allowed" : "pointer", transition: "all 0.15s",
                  opacity: out ? 0.55 : 1,
                  // Полоска слева уступила место рамке: у карточки в сетке
                  // выделять надо всю её, а не один край.
                  border: inCart ? "2px solid var(--color-primary)" : "2px solid transparent",
                }}
                /*
                  Тап по карточке кладёт то, что НАБРАНО, а не одну штуку.

                  Раньше сюда шёл addToCart(product) без количества, то есть
                  всегда 1, и следом набранное в поле стиралось. Агент вбивал
                  «12», гасил клавиатуру тапом по этой же карточке — и в
                  корзину уходила одна штука. Заметить подмену можно было
                  только открыв корзину, а магазин получал одну пачку вместо
                  двенадцати.
                */
                onClick={() => {
                  if (inCart || out) return;
                  const typed = parseFloat(quickQty[product.id as number] ?? "");
                  addToCart(product, isNaN(typed) || typed <= 0 ? undefined : typed);
                }}
              >
                {/* Строка 1: значок, название, цена — во всю ширину карточки.
                    Раньше эта строка делила место с блоком количества, и на
                    длинных названиях (в этом каталоге они бывают за 40
                    знаков) колонка названия сжималась до ~150px и обрезалась
                    почти сразу после первого слова. Количество переехало
                    строкой ниже — здесь ему делить ширину не с кем. */}
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
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
                    width: "100%", aspectRatio: "1", borderRadius: "10px", display: "flex",
                    alignItems: "center", justifyContent: "center", overflow: "hidden",
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
                      <Package size={28} style={{ color: inCart ? "var(--color-primary-text)" : "var(--color-text-tertiary)" }} />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 500, fontSize: "13px", color: "var(--color-text-primary)", margin: 0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: "34px", lineHeight: "17px" }}>
                      {product.name}
                    </p>
                    <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", margin: "2px 0 0" }}>
                      {fmt(product.unitPrice)}/{unitLabel(product.unit, lang)}
                      {out
                        ? <span data-testid={`product-out-${product.id}`} style={{ color: "var(--color-danger-text)", marginLeft: "6px", fontWeight: 600 }}>{t("товар закончился", "mahsulot tugadi")}</span>
                        : lowStock && <span style={{ color: "var(--color-warning-text)", marginLeft: "6px" }}>⚠ {t("осталось", "qoldi")} {formatQty(product.available)}</span>}
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
                <div style={{ display: "grid", gridTemplateColumns: "44px 1fr 44px", gap: "4px", alignItems: "center" }}>
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

      {/* Корзина на десктопе — вторая колонка грида, рядом со списком.
          На мобильном этот блок скрыт совсем (order-cart-panel в index.css),
          и вот почему: в одну колонку он оказывался следующим блоком ПОД
          каталогом, то есть под двумя сотнями строк. Чтобы поправить в нём
          количество или убрать позицию, приходилось пролистать весь каталог
          вниз, а потом столько же обратно. Вместо этого на мобильном корзина
          открывается панелью снизу — кнопкой-итогом, которая видна всегда. */}
      <div className="neo-card order-cart-panel" style={{ padding: "20px" }}>
        {renderCart(false)}
      </div>

      {/* Корзина на мобильном — выдвижная панель снизу.

          Через портал в body, а не просто fixed-блоком на месте. Родитель
          здесь — .animate-fade-up, а это animation: fadeUp .3s ease forwards,
          и последний кадр у неё transform: translateY(0). Режим forwards
          оставляет этот кадр применённым навсегда, а любой transform, кроме
          none, делает элемент точкой отсчёта для position: fixed внутри.
          Панель отсчитывала бы «низ экрана» от низа списка товаров — то есть
          уезжала бы на несколько экранов вниз. AppModal рисуется порталом по
          той же причине.

          Сама себя панель не закрывает: признак живёт в NewOrder, там же он
          и сбрасывается при переходе на другой шаг мастера. */}
      {cartOpen && createPortal(
        <>
          <div
            className="order-cart-backdrop"
            data-testid="cart-sheet-backdrop"
            onClick={() => onCartOpenChange?.(false)}
          />
          {/* neo-card-static обязателен: без него .neo-card:active жмёт карточку
              до scale(0.99), а :active достаётся и предку нажатой кнопки —
              панель дёргалась бы и отлипала от нижнего края экрана при каждом
              касании «+» внутри неё. */}
          <div
            className="neo-card neo-card-static order-cart-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t("Корзина", "Savat")}
            data-testid="cart-sheet"
          >
            <div className="order-cart-sheet-grabber" />
            {renderCart(true)}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
