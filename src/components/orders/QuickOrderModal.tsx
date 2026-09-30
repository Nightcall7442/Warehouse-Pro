import { useState, useMemo, useEffect } from "react";
import { AppModal, modalSectionLabel, modalFieldLabel } from "@/components/ui/AppModal";
import { useConfirm } from "@/components/ConfirmDialog";
import { PremiumSelect } from "@/components/PremiumSelect";
import { Plus, Minus, Trash2, Search, Loader2, Store, Check } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useInvalidateOrderCaches } from "@/hooks/useOrderCacheSync";
import { notify } from "@/lib/toast";
import { useTranslate } from "@/i18n";
import { useShopSearch, SHOP_PICK_LIMIT, type PickedShop } from "@/hooks/useShopSearch";
import { useCurrency } from "@/hooks/useCurrency";
import { colorMix } from "@/lib/color-mix";
import { priceAt } from "@contracts/price-tiers";
import { holdReasonText } from "@contracts/hold-reason";
import type { QuickOrderLine, QuickOrderStart } from "@/lib/quick-order";

type CartItem = QuickOrderLine;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedShopId?: number;
  /**
   * Товар, с которого начинается заказ.
   *
   * Каталог агента (pages/Catalog.tsx) открывает это окно уже с выбранным
   * товаром и количеством: человек нашёл товар и нажал «Заказать» — искать
   * его второй раз в списке этого окна незачем. Своего создания заказа у
   * каталога нет намеренно: дорога одна, и проверки на ней те же.
   */
  initialItem?: CartItem;
  /**
   * С чего начать: магазин и строки повтора (lib/quick-order.ts).
   *
   * Повтор кладёт в корзину только товар и количество; цену и остаток окно
   * берёт из каталога магазина, как для набранного руками, а заказ уходит
   * тем же order.create — со всеми его проверками.
   */
  start?: QuickOrderStart;
  onCreated?: () => void;
}

