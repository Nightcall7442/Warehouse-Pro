import { useState } from "react";
import { Plus, Minus, Loader2, PhoneCall } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { EXTRA_PRICES_UZS } from "@contracts/constants";

/**
 * Докупить места или позиции сверх тарифа.
 *
 * ── Чего не хватало ─────────────────────────────────────────────────────────
 *
 * Возможность была со всех сторон, кроме той, где стоит человек: лендинг
 * называл цену надбавки, отказ при упоре в предел советовал «докупите
 * позиции», подписка показывала уже докупленное и брала за него деньги, а
 * суперадмин умел надбавку выставить. И только сам директор попросить не мог
 * ничем: он упирался в предел, читал «докупите», открывал «Подписку» — и не
 * находил там ничего.
 *
 * ── Почему заявка, а не кнопка «оплатить» ───────────────────────────────────
 *
 * Оплата к продукту не подключена: переход на старший тариф здесь тоже
 * оформляется заявкой и звонком. Выдать места сразу значило бы отдать их
 * бесплатно.
 *
 * ── Почему цена показана, но не отправляется ────────────────────────────────
 *
 * Показать её обязательно — иначе человек нажимает, не зная суммы. А считает
 * её заново сервер, из того же источника: иначе в заявке стояла бы сумма,
 * которую назвал браузер, а не та, по которой выставят счёт.
 */
export function ExtraLimitsCard({ t }: { t: (ru: string, uz: string) => string }) {
  const utils = trpc.useUtils();
  const [users, setUsers] = useState(0);
  const [products, setProducts] = useState(0);

  const request = trpc.billing.requestExtra.useMutation({
    onSuccess: (r) => {
      notify.success(r.message);
      setUsers(0);
      setProducts(0);
      // Надбавку выставляет человек, и сразу она не появится. Но состояние
      // подписки обновить стоит: вдруг оператор уже отработал прошлую заявку.
      utils.billing.status.invalidate();
    },
    onError: (e) => notify.error(e.message),
  });

  const priceMonthly = users * EXTRA_PRICES_UZS.user + products * EXTRA_PRICES_UZS.product;
  const nothingAsked = users === 0 && products === 0;

  const stepper = (
    label: string,
    unitPrice: number,
    value: number,
    set: (v: number) => void,
  ) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: "13.5px", fontWeight: 600, color: "var(--color-text-primary)" }}>{label}</p>
        <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
          {unitPrice.toLocaleString("ru")} {t("сум/мес за штуку", "so'm/oy donasiga")}
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <button
          type="button"
          className="neo-btn"
          aria-label={t(`Убавить: ${label}`, `Kamaytirish: ${label}`)}
          disabled={value === 0 || request.isPending}
          onClick={() => set(Math.max(0, value - 5))}
          style={{ padding: "8px 10px" }}
        >
          <Minus size={14} />
        </button>
        <input
          type="number"
          min={0}
          max={1000}
          value={value}
          aria-label={label}
          onChange={e => {
            // Потолок тот же, что на сервере: тысяча. Он не про щедрость, а
            // про промах по клавиатуре.
            const n = Math.floor(Number(e.target.value));
            set(Number.isFinite(n) ? Math.min(1000, Math.max(0, n)) : 0);
          }}
          className="neo-input"
          style={{ width: "84px", textAlign: "center", fontVariantNumeric: "tabular-nums" }}
        />
        <button
          type="button"
          className="neo-btn"
          aria-label={t(`Прибавить: ${label}`, `Qo'shish: ${label}`)}
          disabled={value >= 1000 || request.isPending}
          onClick={() => set(Math.min(1000, value + 5))}
          style={{ padding: "8px 10px" }}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="neo-card neo-card-static" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "18px" }}>
      <div>
        <p style={{
          fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
          color: "var(--color-text-tertiary)",
        }}>
          {t("Докупить сверх тарифа", "Tarifdan ortiq sotib olish")}
        </p>
        <p style={{ fontSize: "12.5px", color: "var(--color-text-secondary)", marginTop: "6px", maxWidth: "58ch" }}>
          {t(
            "Не хватает мест или позиций, а переходить на старший тариф незачем — добавьте столько, сколько нужно.",
            "Joy yoki mahsulot yetmayapti, lekin yuqori tarifga o'tish shart emas — kerakligicha qo'shing.",
          )}
        </p>
      </div>

      {stepper(t("Места сотрудников", "Xodim joylari"), EXTRA_PRICES_UZS.user, users, setUsers)}
      {stepper(t("Позиции каталога", "Katalog mahsulotlari"), EXTRA_PRICES_UZS.product, products, setProducts)}

      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "12px", flexWrap: "wrap",
        paddingTop: "14px", borderTop: "1px solid var(--color-border-subtle)",
      }}>
        <div>
          <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {t("Доплата к тарифу", "Tarifga qo'shimcha")}
          </p>
          <p style={{
            fontSize: "19px", fontWeight: 700, color: "var(--color-text-primary)",
            fontVariantNumeric: "tabular-nums", lineHeight: 1.2,
          }}>
            {priceMonthly.toLocaleString("ru")} {t("сум/мес", "so'm/oy")}
          </p>
        </div>

        <button
          type="button"
          className="neo-btn-primary"
          disabled={nothingAsked || request.isPending}
          onClick={() => request.mutate({ users, products })}
          style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "11px 20px" }}
        >
          {request.isPending
            ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
            : <PhoneCall size={15} />}
          {t("Отправить заявку", "Ariza yuborish")}
        </button>
      </div>

      <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>
        {t(
          "Оплата пока принимается вручную: оператор перезвонит и включит надбавку. Она остаётся при смене тарифа.",
          "To'lov hozircha qo'lda qabul qilinadi: operator qo'ng'iroq qilib qo'shimchani yoqadi. Tarif o'zgarganda ham saqlanadi.",
        )}
      </p>
    </div>
  );
}
