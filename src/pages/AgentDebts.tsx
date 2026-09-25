import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { dateLocale } from "@/lib/date-locale";
import { Wallet, Phone, MapPin, Loader2, CheckCircle2, Search } from "lucide-react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { useInvalidateOrderCaches } from "@/hooks/useOrderCacheSync";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { AppModal } from "@/components/ui/AppModal";

/**
 * «Мои долги» — то, что магазины должны по заказам этого агента.
 *
 * Долговый заказ — обещание магазина заплатить позже, и собирать его едет тот
 * же агент. Места, где он видел бы свой список, в приложении не было: долг
 * показывался сводной цифрой на «Дне» и полностью — в отчёте, куда агента не
 * пускают. Собрать деньги можно было только через карточку заказа, до которой
 * ещё надо было додуматься.
 *
 * Что здесь считается долгом — ровно то же, что в расчёте долга магазина
 * (api/services/shop-debt.ts): иначе суммы у агента и у офиса разошлись бы.
 *
 * Оплата записывается тем же путём, что и везде (order.recordPartialPayment):
 * он сам ограничивает агента его собственными заказами, не даёт принять больше
 * остатка и оставляет след — запись в журнале и уведомление офису.
 */

type Debt = {
  orderId: number;
  orderNumber: string;
  paymentMethod: string;
  status: string;
  createdAt: string | Date;
  shopId: number;
  shopName: string;
  shopPhone: string | null;
  shopAddress: string | null;
  total: string;
  paid: string;
  remaining: string;
};

