import type { ReactNode } from "react";
import { Check, FileSpreadsheet, Printer, Trophy } from "lucide-react";
import { useTranslate } from "@/i18n";
import { LX, MONO } from "./landing-tokens";
import { SectionHead } from "./landing-shared";
import { Browser, DemoTag } from "./landing-frames";
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

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl p-6" style={{ background: LX.paperRaised, border: `1px solid ${LX.ruleStrong}` }}>
      <div className="text-[11px] uppercase mb-4" style={{ ...MONO, color: LX.brassText, letterSpacing: "0.08em" }}>{title}</div>
      {children}
    </div>
  );
}

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

  return (
    <section id="money" className="py-16 md:py-24 scroll-mt-16" style={{ background: LX.paper, borderTop: `1px solid ${LX.rule}` }}>
      <div ref={root} className="max-w-[1240px] mx-auto px-6">
        <SectionHead
          index="08"
          label={tr("Деньги", "Pul")}
          title={tr("Долги, прибыль и зарплата — по факту, а не по обещаниям", "Qarz, foyda va ish haqi — va'da bo'yicha emas, haqiqat bo'yicha")}
        />

        {/* A. Долги */}
        <div className="mt-12 grid lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] gap-8 items-start">
          <Card title={tr("Полный контроль над долгами", "Qarzlar ustidan to'liq nazorat")}>
            <div className="space-y-3">
              {aging.map(a => (
                <div key={a.k}>
                  <div className="flex justify-between text-[12.5px] mb-1.5">
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
            <ul className="mt-2 space-y-1.5">
              {callFirst.map(c => (
                <li key={c.s} data-call className="flex items-center justify-between gap-3 text-[13px] rounded-lg px-3 py-2" style={{ background: LX.paper, border: `1px solid ${LX.rule}` }}>
                  <span className="truncate" style={{ color: LX.ink }}>{c.s}</span>
                  <span className="shrink-0" style={{ ...MONO, color: LX.inkSoft }}>{c.d} {tr("дн.", "kun")} · {fmt(c.v)}</span>
                </li>
              ))}
            </ul>
            <DemoTag>{tr("демо-данные", "demo-ma'lumotlar")}</DemoTag>
          </Card>
          <ul className="space-y-3 lg:pt-4">
            {[
              tr("Баланс каждой точки: заказы, оплаты, возвраты — и итог", "Har bir nuqta balansi: buyurtmalar, to'lovlar, qaytarishlar — va yakun"),
              tr("Возраст долга: до недели, до месяца, дольше — сразу видно, где горит", "Qarz muddati: haftagacha, oygacha, undan ko'p — qayerda yonayotgani darrov ko'rinadi"),
              tr("Журнал долга по точке — из чего он сложился, строка за строкой", "Nuqta bo'yicha qarz jurnali — nimadan yig'ilgani, satrma-satr"),
              tr("Выписка магазину: отдали — вопросов не осталось", "Do'konga ko'chirma: berdingiz — savol qolmadi"),
              tr("Список должников на утро — без обзвона бухгалтерии", "Ertalabki qarzdorlar ro'yxati — buxgalteriyaga qo'ng'iroqsiz"),
              tr("Агент видит долги по своим заказам в телефоне и записывает оплату на месте", "Agent o'z buyurtmalari qarzini telefonda ko'radi va to'lovni joyida yozadi"),
            ].map(i => (
              <li key={i} className="flex items-start gap-3 text-[14.5px]" style={{ color: LX.inkSoft }}>
                <Check size={15} strokeWidth={3} className="mt-1 shrink-0" style={{ color: LX.brassText }} />{i}
              </li>
            ))}
          </ul>
        </div>

        {/* B. P&L и отчёты */}
        <div className="mt-16 grid lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-8 lg:gap-12 items-center">
          <div className="relative" data-reveal="pnl-shots">
            <Browser shot="pnl" alt={tr("Прибыль и убытки: выручка, себестоимость, прибыль", "Foyda va zarar: tushum, tannarx, foyda")} />
            <div className="hidden md:block absolute -top-6 -right-6 w-[42%]" style={{ opacity: 0.92 }}>
              <Browser shot="reports" alt={tr("Отчёты: продажи по магазинам, топ товаров, агенты", "Hisobotlar: do'konlar bo'yicha savdo, top mahsulotlar, agentlar")} fade={false} style={{ transform: "rotate(2deg)" }} />
            </div>
          </div>
          <div>
            <h3 className="text-[22px] font-bold" style={{ color: LX.ink, letterSpacing: "-0.02em" }}>{tr("P&L и отчётность", "P&L va hisobot")}</h3>
            <ul className="mt-5 space-y-3">
              {[
                tr("Прибыль = выручка − себестоимость из приходов − расходы, включая выданную зарплату", "Foyda = tushum − kirimdagi tannarx − xarajatlar, berilgan ish haqi bilan"),
                tr("По способам оплаты: наличные, карта, перевод, в долг", "To'lov usullari bo'yicha: naqd, karta, o'tkazma, qarzga"),
                tr("Продажи по магазинам, топ товаров, агент × товар — на чём зарабатывает каждый", "Do'konlar bo'yicha savdo, top mahsulotlar, agent × mahsulot — har kim nimadan topadi"),
                tr("Эффективность агентов: заказы, средний чек, визиты без заказа", "Agentlar samaradorligi: buyurtmalar, o'rtacha chek, buyurtmasiz tashriflar"),
              ].map(i => (
                <li key={i} className="flex items-start gap-3 text-[14.5px]" style={{ color: LX.inkSoft }}>
                  <Check size={15} strokeWidth={3} className="mt-1 shrink-0" style={{ color: LX.brassText }} />{i}
                </li>
              ))}
            </ul>
            <div className="mt-6 flex flex-wrap gap-2">
              {[
                { I: FileSpreadsheet, t: tr("Экспорт в Excel и CSV", "Excel va CSV ga eksport") },
                { I: Printer, t: tr("Печатные формы: накладные, погрузочный лист, выписка", "Chop shakllari: yuk xati, yuklash varaqasi, ko'chirma") },
              ].map(c => (
                <span key={c.t} className="inline-flex items-center gap-2 rounded-full px-3.5 h-10 text-[12.5px]" style={{ border: `1px solid ${LX.ruleStrong}`, color: LX.ink }}>
                  <c.I size={14} style={{ color: LX.brassText }} />{c.t}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* C. Зарплата и KPI */}
        <div className="mt-16 grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-8 lg:gap-12 items-start">
          <Card title={tr("Зарплата агента · сентябрь", "Agent ish haqi · sentyabr")}>
            <dl className="space-y-2.5 text-[13.5px]">
              {salary.map(s => (
                <div key={s.k} data-pay className="flex justify-between gap-4" style={{ borderBottom: `1px solid ${LX.rule}`, paddingBottom: 8 }}>
                  <dt style={{ color: LX.inkSoft }}>{s.k}</dt>
                  <dd style={{ ...MONO, color: LX.ink }}>{fmt(s.v)}</dd>
                </div>
              ))}
              <div data-pay className="flex justify-between gap-4 pt-2">
                <dt className="font-semibold" style={{ color: LX.ink }}>{tr("Начислено", "Hisoblandi")}</dt>
                <dd className="text-[20px] font-bold" style={{ ...MONO, color: LX.ink }}><span data-total>{fmt(total)}</span> <span className="text-[12px] font-normal" style={{ color: LX.inkFaint }}>{tr("сум", "so'm")}</span></dd>
              </div>
            </dl>
            <p className="mt-4 text-[12.5px]" style={{ color: LX.inkSoft }}>{tr("Выдали — сотрудник подтверждает получение с телефона. Остаток виден обоим.", "Berdingiz — xodim olganini telefondan tasdiqlaydi. Qoldiq ikkalasiga ko'rinadi.")}</p>
            <DemoTag>{tr("демо-данные", "demo-ma'lumotlar")}</DemoTag>
          </Card>
          <div>
            <Browser shot="salaries" alt={tr("Ведомость зарплат: оклад, комиссия, доставки, обед, выплаты", "Ish haqi vedomosti: oklad, komissiya, yetkazish, tushlik, to'lovlar")} />
            <ul className="mt-6 grid sm:grid-cols-2 gap-3">
              {[
                tr("KPI по доставленному, а не по оформленному", "KPI yetkazilgani bo'yicha, rasmiylashtirilgani bo'yicha emas"),
                tr("Комиссия общая или своя на каждый товар", "Komissiya umumiy yoki har bir mahsulotga alohida"),
                tr("Курьеру — за штуку или процентом от довезённого", "Kuryerga — donasiga yoki yetkazilganidan foiz"),
                tr("Достижения и рейтинг агентов", "Agentlar yutuqlari va reytingi"),
              ].map(i => (
                <li key={i} className="flex items-start gap-2.5 text-[13.5px]" style={{ color: LX.inkSoft }}>
                  <Trophy size={14} className="mt-1 shrink-0" style={{ color: LX.brassText }} />{i}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
