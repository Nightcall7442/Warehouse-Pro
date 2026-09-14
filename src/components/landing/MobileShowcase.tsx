import { useEffect, useRef, useState } from "react";
import { WifiOff, ScanBarcode, BatteryCharging, MapPin, Check } from "lucide-react";
import { useTranslate } from "@/i18n";
import { LX, MONO, useInView } from "./landing-tokens";
import { SectionHead } from "./landing-shared";
import { Phone } from "./landing-frames";
import { type MobileShotKey } from "./shots";
import { reducedMotion } from "./landing-anime";

/* ═══════════════════════════════════════════════════════════════════════════
   10 / ТЕЛЕФОН — 3D, С НАСТОЯЩИМИ ЭКРАНАМИ

   Владелец: «нужен 3D-телефон с нашим Warehouse Pro Mobile, чтобы будущие
   клиенты прямо на лендинге поняли, как мобилка работает и что дизайн
   точно такой же». Внутри корпуса — кадры самого приложения (Expo web,
   тот же код, что в APK), по одному на каждую фишку.

   Первая версия была «уродливой» по слову владельца: приземистый телефон в
   толстом корпусе на пустой бумаге и абзац в рамке справа. Теперь: сцена
   на ночной панели с латунным светом, телефон крупный и целый, вокруг него
   плавающие подсказки из настоящих данных экрана; справа — список фишек
   вертикально, активная раскрыта. Телефон поворачивается за курсором
   (anime.js ведёт плавно), экраны меняются со сдвигом; до первого касания
   листаются сами. При «уменьшить движение» всё стоит.
   ═══════════════════════════════════════════════════════════════════════════ */

type Feature = { key: MobileShotKey; label: string; text: string; tag: string };

const AUTO_MS = 4500;

