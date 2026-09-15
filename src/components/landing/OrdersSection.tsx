import { useTranslate } from "@/i18n";
import { LX, MONO } from "./landing-tokens";
import { SectionHead } from "./landing-shared";
import { Browser, DemoTag, Ledger, Split, Sheet } from "./landing-frames";
import { useAnime } from "./landing-anime";

/* ═══════════════════════════════════════════════════════════════════════════
   06 / ЗАКАЗЫ — САМАЯ НАСЫЩЕННАЯ ГЛАВА

   Владелец: «ОБРАБОТКА С ЗАКАЗАМИ!!!». Это ядро продукта, и на прежнем
   лендинге о нём была одна строка в таблице. Здесь — лента статусов,
   живая карточка заказа с главной мыслью продукта (принято меньше — долг
   пересчитан по факту), настоящие экраны оператора и двенадцать
   возможностей, каждая из которых есть в api/order-router.ts.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function OrdersSection() {
  const tr = useTranslate();

  const steps = [
    tr("Новый", "Yangi"), tr("В обработке", "Jarayonda"), tr("Отгружен", "Jo'natildi"), tr("Доставлен", "Yetkazildi"),
  ];
  const branches = [tr("Принят частично", "Qisman qabul"), tr("Возврат", "Qaytarish")];

  const caps = [
    { t: tr("Быстрый заказ", "Tez buyurtma"), d: tr("Оператор принимает по телефону в два клика: магазин, позиции, готово", "Operator telefonda ikki bosishda qabul qiladi: do'kon, pozitsiyalar, tayyor") },
    { t: tr("Правка до отгрузки", "Jo'natishgacha tahrir"), d: tr("Позиции и количество меняются, пока заказ не уехал", "Pozitsiya va miqdor buyurtma ketguncha o'zgaradi") },
    { t: tr("Частичная доставка", "Qisman yetkazish"), d: tr("Приняли 80 из 100 — остаток на склад, причина недобора записана", "100 dan 80 qabul — qolgani omborga, kam olish sababi yozildi") },
    { t: tr("Частичная оплата", "Qisman to'lov"), d: tr("Наличные, карта, перевод или в долг — частями, из офиса и с телефона", "Naqd, karta, o'tkazma yoki qarzga — bo'lib, ofisdan va telefondan") },
    { t: tr("Пакетные действия", "Ommaviy amallar"), d: tr("Статус, агент, курьер, завершение с оплатой — на десятки заказов сразу", "Holat, agent, kuryer, to'lov bilan yakunlash — o'nlab buyurtmaga birdan") },
    { t: tr("Погрузочные листы", "Yuklash varaqalari"), d: tr("Рейс из нескольких заказов, курьер назначен, лист напечатан складу", "Bir necha buyurtmadan reys, kuryer tayinlangan, varaqa omborga chop etilgan") },
    { t: tr("Комплектация", "Komplektatsiya"), d: tr("Что собрать по складу под рейс — по партиям и срокам годности", "Reys uchun ombordan nima yig'ish — partiya va muddat bo'yicha") },
    { t: tr("Свои фильтры", "O'z filtrlaringiz"), d: tr("Сохранённый набор достаётся одним нажатием", "Saqlangan to'plam bir bosishda ochiladi") },
    { t: tr("Комментарии", "Izohlar"), d: tr("Переписка по заказу остаётся в самом заказе", "Buyurtma bo'yicha yozishma buyurtmaning o'zida qoladi") },
    { t: tr("Печать пачкой", "Ommaviy chop etish"), d: tr("Накладные на весь рейс — одним документом", "Butun reys uchun yuk xatlari — bitta hujjat") },
    { t: tr("Удалить и вернуть", "O'chirish va tiklash"), d: tr("Удалённый заказ восстанавливается; кто и когда — в журнале", "O'chirilgan buyurtma tiklanadi; kim va qachon — jurnalda") },
    { t: tr("Обещанная дата", "Va'da qilingan sana"), d: tr("Когда магазину обещали — видно всем, кто везёт", "Do'konga qachon va'da berilgan — olib boruvchilarning hammasiga ko'rinadi") },
  ];

  const root = useAnime<HTMLDivElement>(({ animate, stagger, createTimeline, utils }, el) => {
    // Лента статусов: шаги выезжают, линии между ними прочерчиваются.
    animate(el.querySelectorAll("[data-step]"), { y: [14, 0], opacity: [0, 1], duration: 520, delay: stagger(140), ease: "outCubic" });
    animate(el.querySelectorAll("[data-link]"), { scaleX: [0, 1], duration: 420, delay: stagger(140, { start: 260 }), ease: "outCubic" });

    // Живая карточка: 100 → принято 80 → остаток 20 → долг пересчитан. По кругу.
    const q = el.querySelector<HTMLElement>("[data-qty]");
    const back = el.querySelector<HTMLElement>("[data-back]");
    const debt = el.querySelector<HTMLElement>("[data-debt]");
    const tag = el.querySelector<HTMLElement>("[data-tag]");
    if (!q || !back || !debt || !tag) return;
    const s = { qty: 100, back: 0, debt: 1_250_000 };
    const fmt = (n: number) => Math.round(n).toLocaleString("ru-RU");
    const tl = createTimeline({ loop: true, defaults: { ease: "outCubic" }, onLoop: () => { s.qty = 100; s.back = 0; s.debt = 1_250_000; } });
    tl.add(s, { qty: 80, duration: 900, delay: 1400, modifier: utils.round(0), onUpdate: () => { q.textContent = fmt(s.qty); } })
      .add(tag, { opacity: [0, 1], y: [6, 0], duration: 320 }, "<+=100")
      .add(s, { back: 20, duration: 700, modifier: utils.round(0), onUpdate: () => { back.textContent = fmt(s.back); } }, "<")
      .add(s, { debt: 1_000_000, duration: 900, modifier: utils.round(0), onUpdate: () => { debt.textContent = fmt(s.debt); } }, "<+=200")
      .add(debt, { color: [LX.bad, LX.good], duration: 500 }, "<")
      .add(el, { duration: 2600 })
      .add(tag, { opacity: 0, duration: 300 })
      .add(debt, { color: LX.ink, duration: 200 }, "<");
    return () => tl.pause();
  }, 0.25);

  return (
    <section id="orders" className="py-20 md:py-32 scroll-mt-16" style={{ background: LX.paper, borderTop: `1px solid ${LX.rule}` }}>
      <div ref={root} className="max-w-[1240px] mx-auto px-6">
        <SectionHead
          index="06"
          label={tr("Заказы", "Buyurtmalar")}
          title={tr("Обработка заказов — от звонка до сверки вечером", "Buyurtmalar bilan ishlash — qo'ng'iroqdan kechki solishtiruvgacha")}
          lead={tr("Заказ живёт статусами, а не устными обещаниями. Что магазин принял на самом деле, записывает курьер в точке — и от этой цифры считается всё остальное.", "Buyurtma og'zaki va'da bilan emas, holatlar bilan yashaydi. Do'kon aslida nima qabul qilganini kuryer nuqtada yozadi — qolgan hamma narsa shu raqamdan hisoblanadi.")}
        />

        {/* Лента статусов */}
        <div className="mt-14 overflow-x-auto pb-2 -mx-6 px-6">
          <ol className="flex items-center gap-0 min-w-[640px]">
            {steps.map((s, i) => (
              <li key={s} className="flex items-center">
                <span data-step className="inline-flex items-center gap-2 rounded-full px-4 h-11 text-[13px] font-semibold whitespace-nowrap" style={{ background: i === 3 ? LX.ink : LX.paperRaised, color: i === 3 ? LX.paperOnInk : LX.ink, border: `1px solid ${i === 3 ? LX.ink : LX.ruleStrong}` }}>
                  <span className="text-[10px]" style={{ ...MONO, color: i === 3 ? LX.brassOnNight : LX.brassText }}>{String(i + 1).padStart(2, "0")}</span>
                  {s}
                </span>
                {i < steps.length - 1 && <span data-link className="block h-px w-10 md:w-16 origin-left" style={{ background: LX.ruleStrong }} />}
              </li>
            ))}
            <li className="ml-6 flex items-center gap-2 pl-6" style={{ borderLeft: `1px dashed ${LX.ruleStrong}` }}>
              {branches.map(b => (
                <span key={b} data-step className="inline-flex items-center rounded-full px-3.5 h-11 text-[12.5px] font-medium whitespace-nowrap" style={{ border: `1px dashed ${LX.brass}`, color: LX.brassDeep }}>{b}</span>
              ))}
            </li>
          </ol>
        </div>

        <Split
          className="mt-14"
          left={
            <Sheet
              title={tr("Заказ № 981", "Buyurtma № 981")}
              aside={<span data-tag className="text-[11px] rounded-full px-2.5 py-1" style={{ ...MONO, background: LX.brassSoft, color: LX.brassDeep }}>{tr("принят частично", "qisman qabul")}</span>}
            >
              <div data-reveal="order-card" className="text-[17px] font-bold" style={{ color: LX.ink, letterSpacing: "-0.01em" }}>{tr("Рахмат Савдо · Ургенч, Гуллан", "Rahmat Savdo · Urganch, Gullan")}</div>
              <dl className="mt-5 text-[14.5px]">
                {[
                  [tr("Отгружено", "Jo'natildi"), <span key="s" style={MONO}>100</span>],
                  [tr("Магазин принял", "Do'kon qabul qildi"), <span key="q" data-qty style={{ ...MONO, fontWeight: 600 }}>100</span>],
                  [tr("Вернулось на склад", "Omborga qaytdi"), <span key="b" data-back style={MONO}>0</span>],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex justify-between gap-4 py-2.5" style={{ borderBottom: `1px solid ${LX.rule}` }}>
                    <dt style={{ color: LX.inkSoft }}>{k}</dt>
                    <dd style={{ color: LX.ink }}>{v}</dd>
                  </div>
                ))}
                <div className="flex justify-between items-baseline gap-4 pt-4">
                  <dt className="font-semibold" style={{ color: LX.ink }}>{tr("Долг магазина", "Do'kon qarzi")}</dt>
                  <dd className="text-[22px] font-bold" style={{ ...MONO, color: LX.ink, letterSpacing: "-0.01em" }}><span data-debt>1 250 000</span> <span className="text-[12px] font-normal" style={{ color: LX.inkFaint }}>{tr("сум", "so'm")}</span></dd>
                </div>
              </dl>
              <p className="mt-5 text-[13.5px] leading-relaxed" style={{ color: LX.inkSoft }}>
                {tr("Курьер отметил 80 из 100 — сумма и долг пересчитались сами. Без этого 250 000 сум остались бы «ничьими».", "Kuryer 100 dan 80 tasini belgiladi — summa va qarz o'zi qayta hisoblandi. Aks holda 250 000 so'm «hech kimniki» bo'lib qolardi.")}
              </p>
              <DemoTag>{tr("демо-данные", "demo-ma'lumotlar")}</DemoTag>
            </Sheet>
          }
          right={<div data-reveal="order-shots"><Browser shot="orders" content alt={tr("Экран заказов оператора: таблица, фильтры, статусы", "Operator buyurtmalar ekrani: jadval, filtrlar, holatlar")} /></div>}
        />

        {/* Возможности — реестром, как в главе 04 */}
        <div className="mt-20 md:mt-24">
          <div className="text-[11px] uppercase mb-4" style={{ ...MONO, color: LX.brassText, letterSpacing: "0.08em" }}>{tr("Что умеет заказ", "Buyurtma nimalarni qila oladi")}</div>
          <Ledger items={caps} />
        </div>
      </div>
    </section>
  );
}
