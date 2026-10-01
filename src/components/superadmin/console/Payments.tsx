import { useMemo, useState } from "react";
import { Wallet, Receipt } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { PremiumSelect } from "@/components/PremiumSelect";
import { PLAN_PRICES_UZS } from "@contracts/constants";
import { TENANT_PLAN_LABEL } from "@contracts/entity-labels";
import {
  PAID_PLANS, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, paymentPeriod, tashkentDay,
  type PaidPlan, type PaymentMethod,
} from "@contracts/subscription-payment";
import { subOf, type Detail } from "./detail";
import { dayOf, money } from "./format";
import { Empty, FieldLabel, Panel, Pill, PlanPill } from "./ui";

/* ═══════════════════════════════════════════════════════════════════════════
   «Записать оплату» и список оплат — вкладка «Подписка» карточки.

   Одна форма делает оба дела: записывает оплату и продлевает подписку на её
   период. Раньше было два раздельных шага («Изменить тариф» и… ничего — оплата
   не записывалась вовсе), и разошедшиеся шаги — это либо заплативший, которого
   заперло, либо продление, за которое никто не платил.

   Сумма предзаполнена: цена тарифа × месяцы. Поправить можно (скидка,
   доплата за места) — после правки руками она больше не пересчитывается сама.
   Период — от конца оплаченного, тем же правилом, что считает сервер
   (contracts/subscription-payment): что видно до нажатия, то и запишется.
   ═══════════════════════════════════════════════════════════════════════════ */

const PLAN_OPTIONS = PAID_PLANS.map(p => ({ value: p, label: `${TENANT_PLAN_LABEL[p].ru} · ${money(PLAN_PRICES_UZS[p])} сум/мес` }));
const METHOD_OPTIONS = PAYMENT_METHODS.map(m => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }));
const input = { minHeight: 44, fontSize: 14 } as const;

export function PaymentForm({ d, onChanged }: { d: Detail; onChanged: () => void }) {
  const sub = subOf(d);
  const utils = trpc.useUtils();
  const current = (sub?.plan ?? d.tenant.plan) as string;
  const [plan, setPlan] = useState<PaidPlan>((PAID_PLANS as readonly string[]).includes(current) ? (current as PaidPlan) : "basic");
  const [months, setMonths] = useState(1);
  const [amountText, setAmountText] = useState<string | null>(null);
  const [paidAt, setPaidAt] = useState(() => tashkentDay(new Date()));
  const [method, setMethod] = useState<PaymentMethod>("transfer");
  const [note, setNote] = useState("");

  const suggested = PLAN_PRICES_UZS[plan] * months;
  const amount = amountText === null ? suggested : Number(amountText.replace(/\D/g, ""));
  const period = useMemo(() => paymentPeriod(sub, Math.max(1, months), new Date()), [sub, months]);

  const record = trpc.platform.recordPayment.useMutation({
    onSuccess: r => {
      notify.success(`Оплата записана, оплачено до ${dayOf(r.periodTo)}`);
      setAmountText(null); setNote("");
      void utils.platform.payments.invalidate({ tenantId: d.tenant.id });
      void utils.platform.paymentsSummary.invalidate();
      void utils.platform.journal.invalidate();
      onChanged();
    },
    onError: e => notify.error(e.message),
  });

  const valid = amount > 0 && months >= 1 && months <= 36 && /^\d{4}-\d{2}-\d{2}$/.test(paidAt);

  return (
    <section className="neo-card neo-card-static console-form lg:col-span-2" style={{ padding: 18, borderRadius: 20 }} data-testid="sub-payment">
      <div className="flex items-center gap-2.5" style={{ marginBottom: 4 }}>
        <span className="flex items-center justify-center flex-shrink-0" style={{ width: 32, height: 32, borderRadius: 10, background: "var(--color-success-subtle)" }}>
          <Wallet size={16} color="var(--color-success-text)" />
        </span>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>Записать оплату</h3>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--color-text-secondary)", margin: "0 0 14px 42px", lineHeight: 1.5 }}>
        Оплата записывается и сразу продлевает подписку на свой период — от конца оплаченного срока.
      </p>

      {/* Телефон — по два поля в ряд (тариф во всю ширину): иначе форма в два экрана. */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_110px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-end">
        <div className="col-span-2 lg:col-span-1">
          <FieldLabel>Тариф</FieldLabel>
          <PremiumSelect value={plan} onChange={v => { setPlan(v as PaidPlan); }} options={PLAN_OPTIONS} width="100%" aria-label="Тариф оплаты" />
        </div>
        <div>
          <FieldLabel htmlFor="pay-months">Месяцев</FieldLabel>
          <input id="pay-months" type="number" min={1} max={36} value={months} data-testid="pay-months"
            onChange={e => setMonths(Math.max(1, Math.min(36, Number(e.target.value) || 1)))} className="neo-input w-full" style={input} />
        </div>
        <div>
          <FieldLabel htmlFor="pay-amount">Сумма, сум</FieldLabel>
          <input id="pay-amount" inputMode="numeric" value={amountText ?? money(suggested)} data-testid="pay-amount"
            onChange={e => setAmountText(e.target.value)} className="neo-input w-full" style={{ ...input, fontVariantNumeric: "tabular-nums" }} />
        </div>
        <div>
          <FieldLabel htmlFor="pay-date">Дата оплаты</FieldLabel>
          <input id="pay-date" type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} data-testid="pay-date" className="neo-input w-full" style={input} />
        </div>
        <div>
          <FieldLabel>Способ</FieldLabel>
          <PremiumSelect value={method} onChange={v => setMethod(v as PaymentMethod)} options={METHOD_OPTIONS} width="100%" aria-label="Способ оплаты" />
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <FieldLabel htmlFor="pay-note">Примечание</FieldLabel>
        <input id="pay-note" value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="Например: скидка 10% за год, счёт № 14" className="neo-input w-full" style={input} data-testid="pay-note" />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap" style={{ marginTop: 14, padding: "12px 14px", borderRadius: 14, background: "var(--color-surface-light)", boxShadow: "var(--shadow-pressed)" }}>
        <div className="min-w-0" style={{ fontSize: 13.5, lineHeight: 1.5 }}>
          <div>
            Период: <b data-testid="pay-period" style={{ fontVariantNumeric: "tabular-nums" }}>{dayOf(period.fromDay)} — {dayOf(period.toDay)}</b>
          </div>
          <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)" }}>
            {amountText !== null && amount !== suggested
              ? `По прайсу было бы ${money(suggested)} сум — сумма изменена руками`
              : `${TENANT_PLAN_LABEL[plan].ru} × ${months} мес. по прайсу`}
          </div>
        </div>
        <button type="button" className="neo-btn-primary w-full sm:w-auto" style={{ minHeight: 44 }} data-testid="pay-submit"
          disabled={!valid || record.isPending}
          onClick={() => record.mutate({ tenantId: d.tenant.id, amount, paidAt, method, plan, months, note: note.trim() || undefined })}>
          {record.isPending ? "Записываю…" : `Записать ${money(amount)} сум и продлить`}
        </button>
      </div>
    </section>
  );
}

