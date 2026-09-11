import { useMemo, useState } from "react";
import { useSellerCompany } from "@/hooks/useSellerCompany";
import { keepPreviousData } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ru as ruLocale } from "date-fns/locale";
import {
  Wallet, HandCoins,
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
import { F, COLORS, SHADOW, thStyle, tdStyle } from "@/components/users/types";
import { labelled, ROLE_LABEL } from "@/lib/entity-labels";

/**
 * Зарплаты — сколько организация начислила за период, сколько отдала и сколько
 * осталась должна.
 *
 * Расчёт существовал и раньше (kpi.salaryReport), но его никто не показывал:
 * эндпоинт был мёртвым, а числа по людям приходилось собирать по карточкам
 * KPI поодиночке. Фонда оплаты — то есть суммы, которая уходит из кассы, — не
 * было видно нигде.
 *
 * Начисление складывается из двух частей, и экран показывает их отдельно,
 * потому что вопрос директора обычно не «сколько всего», а «почему столько»:
 *
 *   • оклад — из плановой суммы по сотруднику;
 *   • комиссия — процент от того, что человек продал.
 *
 * Третьей частью была премия — два процента от продаж, умноженные на балл
 * KPI. Два процента были зашиты числом в коде: их не назначал ни арендатор,
 * ни платформа. Убрана по решению владельца 11.09.2026; балл KPI остался и
 * показывает работу, но денег больше не двигает.
 *
 * У оператора, супервайзера и курьера комиссия выходит нулём сама собой: она
 * считается от заказов, которые человек ОФОРМИЛ, а они их не оформляют.
 * Поэтому у них вся выплата — оклад, и это видно по строке.
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
  /*
    Курьерские слагаемые. У остальных ролей они нули сами собой — доставок за
    ними не числится.

    В составе начисления их не было, и три показанные части (оклады, комиссия,
    премии) не складывались в итог: у организации с курьерами разница уходила
    в никуда, а «состав» отвечал на вопрос «почему столько» неполной правдой.
  */
  deliveryPay: number;
  allowancePay: number;
  totalSalary: number;
  /** Что формула предлагает вычесть за подозрительные визиты; решает директор. */
  fraudDeductionProposed: number;
  breakdown: { fraudDeduction: number };
};

