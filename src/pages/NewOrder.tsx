import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useInvalidateOrderCaches } from "@/hooks/useOrderCacheSync";
import { notify } from "@/lib/toast";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate, useSearchParams } from "react-router";
import { useLang } from "@/i18n";
import { Loader2, WifiOff } from "lucide-react";
import { savePendingOrder } from "./OfflineOrders.helpers";
import { Steps, ShopSelector, ProductSelector, OrderReview } from "@/components/orders";
import type { OrderItem, PaymentMethod } from "@/components/orders";
import { EMPTY_ITEM } from "@/components/orders";

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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const LABELS = lang === "uz" ? LABELS_UZ : LABELS_RU;

  const invalidateOrderCaches = useInvalidateOrderCaches();
  const createOrder = trpc.order.create.useMutation({
    onSuccess: () => {
      invalidateOrderCaches();
      notify.success(t("Заказ создан!", "Buyurtma yaratildi!"));
      const role = user?.role;
      if (role === "ceo" || role === "operator" || role === "superadmin") {
        navigate("/orders");
      } else {
        navigate("/agent");
      }
    },
    onError: (e) => notify.error(e.message),
  });

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
      notes:         notes || undefined,
      discount:      discount || "0",
      paymentMethod,
    };

    if (!navigator.onLine) {
      if (!user) {
        notify.error(t("Сессия не найдена — войдите заново", "Sessiya topilmadi — qayta kiring"));
        return;
      }
      // Владелец записи. Без него запись увидит и отправит следующий, кто
      // войдёт на этом же компьютере, — а сервер поставит агентом его.
      savePendingOrder({ ...payload, shopName, paymentMethod }, user.id)
        .then(() => {
          notify.success(t("Заказ сохранён офлайн", "Buyurtma oflayn saqlandi"));
          const role = user?.role;
          if (role === "ceo" || role === "operator" || role === "superadmin") {
            navigate("/orders");
          } else {
            navigate("/agent");
          }
        })
        .catch(() => notify.error(t("Ошибка сохранения", "Saqlashda xato")));
      return;
    }

    createOrder.mutate(payload);
  };

  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;

  return (
    <div className="max-w-lg mx-auto">
      {/* Header.
          Заголовок скрыт на мобильном (hidden md:block), кнопка назад и
          остальное — нет.

          У Layout.tsx своя шапка, но только на мобильном (MobileHeader,
          md:hidden) — на десктопе заголовка страницы вообще нет ни у кого,
          кроме самой страницы. Здесь стоял один и тот же текст «Новый заказ»
          дважды подряд: сверху из глобальной шапки, сразу под ней — этот же
          заголовок ещё раз. На маленьком экране, где каждый пиксель уходит
          под список товаров, это была просто повторяющаяся строка без
          смысла.

          Кнопка «назад» — не то же самое, что кнопка глобальной шапки, и
          убирать её нельзя: она возвращает на предыдущий шаг мастера
          (Steps — чисто декоративный компонент, кликов по кружкам нет), а
          кнопка в глобальной шапке всегда ведёт на /orders, теряя выбранный
          магазин и уже набранную корзину. Название магазина — тоже
          самостоятельная информация, глобальная шапка показывает только
          статичное «Заказы». */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => step > 1 ? setStep(s => s - 1) : navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-lg border btn-ghost flex-shrink-0"
          style={{ borderColor: "var(--color-border, #d8d5cd)" }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M10 3L5 8l5 5"/>
          </svg>
        </button>
        <div>
          <h1 className="hidden md:block font-display text-xl font-bold text-primary tracking-tight">
            {t("Новый заказ", "Yangi buyurtma")}
          </h1>
          {shopName && step > 1 && (
            <p className="text-xs text-secondary mt-0.5">{shopName}</p>
          )}
        </div>
        {isOffline && (
          <div className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
            style={{ background: "var(--color-warning-subtle, rgba(251,191,36,.10))", color: "var(--color-warning-text)" }}>
            <WifiOff size={12}/>
            {t("Офлайн", "Oflayn")}
          </div>
        )}
      </div>

      <Steps current={step} labels={LABELS}/>

      {/* Content */}
      <div className="min-h-[320px]">
        {step === 1 && (
          <ShopSelector
            shopId={shopId}
            onSelect={(id, name) => { setShopId(id); setShopName(name); }}
          />
        )}
        {step === 2 && <ProductSelector items={items} onChange={setItems}/>}
        {step === 3 && (
          <OrderReview
            shopName={shopName}
            items={items}
            notes={notes}
            onNotesChange={setNotes}
            discount={discount}
            onDiscountChange={setDiscount}
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
          />
        )}
      </div>

      {/* Sticky CTA */}
      <div className="mt-6" style={{ marginBottom: "calc(60px + env(safe-area-inset-bottom, 0px) + 16px)" }}>
        <button
          data-testid="order-next"
          onClick={handleNext}
          disabled={!canNext() || createOrder.isPending}
          className="neo-btn-primary w-full py-3.5 text-[15px] disabled:opacity-40"
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
