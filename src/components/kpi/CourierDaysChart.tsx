import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { CHART_COLORS, CHART_BAR_DEFAULTS, CHART_TOOLTIP_STYLE } from "@/lib/chartTheme";

/**
 * Как шли доставки по дням.
 *
 * ── Зачем график, когда есть числа ──────────────────────────────────────────
 *
 * «Тридцать довезено за месяц» не отвечает на вопрос, который на самом деле
 * задают: работал ли человек ровно или закрыл всё за три дня и три недели
 * простаивал. Оба случая дают одно и то же число в плитке.
 *
 * Столбики, а не линия: доставки — счётные события по дням, а не непрерывная
 * величина. Линия между «5 марта» и «9 марта» рисовала бы плавный переход там,
 * где четыре дня просто ничего не было.
 */
export function CourierDaysChart({ days, t }: {
  days: { date: string; delivered: number; failed: number }[];
  t: (ru: string, uz: string) => string;
}) {
  if (days.length === 0) {
    return (
      <p style={{ fontSize: "12.5px", color: "var(--color-text-tertiary)", padding: "20px 0", textAlign: "center" }}>
        {t("За этот период доставок не было", "Bu davrda yetkazish bo'lmagan")}
      </p>
    );
  }

  /*
    Подпись дня — «05.09», без года: год один и тот же у всех столбиков, а
    место на оси занимает.
  */
  const data = days.map(d => ({
    ...d,
    label: `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}`,
  }));

  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        {/*
          Оси — прямыми детьми графика.

          Обёртка над ними (даже безобидная, вроде фрагмента) убивает подписи
          молча: линии рисуются, чисел под ними нет. Этот случай уже разбирали
          в отчётах.
        */}
        <BarChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={12}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "var(--color-text-tertiary)" }}
            tickLine={false}
            axisLine={false}
            width={38}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            labelStyle={{ color: "var(--color-text-primary)", fontWeight: 600, marginBottom: 4 }}
            itemStyle={{ fontSize: 12 }}
            formatter={(value: number, name: string) => [
              value,
              name === "delivered" ? t("довезено", "yetkazildi") : t("сорвано", "bajarilmadi"),
            ]}
          />
          <Bar dataKey="delivered" {...CHART_BAR_DEFAULTS} fill={CHART_COLORS.primary} stackId="a" />
          {/*
            Сорванные — тем же столбиком сверху, а не рядом.

            Рядом два столбика читаются как две независимые величины, и
            приходится складывать их глазом, чтобы понять, сколько заявок было
            всего. Сложенные отвечают сразу: высота — сколько назначили, цветная
            часть — сколько доехало.
          */}
          <Bar dataKey="failed" {...CHART_BAR_DEFAULTS} fill={CHART_COLORS.danger} stackId="a" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
