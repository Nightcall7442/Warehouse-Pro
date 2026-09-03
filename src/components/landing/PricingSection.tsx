import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useTranslate } from "@/i18n";
import { Check } from "lucide-react";
import { SectionHead, Stamp, BtnInk, BtnGhost } from "./landing-shared";
import { cn, LX, MONO, tgLink } from "./landing-tokens";

/* ═══════════════════════════════════════════════════════════════════════════
   07 / Тарифы.

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
    () => [
      {
        name: "Basic",
        price: "299 000",
        fit: tr("Команда до 5 человек, один склад", "5 kishigacha jamoa, bitta ombor"),
        anchor: tr("≈ 10 000 сум в день", "kuniga ≈ 10 000 so'm"),
        features: [
          tr("Склад, заказы, доставка", "Ombor, buyurtmalar, yetkazish"),
          tr("До 5 пользователей", "5 tagacha foydalanuvchi"),
          tr("Мобильное приложение с офлайн-режимом", "Oflayn rejimli mobil ilova"),
          tr("Базовые отчёты", "Asosiy hisobotlar"),
          tr("Поддержка по email", "Email orqali yordam"),
        ],
        hl: false,
      },
      {
        name: "Pro",
        price: "599 000",
        fit: tr("5–20 сотрудников, агенты в поле", "5–20 xodim, daladagi agentlar"),
        anchor: tr("≈ 20 000 сум в день — меньше одной недостачи", "kuniga ≈ 20 000 so'm — bitta kamomaddan arzon"),
        features: [
          tr("Всё из Basic, до 20 пользователей", "Basic'dagi hammasi, 20 tagacha foydalanuvchi"),
          tr("GPS-контроль агентов и курьеров", "Agentlar va kuryerlar GPS nazorati"),
          tr("Двусторонний обмен с 1С", "1C bilan ikki tomonlama almashinuv"),
          tr("Полная аналитика: прибыль, KPI, долги", "To'liq tahlil: foyda, KPI, qarzlar"),
          tr("Приоритетная поддержка", "Ustuvor yordam"),
        ],
        hl: true,
      },
      {
        name: "Exclusive",
        price: "1 299 000",
        fit: tr("Сеть филиалов, без ограничений", "Filiallar tarmog'i, cheklovsiz"),
        anchor: tr("Персональный менеджер и внедрение", "Shaxsiy menejer va joriy etish"),
        features: [
          tr("Без ограничений по людям и товарам", "Odamlar va tovarlar bo'yicha cheksiz"),
          tr("API-доступ и white-label", "API va white-label"),
          tr("Помощь с переносом данных из Excel и 1С", "Excel va 1C dan ma'lumot ko'chirishda yordam"),
          tr("Выделенный сервер", "Ajratilgan server"),
          tr("Поддержка 24/7", "24/7 yordam"),
        ],
        hl: false,
        manager: true,
      },
    ],
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

              <ul className="mt-6 space-y-2.5 flex-1">
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
