import { useMemo } from "react";
import { LX } from "./landing-tokens";

/* ═══════════════════════════════════════════════════════════════════════════
   Карта-подложка для моков GPS.

   ── Что было не так ────────────────────────────────────────────────────────

   Улицы рисовались волнистыми кривыми Безье поверх пустого фона, парки —
   эллипсами. Города так не выглядят ни на одной карте: кварталы прямоугольны,
   улицы прямые, а на плитке читаются именно КВАРТАЛЫ, разделённые
   промежутками, а не линии поверх пустоты. Вдобавок фон #e7e4dc и улицы
   #f6f4ef отличались меньше чем на 5% светлоты — в мелком масштабе всё
   сливалось в бежевое пятно.

   ── Как сделано ────────────────────────────────────────────────────────────

   Кварталы — заливка, улицы — зазоры между ними. Способ перевёрнутый, и
   именно он даёт узнаваемость: глаз читает город по застройке. Сетка слегка
   неровная (кварталы разной ширины), но всегда прямая; два проспекта режут её
   по диагонали; река — лента постоянной ширины; сквер — квартал, залитый
   зеленью, а не эллипс в пустоте.

   Геометрия детерминирована (LCG с фиксированным зерном): карта не мигает
   при перерисовках и одинакова у всех.
   ═══════════════════════════════════════════════════════════════════════════ */

const W = 200;
const H = 120;

/** Тона подложки. Разведены по светлоте заметно сильнее прежнего. */
const TONE = {
  street: "#e2dfd6", // зазоры между кварталами — то, что читается как проезды
  block: "#f4f2ed", // застройка
  blockAlt: "#eceae3", // часть кварталов темнее: иначе поле выглядит браком печати
  park: "#dae2d0",
  water: "#ccd8df",
  avenue: "#fcfbf8",
};

type Block = { x: number; y: number; w: number; h: number; park: boolean };

function makeCity() {
  // Простейший LCG: Math.random дал бы новый город на каждую перерисовку.
  let s = 421;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

  /** Границы кварталов по оси: шаг разный, но линии всегда прямые. */
  const edges = (limit: number, min: number, max: number) => {
    const out = [0];
    while (out[out.length - 1] < limit) out.push(out[out.length - 1] + min + rnd() * (max - min));
    out[out.length - 1] = limit;
    return out;
  };
  const xs = edges(W, 16, 30);
  const ys = edges(H, 14, 24);

  const GAP = 2.4; // ширина улицы

  const blocks: Block[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const w = xs[i + 1] - xs[i] - GAP;
      const h = ys[j + 1] - ys[j] - GAP;
      if (w <= 1 || h <= 1) continue;
      blocks.push({
        x: xs[i] + GAP / 2,
        y: ys[j] + GAP / 2,
        w,
        h,
        // Немного скверов — но кварталами, на своих местах в сетке.
        park: rnd() < 0.09,
      });
    }
  }

  // Проспекты: прямые, под небольшим углом к сетке — как всюду, где город
  // рос вдоль дорог, а не по линейке.
  const avenues = [
    `M -6,${H * 0.74} L ${W + 6},${H * 0.16}`,
    `M ${W * 0.18},-6 L ${W * 0.56},${H + 6}`,
  ];

  // Река: спокойная дуга постоянной ширины.
  const river = `M ${W * 0.62},-8 C ${W * 0.52},${H * 0.3} ${W * 0.78},${H * 0.6} ${W * 0.94},${H + 8}`;

  return { blocks, avenues, river };
}

export type MapPinSpec = { x: number; y: number; tone: string; pulse?: boolean };

export default function CityMap({
  pins,
  route,
  className,
}: {
  pins: MapPinSpec[];
  /** Точки маршрута агента в процентах [x, y]; соединяются пунктиром. */
  route?: [number, number][];
  className?: string;
}) {
  // Тело мемоизации записано прямо здесь: по голой ссылке плагин не видит,
  // что вычисляется, и проверить зависимости не может.
  const city = useMemo(() => makeCity(), []);
  // Маршрут — отдельным слоем в процентах контейнера: подложка обрезается
  // slice-ом, и путь в её системе координат уезжал бы от пинов.
  const routeD = route?.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x},${y}`).join(" ");

  return (
    <div className={className} style={{ position: "absolute", inset: 0 }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        {/* Улицы — это фон. Кварталы кладутся поверх, зазоры между ними и
            читаются как проезды. */}
        <rect width={W} height={H} fill={TONE.street} />

        {city.blocks.map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
            rx="0.8"
            fill={b.park ? TONE.park : i % 3 === 0 ? TONE.blockAlt : TONE.block}
          />
        ))}

        {/* Река — ПОВЕРХ кварталов.
            Под ними её не было видно совсем: застройка перекрывала ленту
            целиком, и на карте оставался лишь голубой обрезок у нижнего края. */}
        <path d={city.river} stroke={TONE.water} strokeWidth="7.5" fill="none" strokeLinecap="round" />
        <path d={city.river} stroke="rgba(120,150,165,0.28)" strokeWidth="8.5" fill="none" strokeLinecap="round" opacity="0.5" />

        {/* Проспекты поверх кварталов: широкая дорога режет застройку. */}
        {city.avenues.map((d, i) => (
          <path key={`a${i}`} d={d} stroke={TONE.street} strokeWidth="6.4" fill="none" />
        ))}
        {city.avenues.map((d, i) => (
          <path key={`b${i}`} d={d} stroke={TONE.avenue} strokeWidth="3.6" fill="none" />
        ))}
      </svg>

      {/* Маршрут агента — поверх подложки, в процентах контейнера */}
      {routeD && (
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0">
          <path
            d={routeD}
            stroke={LX.brass}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeDasharray="5 4"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.85"
          />
        </svg>
      )}

      {pins.map((p, i) => (
        <div
          key={i}
          className="absolute w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            background: p.tone,
            border: "1.5px solid #ffffff",
            boxShadow: `0 0 0 ${p.pulse ? 5 : 3}px color-mix(in srgb, ${p.tone} ${p.pulse ? 22 : 14}%, transparent), 0 1px 3px rgba(38,35,30,0.35)`,
          }}
        />
      ))}
    </div>
  );
}