export default function MobileShowcase() {
  const tr = useTranslate();

  const features: Feature[] = [
    { key: "home", label: tr("Главная", "Bosh sahifa"), tag: tr("План на день и заказы", "Kunlik reja va buyurtmalar"), text: tr("Мой день: план визитов, заказы за сегодня, выручка — всё нужное в одно касание.", "Mening kunim: tashriflar rejasi, bugungi buyurtmalar, tushum — kerakli hamma narsa bir teginishda.") },
    { key: "catalog", label: tr("Каталог и штрихкод", "Katalog va shtrix-kod"), tag: tr("Цена этого магазина", "Shu do'kon narxi"), text: tr("Товары с фото, ценой этого магазина и остатком. Навёл камеру на штрихкод — позиция в заказе.", "Mahsulotlar surat, shu do'kon narxi va qoldiq bilan. Kamerani shtrix-kodga qaratdi — pozitsiya buyurtmada.") },
    { key: "orders", label: tr("Заказ без связи", "Aloqasiz buyurtma"), tag: tr("В очереди · уйдёт при сети", "Navbatda · tarmoqda ketadi"), text: tr("В подвале магазина заказ сохраняется в телефоне и уходит сам, когда появится сеть. Черновик не теряется.", "Do'kon yerto'lasida buyurtma telefonda saqlanadi va tarmoq paydo bo'lganda o'zi ketadi. Qoralama yo'qolmaydi.") },
    { key: "deliver", label: tr("Частичная приёмка", "Qisman qabul"), tag: tr("Принято меньше — долг по факту", "Kam qabul — qarz haqiqat bo'yicha"), text: tr("Курьер отмечает, сколько магазин принял на самом деле, и причину недобора. Остаток — на склад, долг — по факту.", "Kuryer do'kon aslida qancha olganini va kam olish sababini belgilaydi. Qolgani — omborga, qarz — haqiqat bo'yicha.") },
    { key: "plan", label: tr("План визитов", "Tashriflar rejasi"), tag: tr("Отмечен по GPS", "GPS bo'yicha belgilandi"), text: tr("Точки на сегодня в удобном порядке. Был — отметил, координаты подтвердили.", "Bugungi nuqtalar qulay tartibda. Bordi — belgiladi, koordinatalar tasdiqladi.") },
    { key: "debts", label: tr("Долги", "Qarzlar"), tag: tr("Кому ехать первым", "Kimga birinchi borish"), text: tr("К кому ехать собирать и сколько. Частичную оплату агент записывает прямо в точке.", "Kimdan yig'ish kerak va qancha. Qisman to'lovni agent nuqtaning o'zida yozadi.") },
    { key: "salary", label: tr("Зарплата", "Ish haqi"), tag: tr("Получил — подтвердил", "Oldi — tasdiqladi"), text: tr("Оклад, комиссия, обед и дорожные — каждая строка объясняет, откуда взялась.", "Oklad, komissiya, tushlik va yo'l puli — har bir satr qayerdan kelganini tushuntiradi.") },
    { key: "gps", label: tr("GPS и батарея", "GPS va batareya"), tag: tr("Стоит — не пишет", "Turibdi — yozmaydi"), text: tr("Честное раскрытие перед включением, выключается в одно касание. Стоит на месте — точки не пишутся, батарея цела.", "Yoqishdan oldin halol tushuntirish, bir teginishda o'chadi. Joyida turibdi — nuqtalar yozilmaydi, batareya butun.") },
  ];

  const [active, setActive] = useState(0);
  const [touched, setTouched] = useState(false);
  // Ширина телефона — от сцены: на узком экране корпус не должен вылезать.
  const [pw, setPw] = useState(236);
  const { ref: section, seen } = useInView<HTMLElement>(0.2);
  const stage = useRef<HTMLDivElement>(null);
  const phone = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const anime = useRef<typeof import("animejs") | null>(null);

  const pick = (i: number) => { setTouched(true); setActive(i); };

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => setPw(Math.max(170, Math.min(236, Math.round(el.clientWidth * 0.36))));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!seen || touched || reducedMotion()) return;
    const id = window.setInterval(() => setActive(a => (a + 1) % features.length), AUTO_MS);
    return () => window.clearInterval(id);
  }, [seen, touched, features.length]);

  useEffect(() => {
    if (!seen || reducedMotion()) return;
    let alive = true;
    import("animejs").then(m => {
      if (!alive || !stage.current) return;
      anime.current = m;
      if (phone.current) m.animate(phone.current, { y: [0, -8, 0], duration: 5600, loop: true, ease: "inOutSine" });
      m.animate(stage.current.querySelectorAll("[data-float]"), { y: [14, 0], opacity: [0, 1], duration: 700, delay: m.stagger(160, { start: 300 }), ease: "outCubic" });
    });
    return () => { alive = false; };
  }, [seen]);

  const follow = (clientX: number, clientY: number) => {
    const el = stage.current, m = anime.current;
    if (!el || !m || !phone.current || reducedMotion()) return;
    const r = el.getBoundingClientRect();
    const px = (clientX - r.left) / r.width - 0.5;
    const py = (clientY - r.top) / r.height - 0.5;
    m.animate(phone.current, { rotateX: -py * 14, rotateY: px * 24, duration: 650, ease: "outCubic" });
  };
  const rest = () => {
    const m = anime.current;
    if (!m || !phone.current) return;
    m.animate(phone.current, { rotateX: 4, rotateY: -14, duration: 900, ease: "outCubic" });
  };

  const prev = useRef(active);
  useEffect(() => {
    if (prev.current === active) return;
    prev.current = active;
    const m = anime.current;
    const img = screen.current?.querySelector("img");
    if (!m || !img || reducedMotion()) return;
    m.animate(img, { x: [120, 0], opacity: [0, 1], duration: 460, ease: "outCubic" });
    const tag = stage.current?.querySelector<HTMLElement>("[data-tag]");
    if (tag) m.animate(tag, { y: [8, 0], opacity: [0, 1], duration: 380, ease: "outCubic" });
  }, [active]);

  const f = features[active];

  return (
    <section ref={section} id="mobile" className="py-16 md:py-24 scroll-mt-16" style={{ background: LX.paper, borderTop: `1px solid ${LX.rule}` }}>
      <div className="max-w-[1240px] mx-auto px-6">
        <SectionHead
          index="10"
          label={tr("Телефон", "Telefon")}
          title={tr("Warehouse Pro Mobile — та же программа в кармане агента", "Warehouse Pro Mobile — agent cho'ntagidagi o'sha dastur")}
          lead={tr("Экраны — настоящие, из приложения. Покрутите телефон, выберите фишку: так это выглядит у ваших людей в поле.", "Ekranlar — haqiqiy, ilovadan. Telefonni aylantiring, chipni tanlang: sizning odamlaringizda dalada shunday ko'rinadi.")}
        />

        <div className="mt-12 grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-8 lg:gap-12 items-stretch">
          {/* Сцена */}
          <div
            ref={stage}
            className="relative rounded-2xl overflow-hidden flex items-center justify-center min-h-[520px] md:min-h-[680px]"
            style={{
              background: `radial-gradient(ellipse at 50% 85%, rgba(199,147,81,0.28), transparent 55%), radial-gradient(ellipse at 20% 10%, rgba(240,238,232,0.06), transparent 50%), ${LX.night}`,
              perspective: 1300,
              border: `1px solid ${LX.ruleOnInk}`,
            }}
            onPointerMove={e => follow(e.clientX, e.clientY)}
            onPointerLeave={rest}
          >
            {/* сетка бланка — тихо, как фактура */}
            <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `linear-gradient(${LX.ruleOnInk} 1px, transparent 1px), linear-gradient(90deg, ${LX.ruleOnInk} 1px, transparent 1px)`, backgroundSize: "48px 48px", opacity: 0.28 }} />

            <div ref={phone} style={{ transform: "rotateX(4deg) rotateY(-14deg)", transformStyle: "preserve-3d", willChange: "transform" }}>
              <Phone width={pw} shot={f.key} alt={f.label} screenRef={screen} style={{ boxShadow: "0 70px 100px -50px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,255,255,0.10)" }} />
            </div>

            {/* Плавающие подсказки — из настоящих данных экрана */}
            <div data-float className="hidden md:block absolute left-4 top-6 md:left-8 md:top-10 rounded-lg px-3.5 py-2.5 text-[12.5px]" style={{ background: "rgba(38,35,30,0.92)", color: LX.paperOnInk, border: `1px solid ${LX.ruleOnInk}`, backdropFilter: "blur(6px)" }}>
              <span className="inline-flex items-center gap-2"><WifiOff size={14} style={{ color: LX.brassOnNight }} />{tr("Нет связи · заказ в очереди", "Aloqa yo'q · buyurtma navbatda")}</span>
            </div>
            <div data-float className="hidden md:block absolute right-4 top-6 md:right-8 md:top-10 rounded-lg px-3.5 py-2.5 text-[12.5px]" style={{ background: "rgba(38,35,30,0.92)", color: LX.paperOnInk, border: `1px solid ${LX.ruleOnInk}`, backdropFilter: "blur(6px)" }}>
              <span className="inline-flex items-center gap-2"><ScanBarcode size={14} style={{ color: LX.brassOnNight }} />{tr("Штрихкод → позиция в заказе", "Shtrix-kod → buyurtmadagi pozitsiya")}</span>
            </div>
            <div data-float className="hidden md:block absolute left-5 bottom-24 md:left-10 md:bottom-28 rounded-lg px-3.5 py-2.5 text-[12.5px]" style={{ background: "rgba(38,35,30,0.92)", color: LX.paperOnInk, border: `1px solid ${LX.ruleOnInk}`, backdropFilter: "blur(6px)" }}>
              <span className="inline-flex items-center gap-2"><MapPin size={14} style={{ color: LX.brassOnNight }} />{tr("Визит подтверждён по GPS", "Tashrif GPS bo'yicha tasdiqlandi")}</span>
            </div>
            <div data-float className="hidden md:block absolute right-5 bottom-10 md:right-10 md:bottom-14 rounded-lg px-3.5 py-2.5 text-[12.5px]" style={{ background: "rgba(38,35,30,0.92)", color: LX.paperOnInk, border: `1px solid ${LX.ruleOnInk}`, backdropFilter: "blur(6px)" }}>
              <span className="inline-flex items-center gap-2"><BatteryCharging size={14} style={{ color: LX.brassOnNight }} />{tr("Стоит на месте — батарея цела", "Joyida turibdi — batareya butun")}</span>
            </div>

            {/* подпись текущего экрана */}
            <div data-tag className="absolute left-1/2 -translate-x-1/2 bottom-5 rounded-full px-4 h-9 inline-flex items-center gap-2 text-[12px] whitespace-nowrap" style={{ ...MONO, background: LX.brassOnNight, color: LX.night }}>
              {String(active + 1).padStart(2, "0")} · {f.tag}
            </div>
          </div>

          {/* Фишки списком */}
          <div className="flex flex-col">
            <ol role="tablist" aria-label={tr("Экраны приложения", "Ilova ekranlari")} className="flex-1" style={{ borderTop: `1px solid ${LX.ruleStrong}` }}>
              {features.map((x, i) => {
                const on = active === i;
                return (
                  <li key={x.key} role="presentation" style={{ borderBottom: `1px solid ${LX.rule}` }}>
                    <button
                      role="tab"
                      aria-selected={on}
                      onClick={() => pick(i)}
                      className="w-full text-left flex items-start gap-4 py-3.5 cursor-pointer min-h-[52px]"
                    >
                      <span className="text-[11px] pt-1.5 shrink-0" style={{ ...MONO, color: on ? LX.brassText : LX.inkFaint, width: 22 }}>{String(i + 1).padStart(2, "0")}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15.5px] font-semibold" style={{ color: on ? LX.ink : LX.inkSoft }}>{x.label}</span>
                        {on && <span className="block mt-1.5 text-[14px] leading-relaxed" style={{ color: LX.inkSoft }}>{x.text}</span>}
                      </span>
                      {on && <Check size={15} strokeWidth={3} className="mt-1.5 shrink-0" style={{ color: LX.brassText }} />}
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="mt-4 text-[11px]" style={{ ...MONO, color: LX.inkFaint }}>{tr("Экраны — из приложения, демо-данные · Ургенч, Хорезм", "Ekranlar — ilovadan, demo-ma'lumotlar · Urganch, Xorazm")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
