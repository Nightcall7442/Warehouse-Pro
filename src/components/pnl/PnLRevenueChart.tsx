import {
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  ComposedChart,
  Line,
  LabelList,
  ReferenceLine,
} from "recharts";
import { F, COLORS, monthLabel } from "./styles";
import { ChartTooltip } from "./ChartTooltip";
import { SectionNotice } from "@/components/SectionNotice";

interface TrendDataPoint {
  month: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  netProfit: number;
}

interface PnLRevenueChartProps {
  chartData: TrendDataPoint[];
  fmt: (value: number) => string;
  t: (ru: string, uz: string) => string;
  lang: string;
}

/**
 * Подпись оси.
 *
 * Стояло «12M» и «450K» — латинские сокращения на русской странице. Intl знает
 * их на языке пользователя («12 млн», «450 тыс.») и заодно ставит правильный
 * десятичный разделитель, так что писать собственную лесенку из if незачем.
 */
function shortMoney(lang: string) {
  const nf = new Intl.NumberFormat(lang === "uz" ? "uz" : "ru", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  return (v: number) => nf.format(v);
}

export function PnLRevenueChart({ chartData, fmt, t, lang }: PnLRevenueChartProps) {
  const rows = chartData.map((r) => ({ ...r, label: monthLabel(r.month, lang) }));
  const last = rows.length - 1;
  const short = shortMoney(lang);

  return (
    <div className="neo-card neo-card-static" style={{ padding: "24px" }}>
      <h2
        style={{
          fontFamily: F.display,
          fontSize: "16px",
          fontWeight: 600,
          color: COLORS.textPrimary,
          margin: "0 0 4px",
        }}
      >
        {t("Динамика по месяцам", "Oylar bo'yicha dinamika")}
      </h2>
      <p style={{ margin: "0 0 20px", fontSize: "12px", color: COLORS.textTertiary }}>
        {t(
          "Столбцы — выручка и себестоимость, линия — чистая прибыль",
          "Ustunlar — tushum va tannarx, chiziq — toza foyda"
        )}
      </p>

      {/* Раньше при пустом ряде карточка возвращала null и исчезала со
          страницы целиком: пропавший раздел не отличается от раздела, которого
          и не должно быть. Ряд приходит вместе со сводкой, поэтому отказ
          запроса разбирает страница (QueryErrorFallback), а здесь остаётся
          сказать, что показывать нечего — и почему. */}
      {rows.length === 0 ? (
        <SectionNotice
          kind="empty"
          message={t("За выбранный период продаж не было.", "Tanlangan davrda sotuv bo'lmagan.")}
        />
      ) : rows.length === 1 ? (
        // Ряд сервер отдаёт ПОМЕСЯЧНО, а период по умолчанию — 30 дней. Из
        // одного столбца динамики не видно, и рисовать «график» из одной
        // точки значит обещать сравнение, которого нет.
        <SectionNotice
          kind="empty"
          message={t(
            `Период укладывается в один месяц (${rows[0].label}): ${fmt(rows[0].revenue)} выручки. Динамику видно на диапазоне «12 мес.» или «Год».`,
            `Davr bir oyga to'g'ri keladi (${rows[0].label}): ${fmt(rows[0].revenue)}. Dinamika uchun «12 oy» yoki «Yil» oralig'ini tanlang.`
          )}
        />
      ) : (
        <div style={{ overflowX: "auto" }}>
          {/* Ширина держится минимальной на столбец: на ноутбуке 1280 при
              двенадцати месяцах подписи оси иначе налезали друг на друга. */}
          <div style={{ height: "340px", minWidth: `${Math.max(rows.length * 76, 360)}px` }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 16, right: 56, left: 8, bottom: 4 }}>
                {/* Сетка сплошная и только горизонтальная: пунктир читается
                    как «порог» или «прогноз», а вертикальные линии дублируют
                    подписи оси. */}
                <CartesianGrid vertical={false} stroke={COLORS.border} strokeWidth={1} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: COLORS.textTertiary, fontFamily: F.body }}
                  axisLine={{ stroke: COLORS.border }}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  width={64}
                  tick={{ fontSize: 11, fill: COLORS.textTertiary, fontFamily: F.body }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={short}
                />
                <Tooltip cursor={false} content={<ChartTooltip fmt={fmt} />} />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  wrapperStyle={{ fontSize: "12px", fontFamily: F.body, paddingTop: "12px" }}
                />
                {/*
                  Выручка носит опознавательный синий, а не фирменный цвет.

                  Фирменный цвет задаёт арендатор, и рядом с ним стоит столбец
                  себестоимости — оранжевый. В тёмной теме основной цвет по
                  умолчанию латунный (#c9a227), и при замере пара «латунный —
                  оранжевый» расходится всего на 8.6 из 15 нужных даже при
                  обычном зрении, а при дальтонизме на 3.9: два соседних
                  столбца сливались в один. Синий взят тот же, что у плитки
                  «Выручка» вверху страницы, оранжевый — тот же, что у плитки
                  «Себестоимость» и у полосы состава: один показатель — один
                  оттенок по всей странице.

                  isAnimationActive выключен по той же причине, что у линии
                  ниже: оборванная перерисовкой анимация оставляет пустые
                  группы вместо столбцов.
                */}
                <Bar
                  dataKey="revenue"
                  name={t("Выручка", "Tushum")}
                  fill="var(--kpi-blue)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="cogs"
                  name={t("Себестоимость", "Tannarx")}
                  fill="var(--kpi-orange)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                  isAnimationActive={false}
                />
                {/* Ноль подписан отдельно: без него убыточный месяц выглядит
                    просто «низким», а не отрицательным. */}
                <ReferenceLine y={0} stroke={COLORS.textTertiary} strokeWidth={1} />
                <Line
                  dataKey="netProfit"
                  name={t("Чистая прибыль", "Toza foyda")}
                  stroke="var(--color-success)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  /*
                    Без анимации входа — и это не про вкус.

                    Точки и подпись у последней точки recharts рисует только
                    ПОСЛЕ того, как анимация линии доиграет. Карточка меняет
                    ширину (боковое меню, изменение окна, появление полосы
                    прокрутки), перерисовка обрывает анимацию на середине, и
                    сообщение о её окончании больше не приходит: линия есть, а
                    точек и подписи нет совсем. В проверке это воспроизвелось
                    на второй же перезагрузке.
                  */
                  isAnimationActive={false}
                  // Кольцо цветом карточки: точка остаётся видимой там, где
                  // линия проходит по столбцу.
                  dot={{ r: 4, fill: "var(--color-success)", stroke: COLORS.surface, strokeWidth: 2 }}
                  activeDot={{ r: 6, stroke: COLORS.surface, strokeWidth: 2 }}
                >
                  {/* Подпись только у последней точки: число возле каждой —
                      шум, который никто не читает, а последняя отвечает на
                      вопрос «чем всё кончилось». */}
                  <LabelList
                    dataKey="netProfit"
                    content={(props: { index?: number; x?: number | string; y?: number | string; value?: number | string }) => {
                      if (props.index !== last) return null;
                      const x = Number(props.x ?? 0);
                      const y = Number(props.y ?? 0);
                      return (
                        <text
                          x={x + 8}
                          y={y - 8}
                          fontSize={11}
                          fontWeight={700}
                          fontFamily={F.display}
                          fill={COLORS.textPrimary}
                        >
                          {short(Number(props.value ?? 0))}
                        </text>
                      );
                    }}
                  />
                </Line>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
