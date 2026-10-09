import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useTranslate } from "@/i18n";
import { plural } from "@/lib/plural";
import { Minus, Plus } from "lucide-react";
import { SectionHead } from "./landing-shared";
import { Split } from "./landing-frames";
import { useAnime } from "./landing-anime";
import { LX, MONO, tgLink } from "./landing-tokens";
import { FEATURES, PRODUCT_FEATURES, SERVICE_FEATURES } from "@contracts/constants";
import {
  ANNUAL_DISCOUNT, FIELD_PRICE_UZS, GRANDFATHER_UNTIL, MIN_FIELD_USERS,
  annualPrice, annualSaving, formatDay, formatSum, monthlyPrice,
} from "@contracts/pricing";

/* ═══════════════════════════════════════════════════════════════════════════
   12 / Тарифы — цена за полевого сотрудника.

   ── Что было ────────────────────────────────────────────────────────────────

   Три тарифа прайс-листом: Basic / Pro / Exclusive, у каждого свои пределы
   по людям и товарам, надбавки за место и позицию, функции по ступеням.
   Директору приходилось решать задачу «какой тариф мой» — и понимать, что
   будет, когда он вырастет из пятидесяти мест.

   ── Что стало (решение владельца 05.10.2026) ────────────────────────────────

   Одна цена: 119 000 сум за агента, курьера или мерчендайзера в месяц. Офис
   бесплатно, пределов нет, все функции у всех, год — минус 15 %. Слева —
   сама цена и её условия реестром; справа — счётчик: сколько людей в поле
   → сколько в месяц и за год. Числа только из contracts/pricing.ts: страж
   `pricing-one-source.test` ищет здесь 119 000 буквами.

   Полоса — прежняя ночная (последняя перед FAQ), из деталей языка лендинга:
   Split 5/12 + 7/12, реестр волосяными линиями, латунь — единственный акцент.
   ═══════════════════════════════════════════════════════════════════════════ */

/** С какого числа людей в поле начинает счётчик — типичный дистрибьютор. */
const CALC_START = 20;
const CALC_MAX = 300;

/** Примеры: агенты + курьеры. Цена — из модуля, здесь только состав команды. */
const EXAMPLES: Array<{ agents: number; couriers: number }> = [
  { agents: 5, couriers: 2 },
  { agents: 20, couriers: 6 },
  { agents: 50, couriers: 15 },
];

function Btn({ kind, onClick, href, children, testId }: { kind: "brass" | "paper"; onClick?: () => void; href?: string; children: ReactNode; testId?: string }) {
  const style = kind === "brass"
    ? { background: LX.brassOnNight, color: LX.night, border: `1px solid ${LX.brassOnNight}` }
    : { background: "transparent", color: LX.paperOnInk, border: `1px solid ${LX.paperOnInk34}` };
  const cls = "lx-anim inline-flex items-center justify-center w-full h-12 rounded-lg text-[14px] font-semibold cursor-pointer transition-opacity duration-200 hover:opacity-90";
  return href
    ? <a href={href} target="_blank" rel="noopener" className={cls} style={style} data-testid={testId}>{children}</a>
    : <button type="button" onClick={onClick} className={cls} style={style} data-testid={testId}>{children}</button>;
}

/** Строка реестра: слева что, справа сколько. */
function Row({ k, v, strong = false }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3.5" style={{ borderBottom: `1px solid ${LX.ruleOnInk}` }}>
      <span className="text-[14px] leading-snug" style={{ color: LX.softOnInk }}>{k}</span>
      <span className="text-[14px] font-semibold text-right whitespace-nowrap" style={{ color: strong ? LX.brassOnNight : LX.paperOnInk }}>{v}</span>
    </div>
  );
}