export default function AgentDebts() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (r: string, u: string) => (lang === "uz" ? u : r);
  const invalidateOrderCaches = useInvalidateOrderCaches();

  const { data, isLoading, isLoadingError, refetch } = trpc.agent.myDebts.useQuery();
  const debts = useMemo(() => (data ?? []) as Debt[], [data]);

  const total = useMemo(
    () => debts.reduce((s, d) => s + Number(d.remaining), 0),
    [debts],
  );

  const [collecting, setCollecting] = useState<Debt | null>(null);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();
  // Магазинов, а не строк: «шесть точек» — это шесть остановок за день.
  const shops = useMemo(() => new Set(debts.map(d => d.shopId)).size, [debts]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? debts.filter(d => d.shopName.toLowerCase().includes(q) || d.orderNumber.toLowerCase().includes(q)) : debts;
  }, [debts, search]);
  // Время открытия экрана — одно на все строки; при отрисовке часы не спрашиваем.
  const [now] = useState(() => Date.now());

  if (isLoadingError) return <QueryErrorFallback onRetry={refetch} />;

  /*
    Вид — «Мои долги» мобилки v8 (Warehouse-Pro-Mobile, app/debts.tsx): сумма
    и число точек, поиск, карточка долга с возрастом в днях и строкой звонка;
    нажатие открывает заказ. «Принять оплату» — своё у веба, остаётся.
  */
  return (
    <div className="space-y-3 max-w-lg mx-auto" data-testid="agent-debts">
      <div>
        <h1 className="hidden md:block font-display text-2xl font-bold text-primary tracking-tight">
          {t("Мои долги", "Mening qarzlarim")}
        </h1>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
          {isLoading
            ? t("Считаем…", "Hisoblanmoqda…")
            : t(`${fmt(total)} · ${shops} точек`, `${fmt(total)} · ${shops} ta do'kon`)}
        </p>
      </div>

      {debts.length > 0 && (
        <label className="flex items-center gap-2 px-4" style={{ background: "var(--color-field)", borderRadius: 16, height: 48, boxShadow: "var(--shadow-pressed)" }}>
          <Search size={16} color="var(--color-text-tertiary)" className="flex-shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("Магазин или номер заказа", "Do'kon yoki buyurtma raqami")}
            className="flex-1 min-w-0 bg-transparent outline-none" style={{ fontSize: 15, color: "var(--color-text-primary)" }} />
        </label>
      )}

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="rounded-2xl h-[104px] animate-pulse" style={{ background: "var(--color-surface-light)" }} />
          ))}
        </div>
      )}

      {!isLoading && shown.length === 0 && (
        <div style={{ background: "var(--color-surface)", boxShadow: "var(--shadow-raised)", borderRadius: 24, padding: 32, textAlign: "center" }}>
          <CheckCircle2 size={40} style={{ color: search ? "var(--color-text-tertiary)" : "var(--color-success-text)", margin: "0 auto 10px", display: "block" }} />
          <p style={{ margin: 0, fontWeight: 600, color: "var(--color-text-primary)" }}>
            {search ? t("Ничего не нашлось", "Hech narsa topilmadi") : t("Долгов нет", "Qarz yo'q")}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
            {search ? t("Попробуйте другое название", "Boshqa nom bilan urinib ko'ring") : t("По вашим заказам всё оплачено", "Buyurtmalaringiz bo'yicha hammasi to'langan")}
          </p>
        </div>
      )}

      {shown.map(d => {
        const remaining = Number(d.remaining);
        const paid = Number(d.paid);
        const created = typeof d.createdAt === "string" ? parseISO(d.createdAt) : d.createdAt;
        // Сколько дней висит: «вчера отгрузили» и «забыли полгода назад» по сумме одинаковы.
        const days = Math.max(0, Math.floor((now - created.getTime()) / 86_400_000));
        return (
          <div key={d.orderId} style={{ background: "var(--color-surface)", boxShadow: "var(--shadow-raised)", borderRadius: 24, padding: 16 }} data-testid="agent-debt-card">
            <button type="button" onClick={() => navigate(`/orders/${d.orderId}`)} className="w-full text-left flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block" style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>{d.shopName}</span>
                <span className="block font-data" style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                  {d.orderNumber} · {format(created, "d MMMM", { locale: dateLocale(lang) })}{days > 0 ? t(` · ${days} дн.`, ` · ${days} kun`) : ""}
                </span>
                {d.shopAddress && (
                  <span className="flex items-center gap-1 truncate" style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                    <MapPin size={12} className="flex-shrink-0" /> {d.shopAddress}
                  </span>
                )}
              </span>
              <span className="text-right flex-shrink-0">
                <span className="block font-data" style={{ fontSize: 17, fontWeight: 800, color: "var(--color-danger-text)", whiteSpace: "nowrap" }}>{fmt(remaining)}</span>
                {/* Частично оплаченное отличается от неоплаченного: «внесли половину» — другой разговор в точке. */}
                {paid > 0 && (
                  <span className="block font-data" style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                    {t(`из ${fmt(Number(d.total))}`, `${fmt(Number(d.total))} dan`)}
                  </span>
                )}
              </span>
            </button>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setCollecting(d)}
                className="neo-btn-primary tap flex-1 text-sm"
                data-testid={`collect-${d.orderId}`}
              >
                {t("Принять оплату", "To'lovni qabul qilish")}
              </button>
              {d.shopPhone && (
                <a
                  href={`tel:${d.shopPhone}`}
                  aria-label={t(`Позвонить в ${d.shopName}`, `${d.shopName} ga qo'ng'iroq`)}
                  className="tap flex items-center justify-center gap-1.5 rounded-xl px-3"
                  style={{ minHeight: 44, background: "var(--color-surface-light)", color: "var(--color-text-secondary)", fontSize: 13, fontWeight: 600, textDecoration: "none" }}
                >
                  <Phone size={14} /> {d.shopPhone}
                </a>
              )}
            </div>
          </div>
        );
      })}

      {collecting && (
        <CollectModal
          debt={collecting}
          onClose={() => setCollecting(null)}
          onDone={() => {
            setCollecting(null);
            invalidateOrderCaches();
            refetch();
          }}
        />
      )}
    </div>
  );
}

