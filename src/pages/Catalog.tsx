import { useState, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useTranslate } from "@/i18n";
import { Package, Search, X, Plus, Minus } from "lucide-react";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { QuickOrderModal } from "@/components/orders";
import { formatQty } from "@/lib/format";
import { unitLabel } from "@/components/orders/types";
import { useLang } from "@/i18n";
import { createPortal } from "react-dom";
import { useOfflineCopy } from "@/hooks/useOfflineCopy";

/* ═══════════════════════════════════════════════════════════════════════════
   КАТАЛОГ АГЕНТА — то, чем он пользуется у прилавка.

   Пункт «Каталог» в нижней панели вёл на /products — админскую страницу
   товаров. Она начинается с четырёх плиток статистики («всего товаров»,
   «с категориями», «низкий остаток» и «сессия: р.1»), которые агенту не
   говорят ничего, а занимают два экрана прокрутки до первого товара.
   Дальше идёт список строк, где название сжато ценой до «Банан Э…», а
   вместо фотографии — серый значок коробки, хотя снимки есть у девяти
   товаров из десяти.

   Здесь — как в приложении: сетка карточек с фотографией во всю ширину,
   поиск, категории. Нажатие открывает карточку с крупным снимком, ценой,
   остатком и счётчиком, а «Заказать» отдаёт товар окну быстрого заказа —
   тому же, что открывается со страницы заказов. Своего создания заказа
   здесь нет намеренно: одна дорога, один набор проверок.
   ═══════════════════════════════════════════════════════════════════════════ */

type CatalogProduct = {
  id: number;
  name: string;
  code: string;
  category: string | null;
  unitPrice: string;
  available: string | null;
  unit: string | null;
  photoUrl: string | null;
};

/** Карточка в сетке. */
function ProductCard({ product, onOpen }: { product: CatalogProduct; onOpen: () => void }) {
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const stock = Number(product.available ?? 0);
  const out = stock <= 0;

  return (
    <button
      type="button"
      data-testid={`catalog-card-${product.id}`}
      onClick={onOpen}
      className="neo-card-sm text-left"
      style={{
        display: "flex", flexDirection: "column", gap: "8px", padding: "8px",
        opacity: out ? 0.55 : 1, cursor: "pointer", width: "100%",
      }}
    >
      <div style={{
        width: "100%", aspectRatio: "1", borderRadius: "10px", overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--color-surface-light)",
      }}>
        {product.photoUrl
          ? <img src={product.photoUrl} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <Package size={28} style={{ color: "var(--color-text-tertiary)" }} />}
      </div>

      <p style={{
        margin: 0, fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)",
        display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
        overflow: "hidden", minHeight: "34px", lineHeight: "17px",
      }}>
        {product.name}
      </p>

      <p style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "var(--color-primary-text)" }}>
        {fmt(product.unitPrice)}
      </p>

      <p style={{ margin: 0, fontSize: "11px", color: out ? "var(--color-danger-text)" : "var(--color-text-tertiary)" }}>
        {out ? "Нет в наличии" : `${formatQty(product.available)} ${unitLabel(product.unit ?? undefined, lang)}`}
      </p>
    </button>
  );
}