type Payout = {
  id: number;
  userId: number;
  userName: string;
  kind: "payout" | "advance";
  amount: string;
  paidAt: string | Date;
  note: string | null;
  /*
    Когда сам получатель подтвердил, что деньги у него.

    Пусто — не «не получил», а «ещё не подтвердил»: деньги могли отдать в руки,
    а телефон человек откроет вечером. Поэтому колонка спокойная, без красного:
    тревожить ею директора не за что.
  */
  confirmedAt: string | Date | null;
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

/*
  Вычет за подозрительные визиты — предложение, а не автоматика.

  Формула (оклад × доля подозрительных × ½) раньше вычитала сама и нигде на
  этом экране не показывалась: «начислено» было уже уменьшено, и никто не
  видел, за что. Теперь она только предлагает; из зарплаты уходит то, что
  директор применил здесь. Вычет живёт по месяцам — на неделе и квартале
  строки нет.
*/
function FraudDeductionLine({ row, period, offset, fmt, t }: {
  row: Row; period: PeriodKind; offset: number; fmt: (v: number) => string; t: (r: string, u: string) => string;
}) {
  const utils = trpc.useUtils();
  const set = trpc.kpi.setFraudDeduction.useMutation({
    onSuccess: () => utils.kpi.salaryReport.invalidate(),
    onError: (e) => notify.error(e.message),
  });
  if (period !== "month") return null;
  const applied = -Number(row.breakdown?.fraudDeduction ?? 0);
  const proposed = Number(row.fraudDeductionProposed ?? 0);
  if (applied <= 0 && proposed <= 0) return null;
  const busy = set.isPending;
  return (
    <div className="flex items-center gap-2 flex-wrap" style={{ fontSize: "12px", color: applied > 0 ? "var(--color-danger-text)" : "var(--color-warning-text)" }} data-testid={`fraud-line-${row.agentId}`}>
      {applied > 0 ? (
        <>
          <span>{t("вычет за визиты", "tashriflar uchun ushlab qolish")}: −{fmt(applied)}</span>
          <button type="button" className="neo-btn neo-btn-xs tap" disabled={busy}
            onClick={() => set.mutate({ userId: row.agentId, offset, amount: null })}
            data-testid={`fraud-remove-${row.agentId}`}>
            {t("снять", "olib tashlash")}
          </button>
        </>
      ) : (
        <>
          <span>{t("предложен вычет за подозрительные визиты", "shubhali tashriflar uchun ushlab qolish taklifi")}: {fmt(proposed)}</span>
          <button type="button" className="neo-btn neo-btn-xs tap" disabled={busy}
            onClick={() => set.mutate({ userId: row.agentId, offset, amount: proposed })}
            data-testid={`fraud-apply-${row.agentId}`}>
            {t("применить", "qo'llash")}
          </button>
        </>
      )}
    </div>
  );
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
        delivery:   acc.delivery + Number(r.deliveryPay ?? 0),
        allowance:  acc.allowance + Number(r.allowancePay ?? 0),
        total:      acc.total + Number(r.totalSalary ?? 0),
      }),
      { base: 0, commission: 0, delivery: 0, allowance: 0, total: 0 },
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
      ...seen.map(r => ({ value: r, label: labelled(ROLE_LABEL, r, lang) })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, lang]);

  const exportSheet = () => {
    exportToExcel(
      rows.map(r => ({
        [t("Сотрудник", "Xodim")]: r.agentName,
        [t("Роль", "Lavozim")]: labelled(ROLE_LABEL, r.role, lang),
        [t("Оклад", "Maosh")]: Number(r.baseSalary ?? 0),
        [t("Комиссия", "Komissiya")]: Number(r.commissionAmount ?? 0),
        [t("За доставки", "Yetkazish uchun")]: Number(r.deliveryPay ?? 0),
        [t("Обед и дорожные", "Tushlik va yo'l")]: Number(r.allowancePay ?? 0),
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
          {/* Заголовок как на остальных экранах: тёмный, не акцентный.
              Акцентом красят то, что нажимают, а не то, что читают. */}
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.02em" }}>
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
          <div className="range-pills" role="group" aria-label={t("Период", "Davr")}>
            <button
              onClick={() => setOffset(o => o + 1)}
              className="range-pill tap"
              style={{ padding: "8px 10px" }}
              aria-label={t("Предыдущий период", "Oldingi davr")}
              data-testid="period-prev"
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "12.5px", fontWeight: 700, color: COLORS.textPrimary,
              minWidth: "116px", textAlign: "center", textTransform: "capitalize",
            }}>
              {periodLabel(period, offset, lang)}
            </span>
            <button
              onClick={() => setOffset(o => Math.max(0, o - 1))}
              disabled={offset === 0}
              className="range-pill tap disabled:opacity-30"
              style={{ padding: "8px 10px" }}
              aria-label={t("Следующий период", "Keyingi davr")}
              data-testid="period-next"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/*
            Домашний переключатель — .range-pills, тот же, что на главной, в
            отчётах и в KPI.

            Здесь была своя пара классов, и выбранная кнопка красилась белым по
            фирменному цвету. В тёмной теме фирменный — золотой, и белым по нему
            выходит 2.42:1 при норме 4.5. Та же ошибка уже разбиралась у кнопки
            подтверждения и у переключателя периода в KPI: цвет надписи на
            заливке берут из палитры, а не пишут словом «белый».
          */}
          <div role="group" aria-label={t("Длина периода", "Davr uzunligi")} className="range-pills">
            {PERIODS.map(p => (
              <button
                key={p.value}
                onClick={() => { setPeriod(p.value); setOffset(0); }}
                aria-pressed={period === p.value}
                className={"range-pill tap" + (period === p.value ? " active" : "")}
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

      {/*
        ── Фонд оплаты ────────────────────────────────────────────────────────

        Здесь стояли четыре одинаковых плитки — фонд, выплачено, авансы, к
        выплате — и под ними пятая карточка с полосой. Две беды.

        Первая: четыре равновеликие плитки утверждают, что перед нами четыре
        независимых величины. На деле это ОДНО число и его разложение:
        начислено = выплачено + осталось, а авансы вообще часть выплаченного —
        и этого нигде не было сказано, так что «выплачено 5 млн, авансы 2 млн»
        читалось как семь.

        Вторая: цвета. Значки сидели на градиентах #16a34a→#22c47a,
        #f59e0b→#fbbf24 и #6366f1→#818cf8 — зелёный, янтарный и индиго из
        палитры Tailwind, которой у нас нет. В тёмной теме они оставались
        прежними, рядом с золотым фирменным читались как чужие, а сами значки
        были белыми словом — на золотом это 2.4:1 при норме 4.5.

        Теперь одно число, одна составная полоса под ним и подписи с суммами.
        Цвет один — фирменный: доля закрытого фонда. Остальное — нейтрали.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-3">
        <div className="neo-card neo-card-static" style={{ padding: "20px 22px" }}>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="font-label" style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", color: COLORS.textTertiary }}>
                {t("ФОНД ОПЛАТЫ", "ISH HAQI FONDI")}
              </p>
              <p style={{
                margin: "4px 0 0", fontFamily: F.display, fontSize: "30px", fontWeight: 700,
                lineHeight: 1.1, letterSpacing: "-0.025em",
                color: COLORS.textPrimary, fontVariantNumeric: "tabular-nums",
              }}>
                {fmt(totals.total)}
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <span style={{
                width: "38px", height: "38px", borderRadius: "13px", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "var(--color-primary-subtle)", color: "var(--color-primary-text)",
              }}>
                <Wallet size={18} />
              </span>
              <div>
                <p style={{ fontSize: "19px", fontWeight: 700, lineHeight: 1.1, color: COLORS.textPrimary, fontVariantNumeric: "tabular-nums" }}>
                  {paidPct}%
                </p>
                <p style={{ fontSize: "11px", color: COLORS.textTertiary }}>{t("фонд закрыт", "fond yopildi")}</p>
              </div>
            </div>
          </div>

          <FundBar paid={totals.paid} advances={totals.advances} total={totals.total} />

          {/* Подписи с суммами. Полоса без чисел показывает пропорцию, но
              директору нужна не пропорция, а сколько ещё раздать. */}
          <div className="flex flex-wrap gap-x-7 gap-y-2 mt-3">
            <Legend
              swatch="var(--color-primary)"
              label={t("ВЫПЛАЧЕНО", "TO'LANGAN")}
              value={fmt(totals.paid)}
              note={totals.advances > 0
                ? t(`в т.ч. АВАНСЫ ${fmt(totals.advances)}`, `shu jumladan AVANSLAR ${fmt(totals.advances)}`)
                : undefined}
            />
            <Legend
              swatch="var(--color-canvas)"
              outlined
              label={t("К ВЫПЛАТЕ", "TO'LANADI")}
              value={fmt(totals.due)}
              note={totals.due > 0 ? t("остаток по людям", "odamlar bo'yicha qoldiq") : t("раздано всё", "hammasi berildi")}
              strong={totals.due > 0}
            />
          </div>
        </div>

        {/* Из чего сложилось начисление. Вопрос директора обычно не «сколько
            всего», а «почему столько». */}
        <div className="neo-card neo-card-static" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", justifyContent: "center", gap: "11px" }}>
          <p className="font-label" style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", color: COLORS.textTertiary }}>
            {t("СОСТАВ НАЧИСЛЕНИЯ", "HISOBLASH TARKIBI")}
          </p>
          <Part label={t("ОКЛАДЫ", "MAOSHLAR")} value={totals.base} total={totals.total} fmt={fmt} />
          <Part label={t("КОМИССИЯ", "KOMISSIYA")} value={totals.commission} total={totals.total} fmt={fmt} />
          {/*
            Курьерские части показываются, только когда они есть: у
            организации без курьеров две нулевые строки занимали бы место и
            сообщали бы ровно ничего.
          */}
          {totals.delivery > 0 && (
            <Part label={t("ЗА ДОСТАВКИ", "YETKAZISH UCHUN")} value={totals.delivery} total={totals.total} fmt={fmt} />
          )}
          {totals.allowance > 0 && (
            <Part label={t("ОБЕД И ДОРОЖНЫЕ", "TUSHLIK VA YO'L")} value={totals.allowance} total={totals.total} fmt={fmt} />
          )}
        </div>
      </div>

      {/* ── Вкладки и фильтры ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Разделы — тот же .range-pills, что у периода выше и на других
            экранах. Своя пара классов означала третий механизм переключения на
            одной странице: у периода свой, у разделов свой, у вида выплаты в
            окне третий — и ни один не похож на остальное приложение. */}
        <div role="tablist" aria-label={t("Раздел", "Bo'lim")} className="range-pills">
          {([["accruals", t("Начисления", "Hisoblangan")], ["payouts", `${t("Выплаты", "To'lovlar")} · ${(paidQuery.data ?? []).length}`]] as const).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key as "accruals" | "payouts")}
              className={"range-pill tap" + (tab === key ? " active" : "")}
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
              {/* Домашняя кнопка вместо своей пары стилей: нажатое состояние
                  красилось белым по фирменному — на золоте тёмной темы 2.4:1. */}
              <button
                onClick={() => setOnlyDue(v => !v)}
                aria-pressed={onlyDue}
                className="neo-btn tap px-3 text-xs font-semibold flex items-center gap-1.5"
                style={onlyDue
                  ? { color: "var(--color-primary-text)", boxShadow: "var(--shadow-pressed)" }
                  : undefined}
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
                      {[t("СОТРУДНИК", "XODIM"), t("ОКЛАД", "MAOSH"), t("КОМИССИЯ", "KOMISSIYA"),
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
                        <tr key={r.agentId} className="row-hover" data-testid={`salary-row-${r.agentId}`}>
                          <td style={tdStyle}>
                            <div className="flex items-center gap-3">
                              <Avatar name={r.agentName} />
                              <div className="min-w-0">
                                <div style={{ fontWeight: 600 }}>{r.agentName}</div>
                                <RoleBadge role={r.role} lang={lang} rate={Number(r.commissionAmount) > 0 ? r.commissionRate : null} />
                                <FraudDeductionLine row={r} period={period} offset={offset} fmt={fmt} t={t} />
                              </div>
                            </div>
                          </td>
                          <Num v={Number(r.baseSalary ?? 0)} fmt={fmt} empty={t("не задан", "belgilanmagan")} />
                          <Num v={Number(r.commissionAmount ?? 0)} fmt={fmt} />
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
                  {/*
                    Итог ведомости.

                    Его не было вовсе: суммы по столбцам директор мог узнать
                    только из карточек наверху, и то не все — по окладам,
                    комиссии и премиям там числа за ВСЮ организацию, а таблица
                    показывает отфильтрованных. Отфильтровал по роли — и сверить
                    стало не с чем.
                  */}
                  <tfoot>
                    <tr>
                      <td style={{ ...tdStyle, fontWeight: 700, borderBottom: "none" }}>
                        {t("Итого", "Jami")}
                        <span style={{ fontWeight: 500, color: COLORS.textTertiary }}>
                          {" · "}{rows.length}
                          {rows.length !== allRows.length ? ` ${t("из", "dan")} ${allRows.length}` : ""}
                        </span>
                      </td>
                      {[
                        rows.reduce((x, r) => x + Number(r.baseSalary ?? 0), 0),
                        rows.reduce((x, r) => x + Number(r.commissionAmount ?? 0), 0),
                        rows.reduce((x, r) => x + Number(r.totalSalary ?? 0), 0),
                        rows.reduce((x, r) => x + (paidByUser.get(r.agentId)?.total ?? 0), 0),
                        rows.reduce((x, r) => x + Math.max(0, dueOf(r)), 0),
                      ].map((v, i) => (
                        <td key={i} style={{
                          ...tdStyle, textAlign: "right", borderBottom: "none",
                          fontVariantNumeric: "tabular-nums",
                          fontWeight: i >= 3 ? 700 : 600,
                          color: i >= 3 ? COLORS.textPrimary : COLORS.textSecondary,
                        }}>
                          {fmt(v)}
                        </td>
                      ))}
                      <td style={{ ...tdStyle, borderBottom: "none" }} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Телефон: карточка на человека, история — по нажатию. */}
          <div className="space-y-3 lg:hidden">
            {rows.map(r => {
              const base = Number(r.baseSalary ?? 0);
              const commission = Number(r.commissionAmount ?? 0);
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
                    <p style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: COLORS.textPrimary, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                      {fmt(Number(r.totalSalary ?? 0))}
                    </p>
                  </div>

                  {/* Из чего сложилось. Ноль не печатаем: строка «комиссия 0»
                      ничего не сообщает, а место занимает. */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2" style={{ fontSize: "12px", color: COLORS.textTertiary }}>
                    {base > 0 && <span>{t("оклад", "maosh")}: {fmt(base)}</span>}
                    {commission > 0 && <span>{t("комиссия", "komissiya")}: {fmt(commission)}</span>}
                    {base === 0 && commission === 0 && (
                      // Пусто — это не ошибка расчёта, а незаполненный оклад.
                      // Сказать прямо дешевле, чем принимать вопрос «почему ноль».
                      <span style={{ color: "var(--color-warning-text)" }}>
                        {t("оклад не задан", "maosh belgilanmagan")}
                      </span>
                    )}
                  </div>
                  <FraudDeductionLine row={r} period={period} offset={offset} fmt={fmt} t={t} />

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
                    {[t("НОМЕР", "RAQAM"), t("ДАТА", "SANA"), t("КОМУ", "KIMGA"), t("ВИД", "TURI"), t("ВЫДАЛ", "BERDI"), t("ПОЛУЧЕНО", "OLINDI"), t("СУММА", "SUMMA")].map((h, i) => (
                      <th key={i} style={{ ...thStyle, textAlign: i === 6 ? "right" : "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payouts.map(p => (
                    <tr
                      key={p.id}
                      onClick={() => setViewing(p)}
                      /*
                        Строка кликается, значит должна и подсвечиваться, и
                        открываться с клавиатуры. Курсор-палец без подсветки —
                        единственный признак, что строка живая, и он есть только
                        у мыши.
                      */
                      className="row-hover"
                      tabIndex={0}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setViewing(p); } }}
                      style={{ cursor: "pointer" }}
                      data-testid={`payout-row-${p.id}`}
                    >
                      <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums", color: COLORS.primaryText, fontWeight: 600 }}>{payoutNo(p)}</td>
                      <td style={tdStyle}>{format(asDate(p.paidAt), "d MMMM, HH:mm", lang === "uz" ? undefined : { locale: ruLocale })}</td>
                      <td style={tdStyle}>{p.userName}</td>
                      <td style={tdStyle}><KindBadge kind={p.kind} lang={lang} /></td>
                      <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{p.paidByName ?? "—"}</td>
                      {/*
                        Подтвердил ли получатель. Раньше выплата была событием
                        в одну сторону: записали, что выдали, — а другой
                        стороны у записи не было, и спор «мне не платили»
                        упирался в слово против слова.
                      */}
                      <td style={{ ...tdStyle, color: p.confirmedAt ? "var(--color-success-text)" : COLORS.textTertiary }}>
                        {p.confirmedAt
                          ? format(asDate(p.confirmedAt), "d MMM", lang === "uz" ? undefined : { locale: ruLocale })
                          : t("ждём", "kutamiz")}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(Number(p.amount))}</td>
                    </tr>
                  ))}
                </tbody>
                {/* Итог — в tfoot, а не последней строкой tbody: иначе он
                    попадает под наведение и клик как обычная выплата. */}
                <tfoot>
                  <tr>
                    <td colSpan={6} style={{ ...tdStyle, fontWeight: 700, borderBottom: "none" }}>{t("Итого за период", "Davr uchun jami")}</td>
                    <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, borderBottom: "none", fontVariantNumeric: "tabular-nums" }}>
                      {fmt(payouts.reduce((s, p) => s + Number(p.amount ?? 0), 0))}
                    </td>
                  </tr>
                </tfoot>
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

/**
 * Кружок с инициалами.
 *
 * Был квадратом со скруглением и серой рамкой — той же формы, что плитка
 * товара и значок склада. Круг отличает человека от вещи, и на списке в
 * тридцать строк это единственное, что подсказывает: колонка про людей.
 */
function Avatar({ name }: { name: string }) {
  return (
    <div style={{
      width: "36px", height: "36px", flexShrink: 0, borderRadius: "999px",
      background: "var(--color-primary-subtle)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: F.display, fontSize: "12px", fontWeight: 700, letterSpacing: "0.02em",
      color: "var(--color-primary-text)",
    }}>
      {initials(name)}
    </div>
  );
}

function RoleBadge({ role, lang, rate }: { role: string; lang: string; rate: number | null }) {
  const label = labelled(ROLE_LABEL, role, lang === "uz" ? "uz" : "ru");
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

/**
 * Плашка состояния.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * `var(--color-success-bg, rgba(22,163,74,.12))` — токена --color-success-bg в
 * приложении НЕТ (есть --color-success-subtle). Значит запасное значение
 * срабатывало ВСЕГДА, и плашка всегда была зелёной из палитры Tailwind, мимо
 * темы. То же с warning. Написано как из палитры, работало как литерал.
 *
 * ── Что теперь ──────────────────────────────────────────────────────────────
 *
 * Зелёного здесь нет вовсе, и не только из-за токена. «Выплачено» — не
 * хорошая новость, а закрытая строка: красить её в цвет успеха значит
 * подсвечивать на экране то, чем заниматься уже не нужно. Внимания требует
 * ОСТАТОК — он и берёт фирменный цвет. Предупреждающий остаётся там, где и
 * должен: аванс и переплата.
 */
function Pill({ text, tone }: { text: string; tone: "ok" | "warn" | "due" }) {
  const tones = {
    ok:   { bg: "var(--color-surface-light)",   fg: "var(--color-text-tertiary)" },
    warn: { bg: "var(--color-warning-subtle)",  fg: "var(--color-warning-text)" },
    due:  { bg: "var(--color-primary-subtle)",  fg: "var(--color-primary-text)" },
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

/**
 * Составная полоса фонда: сколько уже отдано и сколько осталось.
 *
 * Цвет один — фирменный. Прежняя полоса заливалась градиентом #16a34a→#22c47a:
 * зелёный из палитры Tailwind, которой у нас нет, одинаковый в обеих темах и
 * ни на что в приложении не похожий.
 *
 * Авансы показаны внутри выплаченного тем же цветом, но светлее: они и есть
 * часть выплаченного, а не пятая величина рядом. Отдельной плиткой они читались
 * как ещё одни деньги, и итог на экране не сходился ни с чем.
 */
function FundBar({ paid, advances, total }: { paid: number; advances: number; total: number }) {
  const share = (v: number) => (total > 0 ? Math.max(0, Math.min(100, (v / total) * 100)) : 0);
  return (
    <div style={{
      height: "10px", borderRadius: "999px", marginTop: "16px", overflow: "hidden",
      background: "var(--color-canvas)", boxShadow: "var(--shadow-pressed)",
      display: "flex",
    }}>
      <div style={{
        width: `${share(paid - advances)}%`, height: "100%",
        background: "var(--color-primary)", transition: "width .3s ease",
      }} />
      <div style={{
        width: `${share(advances)}%`, height: "100%",
        background: "color-mix(in srgb, var(--color-primary) 45%, transparent)",
        transition: "width .3s ease",
      }} />
    </div>
  );
}

/**
 * Подпись под полосой: квадратик цвета, слово, сумма.
 *
 * `outlined` — для незалитой части: её квадратик того же цвета, что дорожка
 * полосы, и без обводки был бы неразличим на карточке. Взять для него просто
 * цвет рамки нельзя: тогда квадратик и полоса говорят об одном разными
 * цветами, а подпись затем и нужна, чтобы их связать.
 */
function Legend({ swatch, label, value, note, strong, outlined }: {
  swatch: string; label: string; value: string; note?: string; strong?: boolean; outlined?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "9px", minWidth: 0 }}>
      <span style={{
        width: "9px", height: "9px", borderRadius: "3px", background: swatch,
        boxShadow: outlined ? "inset 0 0 0 1px var(--color-border)" : undefined,
        flexShrink: 0, marginTop: "5px",
      }} />
      <div style={{ minWidth: 0 }}>
        <p className="font-label" style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.07em", color: COLORS.textTertiary }}>
          {label}
        </p>
        <p style={{
          fontSize: "16px", fontWeight: 700, lineHeight: 1.25, fontVariantNumeric: "tabular-nums",
          color: strong ? "var(--color-primary-text)" : COLORS.textPrimary,
        }}>
          {value}
        </p>
        {note && <p style={{ fontSize: "11px", color: COLORS.textTertiary, marginTop: "1px" }}>{note}</p>}
      </div>
    </div>
  );
}

/** Строка состава начисления: слово, доля полоской, сумма. */
function Part({ label, value, total, fmt }: { label: string; value: number; total: number; fmt: (v: number) => string }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-label" style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.07em", color: COLORS.textTertiary }}>
          {label}
        </span>
        <span style={{ fontSize: "13.5px", fontWeight: 700, color: COLORS.textPrimary, fontVariantNumeric: "tabular-nums" }}>
          {fmt(value)}
        </span>
      </div>
      {/* Доля — полоской, а не процентом цифрой: три доли рядом сравниваются
          глазом за один взгляд, три числа приходится вычитать в уме. */}
      <div style={{ height: "4px", borderRadius: "999px", marginTop: "5px", background: "var(--color-canvas)", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "color-mix(in srgb, var(--color-primary) 55%, transparent)" }} />
      </div>
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
          {/* Тот же .range-pills, что у периода и разделов на странице: третий
              механизм переключения в одном окне читался как чужая вставка. */}
          <div role="group" aria-label={t("Вид", "Turi")} className="range-pills" style={{ display: "flex", width: "100%" }}>
            {(["payout", "advance"] as const).map(k => (
              <button
                key={k}
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={"range-pill tap" + (kind === k ? " active" : "")}
                style={{ flex: 1 }}
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
  const { company: seller } = useSellerCompany();

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
          {/* Имя организации — на бумаге, которую подписывают обе стороны.
              Ордер без шапки не говорит, чья это касса. */}
          {seller.name && <div className="hidden" style={{ fontWeight: 600 }}>{seller.name}</div>}
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