/** Small icon-only round button used for cart quantity steppers. */
function IconButton({ onClick, danger, label, children, size = 26 }: {
  onClick: () => void; danger?: boolean; label: string; children: React.ReactNode; size?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        width: `${size}px`, height: `${size}px`, borderRadius: "8px", border: "none",
        background: "transparent",
        color: danger ? "var(--color-danger-text)" : "var(--color-text-secondary)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/**
 * The quantity, typed rather than clicked.
 *
 * The steppers stay — they are the right tool for "one more" — but a
 * distributor ordering fifty units was pressing plus fifty times. The number
 * between them is now the input.
 *
 * It keeps its own draft while focused, because committing on every keystroke
 * makes the field impossible to edit: clearing it to type a new number would
 * pass 0 upward, and 0 removes the line from the cart. So an empty box is a
 * legal intermediate state, and only a real number is passed on. Leaving the
 * box empty falls back to 1 on blur — removing a line is what the trash button
 * is for, and it should not happen because someone tabbed away mid-edit.
 */
function QtyInput({ value, onChange, label }: {
  value: number; onChange: (qty: number) => void; label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      value={draft ?? String(value)}
      onFocus={e => e.currentTarget.select()}
      onChange={e => {
        // Digits only: a stray letter or minus would otherwise sit in the box
        // looking accepted while the cart quietly kept the old number.
        const digits = e.target.value.replace(/\D/g, "").slice(0, 5);
        setDraft(digits);
        if (digits !== "") onChange(Number(digits));
      }}
      onBlur={() => {
        if (draft === "" || draft === "0") onChange(1);
        setDraft(null);
      }}
      onKeyDown={e => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="text-xs font-semibold text-center tabular-nums"
      style={{
        width: "44px", height: "24px", padding: "0 2px",
        borderRadius: "6px",
        border: "1px solid var(--color-border, #d8d5cd)",
        background: "var(--color-surface, transparent)",
        color: "var(--color-text-primary)",
      }}
    />
  );
}

export function QuickOrderModal({ open, onOpenChange, preselectedShopId, initialItem, start, onCreated }: Props) {
  const t = useTranslate();
  // Валюта — из настроек организации, а не слово «сум» в разметке.
  const { symbol: currency } = useCurrency();

  const startShopId = start?.shop?.id ?? preselectedShopId;
  const [step, setStep] = useState(1);
  const [shopId, setShopId] = useState<number | undefined>(startShopId);
  const [cart, setCart] = useState<CartItem[]>(start?.lines ?? (initialItem ? [initialItem] : []));
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "transfer" | "debt">("cash");
  /*
    Прайс-лист заказа. undefined — не трогали: берётся список магазина;
    null — «по карточке товара»; число — выбранный список. Цены в каталоге и
    в корзине — те, что посчитает сервер по этому списку (product.listAll с
    shopId/priceListId): раньше окно показывало карточку, а заказ уходил по
    списку магазина, и агент называл магазину одну сумму, а накладная
    печатала другую.
  */
  const [priceListId, setPriceListId] = useState<number | null | undefined>(undefined);
  const [productSearch, setProductSearch] = useState("");
  const [shopSearch, setShopSearch] = useState("");
  const invalidateOrderCaches = useInvalidateOrderCaches();

  /*
    Магазины — поиском на сервере (useShopSearch), одним путём для всех ролей.

    Здесь грузились 500 самых новых магазинов (агенту — все), и строка поиска
    фильтровала их у себя: при трёх с половиной тысячах точек старые, то есть
    основные, клиенты не находились вовсе, а номер телефона, который оператор
    слышит в трубке, не искался. Выбранный магазин держится отдельно: следующая
    буква поиска не должна убирать его с экрана и из «Шага 2».
  */
  // Магазин, пришедший со стартом, закреплён сразу: его может не быть среди
  // первых строк поиска, а «Шаг 2» берёт имя отсюда.
  const [pickedShop, setPickedShop] = useState<PickedShop | null>(start?.shop ?? null);
  const { shops: filteredShops, more: moreShops } = useShopSearch(shopSearch, { enabled: open, pinned: pickedShop });
  const priceLists = trpc.priceList.forShop.useQuery({ shopId: shopId ?? 0 }, { enabled: open && !!shopId });
  const effectivePriceListId = priceListId === undefined ? (priceLists.data?.current?.id ?? null) : priceListId;
  const { data: productsData } = trpc.product.listAll.useQuery({ search: productSearch || undefined, shopId, priceListId: effectivePriceListId });
  // Корзина переценивается вслед за списком на отрисовке: цены — из того же
  // ответа, что и каталог; в заказ уходят только товар и количество.
  // Цена — по ступени количества строки («от 10 — 8500»), тем же priceAt,
  // что и сервер: каталог отдаёт цену при одной штуке, а заказ считается по
  // ступени, и «Итого» расходилось с накладной.
  const { data: pricedAll } = trpc.product.listAll.useQuery({ shopId, priceListId: effectivePriceListId }, { enabled: open && !!shopId && cart.length > 0 });
  const catalogOf = useMemo(() => new Map((pricedAll ?? []).map(p => [p.id, p])), [pricedAll]);
  const pricedCart = useMemo(() => cart.map(c => {
    const p = catalogOf.get(c.productId);
    return p ? { ...c, unitPrice: Number(priceAt(String(p.unitPrice), p.tiers, c.quantity)) } : c;
  }), [cart, catalogOf]);

  const createOrder = trpc.order.create.useMutation({
    onSuccess: (created) => {
      // Заказ встал на решение офиса (скидка, просрочка) — сказать и почему.
      if ("held" in created && created.held) {
        const why = holdReasonText(created.holdReason, t("ru", "uz"));
        notify.info(t("Заказ создан и ждёт подтверждения офиса", "Buyurtma yaratildi va ofis tasdig'ini kutmoqda") + (why ? ` — ${why}` : ""));
      } else {
        notify.success(t("Заказ создан", "Buyurtma yaratildi"));
      }
      invalidateOrderCaches();
      onCreated?.();
      onOpenChange(false);
      resetForm();
    },
    onError: (e) => notify.error(e.message),
  });

  const resetForm = () => {
    setStep(1);
    setShopId(startShopId);
    setCart([]);
    setNotes("");
    setDiscount("0");
    setPaymentMethod("cash");
    setProductSearch("");
    setShopSearch("");
    setPickedShop(start?.shop ?? null);
  };

  /**
   * Закрытие с непустой корзиной спрашивает.
   *
   * Промах мимо панели и Escape теперь окно не закрывают вовсе (см. dirty в
   * AppModal), а вот крестик и «Отмена» — действия осознанные, и запрещать
   * их незачем. Но собранный заказ стоит человеку нескольких минут разговора
   * с владельцем магазина, поэтому перед тем как его стереть, спрашиваем.
   */
  const { confirm, dialog } = useConfirm();

  const close = async () => {
    if (cart.length > 0) {
      const ok = await confirm({
        title: t("Закрыть без сохранения?", "Saqlamasdan yopilsinmi?"),
        message: t(
          `В заказе ${cart.length} позиций. Закроете — они пропадут.`,
          `Buyurtmada ${cart.length} ta pozitsiya. Yopsangiz, ular yo'qoladi.`,
        ),
        confirmText: t("Закрыть", "Yopish"),
        danger: true,
      });
      if (!ok) return;
    }
    resetForm();
    onOpenChange(false);
  };

  const subtotal = useMemo(() => pricedCart.reduce((s, i) => s + i.unitPrice * i.quantity, 0), [pricedCart]);
  // Поле скидки стоит вне <form>, поэтому min и max на нём браузер не
  // применяет: набрать «500» можно, и «Итого к оплате» показывало
  // отрицательную сумму. Сервер такой заказ отклонит, но человек к тому
  // моменту уже назвал владельцу магазина цифру с минусом.
  //
  // Здесь скидка приводится к разумному: не число — ноль, больше ста — сто.
  const discountPct = Math.min(100, Math.max(0, Number(discount) || 0));
  const discountAmount = subtotal * (discountPct / 100);
  const total = subtotal - discountAmount;

  const addToCart = (product: { id: number; name: string; code: string; unitPrice: string }) => {
    const existing = cart.find(c => c.productId === product.id);
    if (existing) {
      setCart(cart.map(c => c.productId === product.id ? { ...c, quantity: c.quantity + 1 } : c));
    } else {
      setCart([...cart, { productId: product.id, name: product.name, code: product.code, unitPrice: Number(product.unitPrice), quantity: 1 }]);
    }
  };

  /*
    Сканер-клавиатура: код + Enter. Список ищется на сервере и приходит
    позже, чем Enter, — поэтому Enter только запоминает код, а в корзину
    товар ложится, когда ответ на этот код пришёл и совпал целиком.
  */
  const [pendingScan, setPendingScan] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingScan || !productsData || productSearch !== pendingScan) return;
    const norm = pendingScan.trim().toLowerCase();
    const hit = productsData.find(p => (p.barcode ?? "").toLowerCase() === norm || (p.code ?? "").toLowerCase() === norm);
    /* eslint-disable react-hooks/set-state-in-effect */
    setPendingScan(null);
    if (!hit) return;
    addToCart(hit);
    setProductSearch("");
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingScan, productsData, productSearch]);

  const updateQty = (productId: number, qty: number) => {
    if (qty <= 0) { setCart(cart.filter(c => c.productId !== productId)); return; }
    setCart(cart.map(c => c.productId === productId ? { ...c, quantity: qty } : c));
  };

  const handleSubmit = () => {
    if (!shopId || cart.length === 0) return;
    createOrder.mutate({
      shopId,
      items: cart.map(c => ({ productId: c.productId, quantity: c.quantity })),
      notes: notes || undefined,
      discount,
      paymentMethod,
      priceListId: effectivePriceListId,
    });
  };

  const shopName = filteredShops.find(s => s.id === shopId)?.name;

  const footer = step === 1 ? (
    <>
      <button
        type="button"
        onClick={() => setStep(2)}
        disabled={!shopId || cart.length === 0}
        className="neo-btn-primary flex-1 h-12 text-sm"
      >
        {t("Далее", "Keyingi")}
      </button>
      <button type="button" onClick={close} className="neo-btn flex-1 h-12 text-sm">
        {t("Отмена", "Bekor qilish")}
      </button>
    </>
  ) : (
    <>
      <button
        type="button"
        onClick={handleSubmit}
        disabled={createOrder.isPending}
        className="neo-btn-primary flex-1 h-12 text-sm"
      >
        {createOrder.isPending && <Loader2 size={15} className="animate-spin" />}
        {t("Создать заказ", "Buyurtma yaratish")}
      </button>
      <button type="button" onClick={() => setStep(1)} className="neo-btn flex-1 h-12 text-sm">
        {t("Назад", "Orqaga")}
      </button>
    </>
  );

  return (
    <AppModal
      open={open}
      onClose={close}
      title={t("Новый заказ", "Yangi buyurtma")}
      subtitle={step === 1
        ? t("Шаг 1 из 2 · магазин и товары", "1-qadam 2 dan · do'kon va tovarlar")
        : t("Шаг 2 из 2 · проверка и оплата", "2-qadam 2 dan · tekshirish va to'lov")}
      maxWidth={820}
      footer={footer}
      // Пока в корзине есть товары, промах мимо панели и Escape окно не
      // закрывают: один неточный клик стирал собранный заказ целиком.
      dirty={cart.length > 0}
    >
      {dialog}
      {step === 1 && (
        <>
          {/*
            Повтор — откуда строки и чего в них нет. Цены в корзине сегодняшние
            (каталог магазина), и это сказано прямо: иначе оператор сверит
            «Итого» с прошлой накладной и решит, что окно ошиблось. Снятый с
            продажи товар назван: молча выпавшая строка — это магазин, которому
            не довезли и не сказали почему.
          */}
          {start?.repeatOf && (
            <div className="neo-card neo-card-static" data-testid="quick-order-repeat-note"
              style={{ borderRadius: "16px", padding: "10px 14px", fontSize: "13px", color: "var(--color-text-secondary)" }}>
              {t(`Повтор заказа ${start.repeatOf} · цены и остаток — на сегодня`, `${start.repeatOf} buyurtmasi takrori · narx va qoldiq — bugungi`)}
              {!!start.skipped?.length && (
                <div data-testid="quick-order-skipped" style={{ color: "var(--color-warning-text)", marginTop: "4px" }}>
                  {t("Не вошли — сняты с продажи: ", "Kirmadi — sotuvdan olingan: ")}
                  {start.skipped.map(s => `${s.name} (${Number(s.quantity).toLocaleString("ru")})`).join(", ")}
                </div>
              )}
            </div>
          )}
          <div>
            <p className={modalSectionLabel}>{t("Магазин", "Do'kon")}</p>
            <div style={{ position: "relative", marginBottom: "8px" }}>
              <Search size={15} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)" }} />
              <input
                className="neo-input"
                style={{ paddingLeft: "38px" }}
                placeholder={t("Поиск магазина по названию, владельцу, району…", "Do'kon, egasi, tuman bo'yicha qidirish…")}
                value={shopSearch}
                onChange={e => setShopSearch(e.target.value)}
              />
            </div>
            <div
              className="overflow-y-auto"
              style={{
                maxHeight: 220, borderRadius: "16px",
                border: "1px solid var(--color-border, #d8d5cd)", padding: "8px",
              }}
            >
              {filteredShops.map((s) => (
                <button
                  type="button"
                  key={s.id}
                  onClick={() => { setShopId(s.id); setPickedShop(s); }}
                  /*
                    Наведение — правилом .row-hover, а не парой обработчиков на
                    каждую строку списка. Руками оно не гаснет, если палец ушёл
                    с сенсорного экрана мимо «выхода», и правит style прямо на
                    узле в обход стилей.

                    Выбранная строка своей заливки не теряет: правило подсвечивает
                    прозрачным по фону, а у неё фон уже есть.
                  */
                  className="w-full flex items-center justify-between gap-3 text-left row-hover"
                  style={{
                    padding: "10px 12px", borderRadius: "12px", cursor: "pointer", border: "none",
                    background: shopId === s.id ? "var(--color-primary-subtle)" : "transparent",
                  }}
                >
                  <span className="min-w-0 flex items-center gap-2">
                    <Store size={14} style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate" style={{ color: "var(--color-text-primary)" }}>{s.name}</span>
                      <span className="block text-xs truncate" style={{ color: "var(--color-text-tertiary)" }}>
                        {[s.ownerName, s.district, s.city].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                  </span>
                  {/* Долг виден до выбора: с должником разговор другой, и
                      узнавать это после оформления — поздно. */}
                  {Number(s.debt) > 0 && (
                    <span className="text-xs font-semibold shrink-0 font-data" style={{ color: "var(--color-danger-text)" }}>
                      {t("долг", "qarz")} {Number(s.debt).toLocaleString("ru")}
                    </span>
                  )}
                  {shopId === s.id && <Check size={16} style={{ color: "var(--color-primary)", flexShrink: 0 }} />}
                </button>
              ))}
              {filteredShops.length === 0 && (
                <p className="text-center text-xs py-8" style={{ color: "var(--color-text-tertiary)" }}>
                  {t("Ничего не найдено", "Hech narsa topilmadi")}
                </p>
              )}
              {moreShops && (
                <p className="text-center text-xs pt-2" style={{ color: "var(--color-text-tertiary)" }}>
                  {t(`Показаны первые ${SHOP_PICK_LIMIT} — уточните поиск`, `Dastlabki ${SHOP_PICK_LIMIT} tasi ko'rsatildi — qidiruvni aniqlashtiring`)}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-[1fr_280px] gap-5 max-md:grid-cols-1">
            {/* Product picker */}
            <div>
              <p className={modalSectionLabel}>{t("Товары", "Tovarlar")}</p>
              <div style={{ position: "relative", marginBottom: "12px" }}>
                <Search size={15} style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)" }} />
                <input
                  className="neo-input"
                  style={{ paddingLeft: "38px" }}
                  placeholder={t("Поиск товаров…", "Tovar qidirish…")}
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && productSearch.trim()) { e.preventDefault(); setPendingScan(productSearch); } }}
                  data-testid="quick-order-product-search"
                />
              </div>
              <div
                className="overflow-y-auto"
                style={{
                  maxHeight: 300, borderRadius: "16px",
                  border: "1px solid var(--color-border, #d8d5cd)", padding: "8px",
                }}
              >
                {/*
                  Свободный остаток в строке, и «+» глухой при нуле.

                  listAll давно отдаёт available, а окно его не показывало:
                  оператор клал в корзину то, чего нет, и узнавал об этом
                  отказом сервера уже после разговора с магазином.
                */}
                {(productsData ?? []).map((p) => {
                  const free = Number(p.available ?? 0);
                  return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => addToCart(p)}
                    disabled={free <= 0}
                    className="w-full flex items-center justify-between gap-3 text-left row-hover"
                    style={{ padding: "10px 12px", borderRadius: "12px", background: "transparent", border: "none", cursor: free <= 0 ? "not-allowed" : "pointer", opacity: free <= 0 ? 0.5 : 1 }}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate" style={{ color: "var(--color-text-primary)" }}>{p.name}</span>
                      <span className="block text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                        {/* В корзине — цена строки (по ступени), как справа; иначе — цена одной штуки. */}
                        {p.code} · {(pricedCart.find(c => c.productId === p.id)?.unitPrice ?? Number(p.unitPrice)).toLocaleString("ru")} {currency}
                        {" · "}
                        <span style={{ color: free <= 0 ? "var(--color-danger-text)" : undefined }}>
                          {t("свободно", "bo'sh")} {free}
                        </span>
                      </span>
                    </span>
                    <Plus size={16} style={{ color: "var(--color-primary)", flexShrink: 0 }} />
                  </button>
                  );
                })}
                {(productsData ?? []).length === 0 && (
                  <p className="text-center text-xs py-8" style={{ color: "var(--color-text-tertiary)" }}>
                    {t("Ничего не найдено", "Hech narsa topilmadi")}
                  </p>
                )}
              </div>
            </div>

            {/* Cart */}
            <div>
              {/* Прайс-лист заказа — над корзиной: видно, по каким ценам она посчитана. */}
              <p className={modalSectionLabel}>{t("Прайс-лист", "Narxlar ro'yxati")}</p>
              <div style={{ marginBottom: "12px" }} data-testid="quick-order-price-list">
                <PremiumSelect
                  value={effectivePriceListId == null ? "" : String(effectivePriceListId)}
                  onChange={v => setPriceListId(v ? Number(v) : null)}
                  options={[
                    { value: "", label: t("По карточке товара", "Tovar kartasi bo'yicha") },
                    ...(priceLists.data?.lists ?? []).map(l => ({ value: String(l.id), label: l.markupPct != null ? `${l.name} (${Number(l.markupPct) > 0 ? "+" : ""}${Number(l.markupPct)}%)` : l.name })),
                  ]}
                  width="100%"
                />
                {priceLists.data?.current && effectivePriceListId === priceLists.data.current.id && (
                  <div className="text-[10px] mt-1" style={{ color: "var(--color-text-tertiary)" }}>{t("Список магазина", "Do'kon ro'yxati")}</div>
                )}
              </div>
              <p className={modalSectionLabel}>{t("Корзина", "Savat")} ({cart.length})</p>
              <div
                className="flex flex-col"
                style={{ borderRadius: "16px", border: "1px solid var(--color-border, #d8d5cd)", minHeight: 200 }}
              >
                <div className="overflow-y-auto grow" style={{ maxHeight: 240, padding: "8px" }}>
                  {pricedCart.map(item => {
                    /*
                      Строка повтора может просить больше, чем лежит: руками
                      такую не набрать («+» глохнет на нуле), а повтор кладёт
                      прошлое количество как есть. Сервер откажет всему заказу —
                      пометка говорит об этом до «Создать».
                    */
                    const free = Number(catalogOf.get(item.productId)?.available ?? item.available ?? NaN);
                    return (
                    <div key={item.productId} className="flex items-center gap-2" style={{ padding: "8px 6px" }}>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate" style={{ color: "var(--color-text-primary)" }}>{item.name}</div>
                        <div className="text-[10px]" style={{ color: "var(--color-text-tertiary)" }}>
                          {item.unitPrice.toLocaleString("ru")} × {item.quantity}
                        </div>
                        {Number.isFinite(free) && item.quantity > free && (
                          <div className="text-[10px] font-semibold" data-testid={`quick-order-short-${item.productId}`} style={{ color: "var(--color-danger-text)" }}>
                            {t(`на складе ${free}`, `omborda ${free}`)}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5">
                        <IconButton size={24} label={t("Меньше", "Kamaytirish")} onClick={() => updateQty(item.productId, item.quantity - 1)}><Minus size={12} /></IconButton>
                        <QtyInput
                          value={item.quantity}
                          onChange={qty => updateQty(item.productId, qty)}
                          label={t("Количество", "Miqdori")}
                        />
                        <IconButton size={24} label={t("Больше", "Ko'paytirish")} onClick={() => updateQty(item.productId, item.quantity + 1)}><Plus size={12} /></IconButton>
                      </div>
                      <IconButton size={24} danger label={t("Убрать", "Olib tashlash")} onClick={() => updateQty(item.productId, 0)}><Trash2 size={12} /></IconButton>
                    </div>
                    );
                  })}
                  {cart.length === 0 && (
                    <p className="text-center text-xs py-10" style={{ color: "var(--color-text-tertiary)" }}>
                      {t("Пусто", "Bo'sh")}
                    </p>
                  )}
                </div>
                <div
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderTop: "1px solid var(--color-border, #d8d5cd)" }}
                >
                  <span className="text-xs text-secondary font-medium">{t("Итого", "Jami")}</span>
                  <span className="text-base font-bold text-primary font-data">{total.toLocaleString("ru")} {currency}</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div>
            <p className={modalSectionLabel}>{t("Магазин", "Do'kon")}</p>
            <div
              className="flex items-center justify-between px-4 py-3 rounded-xl"
              style={{ background: "var(--color-primary-subtle)" }}
            >
              <span className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>{shopName}</span>
              <span className="text-xs text-secondary">{cart.length} {t("позиций", "pozitsiya")}</span>
            </div>
          </div>

          <div>
            <p className={modalSectionLabel}>{t("Товары", "Tovarlar")}</p>
            <div style={{ borderRadius: "16px", overflow: "hidden", border: "1px solid var(--color-border, #d8d5cd)" }}>
              <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--color-surface-light)" }}>
                    <th className="text-left font-semibold px-3 py-2.5" style={{ color: "var(--color-text-tertiary)" }}>{t("Товар", "Tovar")}</th>
                    <th className="text-right font-semibold px-3 py-2.5" style={{ color: "var(--color-text-tertiary)" }}>{t("Кол-во", "Miqdor")}</th>
                    <th className="text-right font-semibold px-3 py-2.5" style={{ color: "var(--color-text-tertiary)" }}>{t("Сумма", "Summa")}</th>
                  </tr>
                </thead>
                <tbody>
                  {pricedCart.map(i => (
                    <tr key={i.productId} style={{ borderTop: "1px solid var(--color-border, #d8d5cd)" }}>
                      <td className="px-3 py-2.5" style={{ color: "var(--color-text-primary)" }}>{i.name}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: "var(--color-text-secondary)" }}>{i.quantity}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums font-data" style={{ color: "var(--color-text-primary)" }}>
                        {(i.unitPrice * i.quantity).toLocaleString("ru")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <p className={modalSectionLabel}>{t("Оплата", "To'lov")}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={modalFieldLabel}>{t("Скидка (%)", "Chegirma (%)")}</label>
                <input
                  type="number" min="0" max="100"
                  className="neo-input" style={{ textAlign: "right" }}
                  value={discount}
                  onChange={e => setDiscount(e.target.value)}
                />
              </div>
              <div>
                <label className={modalFieldLabel}>{t("Способ оплаты", "To'lov usuli")}</label>
                <PremiumSelect
                  value={paymentMethod}
                  onChange={v => setPaymentMethod(v as typeof paymentMethod)}
                  options={[
                    { value: "cash", label: t("Наличные", "Naqd") },
                    { value: "card", label: t("Карта", "Karta") },
                    { value: "transfer", label: t("Перевод", "O'tkazma") },
                    { value: "debt", label: t("В долг", "Qarzga") },
                  ]}
                  width="100%"
                />
              </div>
            </div>
          </div>

          <div>
            <label className={modalSectionLabel}>{t("Примечание", "Izoh")}</label>
            <textarea
              className="neo-input"
              style={{ resize: "none", minHeight: 60 }}
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={t("Дополнительная информация…", "Qo'shimcha ma'lumot…")}
            />
          </div>

          <div
            className="flex items-center justify-between px-4 py-3.5 rounded-xl"
            style={{ background: colorMix("var(--color-primary)", 10) }}
          >
            <span className="text-sm text-secondary font-medium">{t("Итого к оплате", "Jami to'lovga")}</span>
            <span className="text-xl font-bold text-primary font-data">{total.toLocaleString("ru")} {currency}</span>
          </div>
        </>
      )}
    </AppModal>
  );
}
