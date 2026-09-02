import { useEffect, useMemo, useRef } from "react";
import { animate, utils } from "animejs";
import { LX } from "./landing-tokens";

/* ═══════════════════════════════════════════════════════════════════════════
   Карта-подложка для моков GPS.

   ── Две попытки до этой, и чем они плохи ───────────────────────────────────

   Сначала улицы рисовались волнистыми кривыми поверх пустоты — города так не
   выглядят нигде.

   Потом кварталы стали заливкой, а улицы — зазорами между ними. Направление
   верное, исполнение никуда не годилось по двум причинам, и обе видно на
   снимке. Первая: тона были ПЕРЕВЁРНУТЫ — улицы (#e2dfd6) темнее кварталов
   (#f4f2ed). На любой настоящей карте наоборот: дороги белые, земля тёплая
   серая. Тёмная сетка поверх светлых прямоугольников читается как таблица.
   Вторая: кварталы были огромные, их влезало пять на четыре. Карта узнаётся
   плотностью — редкая сетка выглядит чертежом.

   ── Как устроено сейчас ────────────────────────────────────────────────────

   Порядок слоёв взят у обычной светлой карты:

     земля → вода → зелень → застройка → улицы → проспекты → метки

   Дороги — белые линии ПОВЕРХ земли, с тонкой тёмной обводкой: именно обводка
   даёт дорогам форму на светлом фоне. Улиц много и они тонкие, проспектов
   несколько и они широкие — эта разница в толщине и читается как город.

   Геометрия детерминирована (LCG с фиксированным зерном): карта не мигает при
   перерисовках и одинакова у всех.
   ═══════════════════════════════════════════════════════════════════════════ */

const W = 200;
const H = 120;

/** Палитра светлой карты: земля тёплая, дороги белые, вода голубая. */
const TONE = {
  land: "#ece7df",
  building: "#e0d9cf",
  water: "#a9cbdd",
  park: "#c9ddb6",
  road: "#ffffff",
  casing: "rgba(96,88,76,0.18)",
};

