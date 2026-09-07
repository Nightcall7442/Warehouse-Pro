import { memo, useMemo, useState } from "react";
import { Award, FileDown, Printer, BarChart3, ArrowDown, ArrowUp, Minus } from "lucide-react";
import { colorMix } from "@/lib/color-mix";
import { F, COLORS, delta, tableMinWidth, thStyle, tdStyle } from "./report-constants";
import { GlassPanel, SectionError } from "./ReportCharts";

/** Строка агента за период. Выручка приходит строкой из decimal — приводится здесь один раз. */
export interface AgentRow {
  agentId: number;
  agentName: string | null;
  orders: number;
  revenue: number;
  avgOrderValue: number;
  /** Выручка того же агента за предыдущий такой же период; null — его тогда не было в списке. */
  prevRevenue: number | null;
}

type SortKey = "revenue" | "orders" | "avgOrderValue";

interface AgentsTabProps {
  agents: AgentRow[] | undefined;
  days: number;
  isLoading?: boolean;
  onRetry?: () => void;
  isError?: boolean;
  fmt: (v: string | number, short?: boolean) => string;
  t: (ru: string, uz: string) => string;
  onExport: () => void;
  onExportPDF: () => void;
}

/**
 * «Агенты» — ответ на вопрос «кто везёт, а кто просел».
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Пьедестал из трёх карточек с медалями-эмодзи и золотой заливкой, а под ним —
 * тот же список целиком, где первые три строки повторяли пьедестал. Дальше шли
 * карточки в столбик: имя, визиты, заказы, выручка. Сравнить двух агентов
 * между собой в таком виде нельзя — глазу не за что зацепиться, числа стоят
 * в разных местах каждой карточки. Отсортировать по среднему чеку — тоже
 * нельзя: порядок задавал сервер, и только по выручке.
 *
 * Заливки пьедестала были прописаны литералами (#7a8ba8, #c47a3a, тень
 * rgba(212,151,58,.25)) с белым текстом поверх. У арендатора со светлым
 * фирменным цветом это оставалось единственным местом страницы, которое не
 * перекрашивалось вместе с остальным.
 *
 * ── Что стало ───────────────────────────────────────────────────────────────
 *
 * Одна таблица, которую можно отсортировать по любому столбцу, и колонка
 * «к прошлому периоду» — та самая, ради которой сюда и приходят: выручка сама
 * по себе говорит, кто больше, но не говорит, кто ПРОСЕЛ. Агент с третьим
 * местом и минус сорока процентами — разговор на завтра, а на пьедестале он
 * выглядел призёром.
 *
 * ── Почему нет визитов ──────────────────────────────────────────────────────
 *
 * Они были и показывали не то. reports.getAgentPerformance, откуда вкладка их
 * брала, считает выручку по ЛЮБОМУ неудалённому заказу — вместе с отменёнными
 * и возвращёнными, — тогда как соседние «Продажи по магазинам» считают только
 * доставленные. Две вкладки одной страницы расходились на отменённые заказы.
 * Вкладка переведена на analytics.agentPerformance, где набор заказов тот же,
 * что у всех остальных чисел страницы, а визитов он не отдаёт. Визиты и
 * конверсия остались в выгрузке «Эффективность агентов» в каталоге.
 */
