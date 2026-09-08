import { Activity, Timer, AlertCircle, MemoryStick, Database, Hourglass } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { COLORS } from "./theme";
import { Section } from "./Section";
import { ChartTooltip } from "./ChartTooltip";
import type { MetricRow } from "@/lib/metric-grid";

/**
 * Графики страницы мониторинга.
 *
 * ── Что здесь есть и почему именно это ──────────────────────────────────────
 *
 * Четыре сигнала, по которым судят о здоровье службы: трафик, время ответа,
 * ошибки и насыщение. Первые три говорят, что происходит СЕЙЧАС; четвёртый —
 * сколько осталось до того, как станет плохо, и раньше его на графиках не было
 * вовсе. Упёршийся в потолок пул соединений или севший цикл событий виден в
 * остальных трёх только последствием: время ответа растёт при совершенно
 * здоровой базе, и причину ищут не там.
 *
 * У времени ответа две линии. Среднее прячет ровно то, из-за чего люди
 * жалуются: один запрос на четыре секунды среди сотни быстрых сдвигает среднее
 * на сорок миллисекунд и на графике не виден, а жалуется как раз тот, кто в
 * него попал. Поэтому рядом идёт худший ответ за ту же секунду.
 *
 * У памяти тоже две: куча — то, чем распоряжается сам JavaScript, RSS — всё,
 * что процесс занял на самом деле. Предел контейнера считается по второму, и
 * убивают процесс по нему же, поэтому смотреть на одну кучу мало.
 *
 * Все ряды приходят уже уложенными на общую секундную сетку (см. chartData в
 * Monitoring.tsx), поэтому ось времени у всех графиков одна и та же.
 */

interface PerformanceChartsProps {
  chartData: MetricRow[];
}

const axis = { fontSize: 10, fill: COLORS.textTertiary };
const legend = { fontSize: "11px", color: COLORS.textTertiary };
const MARGIN = { top: 5, right: 5, left: -20, bottom: 0 };

/** Заливка под линией: один и тот же приём у всех площадных графиков. */
function Fade({ id, color }: { id: string; color: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={0.25} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  );
}

/*
  Оси намеренно повторяются в каждом графике, а не вынесены в общий компонент.

  Recharts ищет оси, сетку и подсказку среди ПРЯМЫХ детей графика: обёртка,
  возвращающая их фрагментом, для него — один незнакомый ребёнок. Линии при
  этом рисуются как ни в чём не бывало, а оси исчезают молча. Так и вышло на
  первой попытке: пять графиков остались без единой подписи.
*/

export function PerformanceCharts({ chartData }: PerformanceChartsProps) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: "16px" }}>
      <Section title="Запросов в секунду" icon={Activity} delay={0.1}>
        <div style={{ height: "180px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={MARGIN}>
              <defs><Fade id="gradRps" color={COLORS.primary} /></defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="time" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40} />
              <YAxis tick={axis} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="rps" name="Запросов" stroke={COLORS.primary} strokeWidth={2} fill="url(#gradRps)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Section>

      {/* Среднее и худшее вместе: по одному среднему длинный ответ не увидеть. */}
      <Section title="Время ответа (мс)" icon={Timer} delay={0.15}>
        <div style={{ height: "180px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={MARGIN}>
              <defs>
                <Fade id="gradResp" color={COLORS.success} />
                <Fade id="gradWorst" color={COLORS.warning} />
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="time" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40} />
              <YAxis tick={axis} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={legend} iconType="plainline" />
              <Area type="monotone" dataKey="worst" name="худший" stroke={COLORS.warning} strokeWidth={1.5} fill="url(#gradWorst)" dot={false} isAnimationActive={false} />
              <Area type="monotone" dataKey="response" name="средний" stroke={COLORS.success} strokeWidth={2} fill="url(#gradResp)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Ошибки в секунду" icon={AlertCircle} delay={0.2}>
        <div style={{ height: "180px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="time" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40} />
              <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip cursor={false} content={<ChartTooltip />} />
              <Bar dataKey="errors" name="Ошибки" fill={COLORS.danger} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      {/* ── Насыщение: сколько осталось запаса ─────────────────────────────── */}

      <Section title="Соединения с базой" icon={Database} delay={0.25}>
        <div style={{ height: "180px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={MARGIN}>
              <defs>
                <Fade id="gradBusy" color={COLORS.info} />
                <Fade id="gradQueue" color={COLORS.danger} />
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="time" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40} />
              <YAxis tick={axis} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={legend} iconType="plainline" />
              <Area type="stepAfter" dataKey="dbBusy" name="занято" stroke={COLORS.info} strokeWidth={2} fill="url(#gradBusy)" dot={false} isAnimationActive={false} />
              {/* Очередь — не доля, а событие: ноль это норма, любое другое
                  число означает, что кто-то уже ждёт свободного соединения. */}
              <Area type="stepAfter" dataKey="dbQueue" name="в очереди" stroke={COLORS.danger} strokeWidth={2} fill="url(#gradQueue)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Задержка цикла событий (мс)" icon={Hourglass} delay={0.3}>
        <div style={{ height: "180px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={MARGIN}>
              <defs><Fade id="gradLag" color={COLORS.warning} /></defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="time" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40} />
              <YAxis tick={axis} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              {/* Хвост p99, а не среднее: среднее по циклу событий почти всегда
                  у нуля даже тогда, когда часть запросов уже ждёт. */}
              <Area type="monotone" dataKey="lag" name="p99, мс" stroke={COLORS.warning} strokeWidth={2} fill="url(#gradLag)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Память (МБ)" icon={MemoryStick} delay={0.35}>
        <div style={{ height: "180px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={MARGIN}>
              <defs>
                <Fade id="gradRss" color={COLORS.primary} />
                <Fade id="gradHeap" color={COLORS.info} />
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="time" tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40} />
              <YAxis tick={axis} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={legend} iconType="plainline" />
              {/* RSS первым: он всегда больше кучи и не должен её накрывать. */}
              <Area type="monotone" dataKey="rss" name="RSS" stroke={COLORS.primary} strokeWidth={1.5} fill="url(#gradRss)" dot={false} isAnimationActive={false} />
              <Area type="monotone" dataKey="heap" name="куча" stroke={COLORS.info} strokeWidth={2} fill="url(#gradHeap)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Section>
    </div>
  );
}
