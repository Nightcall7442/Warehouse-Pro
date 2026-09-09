import { useMemo, useState } from "react";
import { Loader2, CalendarRange, Eraser } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { PremiumSelect } from "@/components/PremiumSelect";
import { currentMonth, monthDays, monthLabel, weekdayOf } from "./month";

/*
  ── Месяц целиком ───────────────────────────────────────────────────────────

  План визита ставился на ОДИН день: выбрать агента, выбрать территорию,
  сохранить — и так двадцать шесть раз, чтобы занять человека на месяц.
  Расписание (магазин × день недели) умело разворачиваться в планы, но лежало
  свёрнутым разделом внизу страницы и требовало ткнуть в каждую клетку таблицы
  «сорок магазинов × семь дней».

  Здесь месяц ставится одним движением: агент, территория, дни недели —
  «Расставить». И тут же видно, что получилось: сетка «агенты × числа месяца»,
  где клетка — сколько визитов стоит в этот день и сколько из них закрыто.

  Дни недели считаются в UTC, как на сервере: организация живёт в Ташкенте
  (+5), и местное время браузера сдвинуло бы «первое октября» на день.
*/

const WEEKDAYS_RU = [
  { dow: 1, ru: "ПН", uz: "DU" },
  { dow: 2, ru: "ВТ", uz: "SE" },
  { dow: 3, ru: "СР", uz: "CH" },
  { dow: 4, ru: "ЧТ", uz: "PA" },
  { dow: 5, ru: "ПТ", uz: "JU" },
  { dow: 6, ru: "СБ", uz: "SH" },
  { dow: 0, ru: "ВС", uz: "YA" },
];

type Overview = {
  days: string[];
  rows: Array<{
    agentId: number; agentName: string; templateShops: number;
    planned: number; visited: number; skipped: number;
    byDay: Record<string, { planned: number; visited: number; skipped: number }>;
  }>;
  totals: { planned: number; visited: number; skipped: number };
};

