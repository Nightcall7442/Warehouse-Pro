import { useState, useEffect } from "react";
import { trpc } from "@/providers/trpc";
import { useInvalidateOrderCaches } from "@/hooks/useOrderCacheSync";
import { notify } from "@/lib/toast";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { useNavigate, useSearchParams, useLocation, Outlet, useOutletContext } from "react-router";
import { useLang } from "@/i18n";
import { Loader2, WifiOff, ShoppingCart, ChevronUp } from "lucide-react";
import { savePendingOrder } from "./OfflineOrders.helpers";
import { saveDraft, loadDraft, clearDraft, draftHasWork } from "./NewOrder.draft";
import { Steps, ShopSelector, ProductSelector, OrderReview } from "@/components/orders";
import type { OrderItem, PaymentMethod } from "@/components/orders";
import { EMPTY_ITEM } from "@/components/orders";

const LABELS_RU = ["Магазин", "Товары", "Итог"];
const LABELS_UZ = ["Do'kon", "Mahsulotlar", "Xulosa"];

/* ═══════════════════════════════════════════════════════════════════════════
   НОВЫЙ ЗАКАЗ — три шага, три адреса.

   Шаг хранился в useState, а «назад» была нарисованной кнопкой в шапке.
   Системная «назад» — кнопка браузера, жест от края на телефоне, аппаратная
   клавиша на Android — про шаги не знала и уводила со страницы целиком,
   унося выбранный магазин и набранную корзину. Обновление страницы делало то
   же самое.

   Теперь у каждого шага свой адрес: /orders/new, /orders/new/items,
   /orders/new/review. Состояние живёт здесь, в общем родителе, и переходы
   между шагами его не рушат — этот компонент не размонтируется.

   ── Что при обновлении страницы ───────────────────────────────────────────

   Состояние всё же в памяти: перезагрузка на шаге товаров оставила бы пустой
   заказ с непонятным экраном. Поэтому шаг, которому не хватает данных,
   возвращает на первый — молча и сразу, вместо показа пустоты.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Всё, что шаги читают у родителя. */
interface OrderWizard {
  shopId: number;
  shopName: string;
  setShop: (id: number, name: string) => void;
  items: OrderItem[];
  setItems: (items: OrderItem[]) => void;
  notes: string;
  setNotes: (v: string) => void;
  discount: string;
  setDiscount: (v: string) => void;
  paymentMethod: PaymentMethod;
  setPaymentMethod: (v: PaymentMethod) => void;
  cartOpen: boolean;
  setCartOpen: (v: boolean) => void;
}

const useWizard = () => useOutletContext<OrderWizard>();

/** Шаг 1 — магазин. */
export function NewOrderShopStep() {
  const w = useWizard();
  return <ShopSelector shopId={w.shopId} onSelect={w.setShop} />;
}

/** Шаг 2 — товары. */
export function NewOrderItemsStep() {
  const w = useWizard();
  return (
    <ProductSelector
      items={w.items}
      onChange={w.setItems}
      cartOpen={w.cartOpen}
      onCartOpenChange={w.setCartOpen}
    />
  );
}

/** Шаг 3 — итог. */
export function NewOrderReviewStep() {
  const w = useWizard();
  return (
    <OrderReview
      shopName={w.shopName}
      items={w.items}
      notes={w.notes}
      onNotesChange={w.setNotes}
      discount={w.discount}
      onDiscountChange={w.setDiscount}
      paymentMethod={w.paymentMethod}
      onPaymentMethodChange={w.setPaymentMethod}
    />
  );
}

/** Адреса шагов по порядку: индекс массива + 1 = номер шага. */
const STEP_PATHS = ["/orders/new", "/orders/new/items", "/orders/new/review"] as const;

