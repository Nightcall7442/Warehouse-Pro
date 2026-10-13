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
import { F, COLORS, dayLabel, monthLabel, weekLabel } from "./styles";
import { ChartTooltip } from "./ChartTooltip";
import { SectionNotice } from "@/components/SectionNotice";

export type ChartGranularity = "day" | "week" | "month";

export interface ChartPoint {
  /** Первый день отрезка, «ГГГГ-ММ-ДД». */
  start: string;
  /** Последний день отрезка. */
  end: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  netProfit: number;
}

interface PnLRevenueChartProps {
  points: ChartPoint[];
  /** Шаг ряда — его выбирает сервер по длине периода (api/services/pnl-series.ts). */
  granularity: ChartGranularity;
  fmt: (value: number) => string;
  t: (ru: string, uz: string) => string;
  lang: string;
}

/**
 * Подпись оси.
 *
 * Стояло «12M» и «450K» — латинские сокращения на русской странице. Потом их
 * заменил Intl с notation: "compact", но браузер без узбекских данных так и
 * отвечал «28M» и «12.5K» на узбекском экране. Ступеней всего три, и
 * словарь для них короче, чем разбор, есть ли у браузера нужный язык.
 */
function shortMoney(lang: string) {
  const units = lang === "uz" ? ["ming", "mln", "mlrd"] : ["тыс.", "млн", "млрд"];
  const nf = new Intl.NumberFormat("ru", { maximumFractionDigits: 1 });
  return (v: number) => {
    const a = Math.abs(v);
    if (a >= 1e9) return `${nf.format(v / 1e9)} ${units[2]}`;
    if (a >= 1e6) return `${nf.format(v / 1e6)} ${units[1]}`;
    if (a >= 1e3) return `${nf.format(v / 1e3)} ${units[0]}`;
    return nf.format(v);
  };
}

/*
  Ширина столбца — по шагу ряда, и задана точно (barSize), а не потолком
  (maxBarSize).

  С потолком recharts делит категорию поровну между столбцами и ставит
  каждый посреди своей половины: при двух месяцах на всю ширину карточки
  выручка и себестоимость одного месяца стояли в сотнях точек друг от друга
  — две отдельные палки, по которым не понять, что они про один месяц.
  С точной шириной пара стоит вплотную посреди своей подписи. Если тридцать
  один день не помещается, recharts сам ужимает столбцы до ширины категории.
*/
const BAR: Record<ChartGranularity, { size: number; minWidth: number }> = {
  day: { size: 10, minWidth: 22 },
  week: { size: 18, minWidth: 60 },
  month: { size: 24, minWidth: 76 },
};

export function PnLRevenueChart({ points, granularity, fmt, t, lang }: PnLRevenueChartProps) {
  const labelOf = (p: ChartPoint) =>
    granularity === "day" ? dayLabel(p.start, lang)
    : granularity === "week" ? weekLabel(p.start, p.end, lang)
    : monthLabel(p.start.slice(0, 7), lang);
  const rows = points.map((r) => ({ ...r, label: labelOf(r) }));
  const last = rows.length - 1;
  const short = shortMoney(lang);
  const bar = BAR[granularity];
  // Дни без продаж сервер отдаёт нулями — ось не теряет дней. Но если нулём
  // стоит весь период, график из пустых дней ничего не говорит.
  const empty = rows.every((r) => !r.revenue && !r.cogs && !r.netProfit);
  const title = {
    day: t("Динамика по дням", "Kunlar bo'yicha dinamika"),
    week: t("Динамика по неделям", "Haftalar bo'yicha dinamika"),
    month: t("Динамика по месяцам", "Oylar bo'yicha dinamika"),
  }[granularity];

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
        {title}
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
      {empty ? (
        <SectionNotice
          kind="empty"
          message={t("За выбранный период продаж не было.", "Tanlangan davrda sotuv bo'lmagan.")}
        />
      ) : rows.length === 1 ? (
        // Из одного столбца динамики не видно, и рисовать «график» из одной
        // точки значит обещать сравнение, которого нет.
        <SectionNotice
          kind="empty"
          message={granularity === "month"
            ? t(
                `Период укладывается в один месяц (${rows[0].label}): ${fmt(rows[0].revenue)} выручки. Динамику видно на диапазоне «12 мес.» или «Год».`,
                `Davr bir oyga to'g'ri keladi (${rows[0].label}): ${fmt(rows[0].revenue)}. Dinamika uchun «12 oy» yoki «Yil» oralig'ini tanlang.`
              )
            : t(
                `Выбран один день (${rows[0].label}): ${fmt(rows[0].revenue)} выручки. Для динамики выберите период длиннее.`,
                `Bitta kun tanlangan (${rows[0].label}): ${fmt(rows[0].revenue)}. Dinamika uchun uzunroq davrni tanlang.`
              )}
        />
      ) : (
        <div style={{ overflowX: "auto" }}>
          {/* Ширина держится минимальной на столбец: на ноутбуке 1280 при
              двенадцати месяцах подписи оси иначе налезали друг на друга. */}
          <div style={{ height: "340px", minWidth: `${Math.max(rows.length * bar.minWidth, 360)}px` }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} barGap={2} margin={{ top: 16, right: 56, left: 8, bottom: 4 }}>
                {/* Сетка сплошная и только горизонтальная: пунктир читается
                    как «порог» или «прогноз», а вертикальные линии дублируют
                    подписи оси. */}
                <CartesianGrid vertical={false} stroke={COLORS.border} strokeWidth={1} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: COLORS.textTertiary, fontFamily: F.body }}
                  axisLine={{ stroke: COLORS.border }}
                  tickLine={false}
                  // Тридцать одна подпись дней не помещается — recharts
                  // прореживает их сам, оставляя первую и последнюю.
                  interval={granularity === "day" ? "preserveStartEnd" : 0}
                  minTickGap={12}
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
                  barSize={bar.size}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="cogs"
                  name={t("Себестоимость", "Tannarx")}
                  fill="var(--kpi-orange)"
                  radius={[4, 4, 0, 0]}
                  barSize={bar.size}
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
                  dot={{ r: granularity === "day" ? 3 : 4, fill: "var(--color-success)", stroke: COLORS.surface, strokeWidth: 2 }}
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