// ── Расстановка ───────────────────────────────────────────────────────────────
function SetupPanel({ month, lang, onDone }: { month: string; lang: string; onDone: () => void }) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [agentId, setAgentId] = useState(0);
  /** 0 — «по расписанию агента»: дни берёт сервер из самого расписания. */
  const [territoryId, setTerritoryId] = useState(0);
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const [saveTemplate, setSaveTemplate] = useState(true);
  /*
    Прошедшие дни текущего месяца по умолчанию не заполняются.

    Визит, поставленный задним числом, никто уже не закроет — он навсегда
    останется «запланирован». А доля закрытых визитов и есть норма: расставь
    пятнадцатого числа весь месяц с первого — и выполнение сразу падает вдвое
    из-за дней, которых не было.
  */
  const [skipPast, setSkipPast] = useState(true);

  const { data: agents = [] } = trpc.agent.listAgents.useQuery();
  const { data: territories = [] } = trpc.territory.list.useQuery();
  const utils = trpc.useUtils();

  const byTemplate = territoryId === 0;
  /*
    Точки берутся тем же запросом, что и на сервере, — только действующие.
    В territory.list счётчик shopCount считает все, включая закрытые, и
    предпросмотр «40 визитов» разошёлся бы с реально поставленными 37.
  */
  const { data: territoryShops } = trpc.territory.getShops.useQuery(
    { territoryId },
    { enabled: territoryId > 0 },
  );

  /*
    Сколько визитов встанет — считается здесь же, до нажатия.

    «Расставить» без числа — это кнопка, после которой в базе появляется
    неизвестно сколько строк. Сорок точек по три дня в неделю дают полтораста
    визитов за месяц, и человек имеет право увидеть это заранее, а не в
    сообщении об успехе.
  */
  const isCurrentMonth = month === currentMonth();
  const fromDay = isCurrentMonth && skipPast ? new Date().getDate() : undefined;
  const workDays = useMemo(
    () => monthDays(month)
      .filter(d => !fromDay || Number(d.slice(-2)) >= fromDay)
      .filter(d => weekdays.includes(weekdayOf(d))),
    [month, weekdays, fromDay],
  );
  const shopCount = territoryShops?.length ?? 0;
  const estimate = byTemplate ? null : shopCount * workDays.length;

  const planMonth = trpc.schedule.planMonth.useMutation({
    onSuccess: (r) => {
      utils.schedule.monthOverview.invalidate();
      utils.agent.getPlans.invalidate();
      notify.success(
        r.created === 0
          ? t(`Всё уже стояло: ${r.skipped} визитов`, `Hammasi allaqachon bor edi: ${r.skipped} tashrif`)
          : t(
            `Поставлено ${r.created} визитов${r.skipped ? `, уже были ${r.skipped}` : ""}`,
            `${r.created} tashrif qo'yildi${r.skipped ? `, ${r.skipped} tasi bor edi` : ""}`,
          ),
      );
      onDone();
    },
    onError: (e) => notify.error(e.message),
  });

  const toggleDay = (dow: number) =>
    setWeekdays(prev => prev.includes(dow) ? prev.filter(d => d !== dow) : [...prev, dow].sort());

  const canRun = agentId > 0 && (byTemplate || (weekdays.length > 0 && shopCount > 0));

  return (
    <div className="neo-card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <CalendarRange size={16} style={{ color: "var(--color-primary-text)" }} />
        <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
          {t("Расставить визиты на месяц", "Oyga tashriflarni joylashtirish")}
        </h3>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
        <label style={{ display: "block" }}>
          <span className="font-label" style={{ fontSize: "11px", color: "var(--color-text-secondary)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: "6px" }}>
            {t("Сотрудник", "Xodim")}
          </span>
          <PremiumSelect
            value={String(agentId)}
            onChange={v => setAgentId(Number(v))}
            width="100%"
            options={[
              { value: "0", label: t("Выберите…", "Tanlang…") },
              ...agents.map(a => ({ value: String(a.id), label: a.name })),
            ]}
          />
        </label>

        <label style={{ display: "block" }}>
          <span className="font-label" style={{ fontSize: "11px", color: "var(--color-text-secondary)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: "6px" }}>
            {t("Что ставим", "Nima qo'yamiz")}
          </span>
          <PremiumSelect
            value={String(territoryId)}
            onChange={v => setTerritoryId(Number(v))}
            width="100%"
            options={[
              { value: "0", label: t("По расписанию сотрудника", "Xodim jadvali bo'yicha") },
              ...territories.map(tr => ({
                value: String(tr.id),
                label: `${tr.name} — ${tr.shopCount} ${t("точек", "nuqta")}`,
              })),
            ]}
          />
        </label>
      </div>

      {/*
        При работе по расписанию дни недели не спрашиваются: у каждой точки в
        нём свои дни, и общий переключатель здесь означал бы не то, что
        показывает. Вместо него — прямая подсказка, откуда возьмутся дни.
      */}
      {byTemplate ? (
        <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", margin: 0 }}>
          {t(
            "Дни возьмутся из расписания сотрудника — у каждой точки свои. Расписание настраивается ниже, в разделе «Расписание визитов».",
            "Kunlar xodim jadvalidan olinadi — har bir nuqtaning o'z kuni bor. Jadval quyida sozlanadi.",
          )}
        </p>
      ) : (
        <div>
          <span className="font-label" style={{ fontSize: "11px", color: "var(--color-text-secondary)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>
            {t("Дни недели", "Hafta kunlari")}
          </span>
          <div role="group" aria-label={t("Дни недели", "Hafta kunlari")} style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            {WEEKDAYS_RU.map(d => {
              const on = weekdays.includes(d.dow);
              return (
                <button
                  key={d.dow}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(d.dow)}
                  className="tap"
                  style={{
                    minWidth: "44px", height: "36px", borderRadius: "10px", cursor: "pointer",
                    fontSize: "12px", fontWeight: 700, letterSpacing: "0.04em",
                    border: `1px solid ${on ? "transparent" : "var(--color-border)"}`,
                    background: on ? "var(--color-primary)" : "var(--color-surface-light)",
                    color: on ? "var(--color-on-primary)" : "var(--color-text-secondary)",
                    boxShadow: on ? "var(--shadow-sm)" : "none",
                    transition: "all 0.15s",
                  }}
                >
                  {lang === "uz" ? d.uz : d.ru}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        {!byTemplate && (
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--color-text-secondary)", cursor: "pointer" }}>
            <input type="checkbox" checked={saveTemplate} onChange={e => setSaveTemplate(e.target.checked)}
              style={{ width: "16px", height: "16px" }} />
            {t("Запомнить расписанием — следующий месяц одной кнопкой",
               "Jadval sifatida eslab qolish — keyingi oy bir tugma bilan")}
          </label>
        )}

        {isCurrentMonth && (
          <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "var(--color-text-secondary)", cursor: "pointer" }}>
            <input type="checkbox" checked={skipPast} onChange={e => setSkipPast(e.target.checked)}
              style={{ width: "16px", height: "16px" }} />
            {t("Не заполнять прошедшие дни", "O'tgan kunlarni to'ldirmaslik")}
          </label>
        )}

        <button
          onClick={() => planMonth.mutate({
            agentId, month,
            territoryId: byTemplate ? undefined : territoryId,
            weekdays: byTemplate ? undefined : weekdays,
            saveTemplate: byTemplate ? false : saveTemplate,
            fromDay,
          })}
          disabled={!canRun || planMonth.isPending}
          className="neo-btn-primary flex items-center gap-2"
          style={{ marginLeft: "auto", opacity: canRun && !planMonth.isPending ? 1 : 0.5, padding: "10px 18px" }}
        >
          {planMonth.isPending && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
          {estimate != null && estimate > 0
            ? t(`Расставить — ${estimate} визитов`, `Joylashtirish — ${estimate} tashrif`)
            : t("Расставить месяц", "Oyni joylashtirish")}
        </button>
      </div>

      {estimate != null && estimate > 0 && (
        <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: 0 }}>
          {t(
            `${shopCount} точек × ${workDays.length} дней${fromDay ? `, начиная с ${fromDay}-го` : ` в ${monthLabel(month, lang).toLowerCase()}`}`,
            `${shopCount} nuqta × ${workDays.length} kun`,
          )}
        </p>
      )}
    </div>
  );
}

// ── Сетка месяца ──────────────────────────────────────────────────────────────
function MonthGrid({ data, lang }: { data: Overview; lang: string }) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "separate", borderSpacing: "2px", fontSize: "11px" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "4px 8px", position: "sticky", left: 0, background: "var(--color-surface)", zIndex: 1, minWidth: "140px", color: "var(--color-text-tertiary)", fontWeight: 600 }}>
              {t("Сотрудник", "Xodim")}
            </th>
            {data.days.map(day => {
              const dow = weekdayOf(day);
              const weekend = dow === 0;
              return (
                <th key={day} style={{
                  width: "26px", padding: "2px", textAlign: "center", fontWeight: 600,
                  color: weekend ? "var(--color-text-tertiary)" : "var(--color-text-secondary)",
                  opacity: weekend ? 0.6 : 1,
                }}>
                  {Number(day.slice(-2))}
                </th>
              );
            })}
            <th style={{ padding: "4px 8px", textAlign: "right", color: "var(--color-text-tertiary)", fontWeight: 600, minWidth: "92px" }}>
              {t("План / факт", "Reja / fakt")}
            </th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map(row => {
            const pct = row.planned > 0 ? Math.round((row.visited / row.planned) * 100) : 0;
            return (
              <tr key={row.agentId}>
                <td style={{
                  padding: "4px 8px", position: "sticky", left: 0, background: "var(--color-surface)", zIndex: 1,
                  color: "var(--color-text-primary)", fontWeight: 600, fontSize: "12px",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "160px",
                }}>
                  {row.agentName}
                  {row.planned === 0 && (
                    <span style={{ display: "block", fontSize: "10px", fontWeight: 500, color: "var(--color-text-tertiary)" }}>
                      {row.templateShops > 0
                        ? t(`расписание есть (${row.templateShops})`, `jadval bor (${row.templateShops})`)
                        : t("месяц не расставлен", "oy joylashtirilmagan")}
                    </span>
                  )}
                </td>
                {data.days.map(day => {
                  const cell = row.byDay[day];
                  const planned = cell?.planned ?? 0;
                  const done = (cell?.visited ?? 0) + (cell?.skipped ?? 0);
                  const full = planned > 0 && done >= planned;
                  return (
                    <td key={day} style={{ padding: 0 }}>
                      <div
                        title={planned > 0
                          ? t(`${day}: ${planned} визитов, закрыто ${done}`, `${day}: ${planned} tashrif, ${done} yopilgan`)
                          : day}
                        style={{
                          width: "26px", height: "26px", borderRadius: "6px",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: "10px", fontWeight: 700,
                          background: planned === 0
                            ? "var(--color-surface-light)"
                            : full ? "var(--color-success-subtle)" : "var(--color-primary-subtle)",
                          color: planned === 0
                            ? "var(--color-text-tertiary)"
                            : full ? "var(--color-success-text)" : "var(--color-primary-text)",
                          opacity: planned === 0 ? 0.45 : 1,
                        }}
                      >
                        {planned || ""}
                      </div>
                    </td>
                  );
                })}
                <td style={{ padding: "4px 8px", textAlign: "right", whiteSpace: "nowrap" }}>
                  <span className="font-data" style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-primary)" }}>
                    {row.planned}
                  </span>
                  <span style={{ color: "var(--color-text-tertiary)" }}> / </span>
                  <span className="font-data" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                    {row.visited}
                  </span>
                  {row.planned > 0 && (
                    <span className="font-data" style={{ marginLeft: "6px", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                      {pct}%
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Вкладка «Месяц» ───────────────────────────────────────────────────────────
export function MonthPlanner({ month, lang }: { month: string; lang: string }) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const utils = trpc.useUtils();
  const { confirm, dialog } = useConfirm();

  const { data, isLoading } = trpc.schedule.monthOverview.useQuery({ month });

  const clearMonth = trpc.schedule.clearMonth.useMutation({
    onSuccess: (r) => {
      utils.schedule.monthOverview.invalidate();
      utils.agent.getPlans.invalidate();
      notify.success(t(
        `Убрано ${r.deleted} незакрытых визитов${r.kept ? `, ${r.kept} с отметками сохранены` : ""}`,
        `${r.deleted} yopilmagan tashrif olib tashlandi${r.kept ? `, ${r.kept} belgilangan saqlandi` : ""}`,
      ));
    },
    onError: (e) => notify.error(e.message),
  });

  const askClear = async () => {
    const ok = await confirm({
      title: t("Убрать незакрытые визиты?", "Yopilmagan tashriflar olib tashlansinmi?"),
      message: t(
        `Из ${monthLabel(month, lang).toLowerCase()} у всех сотрудников будут убраны визиты со статусом «запланирован». Посещённые и отказы останутся — это уже история работы.`,
        `${monthLabel(month, lang)} oyidan «rejalashtirilgan» tashriflar olib tashlanadi. Tashrif qilinganlar saqlanadi.`,
      ),
      confirmText: t("Убрать", "Olib tashlash"),
      danger: true,
    });
    if (ok) clearMonth.mutate({ month });
  };

  const totals = data?.totals;
  const pct = totals && totals.planned > 0 ? Math.round((totals.visited / totals.planned) * 100) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {dialog}

      <SetupPanel month={month} lang={lang} onDone={() => utils.schedule.monthOverview.invalidate()} />

      <div className="neo-card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "14px", flexWrap: "wrap" }}>
            <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
              {monthLabel(month, lang)}
            </h3>
            {totals && (
              <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                <span className="font-data" style={{ fontWeight: 700, color: "var(--color-text-primary)" }}>{totals.planned}</span>
                {" "}{t("визитов", "tashrif")} · {t("закрыто", "yopilgan")}{" "}
                <span className="font-data" style={{ fontWeight: 700 }}>{totals.visited}</span>
                {totals.planned > 0 && <span className="font-data"> · {pct}%</span>}
              </span>
            )}
          </div>
          <button
            onClick={askClear}
            disabled={clearMonth.isPending || !totals?.planned}
            className="neo-btn flex items-center gap-2"
            style={{ fontSize: "12px", padding: "8px 14px", opacity: totals?.planned ? 1 : 0.5 }}
          >
            {clearMonth.isPending ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Eraser size={13} />}
            {t("Убрать незакрытые", "Yopilmaganlarni olib tashlash")}
          </button>
        </div>

        {isLoading ? (
          <div style={{ padding: "32px", textAlign: "center" }}>
            <Loader2 size={20} style={{ animation: "spin 1s linear infinite", color: "var(--color-primary-text)" }} />
          </div>
        ) : !data || data.rows.length === 0 ? (
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", margin: 0, padding: "24px 0", textAlign: "center" }}>
            {t("В организации нет активных агентов — планировать не для кого.",
               "Tashkilotda faol agentlar yo'q.")}
          </p>
        ) : (
          <MonthGrid data={data} lang={lang} />
        )}
      </div>
    </div>
  );
}
