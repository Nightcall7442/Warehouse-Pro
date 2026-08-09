import { Activity, Timer, AlertCircle, MemoryStick } from "lucide-react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { COLORS } from "./theme";
import { Section } from "./Section";
import { ChartTooltip } from "./ChartTooltip";

interface ChartDataItem {
  time: string;
  rps?: number;
  response?: number;
  errors?: number;
  heap?: number;
}

interface PerformanceChartsProps {
  chartData: ChartDataItem[];
}

export function PerformanceCharts({ chartData }: PerformanceChartsProps) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: "16px" }}>
      <Section title="Запросов в секунду" icon={Activity} delay={0.1}>
        <div style={{ height: "180px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gradRps" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: COLORS.textTertiary }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textTertiary }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="rps" name="RPS" stroke={COLORS.primary} strokeWidth={2} fill="url(#gradRps)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Section>
      <Section title="Время ответа (мс)" icon={Timer} delay={0.2}>
        <div style={{ height: "180px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gradResp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.success} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={COLORS.success} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: COLORS.textTertiary }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textTertiary }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="response" name="мс" stroke={COLORS.success} strokeWidth={2} fill="url(#gradResp)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Section>
      <Section title="Ошибки в секунду" icon={AlertCircle} delay={0.3}>
        <div style={{ height: "180px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: COLORS.textTertiary }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textTertiary }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="errors" name="Ошибки" fill={COLORS.danger} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>
      <Section title="Память (MB)" icon={MemoryStick} delay={0.4}>
        <div style={{ height: "180px" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gradHeap" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.info} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={COLORS.info} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: COLORS.textTertiary }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: COLORS.textTertiary }} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="heap" name="Heap MB" stroke={COLORS.info} strokeWidth={2} fill="url(#gradHeap)" dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Section>
    </div>
  );
}
