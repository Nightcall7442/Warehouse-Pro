import { Check, BatteryMedium, BatteryLow, BatteryFull, Route, MapPin, Clock3 } from "lucide-react";
import { useTranslate, useLang } from "@/i18n";
import { LX, MONO } from "./landing-tokens";
import { SectionHead } from "./landing-shared";
import { DemoTag } from "./landing-frames";
import { mapCrop, MAP_CROP_ASPECT } from "./shots";
import { useAnime } from "./landing-anime";

/* ═══════════════════════════════════════════════════════════════════════════
   05 / КОНТРОЛЬ — ЖИВОЙ ЭКРАН СЛЕЖЕНИЯ

   Была нарисованная карта города с точками — «ублюдская», по слову
   владельца, и он прав: карта из квадратиков не говорит ничего о продукте.

   Что говорит: три агента, у каждого заряд телефона (телефон присылает
   batteryLevel вместе с точкой), пробег за день (след маршрута считается в
   километрах), визиты (был / проехал мимо / без заказа) и время последней
   точки. Всё это — настоящие поля экрана «Слежение», не выдумка.

   Карта — настоящая, из того же экрана «Слежение» (вырезка делается в
   scripts/landing_shots.py, чтобы пережить пересъёмку). Первый вариант с
   линиями на сетке владелец отверг словами «тут вообще нет карты» — и был
   прав: схема из квадратиков не говорит, что это карта Яндекса с Ургенчем.

   Движение: маршруты прочерчиваются (svg.createDrawable), по ним бегут
   точки, визиты зажигаются по мере прохода, пробег тикает счётчиком,
   полосы визитов наполняются. Один раз при появлении блока; циклы точек
   останавливаются при размонтировании. При «уменьшить движение» всё стоит в
   конечном состоянии — ничего не спрятано разметкой.
   ═══════════════════════════════════════════════════════════════════════════ */

type Agent = {
  name: string; area: string; battery: number; km: number; visits: number; of: number; last: string;
  path: string; stops: [number, number][];
};

function Battery({ level, hint }: { level: number; hint: string }) {
  const Icon = level > 70 ? BatteryFull : level > 35 ? BatteryMedium : BatteryLow;
  const tone = level > 35 ? LX.paperOnInk : LX.brassOnNight;
  return (
    <span className="inline-flex items-center gap-1.5" style={{ color: tone }}>
      <Icon size={14} />
      <span style={MONO}>{level}%</span>
      {level <= 35 && <span className="text-[10px] uppercase" style={{ letterSpacing: "0.06em" }}>{hint}</span>}
    </span>
  );
}

