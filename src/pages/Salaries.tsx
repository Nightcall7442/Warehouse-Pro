import { useMemo, useState } from "react";
import { Wallet, TrendingUp, Users as UsersIcon } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";

/**
 * Зарплаты — сколько организация платит за период и из чего это складывается.
 *
 * Расчёт существовал и раньше (kpi.salaryReport), но его никто не показывал:
 * эндпоинт был мёртвым, а числа по людям приходилось собирать по карточкам
 * KPI поодиночке. Фонда оплаты — то есть суммы, которая уходит из кассы, — не
 * было видно нигде.
 *
 * Выплата складывается из трёх частей, и экран показывает их отдельно, потому
 * что вопрос директора обычно не «сколько всего», а «почему столько»:
 *
 *   • оклад — из плановой суммы по сотруднику;
 *   • комиссия — процент от того, что человек продал;
 *   • премия — от выполнения KPI.
 *
 * У оператора, супервайзера и курьера комиссия и премия выходят нулём сами
 * собой: и то и другое считается от заказов, которые человек ОФОРМИЛ, а они их
 * не оформляют. Поэтому у них вся выплата — оклад, и это видно по строке.
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

export default function Salaries() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (r: string, u: string) => (lang === "uz" ? u : r);

  const [period, setPeriod] = useState<"week" | "month" | "quarter">("month");
  const { data, isLoading, isLoadingError, refetch } = trpc.kpi.salaryReport.useQuery({ period });

  const rows = useMemo(() => {
    const list = (data ?? []) as Row[];
    // Самые дорогие сверху: директор смотрит этот экран, чтобы понять, куда
    // уходит фонд, а не чтобы читать список по алфавиту.
    return [...list].sort((a, b) => b.totalSalary - a.totalSalary);
  }, [data]);

  const totals = useMemo(() => rows.reduce(
    (acc, r) => ({
      base:       acc.base + Number(r.baseSalary ?? 0),
      commission: acc.commission + Number(r.commissionAmount ?? 0),
      bonus:      acc.bonus + Number(r.bonusAmount ?? 0),
      total:      acc.total + Number(r.totalSalary ?? 0),
    }),
    { base: 0, commission: 0, bonus: 0, total: 0 },
  ), [rows]);

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
          {/* Фонд и его части. Главное число — то, что уходит из кассы. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label={t("ФОНД ОПЛАТЫ", "ISH HAQI FONDI")} value={fmt(totals.total)} icon={<Wallet size={18} />} accent />
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
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
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
