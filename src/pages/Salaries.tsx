import { useMemo, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ru as ruLocale } from "date-fns/locale";
import {
  Wallet, HandCoins, TrendingUp, Coins,
  ChevronLeft, ChevronRight, ChevronDown, Search, FileDown, Printer, SlidersHorizontal, Loader2,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { exportToExcel } from "@/lib/excel";
import { printElement } from "@/lib/print";
import { useConfirm } from "@/components/ConfirmDialog";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { PremiumSelect } from "@/components/PremiumSelect";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { AppModal } from "@/components/ui/AppModal";
import { F, COLORS, SHADOW, thStyle, tdStyle, ROLE_LABELS } from "@/components/users/types";

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
 * Теперь у каждой выдачи есть номер, дата, сумма и тот, кто её сделал; аванс
 * от выплаты отличается только тем, что выдан до конца периода.
 */

const PERIODS = [
  { value: "week"    as const, ru: "Неделя",  uz: "Hafta" },
  { value: "month"   as const, ru: "Месяц",   uz: "Oy" },
  { value: "quarter" as const, ru: "Квартал", uz: "Chorak" },
];

type PeriodKind = "week" | "month" | "quarter";

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

/** «ВЫП-000042» — номер, который можно назвать вслух и найти. */
const payoutNo = (p: Payout) => `${p.kind === "advance" ? "АВ" : "ВЫП"}-${String(p.id).padStart(6, "0")}`;

/** Инициалы для кружка: две буквы — ровно столько помещается и читается. */
const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");

/**
 * Какой именно период сейчас на экране.
 *
 * Стрелки листают назад, и без подписи «сентябрь 2026» человек через два
 * нажатия перестаёт понимать, что он смотрит.
 */
function periodLabel(period: PeriodKind, offset: number, lang: string): string {
  const now = new Date();
  const loc = lang === "uz" ? undefined : { locale: ruLocale };
  if (period === "month") {
    return format(new Date(now.getFullYear(), now.getMonth() - offset, 1), "LLLL yyyy", loc);
  }
  if (period === "quarter") {
    const start = new Date(now.getFullYear(), (Math.floor(now.getMonth() / 3) - offset) * 3, 1);
    return `${Math.floor(start.getMonth() / 3) + 1} ${lang === "uz" ? "chorak" : "квартал"} ${start.getFullYear()}`;
  }
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7 * offset);
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);
  return `${format(start, "d MMM", loc)} — ${format(end, "d MMM", loc)}`;
}