export function PaymentsList({ tenantId }: { tenantId: number }) {
  const { data, isLoading } = trpc.platform.payments.useQuery({ tenantId });
  const total = (data ?? []).reduce((s, p) => s + Number(p.amount), 0);
  return (
    <Panel title="Оплаты" count={data?.length} flush testId="sub-payments"
      action={data && data.length > 0 ? <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>всего {money(total)} сум</span> : undefined}>
      {isLoading ? <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0, padding: "4px 20px 14px" }}>Загрузка…</p>
        : !data || data.length === 0 ? <Empty icon={Receipt} title="Оплат пока нет" hint="Записанная оплата появится здесь и сразу продлит подписку." />
          : data.map((p, i) => (
            <div key={p.id} className="flex items-start gap-3 flex-wrap" style={{ padding: "12px 20px", borderTop: i > 0 ? "1px solid var(--color-border-subtle)" : undefined }} data-testid="payment-row">
              <span className="flex items-center justify-center flex-shrink-0" style={{ width: 38, height: 38, borderRadius: 12, background: "var(--color-success-subtle)" }}>
                <Receipt size={17} color="var(--color-success-text)" />
              </span>
              <div className="min-w-0" style={{ flex: "1 1 220px" }}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span style={{ fontSize: 15, fontWeight: 800, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>{money(Number(p.amount))} сум</span>
                  <Pill>{PAYMENT_METHOD_LABEL[p.method as PaymentMethod] ?? p.method}</Pill>
                  <PlanPill plan={p.plan} />
                </div>
                <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginTop: 3, lineHeight: 1.45 }}>
                  оплачено {dayOf(p.paidAt)} · период {dayOf(p.periodFrom)} — {dayOf(p.periodTo)} · {p.months} мес.
                </div>
                {p.note && <div style={{ fontSize: 12.5, color: "var(--color-text-primary)", marginTop: 3, overflowWrap: "anywhere" }}>{p.note}</div>}
              </div>
              <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", whiteSpace: "nowrap" }}>{p.recordedByName ?? "—"}</span>
            </div>
          ))}
    </Panel>
  );
}