/** Крупная карточка товара — шторкой снизу, как в приложении. */
function ProductSheet({ product, onClose, onOrder }: {
  product: CatalogProduct;
  onClose: () => void;
  onOrder: (qty: number) => void;
}) {
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const tr = useTranslate();
  const [qty, setQty] = useState(1);
  const stock = Number(product.available ?? 0);

  return createPortal(
    <div
      data-testid="catalog-sheet-backdrop"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end" }}
    >
      <div
        data-testid="catalog-sheet"
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxHeight: "92%", overflowY: "auto",
          background: "var(--color-surface)",
          borderTopLeftRadius: "20px", borderTopRightRadius: "20px",
          // Отступ снизу под системную полосу: на телефоне шторка прижата к
          // краю, и без него кнопка «Заказать» уходит под панель жестов.
          padding: "8px 16px calc(20px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 12px" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "var(--color-border)" }} />
        </div>

        <div style={{
          width: "100%", aspectRatio: "1", maxHeight: "42vh", borderRadius: "14px", overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--color-surface-light)", marginBottom: "14px",
        }}>
          {product.photoUrl
            ? <img src={product.photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <Package size={56} style={{ color: "var(--color-text-tertiary)" }} />}
        </div>

        <h2 style={{ margin: 0, fontSize: "20px", fontWeight: 700, color: "var(--color-text-primary)" }}>
          {product.name}
        </h2>
        {product.code && (
          <p style={{ margin: "4px 0 14px", fontSize: "13px", color: "var(--color-text-tertiary)" }}>{product.code}</p>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
          <div>
            <p style={{ margin: 0, fontSize: "10px", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)" }}>
              {tr("Цена", "Narx")}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: "19px", fontWeight: 700, color: "var(--color-primary-text)" }}>
              {fmt(product.unitPrice)}
            </p>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: "10px", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--color-text-tertiary)" }}>
              {tr("Остаток", "Qoldiq")}
            </p>
            <p style={{ margin: "2px 0 0", fontSize: "19px", fontWeight: 700, color: stock > 0 ? "var(--color-success-text)" : "var(--color-danger-text)" }}>
              {formatQty(product.available)} {unitLabel(product.unit ?? undefined, lang)}
            </p>
          </div>
        </div>

        {/* Счётчик: кнопки 44 точки — нижняя граница уверенного попадания.
            У кончившегося товара его нет вовсе: нажимать в нём нечего, а
            ниже вместо кнопки «Заказать» стоит предупреждение. */}
        {stock > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "18px", marginBottom: "16px" }}>
            <button type="button" aria-label={tr("Меньше", "Kamroq")} onClick={() => setQty(q => Math.max(1, q - 1))}
              className="neo-btn" style={{ width: 44, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Minus size={18} />
            </button>
            <span data-testid="catalog-qty" style={{ minWidth: 56, textAlign: "center", fontSize: "28px", fontWeight: 700, color: "var(--color-text-primary)" }}>
              {qty}
            </span>
            <button type="button" aria-label={tr("Больше", "Ko'proq")} onClick={() => setQty(q => q + 1)}
              className="neo-btn" style={{ width: 44, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Plus size={18} />
            </button>
          </div>
        )}

        {/*
          Товара нет — говорим об этом здесь, а не после разговора.

          Кнопка была активна при нулевом остатке, и заказ уходил на сервер.
          Сервер его отклоняет: остаток резервируется при СОЗДАНИИ заказа, и
          при нехватке приходит отказ. То есть агент договаривался с
          владельцем магазина, обещал привезти — и только потом узнавал, что
          товара нет. Стоял он при этом уже у прилавка.

          Остаток тут — со склада по умолчанию, и заказ списывается оттуда же
          (resolveOrderWarehouse в api/services/order.ts). Число, которое
          видит агент, и число, по которому решает сервер, — одно и то же.
        */}
        {stock <= 0 ? (
          <div
            data-testid="catalog-out-of-stock"
            style={{
              padding: "14px", borderRadius: "12px", textAlign: "center",
              background: "var(--color-danger-subtle, rgba(220,80,80,.12))",
            }}
          >
            <p style={{ margin: 0, fontWeight: 600, color: "var(--color-danger-text)" }}>
              {tr("Товар закончился", "Mahsulot tugadi")}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
              {tr("На складе его нет — заказ не примут", "Omborda yo'q — buyurtma qabul qilinmaydi")}
            </p>
          </div>
        ) : (
          <>
            {/* Просят больше, чем есть: заказ отклонят целиком, а не урежут. */}
            {qty > stock && (
              <p
                data-testid="catalog-not-enough"
                style={{ margin: "0 0 10px", fontSize: "13px", color: "var(--color-danger-text)", textAlign: "center" }}
              >
                {tr(`На складе только ${formatQty(product.available)}`, `Omborda faqat ${formatQty(product.available)}`)}
              </p>
            )}
            <button
              type="button"
              data-testid="catalog-order"
              onClick={() => onOrder(qty)}
              disabled={qty > stock}
              className="neo-btn-primary"
              style={{ width: "100%", padding: "14px", fontSize: "15px", fontWeight: 600, opacity: qty > stock ? 0.4 : 1 }}
            >
              {tr("Заказать", "Buyurtma berish")}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default function Catalog() {
  const tr = useTranslate();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [opened, setOpened] = useState<CatalogProduct | null>(null);
  const [quickOrder, setQuickOrder] = useState<{ product: CatalogProduct; qty: number } | null>(null);

  const { data, isLoading, isLoadingError, refetch } = trpc.product.listAll.useQuery(undefined);
  // `data ?? []` прямо в зависимостях давал бы новый пустой массив на каждый
  // рендер, и оба useMemo ниже пересчитывались бы вхолостую.
  // Без связи — отложенная копия: агент в подсобке должен видеть каталог,
  // а не пустой экран. Что копия устарела, сказано ниже прямо на экране.
  const { data: catalogData, fromCopy, savedAt } = useOfflineCopy<CatalogProduct[]>(
    "catalog",
    data as unknown as CatalogProduct[] | undefined,
  );
  const products = useMemo(() => catalogData ?? [], [catalogData]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.category) set.add(p.category);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(p =>
      (!q || p.name.toLowerCase().includes(q) || (p.code ?? "").toLowerCase().includes(q)) &&
      (!category || p.category === category)
    );
  }, [products, search, category]);

  /*
    Экран ошибки — только когда показывать нечего.

    Проверка стояла на одном isError, без оглядки на данные. А react-query
    при неудачном ОБНОВЛЕНИИ ставит статус «error», не трогая уже полученные
    данные: товары, цены и остатки в этот момент целиком лежат в памяти
    телефона. Агент открывал каталог, уходил в заказ, возвращался внутри
    магазина со слабой связью — и вместо сетки товаров получал красный
    треугольник. Кнопка «Повторить» повторяла тот же отказ.

    Сойтись этому легко: у клиента retry: false, staleTime 30 секунд и
    обновление при возврате на вкладку — то есть любое возвращение позже
    полуминуты запускает перезапрос, и первая же неудача выносила экран.

    Теперь неудачное обновление ничего не отнимает: агент дальше работает с
    тем, что уже загружено, ровно как в магазине без связи.
  */
  // Копия спасает и здесь: запрос не удался, но каталог с прошлого раза
  // лежит на устройстве — работать можно.
  if (isLoadingError && products.length === 0) return <QueryErrorFallback onRetry={refetch} />;

  return (
    <div className="space-y-3">
      {/* Копия с устройства — говорим об этом. По остаткам агент
          разговаривает с магазином, и выдавать вчерашнее за сегодняшнее
          молча нельзя. */}
      {fromCopy && (
        <div data-testid="catalog-offline-copy" style={{
          padding: "10px 12px", borderRadius: "12px", fontSize: "13px",
          background: "var(--color-warning-subtle, rgba(220,170,60,.14))",
          color: "var(--color-warning-text)",
        }}>
          {tr("Нет связи. Каталог с устройства", "Aloqa yo'q. Katalog qurilmadan")}
          {savedAt ? " · " + new Date(savedAt).toLocaleString("ru-RU") : ""}
        </div>
      )}

      {/* Поиск — первым делом, без плиток статистики над ним. */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-text-tertiary)" }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={tr("Название или код", "Nomi yoki kodi")}
          className="neo-input"
          style={{ paddingLeft: "38px", paddingRight: search ? "38px" : undefined, width: "100%", height: "46px" }}
        />
        {search && (
          <button type="button" aria-label={tr("Очистить", "Tozalash")} onClick={() => setSearch("")}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "var(--color-text-tertiary)" }}>
            <X size={16} />
          </button>
        )}
      </div>

      {categories.length > 1 && (
        <div style={{ display: "flex", gap: "8px", overflowX: "auto", paddingBottom: "2px" }}>
          {[null, ...categories].map(c => (
            <button
              key={c ?? "*"}
              type="button"
              onClick={() => setCategory(c)}
              style={{
                flexShrink: 0, minHeight: "36px", padding: "0 14px", borderRadius: "999px",
                fontSize: "13px", fontWeight: 600, cursor: "pointer",
                border: `1px solid ${category === c ? "var(--color-primary)" : "var(--color-border)"}`,
                background: category === c ? "var(--color-primary)" : "var(--color-surface)",
                color: category === c ? "#fff" : "var(--color-text-secondary)",
              }}
            >
              {c ?? tr("Все", "Barchasi")}
            </button>
          ))}
        </div>
      )}

      <p style={{ margin: 0, fontSize: "12px", color: "var(--color-text-tertiary)" }}>
        {tr("Найдено", "Topildi")}: {filtered.length}
      </p>

      {isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))", gap: "10px" }}>
          {[1, 2, 3, 4].map(i => <div key={i} className="neo-card-sm" style={{ height: 210 }} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--color-text-tertiary)" }}>
          <Package size={30} style={{ margin: "0 auto 8px", opacity: 0.4 }} />
          <p style={{ fontSize: "14px" }}>{tr("Ничего не нашлось", "Hech narsa topilmadi")}</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))", gap: "10px" }}>
          {filtered.map(p => <ProductCard key={p.id} product={p} onOpen={() => setOpened(p)} />)}
        </div>
      )}

      {opened && (
        <ProductSheet
          product={opened}
          onClose={() => setOpened(null)}
          onOrder={(qty) => { setQuickOrder({ product: opened, qty }); setOpened(null); }}
        />
      )}

      {quickOrder && (
        <QuickOrderModal
          open
          onOpenChange={(v) => { if (!v) setQuickOrder(null); }}
          initialItem={{
            productId: quickOrder.product.id,
            name:      quickOrder.product.name,
            code:      quickOrder.product.code,
            unitPrice: Number(quickOrder.product.unitPrice),
            quantity:  quickOrder.qty,
          }}
          onCreated={() => setQuickOrder(null)}
        />
      )}
    </div>
  );
}