export default function PricingSection() {
  const navigate = useNavigate();
  const tr = useTranslate();
  const tgSales = tgLink(tr("Здравствуйте! Интересуют услуги: перенос данных, выделенный сервер.", "Assalomu alaykum! Xizmatlar qiziqtiradi: ma'lumot ko'chirish, ajratilgan server."));
  const [people, setPeople] = useState(CALC_START);
  const set = (n: number) => setPeople(Math.max(1, Math.min(CALC_MAX, Math.round(n) || 1)));

  const discount = `−${Math.round(ANNUAL_DISCOUNT * 100)}%`;
  const month = monthlyPrice(people);
  const year = annualPrice(people);
  const saving = annualSaving(people);

  const root = useAnime<HTMLDivElement>(({ animate, stagger, utils }, el) => {
    animate(el.querySelectorAll("[data-reveal-col]"), { y: [24, 0], opacity: [0, 1], duration: 620, delay: stagger(140, { start: 100 }), ease: "outCubic" });
    el.querySelectorAll<HTMLElement>("[data-price]").forEach(n => {
      const target = Number(n.dataset.price);
      const o = { v: 0 };
      animate(o, { v: target, duration: 1300, delay: 400, ease: "outCubic", modifier: utils.round(0), onUpdate: () => { n.textContent = o.v.toLocaleString("ru-RU"); } });
    });
  }, 0.2);

  const features = PRODUCT_FEATURES.map(f => tr(FEATURES[f].ru, FEATURES[f].uz));
  const services = SERVICE_FEATURES.map(f => tr(FEATURES[f].ru, FEATURES[f].uz));

  return (
    <section className="lx-ink py-16 md:py-24" style={{ background: LX.night }} data-testid="landing-pricing">
      <div ref={root} className="max-w-[1240px] mx-auto px-6">
        <SectionHead
          id="pricing"
          tone="dark"
          index="12"
          label={tr("Тарифы", "Tariflar")}
          title={tr("Платите за тех, кто в поле", "Faqat dalada ishlaydiganlar uchun to'lang")}
          lead={tr(
            "Один тариф и все функции. Офис, склад, супервайзеры и директор — бесплатно. Первые 14 дней — бесплатно, карта не нужна.",
            "Bitta tarif va barcha funksiyalar. Ofis, ombor, supervayzerlar va direktor — bepul. Dastlabki 14 kun — bepul, karta kerak emas.",
          )}
        />

        <Split
          className="mt-14"
          left={
            <div data-reveal-col style={{ borderTop: `2px solid ${LX.brassOnNight}` }} className="pt-8">
              <div className="text-[11px] uppercase" style={{ ...MONO, color: LX.brassOnNight, letterSpacing: "0.1em" }}>
                {tr("Стандарт · за полевого сотрудника", "Standart · har bir dala xodimi uchun")}
              </div>
              <div className="mt-6 flex items-baseline gap-3 flex-wrap">
                <span className="font-extrabold leading-none" style={{ fontSize: "clamp(3.25rem, 6vw, 5rem)", letterSpacing: "-0.045em", fontVariantNumeric: "tabular-nums", color: LX.brassOnNight }}>
                  <span data-price={FIELD_PRICE_UZS} data-testid="pricing-field-price">{formatSum(FIELD_PRICE_UZS)}</span>
                </span>
                <span className="text-[12px] uppercase" style={{ ...MONO, color: LX.softOnInk, letterSpacing: "0.08em" }}>{tr("сум / мес", "so'm / oy")}</span>
              </div>
              <p className="mt-3 text-[16px] leading-snug" style={{ color: LX.paperOnInk }}>
                {tr("за агента, курьера или мерчендайзера в месяц", "har bir agent, kuryer yoki merchandayzer uchun oyiga")}
              </p>

              <div className="mt-8" style={{ borderTop: `1px solid ${LX.ruleOnInk}` }}>
                <Row k={tr("Офис, склад, супервайзеры и директор", "Ofis, ombor, supervayzerlar va direktor")} v={tr("бесплатно", "bepul")} strong />
                <Row k={tr("Заказы, товары, сотрудники", "Buyurtmalar, mahsulotlar, xodimlar")} v={tr("без ограничений", "cheklovsiz")} />
                <Row k={tr("Функции", "Funksiyalar")} v={tr("все включены", "hammasi kiritilgan")} />
                <Row k={tr("Предоплата за год", "Bir yil oldindan to'lov")} v={discount} strong />
                <Row
                  k={tr(`Минимум — ${MIN_FIELD_USERS} полевых`, `Eng kami — ${MIN_FIELD_USERS} dala xodimi`)}
                  v={`${formatSum(monthlyPrice(MIN_FIELD_USERS))} ${tr("сум/мес", "so'm/oy")}`}
                />
              </div>

              <div className="mt-8">
                <Btn kind="brass" onClick={() => navigate("/register")} testId="pricing-start">{tr("Начать бесплатно", "Bepul boshlash")}</Btn>
                <p className="mt-3 text-center text-[11px]" style={{ ...MONO, color: LX.softOnInk }}>
                  {tr("14 дней бесплатно · все функции · карта не нужна", "14 kun bepul · barcha funksiyalar · karta kerak emas")}
                </p>
              </div>
            </div>
          }
          right={
            <div data-reveal-col className="pt-8" style={{ borderTop: `1px solid ${LX.ruleOnInk}` }}>
              <div className="text-[11px] uppercase" style={{ ...MONO, color: LX.softOnInk, letterSpacing: "0.1em" }}>
                {tr("Посчитайте свою команду", "Jamoangizni hisoblang")}
              </div>

              {/* Счётчик: люди в поле → месяц и год. */}
              <div className="mt-6 flex items-center gap-4 flex-wrap">
                <button type="button" aria-label={tr("Меньше", "Kamroq")} onClick={() => set(people - 1)}
                  className="lx-anim w-12 h-12 rounded-lg inline-flex items-center justify-center cursor-pointer"
                  style={{ border: `1px solid ${LX.paperOnInk34}`, color: LX.paperOnInk }} data-testid="pricing-calc-minus">
                  <Minus size={18} />
                </button>
                <div className="min-w-[96px] text-center">
                  <div className="font-extrabold leading-none" style={{ fontSize: "clamp(2.5rem, 4vw, 3.25rem)", letterSpacing: "-0.04em", fontVariantNumeric: "tabular-nums", color: LX.paperOnInk }} data-testid="pricing-calc-people">{people}</div>
                </div>
                <button type="button" aria-label={tr("Больше", "Ko'proq")} onClick={() => set(people + 1)}
                  className="lx-anim w-12 h-12 rounded-lg inline-flex items-center justify-center cursor-pointer"
                  style={{ border: `1px solid ${LX.paperOnInk34}`, color: LX.paperOnInk }} data-testid="pricing-calc-plus">
                  <Plus size={18} />
                </button>
                <span className="text-[13.5px] leading-snug" style={{ color: LX.softOnInk }}>
                  {tr("агентов, курьеров и мерчендайзеров", "agent, kuryer va merchandayzer")}
                </span>
              </div>
              <input
                type="range" min={1} max={CALC_MAX} value={people}
                onChange={e => set(Number(e.target.value))}
                aria-label={tr("Сколько людей в поле", "Dalada necha kishi")}
                className="mt-5 w-full h-11 cursor-pointer"
                style={{ accentColor: LX.brassOnNight }}
                data-testid="pricing-calc-range"
              />

              <div className="mt-4 grid sm:grid-cols-2" style={{ borderTop: `1px solid ${LX.ruleOnInk}`, borderBottom: `1px solid ${LX.ruleOnInk}` }}>
                <div className="py-5 sm:pr-6">
                  <div className="text-[11px] uppercase" style={{ ...MONO, color: LX.softOnInk, letterSpacing: "0.08em" }}>{tr("В месяц", "Oyiga")}</div>
                  <div className="mt-2 text-[28px] font-bold leading-none whitespace-nowrap" style={{ color: LX.paperOnInk, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                    <span data-testid="pricing-calc-month">{formatSum(month)}</span>
                    <span className="text-[12px] font-normal ml-2" style={{ ...MONO, color: LX.softOnInk }}>{tr("сум", "so'm")}</span>
                  </div>
                  {people < MIN_FIELD_USERS && (
                    <p className="mt-2 text-[12px]" style={{ ...MONO, color: LX.softOnInk }}>{tr(`считаем как ${MIN_FIELD_USERS} — минимум`, `${MIN_FIELD_USERS} deb hisoblanadi — eng kami`)}</p>
                  )}
                </div>
                <div className="py-5 sm:pl-6 border-t sm:border-t-0 sm:border-l" style={{ borderColor: LX.ruleOnInk }}>
                  <div className="text-[11px] uppercase" style={{ ...MONO, color: LX.brassOnNight, letterSpacing: "0.08em" }}>{tr(`За год · ${discount}`, `Bir yilga · ${discount}`)}</div>
                  <div className="mt-2 text-[28px] font-bold leading-none whitespace-nowrap" style={{ color: LX.brassOnNight, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                    <span data-testid="pricing-calc-year">{formatSum(year)}</span>
                    <span className="text-[12px] font-normal ml-2" style={{ ...MONO, color: LX.softOnInk }}>{tr("сум", "so'm")}</span>
                  </div>
                  <p className="mt-2 text-[12px]" style={{ ...MONO, color: LX.softOnInk }}>
                    {tr(`экономия ${formatSum(saving)} сум`, `tejash ${formatSum(saving)} so'm`)}
                  </p>
                </div>
              </div>

              {/* Примеры — нажать, чтобы подставить в счётчик. */}
              <div className="mt-8 text-[11px] uppercase" style={{ ...MONO, color: LX.softOnInk, letterSpacing: "0.1em" }}>
                {tr("Например", "Masalan")}
              </div>
              <ul className="mt-2">
                {EXAMPLES.map(ex => {
                  const n = ex.agents + ex.couriers;
                  return (
                    <li key={n}>
                      <button type="button" onClick={() => set(n)} data-testid={`pricing-example-${n}`}
                        className="lx-anim w-full min-h-[48px] py-3 flex items-baseline justify-between gap-4 text-left cursor-pointer"
                        style={{ borderBottom: `1px solid ${LX.ruleOnInk}`, color: n === people ? LX.brassOnNight : LX.paperOnInk }}>
                        <span className="text-[14px]">
                          {tr(
                            `${ex.agents} ${plural(ex.agents, "агент", "агента", "агентов")} + ${ex.couriers} ${plural(ex.couriers, "курьер", "курьера", "курьеров")}`,
                            `${ex.agents} agent + ${ex.couriers} kuryer`,
                          )}
                          <span className="ml-2 text-[12px]" style={{ ...MONO, color: LX.softOnInk }}>= {n}</span>
                        </span>
                        <span className="text-[15px] font-semibold whitespace-nowrap" style={{ fontVariantNumeric: "tabular-nums" }}>
                          {formatSum(monthlyPrice(n))} <span className="text-[11px] font-normal" style={{ ...MONO, color: LX.softOnInk }}>{tr("сум/мес", "so'm/oy")}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          }
        />

        {/* Что входит — всё; услуги — отдельно и по запросу. */}
        <div className="mt-16 grid md:grid-cols-12 gap-x-16 gap-y-8" style={{ borderTop: `1px solid ${LX.ruleOnInk}` }}>
          <div className="md:col-span-7 pt-7">
            <div className="text-[11px] uppercase mb-4" style={{ ...MONO, color: LX.brassOnNight, letterSpacing: "0.1em" }}>{tr("Включено всё", "Hammasi kiritilgan")}</div>
            <ul className="grid sm:grid-cols-2 gap-x-8">
              {features.map(f => (
                <li key={f} className="py-2.5 text-[13.5px] leading-snug" style={{ color: LX.paperOnInk, borderBottom: `1px solid ${LX.ruleOnInk}` }}>{f}</li>
              ))}
            </ul>
          </div>
          <div className="md:col-span-5 pt-7">
            <div className="text-[11px] uppercase mb-4" style={{ ...MONO, color: LX.softOnInk, letterSpacing: "0.1em" }}>{tr("Услуги — по запросу", "Xizmatlar — so'rov bo'yicha")}</div>
            <ul>
              {services.map(s => (
                <li key={s} className="py-2.5 text-[13.5px] leading-snug flex justify-between gap-4" style={{ color: LX.softOnInk, borderBottom: `1px solid ${LX.ruleOnInk}` }}>
                  {s}<span style={{ ...MONO, fontSize: 11 }}>{tr("по запросу", "so'rov bo'yicha")}</span>
                </li>
              ))}
            </ul>
            {tgSales && (
              <div className="mt-6"><Btn kind="paper" href={tgSales}>{tr("Обсудить с менеджером", "Menejer bilan muhokama qilish")}</Btn></div>
            )}
          </div>
        </div>

        <div className="mt-10 grid md:grid-cols-2 gap-x-10 gap-y-3 text-[13px]" style={{ color: LX.softOnInk }}>
          <p className="py-1">
            {tr(
              `Уже платите по Basic, Pro или Exclusive? Ваша цена и условия сохраняются до ${formatDay(GRANDFATHER_UNTIL)}, затем — цена за полевого сотрудника.`,
              `Basic, Pro yoki Exclusive bo'yicha to'layapsizmi? Narx va shartlaringiz ${formatDay(GRANDFATHER_UNTIL)} gacha saqlanadi, keyin — dala xodimi uchun narx.`,
            )}
          </p>
          <p className="py-1">
            {tr("Оплата: Payme, Click или по счёту для юрлиц — с договором и закрывающими документами.", "To'lov: Payme, Click yoki yuridik shaxslar uchun hisob orqali — shartnoma va yopuvchi hujjatlar bilan.")}
          </p>
        </div>
      </div>
    </section>
  );
}