function makeCity() {
  // Простейший LCG: Math.random дал бы новый город на каждую перерисовку.
  let s = 421;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);

  /** Линии сетки: шаг разный, но улицы всегда прямые. */
  const lines = (limit: number, min: number, max: number) => {
    const out: number[] = [];
    let v = min * 0.5;
    while (v < limit) {
      out.push(v);
      v += min + rnd() * (max - min);
    }
    return out;
  };
  // Плотно: около шестнадцати улиц по горизонтали и десяти по вертикали.
  const vx = lines(W, 10, 15);
  const hy = lines(H, 9, 13);

  /** Кварталы между соседними улицами — под застройку и зелень. */
  const cells: { x: number; y: number; w: number; h: number }[] = [];
  for (let i = 0; i < vx.length - 1; i++) {
    for (let j = 0; j < hy.length - 1; j++) {
      cells.push({ x: vx[i], y: hy[j], w: vx[i + 1] - vx[i], h: hy[j + 1] - hy[j] });
    }
  }

  // Зелень: несколько кварталов целиком.
  const parks = cells.filter(() => rnd() < 0.06);

  // Застройка: мелкие пятна внутри кварталов. Именно они дают карте фактуру —
  // без них поле выглядит пустой сеткой.
  const buildings: { x: number; y: number; w: number; h: number }[] = [];
  for (const c of cells) {
    if (rnd() < 0.35) continue;
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const bw = c.w * (0.24 + rnd() * 0.34);
      const bh = c.h * (0.24 + rnd() * 0.34);
      buildings.push({
        x: c.x + 1.4 + rnd() * Math.max(0.1, c.w - bw - 2.8),
        y: c.y + 1.2 + rnd() * Math.max(0.1, c.h - bh - 2.4),
        w: bw,
        h: bh,
      });
    }
  }

  // Проспекты: прямые, под небольшим углом к сетке.
  const avenues = [
    `M -8,${H * 0.7} L ${W + 8},${H * 0.26}`,
    `M ${W * 0.22},-8 L ${W * 0.54},${H + 8}`,
  ];

  // Река: спокойная дуга постоянной ширины.
  const river = `M ${W * 0.64},-10 C ${W * 0.54},${H * 0.32} ${W * 0.8},${H * 0.6} ${W * 0.95},${H + 10}`;

  return { vx, hy, parks, buildings, avenues, river };
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

  const box = useRef<HTMLDivElement>(null);

  /**
   * Город прочерчивается, потом по нему проходит маршрут.
   *
   * Порядок не случаен: сначала проступает сетка улиц, и только когда ей есть
   * по чему идти — тянется латунная линия рейса. Дойдя до конца, она
   * распадается на пунктир, и он бежит дальше без остановки: машина в пути,
   * а не картинка маршрута.
   *
   * Длина пути берётся у самого элемента (getTotalLength), а не считается по
   * точкам: маршрут задаётся в процентах контейнера и растягивается вместе с
   * ним, поэтому его настоящая длина известна только браузеру.
   */
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const roads = Array.from(root.querySelectorAll<SVGElement>("[data-road]"));
    const path = root.querySelector<SVGPathElement>("[data-route]");
    if (roads.length === 0 && !path) return;

    // Прячем ИЗ сценария: не выполнится — карта просто останется на месте.
    utils.set(roads, { opacity: 0 });
    let len = 0;
    if (path) {
      len = path.getTotalLength();
      utils.set(path, { opacity: 0 });
    }

    let crawl: { revert?: () => void } | null = null;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();

      animate(roads, {
        opacity: [0, 1],
        duration: 620,
        delay: (_t?: unknown, i?: number) => (i ?? 0) * 7,
        ease: "outQuad",
      });

      if (path && len > 0) {
        path.style.strokeDasharray = String(len);
        path.style.strokeDashoffset = String(len);
        utils.set(path, { opacity: 0.9 });
        animate(path, {
          strokeDashoffset: [len, 0],
          duration: 1500,
          delay: 420,
          ease: "inOutQuad",
          onComplete: () => {
            // Сплошная линия распадается на пунктир, и он бежит по маршруту.
            path.style.strokeDasharray = "5 4";
            crawl = animate(path, {
              strokeDashoffset: [0, -9],
              duration: 900,
              ease: "linear",
              loop: true,
            }) as unknown as { revert?: () => void };
          },
        });
      }
    }, { threshold: 0.2 });

    io.observe(root);
    return () => {
      io.disconnect();
      crawl?.revert?.();
    };
  }, [routeD]);

  return (
    <div ref={box} className={className} style={{ position: "absolute", inset: 0 }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        {/* 1. Земля */}
        <rect width={W} height={H} fill={TONE.land} />

        {/* 2. Вода */}
        <path d={city.river} stroke={TONE.water} strokeWidth="8" fill="none" strokeLinecap="round" />

        {/* 3. Зелень — целыми кварталами */}
        {city.parks.map((p, i) => (
          <rect key={`p${i}`} x={p.x} y={p.y} width={p.w} height={p.h} fill={TONE.park} />
        ))}

        {/* 4. Застройка — мелкие пятна, дающие карте фактуру */}
        {city.buildings.map((b, i) => (
          <rect key={`b${i}`} x={b.x} y={b.y} width={b.w} height={b.h} rx="0.4" fill={TONE.building} opacity="0.75" />
        ))}

        {/* 5. Улицы. Сначала обводка — на светлой земле именно она даёт дороге
               форму, — потом белая заливка поверх. */}
        {city.vx.map((x, i) => (
          <line data-road="" key={`vc${i}`} x1={x} y1={0} x2={x} y2={H} stroke={TONE.casing} strokeWidth="2.2" />
        ))}
        {city.hy.map((y, i) => (
          <line data-road="" key={`hc${i}`} x1={0} y1={y} x2={W} y2={y} stroke={TONE.casing} strokeWidth="2.2" />
        ))}
        {city.vx.map((x, i) => (
          <line data-road="" key={`v${i}`} x1={x} y1={0} x2={x} y2={H} stroke={TONE.road} strokeWidth="1.5" />
        ))}
        {city.hy.map((y, i) => (
          <line data-road="" key={`h${i}`} x1={0} y1={y} x2={W} y2={y} stroke={TONE.road} strokeWidth="1.5" />
        ))}

        {/* 6. Проспекты — та же пара слоёв, но заметно шире */}
        {city.avenues.map((d, i) => (
          <path data-road="" key={`ac${i}`} d={d} stroke={TONE.casing} strokeWidth="4.2" fill="none" />
        ))}
        {city.avenues.map((d, i) => (
          <path data-road="" key={`a${i}`} d={d} stroke={TONE.road} strokeWidth="3" fill="none" />
        ))}
      </svg>

      {/* Маршрут агента — поверх подложки, в процентах контейнера */}
      {routeD && (
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0">
          <path
            data-route=""
            d={routeD}
            stroke={LX.brass}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeDasharray="5 4"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.9"
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
