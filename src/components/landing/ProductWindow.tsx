import { useEffect, useRef, useState } from "react";
import { useTranslate, useLang } from "@/i18n";
import { LX, MONO } from "./landing-tokens";
import { webShot, WEB_ASPECT } from "./shots";
import { Phone } from "./landing-frames";
import { reducedMotion } from "./landing-anime";

/* ═══════════════════════════════════════════════════════════════════════════
   02 / ОКНО ПРОДУКТА — НАСТОЯЩИЕ ЭКРАНЫ

   Раньше здесь были четыре нарисованные вкладки с выдуманными цифрами и
   фальшивой картой. Владелец зачеркнул все четыре: покупатель должен видеть
   ту программу, которую купит, а не её портрет.

   Теперь вкладки показывают снимки настоящего приложения на засеве
   (scripts/screenshots.mjs): «Обзор» — главная директора, «Заказы» — экран
   оператора, «Карта» — слежение супервайзера, «Мобильное» — два телефона.
   Кадр держит пропорцию заранее, чтобы раскладка не прыгала при загрузке.

   Переключение — anime.js: уходящий кадр гаснет и чуть сдвигается, новый
   въезжает. Пока человек не тронул вкладки, они листаются сами раз в пять
   секунд; первое касание останавливает автопролистывание навсегда — экран,
   который меняется под рукой, раздражает сильнее, чем статичный.
   ═══════════════════════════════════════════════════════════════════════════ */

const AUTO_MS = 5000;

