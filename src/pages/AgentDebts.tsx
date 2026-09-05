import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ru as ruLocale } from "date-fns/locale";
import { Wallet, Phone, MapPin, Loader2, CheckCircle2 } from "lucide-react";
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

  if (isLoadingError) return <QueryErrorFallback onRetry={refetch} />;

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <div>
        <h1 className="font-display text-2xl font-bold text-primary tracking-tight">
          {t("Мои долги", "Mening qarzlarim")}
        </h1>
        <p className="text-sm" style={{ color: "var(--color-text-tertiary)" }}>
          {isLoading
            ? t("Загружаем…", "Yuklanmoqda…")
            : t(`${debts.length} заказов · ${fmt(total)}`, `${debts.length} ta · ${fmt(total)}`)}
        </p>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="rounded-2xl h-[104px] animate-pulse" style={{ background: "var(--color-surface-light)" }} />
          ))}
        </div>
      )}

      {!isLoading && debts.length === 0 && (
        // Пустой экран не оставляем немым: ноль долгов — это хорошая новость,
        // и агент должен понять, что ничего не сломалось.
        <div className="neo-card" style={{ padding: "32px", textAlign: "center" }}>
          <CheckCircle2 size={40} style={{ color: "var(--color-success-text)", margin: "0 auto 10px", display: "block" }} />
          <p style={{ margin: 0, fontWeight: 600, color: "var(--color-text-primary)" }}>
            {t("Долгов нет", "Qarz yo'q")}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--color-text-tertiary)" }}>
            {t("По вашим заказам всё оплачено", "Buyurtmalaringiz bo'yicha hammasi to'langan")}
          </p>
        </div>
      )}

      {debts.map(d => {
        const remaining = Number(d.remaining);
        const paid = Number(d.paid);
        return (
          <div key={d.orderId} className="neo-card" style={{ padding: "16px" }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p style={{ margin: 0, fontWeight: 600, color: "var(--color-text-primary)" }}>{d.shopName}</p>
                <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                  {d.orderNumber} · {format(typeof d.createdAt === "string" ? parseISO(d.createdAt) : d.createdAt, "d MMMM", lang === "uz" ? undefined : { locale: ruLocale })}
                </p>
              </div>
              <p style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--color-danger-text)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {fmt(remaining)}
              </p>
            </div>

            {/* Уже внесённое видно рядом: иначе агент не поймёт, почему остаток
                меньше суммы заказа, и заподозрит ошибку. */}
            {paid > 0 && (
              <p style={{ margin: "8px 0 0", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                {t("Оплачено", "To'langan")}: {fmt(paid)} {t("из", "dan")} {fmt(Number(d.total))}
              </p>
            )}

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
                  aria-label={t("Позвонить", "Qo'ng'iroq")}
                  className="neo-btn tap flex items-center justify-center"
                  style={{ width: 44 }}
                >
                  <Phone size={16} />
                </a>
              )}
            </div>

            {d.shopAddress && (
              <p style={{ margin: "8px 0 0", fontSize: "12px", color: "var(--color-text-tertiary)", display: "flex", alignItems: "center", gap: "4px" }}>
                <MapPin size={12} /> {d.shopAddress}
              </p>
            )}
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
          onClick={() => record.mutate({ orderId: debt.orderId, paidAmount: String(value), method })}
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