export default function NewOrder() {
  const { user }       = useAuth();
  const { lang }       = useLang();
  const { fmt }        = useCurrency();
  const navigate       = useNavigate();
  const location       = useLocation();
  const [searchParams] = useSearchParams();

  const initialShopId = Number(searchParams.get("shopId") ?? 0);
  const [shopId,   setShopId]   = useState(initialShopId);
  const [shopName, setShopName] = useState("");
  const [items,    setItems]    = useState<OrderItem[]>([{ ...EMPTY_ITEM }]);
  const [notes,    setNotes]    = useState("");
  const [discount, setDiscount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  // Открыта ли панель корзины. Признак нужен только на мобильном, но живёт
  // здесь: кнопка-итог стоит в нижней строке этой страницы, а сама панель —
  // внутри ProductSelector, и общий родитель у них только этот.
  const [cartOpen, setCartOpen] = useState(false);

  // Шаг — из адреса, а не из состояния. Единственный источник истины.
  const step = location.pathname.startsWith("/orders/new/review") ? 3
             : location.pathname.startsWith("/orders/new/items")  ? 2
             : 1;

  const goToStep = (next: number) => {
    // Смена шага всегда закрывает корзину. Иначе, уйдя с открытой панелью на
    // «Итог» и вернувшись назад, пользователь получил бы её снова раскрытой
    // поверх каталога — состояние пережило бы размонтирование панели.
    setCartOpen(false);
    navigate(STEP_PATHS[next - 1]);
  };

  /*
    Заход сразу на внутренний шаг — по ссылке или после обновления страницы.

    Состояние в памяти, и перезагрузка на /orders/new/items оставила бы
    выбранный магазин пустым: экран без товаров, кнопка «Продолжить» гаснет,
    и почему — неоткуда узнать. Возвращаем на первый шаг, заменяя запись в
    истории: «назад» тогда уводит туда, откуда человек пришёл, а не в
    только что покинутый тупик.
  */
  useEffect(() => {
    if (step > 1 && shopId === 0) navigate(STEP_PATHS[0], { replace: true });
  }, [step, shopId, navigate]);

  /*
    Приход с готовым магазином — из карточки магазина: /orders/new?shopId=5.
    Прежде это ставило шаг 2 начальным значением состояния; теперь шаг — это
    адрес, поэтому переход делается явно, тоже с заменой записи в истории.
  */
  useEffect(() => {
    if (initialShopId > 0 && step === 1) navigate(STEP_PATHS[1], { replace: true });
    // Только на первый показ: дальше человек ходит по шагам сам.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialShopId]);

  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const LABELS = lang === "uz" ? LABELS_UZ : LABELS_RU;

  /*
    Черновик: восстановить набранное при возвращении.

    На шаге «Товары» между кнопкой «Продолжить» и вкладками внизу всего 10
    точек. Промах пальцем по «Каталогу» или «Моим заказам» — и весь набранный
    заказ исчезал: возврат на «Заказ» открывал пустой первый шаг, ни вопроса
    «уйти?», ни следа набранного. То же делала перезагрузка страницы.

    Приход с готовым магазином из карточки (?shopId=5) черновик не трогает:
    человек только что назвал магазин явно, и подменять его прошлым набором
    нельзя.
  */
  useEffect(() => {
    if (!user || initialShopId > 0) return;
    const draft = loadDraft(user.id);
    if (!draft || !draftHasWork(draft)) return;
    /*
      Правило про setState в эффекте здесь снимается осознанно, а не по
      недосмотру.

      Начальным значением состояния черновик подставить нельзя: он привязан к
      владельцу, а личность приходит ответом сервера (auth.me, кука httpOnly),
      то есть на первом показе её ещё нет. Это ровно тот случай, который само
      правило и разрешает — приход данных из внешнего источника; отличие лишь
      в том, что источник отвечает один раз, и подписка выродилась в эффект.
    */
    /* eslint-disable react-hooks/set-state-in-effect */
    setShopId(draft.shopId);
    setShopName(draft.shopName);
    setItems(draft.items);
    setNotes(draft.notes);
    setDiscount(draft.discount);
    setPaymentMethod(draft.paymentMethod);
    /* eslint-enable react-hooks/set-state-in-effect */
    notify.info(t("Продолжаем набранный заказ", "Boshlangan buyurtma tiklandi"));
    // Только на первый показ: дальше правит человек, и перезаписывать его
    // ввод сохранённым — худшее, что можно сделать.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Сохраняем на каждое изменение. Запись крошечная и уходит в память
  // браузера, отдельно откладывать её незачем.
  useEffect(() => {
    if (!user) return;
    const draft = { shopId, shopName, items, notes, discount, paymentMethod };
    if (draftHasWork(draft)) saveDraft(user.id, draft);
    else clearDraft(user.id);
  }, [user, shopId, shopName, items, notes, discount, paymentMethod]);


  const invalidateOrderCaches = useInvalidateOrderCaches();
  const createOrder = trpc.order.create.useMutation({
    onSuccess: () => {
      invalidateOrderCaches();
      // Заказ ушёл — черновику конец. Иначе следующий заход на «Заказ»
      // предложил бы продолжить только что отправленный.
      if (user) clearDraft(user.id);
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
    if (step < 3) { goToStep(step + 1); return; }

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
          // Заказ лёг в очередь — он больше не черновик.
          clearDraft(user.id);
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

  // Для панели снизу на шаге «Товары»: сколько позиций и на какую сумму,
  // чтобы корзину было видно, не прокручивая список до конца.
  const validItems = items.filter(i => i.productId > 0 && Number(i.quantity) > 0);
  const cartSubtotal = validItems.reduce((s, i) => s + Number(i.unitPrice) * Number(i.quantity), 0);

  const wizard: OrderWizard = {
    shopId, shopName,
    setShop: (id, name) => { setShopId(id); setShopName(name); },
    items, setItems,
    notes, setNotes,
    discount, setDiscount,
    paymentMethod, setPaymentMethod,
    cartOpen, setCartOpen,
  };

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

          Кнопка «назад» осталась, но теперь делает то же, что системная:
          отдаёт шаг назад по истории. Раньше она вычитала единицу из
          состояния, а системная «назад» уводила со страницы целиком — две
          кнопки с одной стрелкой вели себя по-разному. */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 flex items-center justify-center rounded-lg border btn-ghost flex-shrink-0"
          style={{ borderColor: "var(--color-border, #d8d5cd)" }}
          aria-label={t("Назад", "Orqaga")}
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

      {/* Content.
          order-page-content резервирует место под панель снизу только на
          мобильном — там она fixed и вываливается из потока. На десктопе
          класс ничего не делает (см. index.css): кнопка там в обычном
          потоке, как и раньше. */}
      <div className="min-h-[320px] order-page-content">
        <Outlet context={wizard} />
      </div>

      {/* Панель снизу: итог корзины + кнопка.
          Раньше кнопка стояла обычным блоком в конце страницы — чтобы её
          нажать на шаге «Товары», нужно было долистать весь каталог до
          конца. При двухстах товарах в списке это и значило «очень
          неудобно»: ни сумму заказа не видно по пути, ни до кнопки не
          дотянуться, не прокрутив всё целиком.

          order-action-bar (index.css) на мобильном — fixed-панель прямо
          над нижней навигацией, видна всегда, независимо от прокрутки
          каталога. На десктопе превращается обратно в обычный блок в
          потоке: там уже есть отдельная колонка корзины сбоку (sticky
          .order-cart-panel), плавающая панель внизу была бы лишней. */}
      <div className="order-action-bar">
        {/* Итог — кнопка, а не подпись.
            Показать сумму было полдела: корзина всё равно оставалась внизу
            страницы, под всем каталогом, и чтобы поправить в ней количество
            или убрать позицию, приходилось листать двести строк туда и
            столько же обратно. Теперь это открывает корзину панелью снизу,
            не сдвигая каталог. На десктопе кнопка скрыта (правило
            order-action-bar-summary в index.css): там корзина и так стоит
            отдельной колонкой справа и никуда не девается. */}
        {step === 2 && validItems.length > 0 && (
          <button
            type="button"
            data-testid="open-cart"
            aria-expanded={cartOpen}
            aria-label={t("Открыть корзину", "Savatni ochish")}
            onClick={() => setCartOpen(true)}
            className="order-action-bar-summary"
          >
            <ShoppingCart size={15} style={{ flexShrink: 0, color: "var(--color-text-tertiary, #6b6760)" }} />
            <span style={{ fontSize: "13px", color: "var(--color-text-secondary, #5e5b54)" }}>
              {validItems.length} {t("тов.", "dona")}
            </span>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary, #2b2a28)" }}>
              {fmt(cartSubtotal.toFixed(2))}
            </span>
            <ChevronUp size={14} style={{ flexShrink: 0, color: "var(--color-text-tertiary, #6b6760)" }} />
          </button>
        )}
        <button
          data-testid="order-next"
          onClick={handleNext}
          disabled={!canNext() || createOrder.isPending}
          className="neo-btn-primary order-action-bar-button py-3.5 text-[15px] disabled:opacity-40"
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
