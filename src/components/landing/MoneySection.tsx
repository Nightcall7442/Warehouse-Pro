import { useTranslate } from "@/i18n";
import { LX, MONO } from "./landing-tokens";
import { SectionHead } from "./landing-shared";
import { Browser, DemoTag, Ledger, Split, Sheet, Stage, STAGE_ASPECT } from "./landing-frames";
import { useAnime } from "./landing-anime";

/* ═══════════════════════════════════════════════════════════════════════════
   08 / ДЕНЬГИ — ДОЛГИ, ПРИБЫЛЬ, ЗАРПЛАТА

   Три полосы одной главы, потому что это одни и те же деньги на разных
   стадиях: сначала они должны прийти (долги), потом их считают (P&L),
   потом раздают (зарплата и KPI). Каждая возможность есть в коде:
   shop-router (receivablesAging, debtJournal, statement), analytics-router
   (pnl, agentEfficiency, agentProductSales), kpi-router (salary, payouts,
   confirmPayout), commission-router (ставка по товару), agent.gamification.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function MoneySection() {
  const tr = useTranslate();

  const aging = [
    { k: tr("до 7 дней", "7 kungacha"), v: 2_140_000, w: 46, tone: LX.good },
    { k: tr("до 30 дней", "30 kungacha"), v: 1_620_000, w: 35, tone: LX.warn },
    { k: tr("дольше", "undan ko'p"), v: 880_000, w: 19, tone: LX.bad },
  ];
  const callFirst = [
    { s: tr("Умид Мағозин · Бешмерган", "Umid Mag'ozin · Beshmergan"), d: 47, v: 520_000 },
    { s: tr("Dokon Super · Янгиарик", "Dokon Super · Yangiariq"), d: 33, v: 360_000 },
    { s: tr("Файз Продукт · Ал-Беруний", "Fayz Produkt · Al-Beruniy"), d: 21, v: 240_000 },
  ];
  const salary = [
    { k: tr("Оклад", "Oklad"), v: 2_500_000 },
    { k: tr("Комиссия — общая или по товару", "Komissiya — umumiy yoki mahsulot bo'yicha"), v: 1_840_000 },
    { k: tr("За доставки", "Yetkazishlar uchun"), v: 0 },
    { k: tr("Обед и дорожные × 22 дня", "Tushlik va yo'l × 22 kun"), v: 660_000 },
  ];
  const total = salary.reduce((a, b) => a + b.v, 0);
  const fmt = (n: number) => n.toLocaleString("ru-RU");

  const root = useAnime<HTMLDivElement>(({ animate, stagger, utils }, el) => {
    animate(el.querySelectorAll("[data-age]"), { scaleX: [0, 1], duration: 1000, delay: stagger(140, { start: 200 }), ease: "outCubic" });
    animate(el.querySelectorAll("[data-call]"), { x: [-10, 0], opacity: [0, 1], duration: 420, delay: stagger(120, { start: 600 }), ease: "outCubic" });
    animate(el.querySelectorAll("[data-pay]"), { y: [10, 0], opacity: [0, 1], duration: 420, delay: stagger(160, { start: 300 }), ease: "outCubic" });
    const t = el.querySelector<HTMLElement>("[data-total]");
    if (t) {
      const o = { v: 0 };
      animate(o, { v: total, duration: 1400, delay: 1000, ease: "outCubic", modifier: utils.round(0), onUpdate: () => { t.textContent = fmt(o.v); } });
    }
  }, 0.2);

  const debtCaps = [
    { t: tr("Баланс каждой точки", "Har bir nuqta balansi"), d: tr("Заказы, оплаты, возвраты — и итог, который не надо сводить руками", "Buyurtmalar, to'lovlar, qaytarishlar — va qo'lda yig'ish shart bo'lmagan yakun") },
    { t: tr("Возраст долга", "Qarz muddati"), d: tr("До недели, до месяца, дольше — сразу видно, где горит", "Haftagacha, oygacha, undan ko'p — qayerda yonayotgani darrov ko'rinadi") },
    { t: tr("Журнал долга по точке", "Nuqta bo'yicha qarz jurnali"), d: tr("Из чего он сложился, строка за строкой", "Nimadan yig'ilgani, satrma-satr") },
    { t: tr("Выписка магазину", "Do'konga ko'chirma"), d: tr("Отдали — вопросов не осталось", "Berdingiz — savol qolmadi") },
    { t: tr("Список должников на утро", "Ertalabki qarzdorlar ro'yxati"), d: tr("Без обзвона бухгалтерии", "Buxgalteriyaga qo'ng'iroqsiz") },
    { t: tr("Долги в телефоне агента", "Agent telefonidagi qarzlar"), d: tr("Видит свои, записывает оплату прямо в точке", "O'zinikini ko'radi, to'lovni nuqtaning o'zida yozadi") },
  ];
  const pnlCaps = [
    { t: tr("Прибыль по факту", "Haqiqiy foyda"), d: tr("Выручка − себестоимость из приходов − расходы, включая выданную зарплату", "Tushum − kirimdagi tannarx − xarajatlar, berilgan ish haqi bilan") },
    { t: tr("По способам оплаты", "To'lov usullari bo'yicha"), d: tr("Наличные, карта, перевод, в долг", "Naqd, karta, o'tkazma, qarzga") },
    { t: tr("Продажи по магазинам и товарам", "Do'kon va mahsulot bo'yicha savdo"), d: tr("Топ товаров, агент × товар — на чём зарабатывает каждый", "Top mahsulotlar, agent × mahsulot — har kim nimadan topadi") },
    { t: tr("Эффективность агентов", "Agentlar samaradorligi"), d: tr("Заказы, средний чек, визиты без заказа", "Buyurtmalar, o'rtacha chek, buyurtmasiz tashriflar") },
    { t: tr("Экспорт в Excel и CSV", "Excel va CSV ga eksport"), d: tr("Любой отчёт — одной кнопкой", "Istalgan hisobot — bir tugma bilan") },
    { t: tr("Печатные формы", "Chop shakllari"), d: tr("Накладные, погрузочный лист, выписка магазину", "Yuk xatlari, yuklash varaqasi, do'konga ko'chirma") },
  ];
  const payCaps = [
    { t: tr("KPI по доставленному", "Yetkazilgani bo'yicha KPI"), d: tr("А не по оформленному: заказ, который магазин не принял, в заслугу не идёт", "Rasmiylashtirilgani bo'yicha emas: do'kon qabul qilmagan buyurtma hisobga o'tmaydi") },
    { t: tr("Комиссия общая или по товару", "Umumiy yoki mahsulot bo'yicha komissiya"), d: tr("За разные позиции агент получает разное", "Har xil pozitsiya uchun agent har xil oladi") },
    { t: tr("Курьеру — за штуку или процентом", "Kuryerga — donasiga yoki foiz"), d: tr("Способ выбирается по человеку", "Usul odamga qarab tanlanadi") },
    { t: tr("Подтверждение получения", "Olganini tasdiqlash"), d: tr("Сотрудник отмечает в телефоне, что деньги получил; остаток виден обоим", "Xodim telefonda pulni olganini belgilaydi; qoldiq ikkalasiga ko'rinadi") },
  ];

  const label = (text: string) => (
    <div className="text-[11px] uppercase mb-4" style={{ ...MONO, color: LX.brassText, letterSpacing: "0.08em" }}>{text}</div>
  );

  return (
    <section id="money" className="py-20 md:py-32 scroll-mt-16" style={{ background: LX.paper, borderTop: `1px solid ${LX.rule}` }}>
      <div ref={root} className="max-w-[1240px] mx-auto px-6">
        <SectionHead
          index="08"
          label={tr("Деньги", "Pul")}
          title={tr("Долги, прибыль и зарплата — по факту, а не по обещаниям", "Qarz, foyda va ish haqi — va'da bo'yicha emas, haqiqat bo'yicha")}
        />

        {/* A. Долги: живой блок слева, реестр справа */}
        <Split
          className="mt-14"
          left={
            <Sheet title={tr("Полный контроль над долгами", "Qarzlar ustidan to'liq nazorat")}>
              <div className="space-y-3">
                {aging.map(a => (
                  <div key={a.k}>
                    <div className="flex justify-between text-[13px] mb-1.5">
                      <span style={{ color: LX.inkSoft }}>{a.k}</span>
                      <span style={{ ...MONO, color: LX.ink }}>{fmt(a.v)} <span style={{ color: LX.inkFaint }}>{tr("сум", "so'm")}</span></span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: LX.verso }}>
                      <div data-age className="h-full rounded-full origin-left" style={{ width: `${a.w}%`, background: a.tone }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-6 text-[11px] uppercase" style={{ ...MONO, color: LX.inkFaint, letterSpacing: "0.08em" }}>{tr("Кому звонить первым", "Kimga birinchi qo'ng'iroq qilish")}</div>
              <ul className="mt-2">
                {callFirst.map(c => (
                  <li key={c.s} data-call className="flex items-center justify-between gap-3 text-[13.5px] py-2.5" style={{ borderBottom: `1px solid ${LX.rule}` }}>
                    <span className="truncate" style={{ color: LX.ink }}>{c.s}</span>
                    <span className="shrink-0" style={{ ...MONO, color: LX.inkSoft }}>{c.d} {tr("дн.", "kun")} · {fmt(c.v)}</span>
                  </li>
                ))}
              </ul>
              <DemoTag>{tr("демо-данные", "demo-ma'lumotlar")}</DemoTag>
            </Sheet>
          }
          right={<div>{label(tr("Долги", "Qarzlar"))}<Ledger items={debtCaps} /></div>}
        />

        {/* B. P&L: кадр во весь горизонт, реестр под ним */}
        <Stage
          className="mt-20 md:mt-24"
          frame={<Browser shot="pnl" content aspect={STAGE_ASPECT} alt={tr("Прибыль и убытки: выручка, себестоимость, прибыль, динамика по месяцам", "Foyda va zarar: tushum, tannarx, foyda, oylar dinamikasi")} />}
          caption={tr("Прибыль и убытки · выручка, себестоимость, прибыль по месяцам · демо-данные", "Foyda va zarar · tushum, tannarx, oylik foyda · demo-ma'lumotlar")}
        />
        <div className="mt-10">{label(tr("P&L и отчётность", "P&L va hisobot"))}<Ledger items={pnlCaps} start={7} /></div>

        {/* C. Зарплата: кадр во весь горизонт, формула карточкой поверх правого края, реестр под ними */}
        <Stage
          className="mt-20 md:mt-24"
          flip
          frame={<Browser shot="salaries" content aspect={STAGE_ASPECT} alt={tr("Ведомость зарплат: оклад, комиссия, доставки, обед, выплаты", "Ish haqi vedomosti: oklad, komissiya, yetkazish, tushlik, to'lovlar")} />}
          caption={tr("Ведомость зарплат · оклад, комиссия, доставки, выплаты · демо-данные", "Ish haqi vedomosti · oklad, komissiya, yetkazish, to'lovlar · demo-ma'lumotlar")}
          card={
            <Sheet title={tr("Зарплата агента · сентябрь", "Agent ish haqi · sentyabr")}>
              <dl className="text-[14px]">
                {salary.map(s => (
                  <div key={s.k} data-pay className="flex justify-between gap-4 py-2.5" style={{ borderBottom: `1px solid ${LX.rule}` }}>
                    <dt style={{ color: LX.inkSoft }}>{s.k}</dt>
                    <dd style={{ ...MONO, color: LX.ink }}>{fmt(s.v)}</dd>
                  </div>
                ))}
                <div data-pay className="flex justify-between items-baseline gap-4 pt-4">
                  <dt className="font-semibold" style={{ color: LX.ink }}>{tr("Начислено", "Hisoblandi")}</dt>
                  <dd className="text-[22px] font-bold" style={{ ...MONO, color: LX.ink, letterSpacing: "-0.01em" }}><span data-total>{fmt(total)}</span> <span className="text-[12px] font-normal" style={{ color: LX.inkFaint }}>{tr("сум", "so'm")}</span></dd>
                </div>
              </dl>
              <p className="mt-5 text-[13.5px] leading-relaxed" style={{ color: LX.inkSoft }}>{tr("Выдали — сотрудник подтверждает получение с телефона. Остаток виден обоим.", "Berdingiz — xodim olganini telefondan tasdiqlaydi. Qoldiq ikkalasiga ko'rinadi.")}</p>
              <DemoTag>{tr("демо-данные", "demo-ma'lumotlar")}</DemoTag>
            </Sheet>
          }
        />
        <div className="mt-10">
          {label(tr("Зарплата и KPI", "Ish haqi va KPI"))}
          <Ledger items={payCaps} start={13} />
        </div>
      </div>
    </section>
  );
}