export default function TrackingSection() {
  const tr = useTranslate();
  const { lang } = useLang();

  const agents: Agent[] = [
    { name: tr("Санжар", "Sanjar"), area: tr("Ургенч · Марказ", "Urganch · Markaz"), battery: 91, km: 42.6, visits: 14, of: 18, last: "16:42",
      path: "M 120 420 L 250 380 L 380 440 L 520 400 L 640 470", stops: [[120, 420], [250, 380], [380, 440], [520, 400], [640, 470]] },
    { name: tr("Бехруз", "Behruz"), area: tr("Хива", "Xiva"), battery: 64, km: 31.2, visits: 11, of: 16, last: "16:38",
      path: "M 90 620 L 220 590 L 330 660 L 460 620 L 580 700", stops: [[90, 620], [220, 590], [330, 660], [460, 620], [580, 700]] },
    { name: tr("Отабек", "Otabek"), area: tr("Хонка", "Xonqa"), battery: 23, km: 18.9, visits: 6, of: 15, last: "16:05",
      path: "M 200 860 L 330 820 L 470 900 L 600 850 L 720 930", stops: [[200, 860], [330, 820], [470, 900], [600, 850], [720, 930]] },
  ];

  const root = useAnime<HTMLDivElement>((anime, el) => {
    const { animate, stagger, svg, utils } = anime;
    const cleanups: (() => void)[] = [];

    // 1. Маршруты прочерчиваются слева направо.
    const paths = Array.from(el.querySelectorAll<SVGPathElement>("[data-route]")).filter((_, k) => k % 2 === 1);
    animate(svg.createDrawable(el.querySelectorAll("[data-route]")), { draw: ["0 0", "0 1"], duration: 1400, delay: stagger(90), ease: "inOutSine" });

    // 2. Точки визитов зажигаются по мере прохода.
    animate(el.querySelectorAll("[data-stop]"), { scale: [0.4, 1], opacity: [0.25, 1], duration: 320, delay: stagger(110, { start: 500 }), ease: "outBack" });

    // 3. По каждому маршруту бежит точка агента — цикл, пока блок живёт.
    paths.forEach((p, i) => {
      const dot = el.querySelector<SVGGElement>(`[data-runner="${i}"]`);
      if (!dot) return;
      const len = p.getTotalLength();
      const obj = { t: 0 };
      const run = animate(obj, {
        t: 1, duration: 9000 + i * 1300, delay: 1600, loop: true, alternate: true, ease: "inOutSine",
        onUpdate: () => {
          const pt = p.getPointAtLength(obj.t * len);
          dot.setAttribute("transform", `translate(${pt.x} ${pt.y})`);
        },
      });
      cleanups.push(() => run.pause());
    });

    // 4. Пробег тикает, полосы визитов наполняются, заряд поднимается до значения.
    el.querySelectorAll<HTMLElement>("[data-km]").forEach((n, i) => {
      const target = Number(n.dataset.km);
      const obj = { v: 0 };
      animate(obj, { v: target, duration: 1500, delay: 700 + i * 150, ease: "outCubic", modifier: utils.round(1),
        onUpdate: () => { n.textContent = obj.v.toFixed(1).replace(".", ","); } });
    });
    animate(el.querySelectorAll("[data-bar]"), { scaleX: [0, 1], duration: 1100, delay: stagger(150, { start: 900 }), ease: "outCubic" });

    return () => cleanups.forEach(c => c());
  });

  return (
    <section id="map" className="lx-ink py-20 md:py-32 scroll-mt-16" style={{ background: LX.night }}>
      <div className="max-w-[1240px] mx-auto px-6 grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-12 lg:gap-16 items-center">
        <div>
          <SectionHead
            tone="dark"
            index="05"
            label={tr("Контроль", "Nazorat")}
            title={tr("Вы видите поле, не выходя из кабинета", "Dalani kabinetdan chiqmasdan ko'rasiz")}
          />
          <ul className="mt-8 space-y-4">
            {[
              tr("Живая карта и след маршрута за день, неделю, месяц", "Jonli xarita va kun, hafta, oy bo'yicha yo'nalish izi"),
              tr("Автопробег в километрах — с телефона агента, не со слов", "Avtomatik yurish masofasi kilometrda — agent telefonidan, so'zdan emas"),
              tr("Заряд телефона каждого: разряжен — значит, точки перестанут приходить", "Har birining telefon quvvati: quvvat tugasa — nuqtalar kelmay qoladi"),
              tr("Визиты: был в точке, проехал мимо или ушёл без заказа — видно всё", "Tashriflar: nuqtada bo'ldi, o'tib ketdi yoki buyurtmasiz ketdi — hammasi ko'rinadi"),
              tr("Планы визитов на месяц и нормы продаж — расставили, программа считает выполнение", "Oylik tashrif rejalari va savdo normalari — belgiladingiz, dastur bajarilishini hisoblaydi"),
            ].map(item => (
              <li key={item} className="flex items-start gap-3 text-[14.5px]" style={{ color: LX.softOnInk }}>
                <Check size={15} strokeWidth={3} className="mt-1 shrink-0" style={{ color: LX.brassOnNight }} />
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Живой экран слежения */}
        <div ref={root} data-reveal="track" className="p-4 md:p-6" style={{ borderRadius: 18, background: LX.ink, border: `1px solid ${LX.ruleOnInk}`, boxShadow: `0 40px 80px -40px ${LX.black80}` }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] uppercase" style={{ ...MONO, color: LX.softOnInk, letterSpacing: "0.08em" }}>
              {tr("Слежение · сегодня", "Nazorat · bugun")}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ ...MONO, color: LX.brassOnNight }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: LX.brassOnNight }} />
              {tr("3 в поле", "Dalada 3")}
            </span>
          </div>

          {/*
            Настоящая карта из экрана «Слежение» (вырезка scripts/landing_shots.py),
            поверх — маршруты трёх агентов, бегущие точки и зажигающиеся визиты.
          */}
          <div className="relative overflow-hidden" style={{ borderRadius: 12, aspectRatio: MAP_CROP_ASPECT, border: `1px solid ${LX.ruleOnInk}` }}>
            <img src={mapCrop(lang)} alt={tr("Карта слежения: агенты и курьеры на карте", "Nazorat xaritasi: xaritadagi agentlar va kuryerlar")} loading="lazy" decoding="async" className="absolute inset-0 w-full h-full" style={{ objectFit: "cover" }} />
            <svg viewBox="0 0 1400 1220" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full" aria-hidden="true">
              {agents.map((a, i) => (
                <g key={a.name}>
                  <path data-route d={a.path} fill="none" stroke={LX.ink} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" opacity="0.18" />
                  <path data-route d={a.path} fill="none" stroke={LX.brass} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={i === 2 ? "10 10" : undefined} />
                  {a.stops.map(([x, y], k) => (
                    <circle key={k} data-stop cx={x} cy={y} r="11" fill={k < Math.round(a.stops.length * a.visits / a.of) ? LX.brass : LX.white} stroke={LX.ink} strokeWidth="3" />
                  ))}
                  <g data-runner={i} transform={`translate(${a.stops[0][0]} ${a.stops[0][1]})`}>
                    <circle r="22" fill={LX.ink} opacity="0.95" />
                    <circle r="26" fill="none" stroke={LX.brass} strokeWidth="3" />
                    <text textAnchor="middle" dominantBaseline="central" fontSize="20" fontWeight="700" fill={LX.paperOnInk} style={{ fontFamily: "Manrope, sans-serif" }}>{a.name.slice(0, 1)}</text>
                  </g>
                </g>
              ))}
            </svg>
            <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-16 pointer-events-none" style={{ background: `linear-gradient(to bottom, transparent, ${LX.ink})` }} />
          </div>

          <div className="mt-4" style={{ borderTop: `1px solid ${LX.ruleOnInk}` }}>
            {agents.map(a => (
              <div key={a.name} className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1.4fr)_auto_auto_auto] gap-x-6 gap-y-1.5 items-center py-3" style={{ borderBottom: `1px solid ${LX.ruleOnInk}` }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[13.5px] font-semibold truncate" style={{ color: LX.paperOnInk }}>
                    <MapPin size={12} style={{ color: LX.brassOnNight }} />
                    {a.name} <span className="font-normal" style={{ color: LX.softOnInk }}>· {a.area}</span>
                  </div>
                  <div className="mt-2 h-[3px] rounded-full overflow-hidden" style={{ background: LX.paperOnInk10 }}>
                    <div data-bar className="h-full rounded-full origin-left" style={{ width: `${(a.visits / a.of) * 100}%`, background: LX.brassOnNight }} />
                  </div>
                </div>
                <span className="text-[12px] inline-flex items-center gap-1.5 whitespace-nowrap" style={{ ...MONO, color: LX.softOnInk }}>
                  <Route size={12} /><span data-km={a.km}>{a.km.toFixed(1).replace(".", ",")}</span> {tr("км", "km")}
                </span>
                <span className="text-[12px] whitespace-nowrap" style={{ ...MONO, color: LX.softOnInk }}>
                  {a.visits}/{a.of} {tr("точек", "nuqta")}
                </span>
                <span className="text-[12px] inline-flex items-center gap-3 whitespace-nowrap">
                  <Battery level={a.battery} hint={tr("зарядить", "quvvatlash")} />
                  <span className="inline-flex items-center gap-1" style={{ ...MONO, color: LX.softOnInk }}><Clock3 size={11} />{a.last}</span>
                </span>
              </div>
            ))}
          </div>
          <DemoTag dark>{tr("демо-данные · заряд, пробег и визиты приходят с телефонов агентов", "demo-ma'lumotlar · quvvat, masofa va tashriflar agent telefonlaridan keladi")}</DemoTag>
        </div>
      </div>
    </section>
  );
}
