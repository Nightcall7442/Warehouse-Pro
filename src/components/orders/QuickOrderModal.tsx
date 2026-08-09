import { useState, useMemo } from "react";
import { AppModal, modalSectionLabel, modalFieldLabel } from "@/components/ui/AppModal";
import { PremiumSelect } from "@/components/PremiumSelect";
import { Plus, Minus, Trash2, Search, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useInvalidateOrderCaches } from "@/hooks/useOrderCacheSync";
import { notify } from "@/lib/toast";
import { useTranslate } from "@/i18n";
import { colorMix } from "@/lib/color-mix";

interface CartItem {
  productId: number;
  name: string;
  code: string;
  unitPrice: number;
  quantity: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedShopId?: number;
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

export function QuickOrderModal({ open, onOpenChange, preselectedShopId, onCreated }: Props) {
  const t = useTranslate();

  const [step, setStep] = useState(1);
  const [shopId, setShopId] = useState<number | undefined>(preselectedShopId);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "transfer" | "debt">("cash");
  const [productSearch, setProductSearch] = useState("");
  const invalidateOrderCaches = useInvalidateOrderCaches();

  const { data: shopsData } = trpc.shop.list.useQuery({ pageSize: 500 });
  const { data: productsData } = trpc.product.listAll.useQuery({ search: productSearch || undefined });
  const createOrder = trpc.order.create.useMutation({
    onSuccess: () => {
      notify.success(t("Заказ создан", "Buyurtma yaratildi"));
      invalidateOrderCaches();
      onCreated?.();
      onOpenChange(false);
      resetForm();
    },
    onError: (e) => notify.error(e.message),
  });

  const resetForm = () => {
    setStep(1);
    setShopId(preselectedShopId);
    setCart([]);
    setNotes("");
    setDiscount("0");
    setPaymentMethod("cash");
    setProductSearch("");
  };

  const close = () => { resetForm(); onOpenChange(false); };

  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0), [cart]);
  const discountAmount = subtotal * (Number(discount) / 100);
  const total = subtotal - discountAmount;

  const addToCart = (product: { id: number; name: string; code: string; unitPrice: string }) => {
    const existing = cart.find(c => c.productId === product.id);
    if (existing) {
      setCart(cart.map(c => c.productId === product.id ? { ...c, quantity: c.quantity + 1 } : c));
    } else {
      setCart([...cart, { productId: product.id, name: product.name, code: product.code, unitPrice: Number(product.unitPrice), quantity: 1 }]);
    }
  };

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
    });
  };

  const shopName = shopsData?.data?.find(s => s.id === shopId)?.name;

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
    >
      {step === 1 && (
        <>
          <div>
            <p className={modalSectionLabel}>{t("Магазин", "Do'kon")}</p>
            <PremiumSelect
              value={shopId ? String(shopId) : ""}
              onChange={v => setShopId(v ? Number(v) : undefined)}
              options={[
                { value: "", label: t("Выберите магазин…", "Do'kon tanlang…") },
                ...(shopsData?.data ?? []).map(s => ({ value: String(s.id), label: s.name })),
              ]}
              width="100%"
            />
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
                />
              </div>
              <div
                className="overflow-y-auto"
                style={{
                  maxHeight: 300, borderRadius: "16px",
                  border: "1px solid var(--color-border, #d8d5cd)", padding: "8px",
                }}
              >
                {(productsData ?? []).map((p) => (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => addToCart(p)}
                    className="w-full flex items-center justify-between gap-3 text-left"
                    style={{ padding: "10px 12px", borderRadius: "12px", background: "transparent", border: "none", cursor: "pointer" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "var(--color-surface-light)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate" style={{ color: "var(--color-text-primary)" }}>{p.name}</span>
                      <span className="block text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                        {p.code} · {Number(p.unitPrice).toLocaleString("ru")} сум
                      </span>
                    </span>
                    <Plus size={16} style={{ color: "var(--color-primary)", flexShrink: 0 }} />
                  </button>
                ))}
                {(productsData ?? []).length === 0 && (
                  <p className="text-center text-xs py-8" style={{ color: "var(--color-text-tertiary)" }}>
                    {t("Ничего не найдено", "Hech narsa topilmadi")}
                  </p>
                )}
              </div>
            </div>

            {/* Cart */}
            <div>
              <p className={modalSectionLabel}>{t("Корзина", "Savat")} ({cart.length})</p>
              <div
                className="flex flex-col"
                style={{ borderRadius: "16px", border: "1px solid var(--color-border, #d8d5cd)", minHeight: 200 }}
              >
                <div className="overflow-y-auto grow" style={{ maxHeight: 240, padding: "8px" }}>
                  {cart.map(item => (
                    <div key={item.productId} className="flex items-center gap-2" style={{ padding: "8px 6px" }}>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate" style={{ color: "var(--color-text-primary)" }}>{item.name}</div>
                        <div className="text-[10px]" style={{ color: "var(--color-text-tertiary)" }}>
                          {item.unitPrice.toLocaleString("ru")} × {item.quantity}
                        </div>
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
                  ))}
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
                  <span className="text-base font-bold text-primary font-data">{total.toLocaleString("ru")} сум</span>
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
                  {cart.map(i => (
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
            <span className="text-xl font-bold text-primary font-data">{total.toLocaleString("ru")} сум</span>
          </div>
        </>
      )}
    </AppModal>
  );
}