/** Приём оплаты по одному заказу. */
function CollectModal({ debt, onClose, onDone }: { debt: Debt; onClose: () => void; onDone: () => void }) {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (r: string, u: string) => (lang === "uz" ? u : r);

  const remaining = Number(debt.remaining);
  const [amount, setAmount] = useState(String(remaining));
  const [method, setMethod] = useState<"cash" | "card" | "transfer">("cash");
  // Один ключ на открытое окно: повтор после обрыва связи или двойное нажатие
  // шлёт тот же, и сервер записывает платёж один раз (см. PaymentForm.tsx).
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const record = trpc.order.recordPartialPayment.useMutation({
    onSuccess: () => {
      notify.success(t("Оплата принята", "To'lov qabul qilindi"));
      onDone();
    },
    onError: e => notify.error(e.message),
  });

  const value = Number(amount);
  /*
    Больше остатка принять нельзя — это же правило стоит и на сервере
    («Сумма оплаты не может превышать сумму заказа»). Здесь оно повторено не
    ради защиты, а ради разговора: отказ после нажатия хуже, чем погашенная
    кнопка и понятная подпись.
  */
  const tooMuch = value > remaining;
  const valid = value > 0 && !tooMuch;

  return (
    <AppModal
      open
      onClose={onClose}
      title={t("Принять оплату", "To'lovni qabul qilish")}
      subtitle={`${debt.shopName} · ${debt.orderNumber}`}
      maxWidth={420}
    >
      <div className="space-y-4" style={{ padding: "20px" }}>
        <div>
          <label className="font-label text-secondary text-xs block mb-1">
            {t("СУММА", "SUMMA")}
          </label>
          <input
            className="neo-input"
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            data-testid="collect-amount"
          />
          <p style={{ margin: "6px 0 0", fontSize: "12px", color: tooMuch ? "var(--color-danger-text)" : "var(--color-text-tertiary)" }}>
            {tooMuch
              ? t(`Больше остатка: ${fmt(remaining)}`, `Qoldiqdan ko'p: ${fmt(remaining)}`)
              : `${t("Остаток", "Qoldiq")}: ${fmt(remaining)}`}
          </p>
        </div>

        <div>
          <label className="font-label text-secondary text-xs block mb-1">
            {t("СПОСОБ", "USUL")}
          </label>
          <div className="flex gap-2">
            {(["cash", "card", "transfer"] as const).map(m => (
              <button
                key={m}
                onClick={() => setMethod(m)}
                className="tap flex-1 rounded-xl text-sm font-medium"
                style={
                  method === m
                    ? { background: "var(--color-primary)", color: "var(--color-on-primary, #fff)" }
                    : { border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }
                }
              >
                {m === "cash" ? t("Наличные", "Naqd") : m === "card" ? t("Карта", "Karta") : t("Перевод", "O'tkazma")}
              </button>
            ))}
          </div>
        </div>

        {/* Говорим прямо, что оплата уйдёт в офис. Не угроза, а честность:
            человек должен знать, что действие видно, — и тогда у него нет
            повода думать, будто оно незаметно. */}
        <p style={{ margin: 0, fontSize: "12px", color: "var(--color-text-tertiary)", display: "flex", gap: "6px", alignItems: "flex-start" }}>
          <Wallet size={14} style={{ flexShrink: 0, marginTop: "1px" }} />
          {t("Оплата записывается на ваше имя, офис получает уведомление.",
             "To'lov sizning nomingizga yoziladi, ofis xabar oladi.")}
        </p>

        <button
          onClick={() => record.mutate({ orderId: debt.orderId, paidAmount: String(value), method, idempotencyKey })}
          disabled={!valid || record.isPending}
          className="neo-btn-primary tap w-full disabled:opacity-40"
          data-testid="collect-submit"
        >
          {record.isPending
            ? <Loader2 size={16} className="animate-spin" />
            : t("Принять", "Qabul qilish")}
        </button>
      </div>
    </AppModal>
  );
}