export default function ProductWindow() {
  const tr = useTranslate();
  const { lang } = useLang();
  const [tab, setTab] = useState(0);
  const [touched, setTouched] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const prevTab = useRef(0);
  // Телефоны в пикселях — от ширины окна, чтобы на узком экране не вылезали.
  const [pw, setPw] = useState(220);
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const measure = () => setPw(Math.max(96, Math.min(250, Math.round(el.clientWidth * 0.22))));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tabs = [
    { label: tr("Обзор", "Umumiy"), alt: tr("Главная директора: выручка, заказы, долги, динамика продаж", "Direktor bosh sahifasi: tushum, buyurtmalar, qarzlar, savdo dinamikasi") },
    { label: tr("Заказы", "Buyurtmalar"), alt: tr("Заказы оператора: список, фильтры, пакетные действия", "Operator buyurtmalari: ro'yxat, filtrlar, ommaviy amallar") },
    { label: tr("Карта", "Xarita"), alt: tr("Слежение супервайзера: агенты на карте, след маршрута", "Supervayzer nazorati: xaritadagi agentlar, yo'nalish izi") },
    { label: tr("Мобильное", "Mobil"), alt: tr("Приложение агента: главная и новый заказ", "Agent ilovasi: bosh sahifa va yangi buyurtma") },
  ];

  const pick = (i: number) => { setTouched(true); setTab(i); };

  // Автопролистывание — до первого касания.
  useEffect(() => {
    if (touched || reducedMotion()) return;
    const id = window.setInterval(() => setTab(t => (t + 1) % tabs.length), AUTO_MS);
    return () => window.clearInterval(id);
  }, [touched, tabs.length]);

  // Въезд нового кадра. Уходящий кадр уже размонтирован Реактом — анимируем
  // только появление: сдвиг 18px и прозрачность, 380 мс.
  useEffect(() => {
    const el = panel.current;
    if (!el || prevTab.current === tab) return;
    prevTab.current = tab;
    if (reducedMotion()) return;
    let alive = true;
    import("animejs").then(({ animate }) => {
      if (!alive || !panel.current) return;
      animate(panel.current, { x: [18, 0], opacity: [0.35, 1], duration: 380, ease: "outCubic" });
    });
    return () => { alive = false; };
  }, [tab]);

  return (
    <section id="product" className="lx-ink scroll-mt-16" style={{ background: LX.night }}>
      <div className="max-w-[1240px] mx-auto px-6 pb-16 md:pb-24">
        <div className="rounded-lg p-6 md:p-8" style={{ background: LX.ink }}>
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
            <h2 className="font-bold" style={{ fontSize: "clamp(1.6rem, 2.8vw, 2.2rem)", letterSpacing: "-0.025em", color: LX.paperOnInk }}>
              {tr("Один экран вместо пяти тетрадей", "Beshta daftar o'rniga bitta ekran")}
            </h2>
            <span className="text-[11px] uppercase" style={{ ...MONO, color: LX.softOnInk, letterSpacing: "0.08em" }}>
              {tr("Настоящие экраны программы", "Dasturning haqiqiy ekranlari")}
            </span>
          </div>

          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${LX.ruleOnInk}`, boxShadow: `0 40px 80px -40px ${LX.black80}` }}>
            <div className="flex items-center gap-4 px-4 py-3" style={{ background: LX.paperOnInk06 }}>
              <div className="hidden sm:flex gap-1.5" aria-hidden="true">
                {[0, 1, 2].map(i => <span key={i} className="w-2.5 h-2.5 rounded-full" style={{ background: LX.faintOnInk }} />)}
              </div>
              <span className="hidden md:block text-[11px]" style={{ ...MONO, color: LX.softOnInk }}>app.warehouse-pro.uz</span>
              <div
                role="tablist"
                aria-label={tr("Разделы приложения", "Ilova bo'limlari")}
                className="flex gap-1 ml-auto overflow-x-auto"
                onKeyDown={e => {
                  const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                  if (!d) return;
                  e.preventDefault();
                  const next = (tab + d + tabs.length) % tabs.length;
                  pick(next);
                  (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
                }}
              >
                {tabs.map((t, i) => (
                  <button
                    key={t.label}
                    role="tab"
                    id={`wp-tab-${i}`}
                    aria-selected={tab === i}
                    aria-controls="wp-panel"
                    tabIndex={tab === i ? 0 : -1}
                    onClick={() => pick(i)}
                    className="lx-anim px-3.5 h-10 md:h-8 rounded-md text-[12px] font-medium whitespace-nowrap cursor-pointer transition-colors duration-200"
                    style={tab === i ? { background: LX.paper, color: LX.ink } : { color: LX.softOnInk }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div
              role="tabpanel"
              id="wp-panel"
              aria-labelledby={`wp-tab-${tab}`}
              tabIndex={0}
              className="relative outline-none overflow-hidden"
              style={{ aspectRatio: WEB_ASPECT, background: LX.appCanvas }}
            >
              <div ref={panel} className="absolute inset-0">
                {tab < 3 ? (
                  <img
                    key={tab}
                    src={webShot((["dashboard", "orders", "map"] as const)[tab], lang)}
                    alt={tabs[tab].alt}
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 w-full h-full"
                    style={{ objectFit: "cover", objectPosition: "top left" }}
                  />
                ) : (
                  /*
                    Три телефона дугой: средний ближе и крупнее, боковые
                    повёрнуты к центру. Целиком, без обреза снизу — обрезанный
                    телефон читается как ошибка вёрстки, а не как приём.
                  */
                  <div
                    className="absolute inset-0 flex items-center justify-center gap-5 md:gap-8 px-6"
                    style={{ perspective: 1400, background: `radial-gradient(ellipse at 50% 70%, ${LX.brassGlow16}, transparent 62%), ${LX.night}` }}
                  >
                    <Phone shot="catalog" alt={tr("Каталог с фото и ценой магазина", "Surat va do'kon narxi bilan katalog")} width={Math.round(pw * 0.86)} className="hidden sm:block" style={{ transform: "rotateY(22deg) translateX(10px) scale(0.92)", transformOrigin: "100% 50%" }} />
                    <Phone shot="home" alt={tr("Главная агента: план визитов и заказы", "Agent bosh sahifasi: tashriflar rejasi va buyurtmalar")} width={pw} style={{ zIndex: 2 }} />
                    <Phone shot="deliveries" alt={tr("Доставки курьера на сегодня", "Kuryerning bugungi yetkazishlari")} width={Math.round(pw * 0.86)} className="hidden md:block" style={{ transform: "rotateY(-22deg) translateX(-10px) scale(0.92)", transformOrigin: "0% 50%" }} />
                  </div>
                )}
              </div>
              <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-14 pointer-events-none" style={{ background: `linear-gradient(to bottom, transparent, ${LX.ink})` }} />
            </div>
          </div>

          <p className="mt-4 text-[11.5px]" style={{ ...MONO, color: LX.softOnInk }}>
            {tr("Снимки сделаны с работающей программы на демо-данных · Ургенч, Хорезм", "Suratlar ishlayotgan dasturdan, demo-ma'lumotlarda · Urganch, Xorazm")}
          </p>
        </div>
      </div>
    </section>
  );
}
