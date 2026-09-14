import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useTranslate } from "@/i18n";
import { Check } from "lucide-react";
import { SectionHead, Stamp } from "./landing-shared";
import { useAnime } from "./landing-anime";
import { LX, MONO, tgLink } from "./landing-tokens";
import { PLANS, PLAN_PRICES_UZS, PLAN_ADDS, FEATURES, EXTRA_PRICES_UZS } from "@contracts/constants";

/* ═══════════════════════════════════════════════════════════════════════════
   07 / Тарифы.

   ── Числа берутся из источника, а не переписываются ─────────────────────────

   Цены и пределы стояли здесь строками: «299 000», «До 5 пользователей». Это
   вторая копия того, что живёт в contracts/constants.ts и по чему приложение
   считает доступ. Совпадали они по случайности: подними цену в одном месте — и
   лендинг продолжит обещать старую, а на экране оплаты человек увидит другую.

   ── Чего не хватало ────────────────────────────────────────────────────────

   Предел по товарам не назывался ВООБСЕ. У Basic это 50 SKU, у Pro — 100:
   для оптовика с тысячей позиций это главный вопрос к тарифу, и ответа на
   странице не было. Пределы теперь стоят отдельной строкой в каждой карточке,
   все три сразу.

   Возражение директора — не «дорого», а «непонятно, какой тариф мой и что
   будет после триала». Поэтому: строка самоопределения под именем тарифа,
   де-риск «14 дней · карта не нужна · ничего не спишется» в каждой карточке,
   у Pro — экономический якорь в сум/день и второй оттиск печати.
   Верхний тариф не продаётся self-serve: если задан Telegram — кнопка ведёт
   к менеджеру.

   ── Премиальная подача ─────────────────────────────────────────────────────

   Владелец: «сделать ещё премиальным». Тарифы стали последней ночной
   полосой перед FAQ: панели цвета чернил, у Pro — латунная кромка (единственный
   акцент) и приподнятость, цена набирается счётчиком anime.js при появлении,
   пределы — одной строкой с тонкими разделителями, а не тремя плитками.
   Числа по-прежнему только из contracts/constants.ts.
   ═══════════════════════════════════════════════════════════════════════════ */

function Btn({ kind, onClick, href, children }: { kind: "brass" | "paper"; onClick?: () => void; href?: string; children: ReactNode }) {
  const style = kind === "brass"
    ? { background: LX.brassOnNight, color: LX.night, border: `1px solid ${LX.brassOnNight}` }
    : { background: "transparent", color: LX.paperOnInk, border: "1px solid rgba(240,238,232,0.34)" };
  const cls = "lx-anim inline-flex items-center justify-center w-full h-12 rounded-lg text-[14px] font-semibold cursor-pointer transition-opacity duration-200 hover:opacity-90";
  return href
    ? <a href={href} target="_blank" rel="noopener" className={cls} style={style}>{children}</a>
    : <button type="button" onClick={onClick} className={cls} style={style}>{children}</button>;
}


