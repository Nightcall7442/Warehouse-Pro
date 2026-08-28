import { useMemo } from "react";
import { LX } from "./landing-tokens";

/* ═══════════════════════════════════════════════════════════════════════════
   Карта-подложка для моков GPS.

   Четыре беззубые кривые «как бы дорог» картой не читались вовсе. Вместо
   них — процедурный монохромный basemap в духе светлых векторных карт:
   кварталы как фон, улицы светлыми штрихами с редкими проспектами, канал
   и парк как у любого города, поверх — пунктирный маршрут агента латунью.

   Геометрия детерминирована (LCG с фиксированным зерном): карта не мигает
   при перерендерах и одинакова у всех посетителей.
   ═══════════════════════════════════════════════════════════════════════════ */

const W = 200;
const H = 120;

function makeCity() {
  // Простейший LCG — Math.random здесь дал бы новую «геометрию города»
  // на каждый рендер.
  let s = 421;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

  const jitter = (v: number, amp: number) => v + (rnd() - 0.5) * amp;

  // Второстепенные улицы: слегка неровная сетка.
  const streets: string[] = [];
  for (let x = 8; x < W; x += 14 + rnd() * 8) {
    const x1 = jitter(x, 6);
    const x2 = jitter(x, 10);
    streets.push(`M ${x1},0 C ${jitter(x1, 8)},${H / 3} ${jitter(x2, 8)},${(2 * H) / 3} ${x2},${H}`);
  }
  for (let y = 10; y < H; y += 13 + rnd() * 7) {
    const y1 = jitter(y, 5);
    const y2 = jitter(y, 9);
    streets.push(`M 0,${y1} C ${W / 3},${jitter(y1, 7)} ${(2 * W) / 3},${jitter(y2, 7)} ${W},${y2}`);
  }

  // Проспекты: две диагонали и дуга кольцевой.
  const avenues = [
    `M -4,${H * 0.78} C ${W * 0.3},${H * 0.55} ${W * 0.62},${H * 0.38} ${W + 4},${H * 0.12}`,
    `M ${W * 0.14},-4 C ${W * 0.3},${H * 0.4} ${W * 0.42},${H * 0.7} ${W * 0.62},${H + 4}`,
    `M -4,${H * 0.3} C ${W * 0.34},${H * 0.16} ${W * 0.72},${H * 0.24} ${W + 4},${H * 0.5}`,
  ];

  // Канал: лента с параллельной набережной.
  const canal = `M ${W * 0.55},-6 C ${W * 0.48},${H * 0.3} ${W * 0.72},${H * 0.62} ${W * 0.92},${H + 6}`;

  return { streets, avenues, canal };
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
  // что вычисляется, и проверить зависимости не может. Поведение то же —
  // React всё равно вызывает фабрику без аргументов.
  const city = useMemo(() => makeCity(), []);
  // Маршрут рисуется в отдельном слое с теми же процентными координатами,
  // что у пинов: подложка обрезается slice-ом, и путь, нарисованный в её
  // системе, уезжал от пинов, расставленных в процентах контейнера.
  const routeD = route?.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x},${y}`).join(" ");

  return (
    <div className={className} style={{ position: "absolute", inset: 0 }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        {/* Кварталы */}
        <rect width={W} height={H} fill="#e7e4dc" />
        {/* Парк */}
        <ellipse cx={W * 0.22} cy={H * 0.24} rx="26" ry="15" fill="#dee0cf" />
        <ellipse cx={W * 0.8} cy={H * 0.82} rx="20" ry="12" fill="#dee0cf" />
        {/* Канал */}
        <path d={city.canal} stroke="#ccd2c8" strokeWidth="5" fill="none" strokeLinecap="round" />
        {/* Улицы */}
        {city.streets.map((d, i) => (
          <path key={i} d={d} stroke="#f6f4ef" strokeWidth="1.6" fill="none" />
        ))}
        {/* Проспекты */}
        {city.avenues.map((d, i) => (
          <path key={i} d={d} stroke="#fbfaf7" strokeWidth="3.4" fill="none" strokeLinecap="round" />
        ))}
        {city.avenues.map((d, i) => (
          <path key={`c${i}`} d={d} stroke="rgba(72,66,55,0.12)" strokeWidth="3.9" fill="none" strokeLinecap="round" style={{ mixBlendMode: "multiply" }} opacity="0.35" />
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
            border: "1.5px solid #fbfaf7",
            boxShadow: `0 0 0 ${p.pulse ? 5 : 3}px color-mix(in srgb, ${p.tone} ${p.pulse ? 22 : 14}%, transparent), 0 1px 3px rgba(38,35,30,0.3)`,
          }}
        />
      ))}
    </div>
  );
}
