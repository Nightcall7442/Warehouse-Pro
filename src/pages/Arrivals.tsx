import { memo, useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useScrollTopOnChange } from "@/hooks/useScrollTopOnChange";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { format } from "date-fns";
import { CardTable } from "@/components/CardTable";
import {
  Plus, FileDown,
  ArrowUpRight, ArrowDownRight, Minus, Truck, Package, CheckCircle2, Clock,
} from "lucide-react";
import { exportToExcel, formatArrivalsForExport } from "@/lib/excel";
import { notify } from "@/lib/toast";
import { PremiumSelect } from "@/components/PremiumSelect";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { useConfirm } from "@/components/ConfirmDialog";
import { CounterpartiesSection } from "@/components/counterparties";
import { useUrlState, urlEnum } from "@/hooks/useUrlState";
import { colorMix } from "@/lib/color-mix";


/** Вкладка живёт в адресе: ссылку на раздел долгов можно переслать. */
const TAB_CODEC = urlEnum(["arrivals", "counterparties"] as const, "arrivals");

const F = { display: "'Manrope', -apple-system, sans-serif", body: "'Manrope', -apple-system, sans-serif" };
const COLORS = {
  primary: "var(--color-primary)",
  // Accent-coloured *text* (a price, a code, a link). The fill colour above
  // is a hair under 4.5:1 as text on a light card, so semantic text uses
  // this darker sibling instead. See --color-primary-text in index.css.
  primaryText: "var(--color-primary-text)", success: "var(--color-success)",
  warning: "var(--color-warning)", danger: "var(--color-danger)",
  surface: "var(--color-surface, #efedea)", surfaceLight: "var(--color-surface-light, #f6f4f0)",
  textPrimary: "var(--color-text-primary, #2b2a28)", textSecondary: "var(--color-text-secondary, #5e5b54)",
  textTertiary: "var(--color-text-tertiary, #6b6760)", border: "var(--color-border, #d8d5cd)",
};
const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

