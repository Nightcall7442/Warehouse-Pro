import { useState } from "react";
import { BookOpen, Search, Printer, Languages, ListChecks, Bot } from "lucide-react";
import { useTranslate } from "@/i18n";
import { LX, MONO } from "./landing-tokens";
import { SectionHead } from "./landing-shared";
import { ManualLeaf } from "./landing-frames";
import { useAnime, WARM_SHADOW } from "./landing-anime";
import type { ManualPageKey } from "./shots";

/* ═══════════════════════════════════════════════════════════════════════════
   11 / СПРАВКА — РУКОВОДСТВО ЖИВЁТ ВНУТРИ ПРОГРАММЫ

   Владелец: «особенно надо говорить о справке — просто рекламируй некоторые
   её страницы». Показываем сами страницы: снимки экранов с пронумерованными
   выносками — это и есть то, чем руководство отличается от «почитайте
   документацию». Ни слова об условиях выдачи — только что внутри.

   Движение: страницы разъезжаются из стопки веером; у активной номера
   выносок подсвечиваются латунью по очереди.
   ═══════════════════════════════════════════════════════════════════════════ */

type Leaf = { key: ManualPageKey; mobile?: boolean; title: string };

export default function ManualSection() {
  const tr = useTranslate();
  const leaves: Leaf[] = [
    { key: "ordersWeb", title: tr("Оператор · заказы", "Operator · buyurtmalar") },
    { key: "orderMobile", mobile: true, title: tr("Агент · новый заказ", "Agent · yangi buyurtma") },
    { key: "deliverMobile", mobile: true, title: tr("Курьер · приёмка", "Kuryer · qabul") },
    { key: "mapWeb", title: tr("Супервайзер · карта", "Supervayzer · xarita") },
  ];
  const [active, setActive] = useState(0);

  const root = useAnime<HTMLDivElement>(({ animate, stagger }, el) => {
    // Внутренний слой листа: внешняя кнопка держит своё место в веере
    // инлайновым transform, а anime.js ведёт только вложенный слой — так
    // они не спорят за одно свойство. Листы выезжают из стопки в центре.
    el.querySelectorAll<HTMLElement>("[data-leaf]").forEach((leaf, i) => {
      animate(leaf, { x: [-(i - 1.5) * 34, 0], y: [28, 0], opacity: [0.5, 1], duration: 900, delay: 200 + i * 120, ease: "outCubic" });
    });
    animate(el.querySelectorAll("[data-fact]"), { x: [-10, 0], opacity: [0, 1], duration: 420, delay: stagger(90, { start: 500 }), ease: "outCubic" });
  }, 0.25);

  const facts = [
    { I: ListChecks, t: tr("По ролям и по дням внедрения — с первого дня до сверки через месяц", "Rollar va joriy etish kunlari bo'yicha — birinchi kundan bir oydan keyingi solishtiruvgacha") },
    { I: BookOpen, t: tr("56 снимков экранов на каждый язык с пронумерованными выносками", "Har bir tilga 56 ta ekran surati, raqamlangan izohlar bilan") },
    { I: Languages, t: tr("Русский и узбекский — переключаются одной кнопкой", "Rus va o'zbek tillari — bir tugma bilan almashadi") },
    { I: Search, t: tr("Поиск по всему руководству", "Butun qo'llanma bo'yicha qidiruv") },
    { I: Printer, t: tr("Печать и PDF — для тех, кто учится с бумаги", "Chop etish va PDF — qog'ozdan o'rganadiganlar uchun") },
    { I: Bot, t: tr("Открывается из бокового меню и командой /manual в Telegram-боте", "Yon menyudan va Telegram-botdagi /manual buyrug'i bilan ochiladi") },
  ];

  return (
    <section id="manual" className="py-16 md:py-24 scroll-mt-16 overflow-hidden" style={{ background: LX.verso, borderTop: `1px solid ${LX.rule}` }}>
      <div ref={root} className="max-w-[1240px] mx-auto px-6 grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-12 lg:gap-16 items-center">
        <div>
          <SectionHead
            index="11"
            label={tr("Справка", "Qo'llanma")}
            title={tr("Руководство живёт внутри программы", "Qo'llanma dasturning ichida yashaydi")}
            lead={tr("Не «почитайте документацию», а страницы с настоящими экранами и цифрами на них: куда нажать первым, что появится вторым.", "«Hujjatlarni o'qing» emas, balki haqiqiy ekranlar va ulardagi raqamlar bilan sahifalar: avval qayerga bosish, keyin nima paydo bo'lishi.")}
          />
          <ul className="mt-8 space-y-3">
            {facts.map(f => (
              <li key={f.t} data-fact className="flex items-start gap-3 text-[14.5px]" style={{ color: LX.inkSoft }}>
                <f.I size={15} className="mt-1 shrink-0" style={{ color: LX.brassText }} />{f.t}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[13px]" style={{ color: LX.inkSoft }}>
            {tr("Каждая глава заканчивается тем, что сотрудник делает руками — рассказ забывается за сутки, сделанное нет.", "Har bir bob xodim o'z qo'li bilan qiladigan ish bilan tugaydi — aytilgan bir kunda unutiladi, qilingan esa yo'q.")}
          </p>
        </div>

        {/* Страницы веером */}
        <div>
          {/* Веер: четыре страницы в ряд внахлёст, чтобы видно было каждую,
              а активная выходила вперёд. Все размеры — доли ширины ряда. */}
          <div className="flex items-end justify-center" style={{ perspective: 1000 }}>
            {leaves.map((l, i) => {
              const isActive = active === i;
              return (
                <button
                  key={l.key}
                  type="button"
                  aria-label={l.title}
                  aria-pressed={isActive}
                  onClick={() => setActive(i)}
                  className="relative shrink-0 cursor-pointer transition-transform duration-300 focus:outline-none"
                  style={{
                    width: l.mobile ? "17%" : "44%",
                    marginLeft: i ? "-5%" : 0,
                    zIndex: isActive ? 10 : 5 - Math.abs(active - i),
                    filter: isActive ? "none" : "brightness(0.86)",
                    transformOrigin: "50% 100%",
                    transform: `rotate(${(i - 1.5) * 2.4}deg) translateY(${l.mobile ? -6 : 0}px) ${isActive ? "scale(1.05)" : "scale(1)"}`,
                  }}
                >
                  <div data-leaf>
                    <ManualLeaf page={l.key} mobile={l.mobile} alt={l.title} style={{ outline: isActive ? `2px solid ${LX.brass}` : "none", outlineOffset: 4, boxShadow: WARM_SHADOW }} />
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-6 flex flex-wrap gap-2 justify-center">
            {leaves.map((l, i) => (
              <button
                key={l.key}
                type="button"
                onClick={() => setActive(i)}
                className="lx-anim rounded-full px-3.5 h-10 text-[12.5px] cursor-pointer transition-colors duration-200"
                style={active === i
                  ? { background: LX.ink, color: LX.paperOnInk, border: `1px solid ${LX.ink}` }
                  : { color: LX.ink, border: `1px solid ${LX.ruleStrong}` }}
              >
                {l.title}
              </button>
            ))}
          </div>
          <p className="mt-4 text-center text-[11px]" style={{ ...MONO, color: LX.inkFaint }}>
            {tr("Страницы руководства — с настоящих экранов, демо-данные", "Qo'llanma sahifalari — haqiqiy ekranlardan, demo-ma'lumotlar")}
          </p>
        </div>
      </div>
    </section>
  );
}