export const AgentsTab = memo(function AgentsTab({
  agents, days, isLoading, isError, onRetry, fmt, t, onExport, onExportPDF,
}: AgentsTabProps) {
  const [sort, setSort] = useState<SortKey>("revenue");

  const rows = useMemo(
    // Копия перед sort(): он правит массив на месте, а эти же ряды страница
    // отдаёт и в «Обзор», где порядок свой.
    () => (agents ?? []).slice().sort((a, b) => b[sort] - a[sort]),
    [agents, sort],
  );
  const totalRevenue = rows.reduce((s, a) => s + a.revenue, 0);

  const columns: { key: SortKey | null; ru: string; uz: string; right?: boolean }[] = [
    { key: null, ru: "Агент", uz: "Agent" },
    { key: "orders", ru: "Заказов", uz: "Buyurtma", right: true },
    { key: "avgOrderValue", ru: "Средний чек", uz: "O'rtacha chek", right: true },
    { key: "revenue", ru: "Выручка", uz: "Tushum", right: true },
    { key: null, ru: "Доля", uz: "Ulush", right: true },
    { key: null, ru: `К прошлым ${days} дн.`, uz: `Oldingi ${days} kunga`, right: true },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <GlassPanel style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", padding: "18px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            width: "40px", height: "40px", borderRadius: "12px", flexShrink: 0,
            background: "var(--kpi-purple-track)", color: "var(--kpi-purple)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Award size={18} aria-hidden />
          </div>
          <div>
            <p style={{ fontFamily: F.body, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
              {t(`Агенты за ${days} дней`, `Agentlar (${days} kun)`)}
            </p>
            <p style={{ fontSize: "12px", color: COLORS.textTertiary, margin: "2px 0 0" }}>
              {rows.length} {t("агентов", "ta agent")} · {t("выручка", "tushum")} {fmt(totalRevenue)}
            </p>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" onClick={onExport} className="neo-btn neo-btn-sm tap" style={{ padding: "0 14px" }}>
            <FileDown size={13} aria-hidden /> Excel
          </button>
{/* Та же правка, что на странице отчётов: значок принтера печатал сам
              экран приложения, а документ собирала соседняя кнопка. */}
          <button
            type="button"
            onClick={onExportPDF}
            className="neo-btn neo-btn-sm tap"
            style={{ padding: "0 14px" }}
            title={t("Откроется окно печати. Чтобы получить файл, выберите принтер «Сохранить как PDF».",
                     "Chop etish oynasi ochiladi. Fayl olish uchun «PDF sifatida saqlash» printerini tanlang.")}
          >
            <Printer size={13} aria-hidden /> {t("Печать", "Chop etish")}
          </button>
        </div>
      </GlassPanel>

      {isError && onRetry ? (
        <SectionError onRetry={onRetry} t={t} />
      ) : isLoading ? (
        <GlassPanel>
          <p style={{ color: COLORS.textSecondary, fontSize: "13px", textAlign: "center", padding: "32px 0" }}>
            {t("Загрузка…", "Yuklanmoqda…")}
          </p>
        </GlassPanel>
      ) : rows.length === 0 ? (
        <GlassPanel>
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <BarChart3 size={32} style={{ color: COLORS.textTertiary, margin: "0 auto 12px", opacity: 0.3 }} aria-hidden />
            <p style={{ fontSize: "14px", color: COLORS.textSecondary, margin: 0 }}>
              {t("За период агенты не продавали", "Davrda agentlar sotmagan")}
            </p>
          </div>
        </GlassPanel>
      ) : (
        <GlassPanel style={{ padding: "8px 0 0" }}>
          {/* Таблица не сминается, а едет вбок: восемь колонок на ноутбуке 1280
              иначе укладывают имя агента в три строки, а числа — в две. */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: tableMinWidth, borderCollapse: "separate", borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: "44px", textAlign: "right" }}>№</th>
                  {columns.map(c => (
                    <th key={c.ru} style={{ ...thStyle, textAlign: c.right ? "right" : "left", padding: c.key ? 0 : thStyle.padding }}
                      aria-sort={c.key && sort === c.key ? "descending" : undefined}>
                      {c.key ? (
                        <button type="button" onClick={() => setSort(c.key as SortKey)} style={{
                          display: "inline-flex", alignItems: "center", gap: "4px",
                          width: "100%", justifyContent: c.right ? "flex-end" : "flex-start",
                          padding: "12px 16px", border: "none", background: "transparent", cursor: "pointer",
                          font: "inherit", color: sort === c.key ? COLORS.primaryText : "inherit",
                          textTransform: "inherit", letterSpacing: "inherit",
                        }}>
                          {t(c.ru, c.uz)}
                          {sort === c.key && <ArrowDown size={11} aria-hidden />}
                        </button>
                      ) : t(c.ru, c.uz)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((a, i) => {
                  const share = totalRevenue > 0 ? (a.revenue / totalRevenue) * 100 : 0;
                  const d = delta(a.revenue, a.prevRevenue);
                  return (
                    <tr key={a.agentId} style={{
                      // Тройка лидеров — бледной подложкой из фирменного цвета,
                      // а не золотом-серебром-бронзой поверх белого текста.
                      background: i < 3 ? colorMix(COLORS.primary, 4) : "transparent",
                    }}>
                      <td style={{ ...tdStyle, textAlign: "right", color: COLORS.textTertiary, fontVariantNumeric: "tabular-nums" }}>
                        {i + 1}
                      </td>
                      <td style={{ ...tdStyle, fontWeight: 600 }}>
                        {a.agentName ?? `${t("Агент", "Agent")} #${a.agentId}`}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{a.orders}</td>
                      <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {a.orders > 0 ? fmt(a.avgOrderValue, true) : "—"}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700, color: COLORS.primaryText, fontVariantNumeric: "tabular-nums" }}>
                        {fmt(a.revenue)}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", color: COLORS.textSecondary, fontVariantNumeric: "tabular-nums" }}>
                        {share.toFixed(1)}%
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <DeltaCell pct={d?.pct ?? null} t={t} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </GlassPanel>
      )}
    </div>
  );
});

/**
 * Изменение к прошлому периоду.
 *
 * Прочерк, а не «0 %», когда сравнивать не с чем: у нового агента прошлого
 * периода нет, и ноль тут читался бы как «стоит на месте».
 */
const DeltaCell = memo(function DeltaCell({ pct, t }: { pct: number | null; t: (ru: string, uz: string) => string }) {
  if (pct === null) return (
    <span title={t("В прошлом периоде продаж не было", "Oldingi davrda sotuv bo'lmagan")}
      style={{ color: COLORS.textTertiary }}>—</span>
  );
  const dir = pct > 0.5 ? "up" : pct < -0.5 ? "down" : "flat";
  const color = dir === "up" ? COLORS.successText : dir === "down" ? COLORS.dangerText : COLORS.textTertiary;
  const Icon = dir === "up" ? ArrowUp : dir === "down" ? ArrowDown : Minus;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "3px",
      color, fontWeight: 700, fontVariantNumeric: "tabular-nums",
    }}>
      <Icon size={12} aria-hidden />
      {pct > 0 ? "+" : ""}{pct.toFixed(pct > -10 && pct < 10 ? 1 : 0)}%
    </span>
  );
});