function KpiCard({ label, value, delta, icon, gradient, delay }: {
  label: string; value: string; delta: number | null;
  icon: React.ReactNode; gradient: string; delay: number;
}) {
  const isPositive = delta !== null && delta > 0;
  const isNegative = delta !== null && delta < 0;
  return (
    <div className="kpi-hero" style={{
      borderRadius: "24px", padding: "24px",
      position: "relative", overflow: "hidden",
      animation: `slideUp ${0.5 + delay}s ease`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>
          {label}
        </span>
        <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon}
        </div>
      </div>
      <div style={{ fontFamily: F.display, fontSize: "32px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
        {value}
      </div>
      {delta !== null && (
        <div style={{
          display: "flex", alignItems: "center", gap: "4px", marginTop: "10px",
          fontSize: "12px", fontWeight: 600, fontFamily: F.body,
          color: isPositive ? "var(--color-success-text)" : isNegative ? "var(--color-danger-text)" : COLORS.textTertiary,
        }}>
          {isPositive ? <ArrowUpRight size={14} /> : isNegative ? <ArrowDownRight size={14} /> : <Minus size={14} />}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}


const STATUS: Record<string, { ru: string; uz: string; color: string }> = {
  pending:   { ru: "Ожидает", uz: "Kutilmoqda", color: "var(--color-warning-text)" },
  unloading: { ru: "Разгрузка", uz: "Tushirilmoqda", color: "var(--color-info)" },
  completed: { ru: "Завершён", uz: "Yakunlandi", color: "var(--color-success-text)" },
};

const StatusBadge = memo(function StatusBadge({ status, lang }: { status: string; lang: "ru" | "uz" }) {
  const s = STATUS[status] ?? STATUS.pending;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 12px",
      borderRadius: "24px", fontSize: "11px", fontWeight: 600,
      background: colorMix(s.color, 7), color: s.color, fontFamily: F.body,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />
      {lang === "uz" ? s.uz : s.ru}
    </span>
  );
});

// ── Main Page ────────────────────────────────────────────────────────────────
/*
  Список приходов. Сам приход — отдельная страница (ArrivalEditor):
  новый набирается сеткой, сохранённый открывается документом.
*/
export default function Arrivals() {
  const [page, setPage] = useState(1);
  useScrollTopOnChange(page);
  const [status, setStatus] = useState("");
  const navigate = useNavigate();
  const [tab, setTab] = useUrlState("tab", "arrivals" as const, TAB_CODEC);
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);
  const { confirm, dialog } = useConfirm();

  const { data, isLoading, isLoadingError, refetch } = trpc.arrival.list.useQuery({ page, pageSize: 25, status: (status || undefined) as "pending" | "unloading" | "completed" | undefined });
  /*
    Запрос для выгрузки. Страница была на пятьсот строк — молчаливый потолок:
    у организации с шестьюстами приходами в файл попадали пятьсот, и понять
    это было нельзя ниоткуда. Размер тот же, что у выгрузки заказов.
  */
  const { data: all } = trpc.arrival.list.useQuery({ page: 1, pageSize: 5000 });
  const utils = trpc.useUtils();

  const updateStatus = trpc.arrival.update.useMutation({
    onSuccess: () => { utils.arrival.list.invalidate(); notify.success(t("Статус обновлён", "Holat yangilandi")); },
    onError: (e) => notify.error(e.message),
  });
  const deleteMutation = trpc.arrival.delete.useMutation({
    onSuccess: () => { utils.arrival.list.invalidate(); notify.success(t("Приход удалён", "Kelish o'chirildi")); },
    onError: (e) => notify.error(e.message),
  });

  const arrivals = useMemo(() => data?.data ?? [], [data]);
  const kpis = useMemo(() => {
    const total = arrivals.length;
    const totalExpenses = arrivals.reduce((s, a) => s + Number(a.totalExpense ?? 0), 0);
    const completed = arrivals.filter((a) => a.status === "completed").length;
    // Долг считается только по суммовым поставкам: складывать их с
    // долларовыми в одно число нельзя, а долларовые встречаются редко и
    // видны в разделе контрагентов отдельной строкой.
    const supplierDebt = arrivals
      .filter((a) => a.supplyCurrency === "UZS")
      .reduce((s, a) => s + Number(a.supplyDebt ?? 0), 0);
    return { total, totalExpenses, completed, supplierDebt };
  }, [arrivals]);

  const thStyle: React.CSSProperties = {
    fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
    letterSpacing: "0.08em", color: COLORS.textTertiary, padding: "14px 16px",
    borderBottom: `1px solid ${COLORS.border}`, textAlign: "left",
  };
  const tdStyle: React.CSSProperties = {
    padding: "14px 16px", borderBottom: `1px solid ${COLORS.border}`,
    fontSize: "13px", fontFamily: F.body, color: COLORS.textPrimary,
  };

  if (isLoadingError) return <QueryErrorFallback onRetry={refetch} />;
  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ height: "28px", width: "200px", borderRadius: "8px", background: COLORS.surfaceLight, marginBottom: "8px" }} />
            <div style={{ height: "16px", width: "280px", borderRadius: "6px", background: COLORS.surfaceLight }} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ height: "140px", borderRadius: "24px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.025em", margin: 0 }}>
            {t("Приходы", "Kelishlar")}
          </h1>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: "4px 0 0" }}>
            {tab === "counterparties"
              ? t("Расчёты с поставщиками и задолженность", "Yetkazib beruvchilar bilan hisob-kitob va qarzdorlik")
              : t("Поступление товаров на склад", "Omborga mahsulot kelishi")}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {tab === "arrivals" && <>
          <button onClick={async () => await exportToExcel(formatArrivalsForExport(all?.data ?? []), "arrivals")} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
            border: `1px solid ${COLORS.border}`, cursor: "pointer",
            background: COLORS.surface, color: COLORS.textSecondary,
          }}>
            <FileDown size={14} /> Excel
          </button>
          <button onClick={() => navigate("/arrivals/new")} className="neo-btn-primary" data-testid="arrivals-new" style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px",
          }}>
            <Plus size={15} /> {t("Новый приход", "Yangi kelish")}
          </button>
          </>}
        </div>
      </div>

      {/* Вкладки раздела.
          Долг перед заводом рождается в момент прихода товара и гасится
          оттуда же — поэтому расчёты с контрагентами живут здесь же, соседней
          вкладкой, а не отдельным пунктом меню, между которыми оператору
          пришлось бы ходить. */}
      <div style={{ display: "flex", gap: "4px", borderBottom: `1px solid ${COLORS.border}` }}>
        {([
          { key: "arrivals" as const,       label: t("Приходы", "Kelishlar") },
          { key: "counterparties" as const, label: t("Контрагенты и долги", "Kontragentlar va qarzlar") },
        ]).map(x => (
          <button
            key={x.key}
            data-testid={`arrivals-tab-${x.key}`}
            onClick={() => setTab(x.key)}
            style={{
              padding: "12px 18px", border: "none", background: "none", cursor: "pointer",
              fontFamily: F.body, fontSize: "14px",
              fontWeight: tab === x.key ? 700 : 500,
              color: tab === x.key ? COLORS.primaryText : COLORS.textSecondary,
              borderBottom: `2px solid ${tab === x.key ? "var(--color-primary)" : "transparent"}`,
              marginBottom: "-1px",
            }}
          >
            {x.label}
          </button>
        ))}
      </div>

      {/* Раздел монтируется только когда выбран: пока открыты приходы, ни один
          его запрос не уходит на сервер. */}
      {tab === "counterparties" && <CounterpartiesSection />}

      {tab === "arrivals" && <>
      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        <KpiCard
          label={t("ВСЕГО ПРИХОДОВ", "JAMI KELISHLAR")}
          value={String(kpis.total)}
          delta={null}
          icon={<Package size={20} color="var(--color-on-primary)" />}
          gradient="var(--color-primary)"
          delay={0}
        />
        <KpiCard
          label={t("РАСХОДЫ", "XARAJATLAR")}
          value={fmt(kpis.totalExpenses)}
          delta={null}
          icon={<Truck size={20} color="var(--color-on-primary)" />}
          gradient="linear-gradient(135deg, var(--color-warning), color-mix(in srgb, var(--color-warning) 70%, var(--color-danger)))"
          delay={0.05}
        />
        <KpiCard
          label={t("ЗАВЕРШЕНЫ", "YAKUNLANDI")}
          value={String(kpis.completed)}
          delta={null}
          icon={<CheckCircle2 size={20} color="var(--color-on-primary)" />}
          gradient="linear-gradient(135deg, var(--color-success), color-mix(in srgb, var(--color-success) 65%, var(--color-primary)))"
          delay={0.1}
        />
        <KpiCard
          label={t("ДОЛГ ПОСТАВЩИКАМ", "YETKAZUVCHILARGA QARZ")}
          value={fmt(kpis.supplierDebt)}
          delta={null}
          icon={<Clock size={20} color="var(--color-on-primary)" />}
          gradient="linear-gradient(135deg, var(--color-danger), color-mix(in srgb, var(--color-danger) 70%, var(--color-warning)))"
          delay={0.15}
        />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <PremiumSelect value={status} onChange={v => { setStatus(v); setPage(1); }}
          options={[{ value: "", label: t("Все статусы", "Barcha holatlar") }, { value: "pending", label: t("Ожидает", "Kutilmoqda") }, { value: "unloading", label: t("Разгрузка", "Tushirilmoqda") }, { value: "completed", label: t("Завершён", "Yakunlandi") }]}
          width="180px" />
      </div>

      {/* Table */}
      {/*
        Таблица прокручивается вбок, а не обрезается.

        Здесь стояло overflow: hidden — оно нужно ради скруглённых углов, но
        заодно отрезало всё, что не влезло. В таблице семь колонок, и у трёх
        запрещён перенос (номер прихода, оплачено, остаток), так что на
        экране 375 точек она заведомо шире. Оператор и руководитель с
        телефона не видели «ОСТАТОК» и «СТАТУС» вовсе — и добраться до них
        не могли ничем: обрезанное не прокручивается.

        min-width у самой таблицы: без него колонки сжимаются в нечитаемые
        полоски, и прокрутка теряет смысл — честнее оставить её шире экрана.
      */}
      <CardTable style={{ background: COLORS.surface, borderRadius: "24px", boxShadow: SHADOW, overflowX: "auto", overflowY: "hidden", WebkitOverflowScrolling: "touch", animation: "slideUp 0.5s ease" }}>
        <table style={{ width: "100%", minWidth: "760px", borderCollapse: "separate", borderSpacing: 0 }}>
          <thead>
            <tr>
              {[t("ПРИХОД", "KELISH"), t("ДАТА", "SANA"), t("ПОСТАВЩИК", "YETKAZUVCHI"), t("СУММА", "SUMMA"), t("ОПЛАЧЕНО", "TO'LANGAN"), t("ОСТАТОК", "QOLDIQ"), t("СТАТУС", "HOLAT")].map(h => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}><td colSpan={7} style={{ padding: "16px" }}><div style={{ height: 16, background: COLORS.surfaceLight, borderRadius: 8, width: "60%" }} /></td></tr>
            )) : arrivals.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: "center", padding: "48px 16px", color: COLORS.textTertiary, fontSize: "14px" }}>{t("Нет приходов", "Kelishlar yo'q")}</td></tr>
            ) : arrivals.map((a) => (
              <tr key={a.id} className="row-hover" style={{ cursor: "pointer" }} onClick={() => navigate(`/arrivals/${a.id}`)}>
                <td style={{ ...tdStyle, fontWeight: 500 }}>{a.arrivalNumber}</td>
                <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{a.arrivalDate ? format(new Date(a.arrivalDate), "dd.MM.yyyy") : "—"}</td>
                <td style={{ ...tdStyle, color: COLORS.textSecondary }}>
                  {a.supplierName ?? "—"}
                  {a.truckId && <div style={{ fontSize: "11px", color: COLORS.textTertiary }}>{a.truckId}</div>}
                </td>
                <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: "nowrap" }}>
                  {a.supplyAmount == null
                    ? <span style={{ color: COLORS.textTertiary, fontWeight: 400 }}>—</span>
                    : `${Number(a.supplyAmount).toLocaleString("ru-RU")} ${a.supplyCurrency}`}
                </td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap", color: "var(--color-success-text)" }}>
                  {a.supplyPaid == null
                    ? <span style={{ color: COLORS.textTertiary }}>—</span>
                    : `${Number(a.supplyPaid).toLocaleString("ru-RU")} ${a.supplyCurrency}`}
                </td>
                <td style={{ ...tdStyle, whiteSpace: "nowrap", fontWeight: 700, color: Number(a.supplyDebt ?? 0) > 0 ? COLORS.danger : COLORS.textTertiary }}>
                  {a.supplyDebt == null
                    ? <span style={{ fontWeight: 400 }}>—</span>
                    : `${Number(a.supplyDebt).toLocaleString("ru-RU")} ${a.supplyCurrency}`}
                </td>
                <td style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <StatusBadge status={a.status ?? "pending"} lang={lang as "ru" | "uz"} />
                    {a.status === "pending" && <button onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: a.id, status: "unloading" }); }} style={{ padding: "6px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 600, fontFamily: F.body, color: COLORS.primaryText, background: "color-mix(in srgb, var(--color-primary) 8%, transparent)", border: "none", cursor: "pointer" }}>{t("Разгрузка", "Tushirish")}</button>}
                    {a.status === "unloading" && <button onClick={(e) => { e.stopPropagation(); updateStatus.mutate({ id: a.id, status: "completed" }); }} className="neo-btn-primary neo-btn-sm">{t("Завершить", "Yakunlash")}</button>}
                    {a.status !== "completed" && <button onClick={async (e) => { e.stopPropagation(); const ok = await confirm({ title: t("Удалить приход?", "Kelish o'chirilsinmi?"), message: t("Данные будут удалены безвозвратно.", "Ma'lumotlar qaytarib bo'lmaydigan tarzda o'chiriladi."), confirmText: t("Удалить", "O'chirish"), danger: true }); if (ok) deleteMutation.mutate({ id: a.id }); }} style={{ padding: "6px 10px", borderRadius: "8px", fontSize: "11px", fontWeight: 600, fontFamily: F.body, color: COLORS.danger, background: "var(--color-danger-subtle)", border: "none", cursor: "pointer" }}>{t("Удалить", "O'chirish")}</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardTable>

      {/* Pagination */}
      {data && data.total > 25 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "13px", color: COLORS.textSecondary }}>{data.total} {t("всего", "jami")}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{
              padding: "8px 16px", borderRadius: "10px", fontSize: "13px", fontFamily: F.body,
              color: COLORS.textSecondary, border: "none", cursor: "pointer",
              background: COLORS.surfaceLight, opacity: page === 1 ? 0.5 : 1,
            }}>{t("Назад", "Orqaga")}</button>
            <button onClick={() => setPage(p => p + 1)} disabled={page * 25 >= data.total} style={{
              padding: "8px 16px", borderRadius: "10px", fontSize: "13px", fontFamily: F.body,
              color: COLORS.textSecondary, border: "none", cursor: "pointer",
              background: COLORS.surfaceLight, opacity: page * 25 >= data.total ? 0.5 : 1,
            }}>{t("Далее", "Keyingi")}</button>
          </div>
        </div>
      )}

      </>}

      {dialog}
    </div>
  );
}