export default function Salaries() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (r: string, u: string) => (lang === "uz" ? u : r);
  const utils = trpc.useUtils();
  const { confirm, dialog } = useConfirm();

  const [period, setPeriod] = useState<PeriodKind>("month");
  const [offset, setOffset] = useState(0);
  const [tab, setTab] = useState<"accruals" | "payouts">("accruals");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [role, setRole] = useState("");
  const [onlyDue, setOnlyDue] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [paying, setPaying] = useState<{ row: Row; due: number } | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [viewing, setViewing] = useState<Payout | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  /*
    keepPreviousData: без него каждое нажатие стрелки обнуляет data, и экран
    падает в скелетон — листать месяцы становится похоже на перезагрузку.
  */
  const { data, isLoading, isLoadingError, refetch } = trpc.kpi.salaryReport.useQuery(
    { period, offset },
    { placeholderData: keepPreviousData },
  );
  const paidQuery = trpc.kpi.payouts.useQuery(
    { period, offset },
    { placeholderData: keepPreviousData },
  );

  const recordPayout = trpc.kpi.recordPayout.useMutation();

  const allRows = useMemo(() => {
    const list = (data ?? []) as Row[];
    // Самые дорогие сверху: директор смотрит этот экран, чтобы понять, куда
    // уходит фонд, а не чтобы читать список по алфавиту.
    return [...list].sort((a, b) => b.totalSalary - a.totalSalary);
  }, [data]);

  const paidByUser = useMemo(() => {
    const map = new Map<number, { total: number; advances: number; entries: Payout[] }>();
    for (const p of (paidQuery.data ?? []) as Payout[]) {
      const cur = map.get(p.userId) ?? { total: 0, advances: 0, entries: [] };
      const sum = Number(p.amount ?? 0);
      cur.total += sum;
      if (p.kind === "advance") cur.advances += sum;
      cur.entries.push(p);
      map.set(p.userId, cur);
    }
    return map;
  }, [paidQuery.data]);

  const dueOf = (r: Row) => Number(r.totalSalary ?? 0) - (paidByUser.get(r.agentId)?.total ?? 0);

  const rows = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return allRows.filter(r => {
      if (role && r.role !== role) return false;
      if (onlyDue && dueOf(r) <= 0) return false;
      if (q && !r.agentName.toLowerCase().includes(q)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, role, onlyDue, debouncedSearch, paidByUser]);

  const totals = useMemo(() => {
    const accrued = allRows.reduce(
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
    const advances = [...paidByUser.values()].reduce((s, v) => s + v.advances, 0);
    /*
      Остаток — по каждому отдельно и не ниже нуля. Переплата одному не
      закрывает долг перед другим, а вычесть её из общего числа значило бы
      показать директору меньше, чем он на самом деле должен раздать.
    */
    const due = allRows.reduce(
      (s, r) => s + Math.max(0, Number(r.totalSalary ?? 0) - (paidByUser.get(r.agentId)?.total ?? 0)),
      0,
    );
    return { ...accrued, paid, advances, due };
  }, [allRows, paidByUser]);

  const payouts = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return ((paidQuery.data ?? []) as Payout[]).filter(p => {
      if (q && !p.userName.toLowerCase().includes(q) && !payoutNo(p).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [paidQuery.data, debouncedSearch]);

  const roleOptions = useMemo(() => {
    const seen = [...new Set(allRows.map(r => r.role))];
    return [
      { value: "", label: t("Все роли", "Barcha lavozimlar") },
      ...seen.map(r => ({ value: r, label: ROLE_LABELS[r] ? (lang === "uz" ? ROLE_LABELS[r].uz : ROLE_LABELS[r].ru) : r })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, lang]);

  const exportSheet = () => {
    exportToExcel(
      rows.map(r => ({
        [t("Сотрудник", "Xodim")]: r.agentName,
        [t("Роль", "Lavozim")]: ROLE_LABELS[r.role] ? (lang === "uz" ? ROLE_LABELS[r.role].uz : ROLE_LABELS[r.role].ru) : r.role,
        [t("Оклад", "Maosh")]: Number(r.baseSalary ?? 0),
        [t("Комиссия", "Komissiya")]: Number(r.commissionAmount ?? 0),
        [t("Премия", "Mukofot")]: Number(r.bonusAmount ?? 0),
        [t("Начислено", "Hisoblangan")]: Number(r.totalSalary ?? 0),
        [t("Выплачено", "To'langan")]: paidByUser.get(r.agentId)?.total ?? 0,
        [t("Остаток", "Qoldiq")]: dueOf(r),
      })),
      `salaries-${period}-${offset}`,
      t("Зарплаты", "Ish haqi"),
      `${t("Ведомость", "Vedomost")} — ${periodLabel(period, offset, lang)}`,
    );
  };

  /*
    Выдать всем остаток разом.

    Зарплату раздают в один день всей команде, и по одному человеку это
    двадцать открытых окон. Подтверждение обязательно: деньги, и отменить
    записи нельзя.
  */
  const payEveryone = async () => {
    const targets = rows.map(r => ({ r, due: dueOf(r) })).filter(x => x.due > 0);
    if (!targets.length) { notify.info(t("Некому выплачивать — остатков нет", "To'lanadigan qoldiq yo'q")); return; }
    const sum = targets.reduce((s, x) => s + x.due, 0);
    const ok = await confirm({
      title: t(`Выплатить ${targets.length} сотрудникам?`, `${targets.length} xodimga to'lansinmi?`),
      message: t(
        `Будет записано ${fmt(sum)} — каждому его остаток за ${periodLabel(period, offset, lang)}. Записи выплат нельзя изменить или удалить.`,
        `${fmt(sum)} yoziladi — har biriga o'z qoldig'i. Yozuvlarni o'zgartirib yoki o'chirib bo'lmaydi.`,
      ),
      confirmText: t("Выплатить", "To'lash"),
    });
    if (!ok) return;

    setBulkBusy(true);
    let done = 0;
    try {
      for (const { r, due } of targets) {
        await recordPayout.mutateAsync({ userId: r.agentId, amount: due.toFixed(2), kind: "payout" });
        done++;
      }
      notify.success(t(`Выплачено ${done}`, `${done} ta to'landi`));
    } catch (e) {
      // Часть уже записана — сказать об этом важнее, чем показать текст ошибки:
      // повторное нажатие выдаст ровно оставшихся, потому что остаток пересчитан.
      notify.error(t(`Записано ${done} из ${targets.length}: ${(e as Error).message}`,
                     `${targets.length} dan ${done} yozildi: ${(e as Error).message}`));
    } finally {
      setBulkBusy(false);
      utils.kpi.payouts.invalidate();
    }
  };

  if (isLoadingError) return <QueryErrorFallback onRetry={refetch} />;

  const paidPct = totals.total > 0 ? Math.min(100, Math.round((totals.paid / totals.total) * 100)) : 0;

  return (
    <div className="space-y-5">
      {/* ── Шапка: что это, за какой период, и куда листать ─────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary tracking-tight">
            {t("Зарплаты", "Ish haqi")}
          </h1>
          <p className="text-sm" style={{ color: COLORS.textTertiary }}>
            {isLoading
              ? t("Считаем…", "Hisoblanmoqda…")
              : t(`${allRows.length} сотрудников · ${periodLabel(period, offset, lang)}`,
                  `${allRows.length} xodim · ${periodLabel(period, offset, lang)}`)}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Листалка периодов. Вперёд дальше текущего — некуда. */}
          <div className="flex items-center gap-1" style={{ background: COLORS.surfaceLight, borderRadius: "12px", padding: "2px" }}>
            <button
              onClick={() => setOffset(o => o + 1)}
              className="tap rounded-lg"
              style={{ color: COLORS.textSecondary, width: "36px" }}
              aria-label={t("Предыдущий период", "Oldingi davr")}
              data-testid="period-prev"
            >
              <ChevronLeft size={18} style={{ margin: "0 auto" }} />
            </button>
            <span style={{ fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary, minWidth: "112px", textAlign: "center", textTransform: "capitalize" }}>
              {periodLabel(period, offset, lang)}
            </span>
            <button
              onClick={() => setOffset(o => Math.max(0, o - 1))}
              disabled={offset === 0}
              className="tap rounded-lg disabled:opacity-30"
              style={{ color: COLORS.textSecondary, width: "36px" }}
              aria-label={t("Следующий период", "Keyingi davr")}
              data-testid="period-next"
            >
              <ChevronRight size={18} style={{ margin: "0 auto" }} />
            </button>
          </div>

          <div className="flex gap-1.5">
            {PERIODS.map(p => (
              <button
                key={p.value}
                onClick={() => { setPeriod(p.value); setOffset(0); }}
                className={`tap px-3 rounded-lg text-xs font-semibold transition-all ${period === p.value ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-light)] text-[var(--color-text-secondary)]"}`}
              >
                {lang === "uz" ? p.uz : p.ru}
              </button>
            ))}
          </div>

          <button onClick={exportSheet} className="neo-btn tap flex items-center gap-1.5 px-3 text-xs font-semibold" data-testid="salaries-export">
            <FileDown size={14} />
            {t("Ведомость", "Vedomost")}
          </button>
        </div>
      </div>

      {/* ── Деньги в четырёх состояниях ──────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label={t("ФОНД ОПЛАТЫ", "ISH HAQI FONDI")} value={fmt(totals.total)} icon={<Wallet size={18} color="#fff" />} gradient="var(--color-primary)" accent />
        <Tile label={t("ВЫПЛАЧЕНО", "TO'LANGAN")} value={fmt(totals.paid)} icon={<HandCoins size={18} color="#fff" />} gradient="linear-gradient(135deg, #16a34a, #22c47a)" />
        <Tile label={t("АВАНСЫ", "AVANSLAR")} value={fmt(totals.advances)} icon={<Coins size={18} color="#fff" />} gradient="linear-gradient(135deg, #f59e0b, #fbbf24)" />
        <Tile label={t("К ВЫПЛАТЕ", "TO'LANADI")} value={fmt(totals.due)} icon={<TrendingUp size={18} color="#fff" />} gradient="linear-gradient(135deg, #6366f1, #818cf8)" />
      </div>

      {/* Полоса закрытия фонда и его состав — на один взгляд. */}
      <div className="neo-card" style={{ padding: "14px 16px" }}>
        <div className="flex items-center justify-between" style={{ fontSize: "12px", color: COLORS.textTertiary }}>
          <span>{t("Фонд закрыт на", "Fond yopildi")} <b style={{ color: COLORS.textPrimary }}>{paidPct}%</b></span>
          <span className="flex flex-wrap gap-x-4">
            <span>{t("ОКЛАДЫ", "MAOSHLAR")}: {fmt(totals.base)}</span>
            <span>{t("КОМИССИЯ", "KOMISSIYA")}: {fmt(totals.commission)}</span>
            <span>{t("ПРЕМИИ", "MUKOFOTLAR")}: {fmt(totals.bonus)}</span>
          </span>
        </div>
        <div style={{ height: "6px", borderRadius: "999px", background: COLORS.surfaceLight, marginTop: "8px", overflow: "hidden" }}>
          <div style={{ width: `${paidPct}%`, height: "100%", borderRadius: "999px", background: "linear-gradient(90deg, #16a34a, #22c47a)", transition: "width .3s ease" }} />
        </div>
      </div>

      {/* ── Вкладки и фильтры ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-1.5">
          {([["accruals", t("Начисления", "Hisoblangan")], ["payouts", `${t("Выплаты", "To'lovlar")} · ${(paidQuery.data ?? []).length}`]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key as "accruals" | "payouts")}
              className={`tap px-4 rounded-xl text-sm font-semibold transition-all ${tab === key ? "bg-[var(--color-primary)] text-white" : "bg-[var(--color-surface-light)] text-[var(--color-text-secondary)]"}`}
              data-testid={`salaries-tab-${key}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div style={{ position: "relative" }}>
            <Search size={15} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: COLORS.textTertiary }} />
            <input
              className="neo-input"
              style={{ paddingLeft: "32px", width: "200px" }}
              placeholder={t("Поиск по имени", "Ism bo'yicha qidirish")}
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="salaries-search"
            />
          </div>
          {tab === "accruals" && (
            <>
              <PremiumSelect value={role} onChange={setRole} options={roleOptions} width="170px" aria-label={t("Роль", "Lavozim")} />
              <button
                onClick={() => setOnlyDue(v => !v)}
                className="tap px-3 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                style={onlyDue
                  ? { background: "var(--color-primary)", color: "#fff" }
                  : { border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary }}
                data-testid="salaries-only-due"
              >
                <SlidersHorizontal size={13} />
                {t("Только с остатком", "Faqat qoldiqli")}
              </button>
              <button
                onClick={payEveryone}
                disabled={bulkBusy}
                className="neo-btn-primary tap px-3 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40"
                data-testid="salaries-pay-all"
              >
                {bulkBusy ? <Loader2 size={13} className="animate-spin" /> : <HandCoins size={13} />}
                {t("Выдать всем", "Hammaga berish")}
              </button>
            </>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl h-16 animate-pulse" style={{ background: COLORS.surfaceLight }} />
          ))}
        </div>
      )}

      {!isLoading && tab === "accruals" && (
        <>
          {rows.length === 0 && (
            <div className="neo-card" style={{ padding: "32px", textAlign: "center", color: COLORS.textTertiary }}>
              <Wallet size={32} style={{ margin: "0 auto 10px", display: "block" }} />
              <p style={{ margin: 0 }}>{t("Сотрудников нет", "Xodimlar yo'q")}</p>
            </div>
          )}

          {/* Настольная ведомость: пять денежных величин в строке читаются
              только в таблице. На телефоне ниже — те же данные карточками. */}
          {rows.length > 0 && (
            <div className="hidden lg:block" style={{ background: COLORS.surface, borderRadius: "24px", boxShadow: SHADOW, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      {[t("СОТРУДНИК", "XODIM"), t("ОКЛАД", "MAOSH"), t("КОМИССИЯ", "KOMISSIYA"), t("ПРЕМИЯ", "MUKOFOT"),
                        t("НАЧИСЛЕНО", "HISOBLANGAN"), t("ВЫПЛАЧЕНО", "TO'LANGAN"), t("ОСТАТОК", "QOLDIQ"), ""].map((h, i) => (
                        <th key={i} style={{ ...thStyle, textAlign: i === 0 || i === 7 ? "left" : "right" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => {
                      const paid = paidByUser.get(r.agentId);
                      const due = dueOf(r);
                      return (
                        <tr key={r.agentId} data-testid={`salary-row-${r.agentId}`}>
                          <td style={tdStyle}>
                            <div className="flex items-center gap-3">
                              <Avatar name={r.agentName} />
                              <div className="min-w-0">
                                <div style={{ fontWeight: 600 }}>{r.agentName}</div>
                                <RoleBadge role={r.role} lang={lang} rate={Number(r.commissionAmount) > 0 ? r.commissionRate : null} />
                              </div>
                            </div>
                          </td>
                          <Num v={Number(r.baseSalary ?? 0)} fmt={fmt} empty={t("не задан", "belgilanmagan")} />
                          <Num v={Number(r.commissionAmount ?? 0)} fmt={fmt} />
                          <Num v={Number(r.bonusAmount ?? 0)} fmt={fmt} />
                          <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                            {fmt(Number(r.totalSalary ?? 0))}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: COLORS.textSecondary }}>
                            {fmt(paid?.total ?? 0)}
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right" }}>
                            <DueBadge due={due} fmt={fmt} lang={lang} />
                          </td>
                          <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                            <button
                              onClick={() => setPaying({ row: r, due })}
                              className="neo-btn-primary neo-btn-xs tap"
                              style={{ marginRight: "6px" }}
                              data-testid={`payout-open-${r.agentId}`}
                            >
                              {t("Выплатить", "To'lash")}
                            </button>
                            <button
                              onClick={() => setEditing(r)}
                              className="neo-btn neo-btn-xs tap"
                              data-testid={`salary-edit-${r.agentId}`}
                            >
                              {t("Оклад", "Maosh")}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Телефон: карточка на человека, история — по нажатию. */}
          <div className="space-y-3 lg:hidden">
            {rows.map(r => {
              const base = Number(r.baseSalary ?? 0);
              const commission = Number(r.commissionAmount ?? 0);
              const bonus = Number(r.bonusAmount ?? 0);
              const paid = paidByUser.get(r.agentId);
              const due = dueOf(r);
              const open = expanded === r.agentId;
              return (
                <div key={r.agentId} className="neo-card" style={{ padding: "16px" }} data-testid={`salary-card-${r.agentId}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={r.agentName} />
                      <div className="min-w-0">
                        <p style={{ margin: 0, fontWeight: 600, color: COLORS.textPrimary }}>{r.agentName}</p>
                        <RoleBadge role={r.role} lang={lang} rate={commission > 0 ? r.commissionRate : null} />
                      </div>
                    </div>
                    <p style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: COLORS.primaryText, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {fmt(Number(r.totalSalary ?? 0))}
                    </p>
                  </div>

                  {/* Из чего сложилось. Ноль не печатаем: строка «премия 0»
                      ничего не сообщает, а место занимает. */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2" style={{ fontSize: "12px", color: COLORS.textTertiary }}>
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

                  <div className="flex items-center justify-between gap-2 mt-3 pt-3 flex-wrap" style={{ borderTop: `1px solid ${COLORS.border}` }}>
                    <div className="flex items-center gap-2" style={{ fontSize: "12px", color: COLORS.textTertiary }}>
                      <span>{t("выплачено", "to'langan")}: {fmt(paid?.total ?? 0)}</span>
                      <DueBadge due={due} fmt={fmt} lang={lang} />
                    </div>
                    <div className="flex gap-1.5">
                      <button onClick={() => setEditing(r)} className="neo-btn neo-btn-xs tap" data-testid={`salary-edit-m-${r.agentId}`}>
                        {t("Оклад", "Maosh")}
                      </button>
                      <button onClick={() => setPaying({ row: r, due })} className="neo-btn-primary neo-btn-xs tap" data-testid={`payout-open-m-${r.agentId}`}>
                        {t("Выплатить", "To'lash")}
                      </button>
                    </div>
                  </div>

                  {/* Кому и когда отдали — по этой же карточке, а не отдельным
                      экраном: вопрос возникает ровно здесь. */}
                  {paid && paid.entries.length > 0 && (
                    <>
                      <button
                        onClick={() => setExpanded(open ? null : r.agentId)}
                        className="tap flex items-center gap-1 mt-2"
                        style={{ fontSize: "12px", color: COLORS.primaryText }}
                      >
                        <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
                        {t(`Выплаты (${paid.entries.length})`, `To'lovlar (${paid.entries.length})`)}
                      </button>
                      {open && (
                        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: "6px" }}>
                          {paid.entries.map(p => (
                            <li key={p.id}>
                              <button
                                onClick={() => setViewing(p)}
                                className="flex items-baseline justify-between gap-3 w-full text-left"
                                style={{ fontSize: "12px", color: COLORS.textTertiary }}
                              >
                                <span className="min-w-0" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {payoutNo(p)} · {format(asDate(p.paidAt), "d MMMM", lang === "uz" ? undefined : { locale: ruLocale })}
                                  {" · "}
                                  {p.kind === "advance" ? t("аванс", "avans") : t("выплата", "to'lov")}
                                </span>
                                <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{fmt(Number(p.amount))}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Журнал выплат ────────────────────────────────────────────────── */}
      {!isLoading && tab === "payouts" && (
        <div style={{ background: COLORS.surface, borderRadius: "24px", boxShadow: SHADOW, overflow: "hidden" }}>
          {payouts.length === 0 ? (
            <div style={{ padding: "40px", textAlign: "center", color: COLORS.textTertiary }}>
              <HandCoins size={32} style={{ margin: "0 auto 10px", display: "block" }} />
              <p style={{ margin: 0 }}>{t("За этот период выплат не было", "Bu davrda to'lovlar bo'lmagan")}</p>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                <thead>
                  <tr>
                    {[t("НОМЕР", "RAQAM"), t("ДАТА", "SANA"), t("КОМУ", "KIMGA"), t("ВИД", "TURI"), t("ВЫДАЛ", "BERDI"), t("СУММА", "SUMMA")].map((h, i) => (
                      <th key={i} style={{ ...thStyle, textAlign: i === 5 ? "right" : "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payouts.map(p => (
                    <tr
                      key={p.id}
                      onClick={() => setViewing(p)}
                      style={{ cursor: "pointer" }}
                      data-testid={`payout-row-${p.id}`}
                    >
                      <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums", color: COLORS.primaryText, fontWeight: 600 }}>{payoutNo(p)}</td>
                      <td style={tdStyle}>{format(asDate(p.paidAt), "d MMMM, HH:mm", lang === "uz" ? undefined : { locale: ruLocale })}</td>
                      <td style={tdStyle}>{p.userName}</td>
                      <td style={tdStyle}><KindBadge kind={p.kind} lang={lang} /></td>
                      <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{p.paidByName ?? "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(Number(p.amount))}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={5} style={{ ...tdStyle, fontWeight: 600, color: COLORS.textSecondary }}>{t("Итого за период", "Davr uchun jami")}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      {fmt(payouts.reduce((s, p) => s + Number(p.amount ?? 0), 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {paying && (
        <PayoutModal
          row={paying.row}
          due={paying.due}
          onClose={() => setPaying(null)}
          onDone={() => { setPaying(null); utils.kpi.payouts.invalidate(); }}
        />
      )}

      {editing && (
        <SalaryModal
          row={editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); utils.kpi.salaryReport.invalidate(); }}
        />
      )}

      {viewing && <PayoutDetail payout={viewing} onClose={() => setViewing(null)} />}

      {dialog}
    </div>
  );
}

/* ── Мелкие части ─────────────────────────────────────────────────────────── */

function Avatar({ name }: { name: string }) {
  return (
    <div style={{
      width: "36px", height: "36px", flexShrink: 0, borderRadius: "12px",
      background: "var(--color-surface-light)", border: `1px solid ${COLORS.border}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: F.display, fontSize: "12px", fontWeight: 700, color: COLORS.textSecondary,
    }}>
      {initials(name)}
    </div>
  );
}

function RoleBadge({ role, lang, rate }: { role: string; lang: string; rate: number | null }) {
  const label = ROLE_LABELS[role] ? (lang === "uz" ? ROLE_LABELS[role].uz : ROLE_LABELS[role].ru) : role;
  return (
    <span style={{ fontSize: "11px", color: COLORS.textTertiary }}>
      {label}{rate != null && rate > 0 && ` · ${rate}%`}
    </span>
  );
}

/** Остаток словом и цветом: ноль — это «закрыто», а не просто число. */
function DueBadge({ due, fmt, lang }: { due: number; fmt: (v: number) => string; lang: string }) {
  const t = (r: string, u: string) => (lang === "uz" ? u : r);
  if (Math.abs(due) < 0.01) {
    return <Pill text={t("выплачено", "to'langan")} tone="ok" />;
  }
  if (due < 0) {
    return <Pill text={`${t("переплата", "ortiqcha")} ${fmt(-due)}`} tone="warn" />;
  }
  return <Pill text={fmt(due)} tone="due" />;
}

function KindBadge({ kind, lang }: { kind: "payout" | "advance"; lang: string }) {
  const t = (r: string, u: string) => (lang === "uz" ? u : r);
  return kind === "advance"
    ? <Pill text={t("аванс", "avans")} tone="warn" />
    : <Pill text={t("выплата", "to'lov")} tone="ok" />;
}

function Pill({ text, tone }: { text: string; tone: "ok" | "warn" | "due" }) {
  const tones = {
    ok:   { bg: "var(--color-success-bg, rgba(22,163,74,.12))", fg: "var(--color-success-text, #15803d)" },
    warn: { bg: "var(--color-warning-bg, rgba(245,158,11,.14))", fg: "var(--color-warning-text, #b45309)" },
    due:  { bg: "var(--color-surface-light)", fg: "var(--color-text-primary)" },
  }[tone];
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: "999px",
      background: tones.bg, color: tones.fg,
      fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
    }}>
      {text}
    </span>
  );
}

function Num({ v, fmt, empty }: { v: number; fmt: (n: number) => string; empty?: string }) {
  return (
    <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: v > 0 ? COLORS.textPrimary : COLORS.textTertiary }}>
      {v > 0 ? fmt(v) : (empty ?? "—")}
    </td>
  );
}

function Tile({ label, value, icon, gradient, accent }: { label: string; value: string; icon: React.ReactNode; gradient: string; accent?: boolean }) {
  return (
    <div className="kpi-hero" style={{ borderRadius: "20px", padding: "16px" }}>
      <div className="flex items-start justify-between">
        <span className="font-label text-[10px] tracking-wider" style={{ color: COLORS.textTertiary }}>{label}</span>
        <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: gradient, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {icon}
        </div>
      </div>
      <p style={{
        margin: "10px 0 0", fontFamily: F.display, fontSize: accent ? "22px" : "19px", fontWeight: 700,
        color: accent ? COLORS.primaryText : COLORS.textPrimary,
        fontVariantNumeric: "tabular-nums", lineHeight: 1.1, letterSpacing: "-0.02em",
      }}>
        {value}
      </p>
    </div>
  );
}

/* ── Выдача денег ─────────────────────────────────────────────────────────── */

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
    <AppModal open onClose={onClose} title={t("Выплата", "To'lov")} subtitle={row.agentName} maxWidth={420}>
      <div className="space-y-4" style={{ padding: "20px" }}>
        <div>
          <label className="font-label text-secondary text-xs block mb-1">{t("ВИД", "TURI")}</label>
          <div className="flex gap-2">
            {(["payout", "advance"] as const).map(k => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className="tap flex-1 rounded-xl text-sm font-medium"
                style={kind === k
                  ? { background: "var(--color-primary)", color: "var(--color-on-primary, #fff)" }
                  : { border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary }}
                data-testid={`payout-kind-${k}`}
              >
                {k === "payout" ? t("Выплата", "To'lov") : t("Аванс", "Avans")}
              </button>
            ))}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: "12px", color: COLORS.textTertiary }}>
            {kind === "advance"
              ? t("Аванс — деньги до конца периода. Остаток он уменьшает так же.",
                  "Avans — davr tugashidan oldingi pul. Qoldiqni xuddi shunday kamaytiradi.")
              : t("Обычная выдача за период.", "Davr uchun oddiy to'lov.")}
          </p>
        </div>

        <div>
          <label className="font-label text-secondary text-xs block mb-1">{t("СУММА", "SUMMA")}</label>
          <input
            className="neo-input"
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            data-testid="payout-amount"
          />
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {due > 0 && (
              <>
                <button onClick={() => setAmount(String(Math.round(due)))} className="neo-btn neo-btn-xs tap">
                  {t("Весь остаток", "Butun qoldiq")}
                </button>
                <button onClick={() => setAmount(String(Math.round(due / 2)))} className="neo-btn neo-btn-xs tap">
                  50%
                </button>
              </>
            )}
            <span style={{ fontSize: "12px", color: COLORS.textTertiary }}>
              {due > 0
                ? `${t("Остаток", "Qoldiq")}: ${fmt(due)}`
                : t("Начисленное за период уже выдано", "Davr uchun hisoblangan pul berilgan")}
            </span>
          </div>
        </div>

        <div>
          <label className="font-label text-secondary text-xs block mb-1">{t("ПРИМЕЧАНИЕ", "IZOH")}</label>
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
        <p style={{ margin: 0, fontSize: "12px", color: COLORS.textTertiary, display: "flex", gap: "6px", alignItems: "flex-start" }}>
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
          {record.isPending ? <Loader2 size={16} className="animate-spin" /> : t("Записать выдачу", "To'lovni yozish")}
        </button>
      </div>
    </AppModal>
  );
}

/* ── Оклад и ставка ───────────────────────────────────────────────────────── */

function SalaryModal({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const { lang } = useLang();
  const t = (r: string, u: string) => (lang === "uz" ? u : r);

  const [base, setBase] = useState(String(Math.round(Number(row.baseSalary ?? 0))));
  const [rate, setRate] = useState(String(Number(row.commissionRate ?? 0)));

  const save = trpc.kpi.setSalary.useMutation({
    onSuccess: () => {
      notify.success(t("Оклад сохранён", "Maosh saqlandi"));
      onDone();
    },
    onError: e => notify.error(e.message),
  });

  const baseNum = Number(base);
  const rateNum = Number(rate);
  const valid = Number.isFinite(baseNum) && baseNum >= 0 && Number.isFinite(rateNum) && rateNum >= 0 && rateNum <= 100;

  return (
    <AppModal open onClose={onClose} title={t("Оклад и комиссия", "Maosh va komissiya")} subtitle={row.agentName} maxWidth={420}>
      <div className="space-y-4" style={{ padding: "20px" }}>
        <div>
          <label className="font-label text-secondary text-xs block mb-1">{t("ОКЛАД ЗА МЕСЯЦ", "OYLIK MAOSH")}</label>
          <input
            className="neo-input"
            type="number"
            inputMode="decimal"
            value={base}
            onChange={e => setBase(e.target.value)}
            data-testid="salary-base"
          />
        </div>

        <div>
          <label className="font-label text-secondary text-xs block mb-1">{t("КОМИССИЯ, % ОТ ПРОДАЖ", "KOMISSIYA, SOTUVDAN %")}</label>
          <input
            className="neo-input"
            type="number"
            inputMode="decimal"
            value={rate}
            onChange={e => setRate(e.target.value)}
            data-testid="salary-rate"
          />
          <p style={{ margin: "6px 0 0", fontSize: "12px", color: COLORS.textTertiary }}>
            {t("Считается от заказов, которые человек оформил сам. У оператора и курьера выйдет ноль.",
               "Xodim o'zi rasmiylashtirgan buyurtmalardan hisoblanadi. Operator va kuryerda nol chiqadi.")}
          </p>
        </div>

        {/* Задним числом менять закрытый месяц нельзя — сказать сразу. */}
        <p style={{ margin: 0, fontSize: "12px", color: COLORS.textTertiary }}>
          {t("Применяется с текущего месяца. Прошлые периоды остаются такими, какими их закрыли.",
             "Joriy oydan qo'llanadi. O'tgan davrlar o'zgarmaydi.")}
        </p>

        <button
          onClick={() => save.mutate({ userId: row.agentId, baseSalary: baseNum, commissionRate: rateNum })}
          disabled={!valid || save.isPending}
          className="neo-btn-primary tap w-full disabled:opacity-40"
          data-testid="salary-submit"
        >
          {save.isPending ? <Loader2 size={16} className="animate-spin" /> : t("Сохранить", "Saqlash")}
        </button>
      </div>
    </AppModal>
  );
}

/* ── Детали одной выплаты ─────────────────────────────────────────────────── */

function PayoutDetail({ payout, onClose }: { payout: Payout; onClose: () => void }) {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (r: string, u: string) => (lang === "uz" ? u : r);
  const id = `payout-receipt-${payout.id}`;

  const rows: [string, string][] = [
    [t("Номер", "Raqam"), payoutNo(payout)],
    [t("Дата выдачи", "Berilgan sana"), format(asDate(payout.paidAt), "d MMMM yyyy, HH:mm", lang === "uz" ? undefined : { locale: ruLocale })],
    [t("Кому", "Kimga"), payout.userName],
    [t("Вид", "Turi"), payout.kind === "advance" ? t("Аванс", "Avans") : t("Выплата", "To'lov")],
    [t("Сумма", "Summa"), fmt(Number(payout.amount))],
    [t("Выдал", "Berdi"), payout.paidByName ?? "—"],
    [t("Примечание", "Izoh"), payout.note || "—"],
  ];

  return (
    <AppModal open onClose={onClose} title={payoutNo(payout)} subtitle={payout.userName} maxWidth={460}>
      <div className="space-y-4" style={{ padding: "20px" }}>
        {/* Тот же блок печатается расходным ордером — печать берёт его по id. */}
        <div id={id}>
          {/*
            Шапка и подписи нужны только на бумаге.

            Скрыты классом, а не инлайновым display:none: печать копирует
            innerHTML в отдельное окно со своей таблицей стилей, где класса
            .hidden нет — значит там эти строки появятся. Инлайновый стиль
            уехал бы вместе с разметкой и спрятал бы их и в ордере.
          */}
          <h1 className="hidden">{t("Расходный ордер", "Xarajat orderi")} {payoutNo(payout)}</h1>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <td style={{ padding: "8px 0", fontSize: "13px", color: COLORS.textTertiary, whiteSpace: "nowrap", verticalAlign: "top" }}>{k}</td>
                  <td style={{ padding: "8px 0 8px 16px", fontSize: "14px", color: COLORS.textPrimary, fontWeight: 600, textAlign: "right" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="signature-block hidden">
            <div className="signature-line">{t("Выдал", "Berdi")}</div>
            <div className="signature-line">{t("Получил", "Oldi")}</div>
          </div>
        </div>

        <button
          onClick={() => printElement(id, `${t("Расходный ордер", "Xarajat orderi")} ${payoutNo(payout)}`)}
          className="neo-btn tap w-full flex items-center justify-center gap-2"
          data-testid="payout-print"
        >
          <Printer size={15} />
          {t("Печать ордера", "Orderni chop etish")}
        </button>

        {/* Изменить запись нечем — и это не недоделка, а правило. */}
        <p style={{ margin: 0, fontSize: "12px", color: COLORS.textTertiary }}>
          {t("Запись выплаты не изменяется и не удаляется. Ошибочную выдачу гасят встречной записью с минусом.",
             "To'lov yozuvi o'zgarmaydi va o'chirilmaydi. Xato to'lov minusli yozuv bilan qoplanadi.")}
        </p>
      </div>
    </AppModal>
  );
}
