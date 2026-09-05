import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ru as ruLocale } from "date-fns/locale";
import { Wallet, TrendingUp, Users as UsersIcon, HandCoins, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { AppModal } from "@/components/ui/AppModal";

/**
 * Зарплаты — сколько организация начислила за период, сколько отдала и сколько
 * осталась должна.
 *
 * Расчёт существовал и раньше (kpi.salaryReport), но его никто не показывал:
 * эндпоинт был мёртвым, а числа по людям приходилось собирать по карточкам
 * KPI поодиночке. Фонда оплаты — то есть суммы, которая уходит из кассы, — не
 * было видно нигде.
 *
 * Начисление складывается из трёх частей, и экран показывает их отдельно,
 * потому что вопрос директора обычно не «сколько всего», а «почему столько»:
 *
 *   • оклад — из плановой суммы по сотруднику;
 *   • комиссия — процент от того, что человек продал;
 *   • премия — от выполнения KPI.
 *
 * У оператора, супервайзера и курьера комиссия и премия выходят нулём сами
 * собой: и то и другое считается от заказов, которые человек ОФОРМИЛ, а они их
 * не оформляют. Поэтому у них вся выплата — оклад, и это видно по строке.
 *
 * Начисленное — ещё не отданное. Выдачу денег система не знала вовсе: учёт
 * вёлся на стороне, и спор «мне за март не платили» разрешать было нечем.
 * Теперь каждая выдача — запись с суммой, датой и тем, кто её сделал; аванс
 * от выплаты отличается только тем, что выдан до конца периода.
 */

const PERIODS = [
  { value: "week"    as const, ru: "Неделя",  uz: "Hafta" },
  { value: "month"   as const, ru: "Месяц",   uz: "Oy" },
  { value: "quarter" as const, ru: "Квартал", uz: "Chorak" },
];

const ROLE_LABEL: Record<string, { ru: string; uz: string }> = {
  ceo:          { ru: "Руководитель", uz: "Rahbar" },
  operator:     { ru: "Оператор",     uz: "Operator" },
  supervisor:   { ru: "Супервайзер",  uz: "Supervayzer" },
  agent:        { ru: "Агент",        uz: "Agent" },
  merchandiser: { ru: "Мерчендайзер", uz: "Merchandayzer" },
  courier:      { ru: "Курьер",       uz: "Kuryer" },
};

type Row = {
  agentId: number;
  agentName: string;
  role: string;
  baseSalary: number;
  commissionRate: number;
  salesAmount: number;
  commissionAmount: number;
  bonusAmount: number;
  totalSalary: number;
};

type Payout = {
  id: number;
  userId: number;
  userName: string;
  kind: "payout" | "advance";
  amount: string;
  paidAt: string | Date;
  note: string | null;
  paidByName: string | null;
};

const asDate = (v: string | Date) => (typeof v === "string" ? parseISO(v) : v);

export default function Salaries() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (r: string, u: string) => (lang === "uz" ? u : r);
  const utils = trpc.useUtils();

  const [period, setPeriod] = useState<"week" | "month" | "quarter">("month");
  const [paying, setPaying] = useState<{ row: Row; due: number } | null>(null);

  const { data, isLoading, isLoadingError, refetch } = trpc.kpi.salaryReport.useQuery({ period });
  const paidQuery = trpc.kpi.payouts.useQuery({ period });

  const rows = useMemo(() => {
    const list = (data ?? []) as Row[];
    // Самые дорогие сверху: директор смотрит этот экран, чтобы понять, куда
    // уходит фонд, а не чтобы читать список по алфавиту.
    return [...list].sort((a, b) => b.totalSalary - a.totalSalary);
  }, [data]);

  const paidByUser = useMemo(() => {
    const map = new Map<number, { total: number; entries: Payout[] }>();
    for (const p of (paidQuery.data ?? []) as Payout[]) {
      const cur = map.get(p.userId) ?? { total: 0, entries: [] };
      cur.total += Number(p.amount ?? 0);
      cur.entries.push(p);
      map.set(p.userId, cur);
    }
    return map;
  }, [paidQuery.data]);

  const totals = useMemo(() => {
    const accrued = rows.reduce(
      (acc, r) => ({
        base:       acc.base + Number(r.baseSalary ?? 0),
        commission: acc.commission + Number(r.commissionAmount ?? 0),
        bonus:      acc.bonus + Number(r.bonusAmount ?? 0),
        total:      acc.total + Number(r.totalSalary ?? 0),
      }),
      { base: 0, commission: 0, bonus: 0, total: 0 },
    );
    // Выплачено — по всем записям периода, включая тех, кого уже нет в
    // списке: деньги из кассы ушли, и прятать их нельзя.
    const paid = [...paidByUser.values()].reduce((s, v) => s + v.total, 0);
    /*
      Остаток — по каждому отдельно и не ниже нуля. Переплата одному не
      закрывает долг перед другим, а вычесть её из общего числа значило бы
      показать директору меньше, чем он на самом деле должен раздать.
    */
    const due = rows.reduce(
      (s, r) => s + Math.max(0, Number(r.totalSalary ?? 0) - (paidByUser.get(r.agentId)?.total ?? 0)),
      0,
    );
    return { ...accrued, paid, due };
  }, [rows, paidByUser]);

  if (isLoadingError) return <QueryErrorFallback onRetry={refetch} />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary tracking-tight">
            {t("Зарплаты", "Ish haqi")}
          </h1>
          <p className="text-sm" style={{ color: "var(--color-text-tertiary)" }}>
            {isLoading ? t("Считаем…", "Hisoblanmoqda…") : t(`${rows.length} сотрудников`, `${rows.length} xodim`)}
          </p>
        </div>
        <div className="flex gap-1.5">
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`tap px-3 rounded-lg text-xs font-semibold transition-all ${period === p.value ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-light)] text-[var(--color-text-secondary)]"}`}
            >
              {lang === "uz" ? p.uz : p.ru}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl h-20 animate-pulse" style={{ background: "var(--color-surface-light)" }} />
          ))}
        </div>
      )}

      {!isLoading && (
        <>
          {/* Деньги в трёх состояниях: начислено, отдано, осталось отдать. */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <Tile label={t("ФОНД ОПЛАТЫ", "ISH HAQI FONDI")} value={fmt(totals.total)} icon={<Wallet size={18} />} accent />
            <Tile label={t("ВЫПЛАЧЕНО", "TO'LANGAN")} value={fmt(totals.paid)} icon={<HandCoins size={18} />} />
            <Tile label={t("К ВЫПЛАТЕ", "TO'LANADI")} value={fmt(totals.due)} icon={<HandCoins size={18} />} />
          </div>

          {/* Из чего сложился фонд. */}
          <div className="grid grid-cols-3 gap-3">
            <Tile label={t("ОКЛАДЫ", "MAOSHLAR")} value={fmt(totals.base)} icon={<UsersIcon size={18} />} />
            <Tile label={t("КОМИССИЯ", "KOMISSIYA")} value={fmt(totals.commission)} icon={<TrendingUp size={18} />} />
            <Tile label={t("ПРЕМИИ", "MUKOFOTLAR")} value={fmt(totals.bonus)} icon={<TrendingUp size={18} />} />
          </div>

          {rows.length === 0 && (
            <div className="neo-card" style={{ padding: "32px", textAlign: "center", color: "var(--color-text-tertiary)" }}>
              <Wallet size={32} style={{ margin: "0 auto 10px", display: "block" }} />
              <p style={{ margin: 0 }}>{t("Сотрудников нет", "Xodimlar yo'q")}</p>
            </div>
          )}

          {/* Карточками, а не таблицей: у строки пять денежных величин, и на
              телефоне таблица из них либо обрезается, либо жмётся в кашу. */}
          <div className="space-y-3">
            {rows.map(r => {
              const role = ROLE_LABEL[r.role];
              const base = Number(r.baseSalary ?? 0);
              const commission = Number(r.commissionAmount ?? 0);
              const bonus = Number(r.bonusAmount ?? 0);
              const paid = paidByUser.get(r.agentId);
              const due = Number(r.totalSalary ?? 0) - (paid?.total ?? 0);
              return (
                <div key={r.agentId} className="neo-card" style={{ padding: "16px" }} data-testid={`salary-row-${r.agentId}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p style={{ margin: 0, fontWeight: 600, color: "var(--color-text-primary)" }}>{r.agentName}</p>
                      <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                        {role ? (lang === "uz" ? role.uz : role.ru) : r.role}
                        {commission > 0 && ` · ${r.commissionRate}%`}
                      </p>
                    </div>
                    <p style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "var(--color-primary-text)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {fmt(Number(r.totalSalary ?? 0))}
                    </p>
                  </div>

                  {/* Из чего сложилось. Ноль не печатаем: строка «премия 0»
                      ничего не сообщает, а место занимает. */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2" style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                    {base > 0 && <span>{t("оклад", "maosh")}: {fmt(base)}</span>}
                    {commission > 0 && <span>{t("комиссия", "komissiya")}: {fmt(commission)}</span>}
                    {bonus > 0 && <span>{t("премия", "mukofot")}: {fmt(bonus)}</span>}
                    {base === 0 && commission === 0 && bonus === 0 && (
                      // Пусто — это не ошибка расчёта, а незаполненный оклад.
                      // Сказать прямо дешевле, чем принимать вопрос «почему ноль».
                      <span style={{ color: "var(--color-warning-text)" }}>
                        {t("оклад не задан", "maosh belgilanmagan")}
                      </span>
                    )}
                  </div>

                  {/* Что отдали и что осталось. */}
                  <div className="flex items-center justify-between gap-3 mt-3 pt-3 flex-wrap" style={{ borderTop: "1px solid var(--color-border)" }}>
                    <div style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                      <span>{t("выплачено", "to'langan")}: {fmt(paid?.total ?? 0)}</span>
                      <span style={{ margin: "0 8px" }}>·</span>
                      <span style={{ color: due > 0 ? "var(--color-warning-text)" : "var(--color-text-tertiary)" }}>
                        {due >= 0
                          ? `${t("остаток", "qoldiq")}: ${fmt(due)}`
                          : `${t("переплата", "ortiqcha to'lov")}: ${fmt(-due)}`}
                      </span>
                    </div>
                    <button
                      onClick={() => setPaying({ row: r, due })}
                      className="tap px-3 rounded-lg text-xs font-semibold"
                      style={{ border: "1px solid var(--color-border)", color: "var(--color-primary-text)" }}
                      data-testid={`payout-open-${r.agentId}`}
                    >
                      {t("Выплатить", "To'lash")}
                    </button>
                  </div>

                  {/* Кому и когда отдали — по этой же карточке, а не отдельным
                      экраном: вопрос возникает ровно здесь. */}
                  {paid && paid.entries.length > 0 && (
                    <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: "4px" }}>
                      {paid.entries.map(p => (
                        <li key={p.id} className="flex items-baseline justify-between gap-3" style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                          <span className="min-w-0" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {format(asDate(p.paidAt), "d MMMM", lang === "uz" ? undefined : { locale: ruLocale })}
                            {" · "}
                            {p.kind === "advance" ? t("аванс", "avans") : t("выплата", "to'lov")}
                            {p.paidByName && ` · ${p.paidByName}`}
                            {p.note && ` · ${p.note}`}
                          </span>
                          <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmt(Number(p.amount))}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {paying && (
        <PayoutModal
          row={paying.row}
          due={paying.due}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            utils.kpi.payouts.invalidate();
          }}
        />
      )}
    </div>
  );
}

/** Выдача денег: выплата или аванс. */
function PayoutModal({ row, due, onClose, onDone }: { row: Row; due: number; onClose: () => void; onDone: () => void }) {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (r: string, u: string) => (lang === "uz" ? u : r);

  const [kind, setKind] = useState<"payout" | "advance">("payout");
  const [amount, setAmount] = useState(due > 0 ? String(Math.round(due)) : "");
  const [note, setNote] = useState("");

  const record = trpc.kpi.recordPayout.useMutation({
    onSuccess: () => {
      notify.success(t("Выплата записана", "To'lov yozildi"));
      onDone();
    },
    onError: e => notify.error(e.message),
  });

  const value = Number(amount);
  /*
    Ноль отклоняем, отрицательное — нет. Ошибочную выдачу нельзя удалить, и
    единственный способ её исправить — встречная запись с минусом; запретить
    минус значило бы оставить ошибку в журнале навсегда.
  */
  const valid = amount.trim() !== "" && Number.isFinite(value) && value !== 0;

  return (
    <AppModal
      open
      onClose={onClose}
      title={t("Выплата", "To'lov")}
      subtitle={row.agentName}
      maxWidth={420}
    >
      <div className="space-y-4" style={{ padding: "20px" }}>
        <div>
          <label className="font-label text-secondary text-xs block mb-1">
            {t("ВИД", "TURI")}
          </label>
          <div className="flex gap-2">
            {(["payout", "advance"] as const).map(k => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className="tap flex-1 rounded-xl text-sm font-medium"
                style={
                  kind === k
                    ? { background: "var(--color-primary)", color: "var(--color-on-primary, #fff)" }
                    : { border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }
                }
                data-testid={`payout-kind-${k}`}
              >
                {k === "payout" ? t("Выплата", "To'lov") : t("Аванс", "Avans")}
              </button>
            ))}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
            {kind === "advance"
              ? t("Аванс — деньги до конца периода. Остаток он уменьшает так же.",
                  "Avans — davr tugashidan oldingi pul. Qoldiqni xuddi shunday kamaytiradi.")
              : t("Обычная выдача за период.", "Davr uchun oddiy to'lov.")}
          </p>
        </div>

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
            data-testid="payout-amount"
          />
          <p style={{ margin: "6px 0 0", fontSize: "12px", color: "var(--color-text-tertiary)" }}>
            {due > 0
              ? `${t("Остаток", "Qoldiq")}: ${fmt(due)}`
              : t("Начисленное за период уже выдано", "Davr uchun hisoblangan pul berilgan")}
          </p>
        </div>

        <div>
          <label className="font-label text-secondary text-xs block mb-1">
            {t("ПРИМЕЧАНИЕ", "IZOH")}
          </label>
          <input
            className="neo-input"
            maxLength={255}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={t("необязательно", "ixtiyoriy")}
            data-testid="payout-note"
          />
        </div>

        {/* Запись останется навсегда — сказать это до нажатия честнее, чем
            объяснять потом, почему выдачу нельзя стереть. */}
        <p style={{ margin: 0, fontSize: "12px", color: "var(--color-text-tertiary)", display: "flex", gap: "6px", alignItems: "flex-start" }}>
          <HandCoins size={14} style={{ flexShrink: 0, marginTop: "1px" }} />
          {t("Запись остаётся в журнале: дата, сумма и кто выдал.",
             "Yozuv jurnalda qoladi: sana, summa va kim bergani.")}
        </p>

        <button
          onClick={() => record.mutate({ userId: row.agentId, amount: String(value), kind, note: note.trim() || undefined })}
          disabled={!valid || record.isPending}
          className="neo-btn-primary tap w-full disabled:opacity-40"
          data-testid="payout-submit"
        >
          {record.isPending
            ? <Loader2 size={16} className="animate-spin" />
            : t("Записать выдачу", "To'lovni yozish")}
        </button>
      </div>
    </AppModal>
  );
}

function Tile({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent?: boolean }) {
  return (
    <div className="neo-card" style={{ padding: "14px" }}>
      <div style={{ color: accent ? "var(--color-primary-text)" : "var(--color-text-tertiary)" }}>{icon}</div>
      <p style={{
        margin: "8px 0 0", fontSize: accent ? "20px" : "17px", fontWeight: 700,
        color: accent ? "var(--color-primary-text)" : "var(--color-text-primary)",
        fontVariantNumeric: "tabular-nums",
      }}>
        {value}
      </p>
      <p className="font-label text-[10px] tracking-wider" style={{ margin: "4px 0 0", color: "var(--color-text-tertiary)" }}>
        {label}
      </p>
    </div>
  );
}
