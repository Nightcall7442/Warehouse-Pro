import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useTranslate } from "@/i18n";
import { Check } from "lucide-react";
import { SectionHead, Stamp, BtnInk, BtnGhost } from "./landing-shared";
import { cn, LX, MONO, tgLink } from "./landing-tokens";
import { PLANS, PLAN_PRICES_UZS, PLAN_ADDS, FEATURES } from "@contracts/constants";

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
   ═══════════════════════════════════════════════════════════════════════════ */

export default function PricingSection() {
  const navigate = useNavigate();
  const tr = useTranslate();
  const tgSales = tgLink(tr("Здравствуйте! Интересует тариф Exclusive.", "Assalomu alaykum! Exclusive tarifi bo'yicha ma'lumot olmoqchiman."));

  const plans = useMemo(
    () => {
      /** Предел: null значит «без ограничения». Внутри memo — иначе он
          пересоздаётся каждую отрисовку и обнуляет смысл memo. */
      const cap = (v: number | null) => (v === null ? tr("без предела", "cheksiz") : v.toLocaleString("ru"));
      return [
      {
        name: "Basic",
        price: PLAN_PRICES_UZS.basic.toLocaleString("ru"),
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
      },
      {
        name: "Pro",
        price: PLAN_PRICES_UZS.pro.toLocaleString("ru"),
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
      },
      {
        name: "Exclusive",
        price: PLAN_PRICES_UZS.exclusive.toLocaleString("ru"),
        fit: tr("Сеть филиалов, без ограничений", "Filiallar tarmog'i, cheklovsiz"),
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
        manager: true,
      },
      ];
    },
    [tr],
  );

  return (
    <section className="py-16 md:py-24" style={{ borderTop: `1px solid ${LX.rule}` }}>
      <div className="max-w-[1240px] mx-auto px-6">
        <SectionHead
          id="pricing"
          index="06"
          label={tr("Тарифы", "Tariflar")}
          title={tr("Цена написана на ценнике", "Narx yorlig'ida yozilgan")}
          lead={tr(
            "Каждый тариф начинается с 14 бесплатных дней. Карта не привязывается — после триала ничего не спишется.",
            "Har bir tarif 14 kunlik bepul sinovdan boshlanadi. Karta bog'lanmaydi — sinovdan keyin hech narsa yechilmaydi.",
          )}
        />

        <div className="mt-12 grid md:grid-cols-3 gap-5 items-stretch">
          {plans.map(plan => (
            <div
              key={plan.name}
              className={cn("relative rounded-xl p-7 flex flex-col")}
              style={{
                background: plan.hl ? LX.paperRaised : LX.paper,
                border: plan.hl ? `2px solid ${LX.brass}` : `1px solid ${LX.ruleStrong}`,
                boxShadow: plan.hl ? `0 0 0 4px ${LX.brassSoft}` : undefined,
              }}
            >
              {plan.hl && (
                <div className="absolute -top-10 -right-5">
                  <Stamp
                    ring={tr("РЕКОМЕНДУЕМ · TAVSIYA ETILADI · РЕКОМЕНДУЕМ · ", "TAVSIYA ETILADI · РЕКОМЕНДУЕМ · TAVSIYA · ")}
                    center="PRO"
                    size={104}
                    rotate={8}
                  />
                </div>
              )}
              <h3 className="text-[16px] font-bold" style={{ color: LX.ink }}>
                {plan.name}
              </h3>
              <p className="text-[12.5px] mt-1" style={{ color: LX.inkFaint }}>
                {plan.fit}
              </p>
              <div className="mt-5 flex items-baseline gap-2">
                <span className="text-[32px] font-medium tracking-tight" style={{ ...MONO, color: LX.ink }}>
                  {plan.price}
                </span>
                <span className="text-[12px]" style={{ color: LX.inkFaint }}>
                  {tr("сум/мес", "so'm/oy")}
                </span>
              </div>
              <p className="text-[12px] mt-1.5" style={{ ...MONO, color: LX.brassText }}>
                {plan.anchor}
              </p>

              {/* Пределы — все три сразу и числом. Предел по товарам раньше не
                  назывался вовсе, а для оптовика это главный вопрос. */}
              <div
                className="mt-5 grid grid-cols-3 gap-2 rounded-lg py-3 px-2"
                style={{ background: LX.paperRaised, border: `1px solid ${LX.rule}` }}
              >
                {plan.limits.map(l => (
                  <div key={l.label} className="text-center">
                    <div className="text-[15px] font-semibold leading-none" style={{ ...MONO, color: LX.ink }}>
                      {l.v}
                    </div>
                    <div className="text-[10.5px] mt-1.5 leading-tight" style={{ color: LX.inkFaint }}>
                      {l.label}
                    </div>
                  </div>
                ))}
              </div>

              <ul className="mt-5 space-y-2.5 flex-1">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2.5 text-[13.5px]" style={{ color: LX.inkSoft }}>
                    <Check size={14} strokeWidth={3} className="mt-0.5 shrink-0" style={{ color: LX.brassText }} />
                    {f}
                  </li>
                ))}
              </ul>

              <div className="mt-7">
                {plan.manager && tgSales ? (
                  <BtnGhost href={tgSales} className="w-full">
                    {tr("Обсудить с менеджером", "Menejer bilan muhokama qilish")}
                  </BtnGhost>
                ) : plan.hl ? (
                  <BtnInk onClick={() => navigate("/register")} className="w-full">
                    {tr("Начать бесплатно", "Bepul boshlash")}
                  </BtnInk>
                ) : (
                  <BtnGhost onClick={() => navigate("/register")} className="w-full">
                    {tr("Начать бесплатно", "Bepul boshlash")}
                  </BtnGhost>
                )}
                <p className="mt-3 text-center text-[11px]" style={{ ...MONO, color: LX.inkFaint }}>
                  {tr("14 дней бесплатно · карта не нужна", "14 kun bepul · karta kerak emas")}
                </p>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-[13px]" style={{ color: LX.inkSoft }}>
          {tr(
            "Оплата: Payme, Click или по счёту для юрлиц — с договором и закрывающими документами.",
            "To'lov: Payme, Click yoki yuridik shaxslar uchun hisob orqali — shartnoma va yopuvchi hujjatlar bilan.",
          )}
        </p>
      </div>
    </section>
  );
}