export default function PricingSection() {
  const navigate = useNavigate();
  const tr = useTranslate();
  const tgSales = tgLink(tr("Здравствуйте! Интересует тариф Exclusive.", "Assalomu alaykum! Exclusive tarifi bo'yicha ma'lumot olmoqchiman."));

  const plans = useMemo(
    () => {
      /** Предел: null значит «без ограничения». Внутри memo — иначе он
          пересоздаётся каждую отрисовку и обнуляет смысл memo. */
      const cap = (v: number | null) => (v === null ? tr("без предела", "cheksiz") : v.toLocaleString("ru"));
      /*
        Предел — не стена: место и позицию можно докупить сверх тарифа. Цены
        берутся из того же источника, что и списание (EXTRA_PRICES_UZS), а не
        переписываются сюда — ровно по той же причине, что и цены тарифов выше.
      */
      const extraNote = tr(
        `Мало? Сверх тарифа: место ${EXTRA_PRICES_UZS.user.toLocaleString("ru")} · товар ${EXTRA_PRICES_UZS.product.toLocaleString("ru")} сум/мес`,
        `Kam? Tarifdan ortiq: joy ${EXTRA_PRICES_UZS.user.toLocaleString("ru")} · mahsulot ${EXTRA_PRICES_UZS.product.toLocaleString("ru")} so'm/oy`,
      );
      return [
      {
        name: "Basic",
        price: PLAN_PRICES_UZS.basic.toLocaleString("ru"),
        priceNumber: PLAN_PRICES_UZS.basic,
        fit: tr("Команда до 5 человек, один склад", "5 kishigacha jamoa, bitta ombor"),
        anchor: tr("≈ 10 000 сум в день", "kuniga ≈ 10 000 so'm"),
        limits: [
          { v: cap(PLANS.basic.maxUsers), label: tr("пользователей", "foydalanuvchi") },
          { v: cap(PLANS.basic.maxProducts), label: tr("SKU товаров", "SKU mahsulot") },
          { v: cap(PLANS.basic.maxOrdersMonth), label: tr("заказов в месяц", "buyurtma/oy") },
        ],
        features: [
          ...PLAN_ADDS.basic.map(f => tr(FEATURES[f].ru, FEATURES[f].uz)),
        ],
        hl: false,
        extra: extraNote,
      },
      {
        name: "Pro",
        price: PLAN_PRICES_UZS.pro.toLocaleString("ru"),
        priceNumber: PLAN_PRICES_UZS.pro,
        fit: tr("5–20 сотрудников, агенты в поле", "5–20 xodim, daladagi agentlar"),
        anchor: tr("≈ 20 000 сум в день — меньше одной недостачи", "kuniga ≈ 20 000 so'm — bitta kamomaddan arzon"),
        limits: [
          { v: cap(PLANS.pro.maxUsers), label: tr("пользователей", "foydalanuvchi") },
          { v: cap(PLANS.pro.maxProducts), label: tr("SKU товаров", "SKU mahsulot") },
          { v: cap(PLANS.pro.maxOrdersMonth), label: tr("заказов в месяц", "buyurtma/oy") },
        ],
        features: [
          tr("Всё из Basic", "Basic'dagi hammasi"),
          ...PLAN_ADDS.pro.map(f => tr(FEATURES[f].ru, FEATURES[f].uz)),
        ],
        hl: true,
        extra: extraNote,
      },
      {
        name: "Exclusive",
        price: PLAN_PRICES_UZS.exclusive.toLocaleString("ru"),
        priceNumber: PLAN_PRICES_UZS.exclusive,
        /*
          Было «Сеть филиалов, без ограничений». Числа рядом берутся из PLANS и
          после отмены безлимита показывают 50 и 250 — то есть подпись спорила
          с колонкой прямо под собой. Теперь она говорит про то, чем Exclusive
          и отличается на самом деле: сопровождение и заказы без предела.
        */
        fit: tr("Сеть филиалов, заказы без предела", "Filiallar tarmog'i, buyurtmalar cheksiz"),
        anchor: tr("Персональный менеджер и внедрение", "Shaxsiy menejer va joriy etish"),
        limits: [
          { v: cap(PLANS.exclusive.maxUsers), label: tr("пользователей", "foydalanuvchi") },
          { v: cap(PLANS.exclusive.maxProducts), label: tr("SKU товаров", "SKU mahsulot") },
          { v: cap(PLANS.exclusive.maxOrdersMonth), label: tr("заказов в месяц", "buyurtma/oy") },
        ],
        features: [
          tr("Всё из Pro", "Pro'dagi hammasi"),
          ...PLAN_ADDS.exclusive.map(f => tr(FEATURES[f].ru, FEATURES[f].uz)),
        ],
        hl: false,
        extra: extraNote,
        manager: true,
      },
      ];
    },
    [tr],
  );

  const root = useAnime<HTMLDivElement>(({ animate, stagger, utils }, el) => {
    animate(el.querySelectorAll("[data-plan]"), { y: [24, 0], opacity: [0, 1], duration: 620, delay: stagger(130, { start: 100 }), ease: "outCubic" });
    el.querySelectorAll<HTMLElement>("[data-price]").forEach((n, i) => {
      const target = Number(n.dataset.price);
      const o = { v: 0 };
      animate(o, { v: target, duration: 1300, delay: 400 + i * 150, ease: "outCubic", modifier: utils.round(0), onUpdate: () => { n.textContent = o.v.toLocaleString("ru"); } });
    });
    animate(el.querySelectorAll("[data-feat]"), { x: [-8, 0], opacity: [0, 1], duration: 380, delay: stagger(40, { start: 700 }), ease: "outCubic" });
  }, 0.2);

  return (
    <section className="lx-ink py-16 md:py-24" style={{ background: LX.night }}>
      <div ref={root} className="max-w-[1240px] mx-auto px-6">
        <SectionHead
          id="pricing"
          tone="dark"
          index="12"
          label={tr("Тарифы", "Tariflar")}
          title={tr("Цена написана на ценнике", "Narx yorlig'ida yozilgan")}
          lead={tr(
            "Каждый тариф начинается с 14 бесплатных дней. Карта не привязывается — после триала ничего не спишется.",
            "Har bir tarif 14 kunlik bepul sinovdan boshlanadi. Karta bog'lanmaydi — sinovdan keyin hech narsa yechilmaydi.",
          )}
        />

        <div className="mt-14 grid md:grid-cols-3 gap-5 items-stretch">
          {plans.map(plan => (
            <div
              key={plan.name}
              data-plan
              className={`relative rounded-2xl flex flex-col transition-transform duration-300 hover:-translate-y-1 ${plan.hl ? "md:-mt-6 md:mb-2" : ""}`}
              style={{
                padding: plan.hl ? "36px 30px" : "30px 26px",
                background: plan.hl ? `linear-gradient(180deg, rgba(199,147,81,0.10), rgba(199,147,81,0.02) 40%, transparent), ${LX.ink}` : LX.ink,
                border: plan.hl ? `1px solid ${LX.brassOnNight}` : `1px solid ${LX.ruleOnInk}`,
                boxShadow: plan.hl
                  ? "0 0 0 6px rgba(199,147,81,0.08), 0 50px 90px -50px rgba(0,0,0,0.9)"
                  : "0 30px 60px -40px rgba(0,0,0,0.8)",
              }}
            >
              {plan.hl && (
                <div className="absolute -top-12 -right-4" style={{ filter: "brightness(1.45) saturate(1.1)" }}>
                  <Stamp
                    ring={tr("РЕКОМЕНДУЕМ · TAVSIYA ETILADI · РЕКОМЕНДУЕМ · ", "TAVSIYA ETILADI · РЕКОМЕНДУЕМ · TAVSIYA · ")}
                    center="PRO"
                    size={104}
                    rotate={8}
                  />
                </div>
              )}
              <div className="text-[11px] uppercase" style={{ ...MONO, color: LX.brassOnNight, letterSpacing: "0.1em" }}>{plan.name}</div>
              <p className="text-[13.5px] mt-2" style={{ color: LX.softOnInk }}>{plan.fit}</p>

              <div className="mt-6 flex items-baseline gap-2">
                <span className="font-medium tracking-tight" style={{ ...MONO, fontSize: plan.hl ? 40 : 34, lineHeight: 1, color: LX.paperOnInk }}>
                  <span data-price={plan.priceNumber}>{plan.price}</span>
                </span>
                <span className="text-[12px]" style={{ color: LX.softOnInk }}>{tr("сум/мес", "so'm/oy")}</span>
              </div>
              <p className="text-[12px] mt-2" style={{ ...MONO, color: LX.brassOnNight }}>{plan.anchor}</p>

              {/* Пределы — одной строкой с тонкими разделителями. */}
              <div className="mt-6 flex items-stretch rounded-lg overflow-hidden" style={{ border: `1px solid ${LX.ruleOnInk}` }}>
                {plan.limits.map((l, i) => (
                  <div key={l.label} className="flex-1 px-2 py-3 text-center" style={{ borderLeft: i ? `1px solid ${LX.ruleOnInk}` : undefined }}>
                    <div className="text-[15px] font-semibold leading-none" style={{ ...MONO, color: LX.paperOnInk }}>{l.v}</div>
                    <div className="text-[10.5px] mt-1.5 leading-tight" style={{ color: LX.softOnInk }}>{l.label}</div>
                  </div>
                ))}
              </div>
              {plan.extra && (
                <p className="mt-2.5 text-center text-[11px] leading-snug" style={{ color: LX.softOnInk }}>{plan.extra}</p>
              )}

              <ul className="mt-6 space-y-2.5 flex-1">
                {plan.features.map((f, i) => (
                  <li key={f} data-feat className="flex items-start gap-2.5 text-[13.5px]" style={{ color: i === 0 && plan.name !== "Basic" ? LX.paperOnInk : LX.softOnInk, fontWeight: i === 0 && plan.name !== "Basic" ? 600 : 400 }}>
                    <Check size={14} strokeWidth={3} className="mt-0.5 shrink-0" style={{ color: LX.brassOnNight }} />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                {plan.manager && tgSales ? (
                  <Btn kind="paper" href={tgSales}>{tr("Обсудить с менеджером", "Menejer bilan muhokama qilish")}</Btn>
                ) : plan.hl ? (
                  <Btn kind="brass" onClick={() => navigate("/register")}>{tr("Начать бесплатно", "Bepul boshlash")}</Btn>
                ) : (
                  <Btn kind="paper" onClick={() => navigate("/register")}>{tr("Начать бесплатно", "Bepul boshlash")}</Btn>
                )}
                <p className="mt-3 text-center text-[11px]" style={{ ...MONO, color: LX.softOnInk }}>
                  {tr("14 дней бесплатно · карта не нужна", "14 kun bepul · karta kerak emas")}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 grid md:grid-cols-2 gap-4 text-[13px]" style={{ color: LX.softOnInk }}>
          <p className="rounded-lg px-4 py-3" style={{ border: `1px solid ${LX.ruleOnInk}` }}>
            {tr("Предел ничего не удаляет: всё заведённое работает, нельзя лишь добавить сверх — а сверх можно докупить поштучно.", "Chegara hech narsani o'chirmaydi: kiritilgan hamma narsa ishlaydi, faqat ustiga qo'shib bo'lmaydi — ustini esa donalab sotib olish mumkin.")}
          </p>
          <p className="rounded-lg px-4 py-3" style={{ border: `1px solid ${LX.ruleOnInk}` }}>
            {tr("Оплата: Payme, Click или по счёту для юрлиц — с договором и закрывающими документами.", "To'lov: Payme, Click yoki yuridik shaxslar uchun hisob orqali — shartnoma va yopuvchi hujjatlar bilan.")}
          </p>
        </div>
      </div>
    </section>
  );
}
