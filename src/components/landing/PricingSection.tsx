import { useMemo } from "react";
import { useNavigate } from "react-router";
import { useTranslate } from "@/i18n";
import { Star, CheckCircle2 } from "lucide-react";
import { cn, NEU, raisedSm, FadeIn, NeuCard, NeuButton, Eyebrow } from "./landing-shared";

export default function PricingSection() {
  const navigate = useNavigate();
  const tr = useTranslate();

  const pricingPlans = useMemo(
    () => [
      { name: "Basic", price: "299 000", features: [tr("До 5 пользователей", "5 tagacha foydalanuvchi"), tr("До 50 товаров", "50 tagacha mahsulot"), tr("Управление складом", "Omborni boshqarish"), tr("Базовая аналитика", "Asosiy tahlil"), tr("Создание и обработка заказов", "Buyurtmalar yaratish"), tr("Мобильное приложение для агентов", "Agentlar uchun mobil ilova"), tr("Email-поддержка", "Email-qo'llab-quvvatlash")], hl: false },
      { name: "Pro", price: "599 000", features: [tr("До 20 пользователей", "20 tagacha foydalanuvchi"), tr("До 100 товаров", "100 tagacha mahsulot"), tr("Всё из Basic", "Basic dagi hammasi"), tr("Полная аналитика (20+ отчётов)", "To'liq tahlil (20+ hisobot)"), tr("GPS-трекинг агентов и курьеров", "Agentlar va kuryerlarning GPS kuzatuvi"), tr("Интеграция с 1С:Предприятие", "1C bilan integratsiya"), tr("Аудит-лог действий", "Amallar audit jurnali"), tr("Приоритетная поддержка", "Ustuvor qo'llab-quvvatlash")], hl: true },
      { name: "Exclusive", price: "1 299 000", features: [tr("Без ограничений по пользователям", "Foydalanuvchilar bo'yicha cheksiz"), tr("Без ограничений по товарам", "Mahsulotlar bo'yicha cheksiz"), tr("Всё из Pro", "Pro dagi hammasi"), tr("API доступ для интеграций", "Integratsiyalar uchun API"), tr("White-label (ваш бренд)", "White-label (sizning brendingiz)"), tr("Персональный менеджер", "Shaxsiy menejer"), tr("Выделенный сервер", "Ajratilgan server"), tr("Поддержка 24/7", "24/7 qo'llab-quvvatlash")], hl: false },
    ],
    [tr]
  );

  return (
    <section id="pricing" className="py-24">
      <div className="max-w-7xl mx-auto px-6">
        <FadeIn>
          <div className="text-center mb-6">
            <Eyebrow icon={Star}>{tr("Тарифы", "Tariflar")}</Eyebrow>
            <h2 className="text-2xl md:text-[2rem] font-medium tracking-tight mb-3">{tr("Прозрачные цены", "Shaffof narxlar")}</h2>
            <p className="text-[15px]" style={{ color: NEU.textSecondary }}>{tr("Начните бесплатно, растите с бизнесом.", "Bepul boshlang, biznesingiz bilan o'sing.")}</p>
          </div>
        </FadeIn>

        <p className="text-center text-[13px] mb-10" style={{ color: NEU.textSecondary }}>
          {tr("Все тарифы включают", "Barcha tariflarga kiradi")}{" "}
          <span className="font-medium" style={{ color: NEU.accent }}>{tr("14 дней бесплатно", "14 kun bepul")}</span>{" "}
          {tr("без привязки карты", "karta bog'lash shart emas")}
        </p>

        <div className="grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {pricingPlans.map((plan, i) => (
            <FadeIn key={plan.name} delay={i * 100}>
              <NeuCard
                className={cn("p-7 h-full flex flex-col relative", plan.hl && "md:-translate-y-2")}
                hover={false}
              >
                {plan.hl && (
                  <div
                    className={cn("absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-full text-[10px] font-medium tracking-wide uppercase", raisedSm)}
                    style={{ background: NEU.bg, color: NEU.accent }}
                  >
                    {tr("Популярный", "Mashhur")}
                  </div>
                )}
                <h3 className="text-[15px] font-medium mb-1">{plan.name}</h3>
                <div className="mb-6 mt-2">
                  <span className="text-3xl font-medium tracking-tight">{plan.price}</span>
                  <span className="text-[12px] ml-1.5" style={{ color: NEU.textMuted }}>{tr("сум/мес", "so'm/oy")}</span>
                </div>
                <ul className="space-y-2.5 mb-7 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-2.5 text-[13px]" style={{ color: NEU.textSecondary }}>
                      <CheckCircle2 size={13} style={{ color: NEU.textMuted }} className="flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <NeuButton
                  onClick={() => navigate("/register")}
                  variant={plan.hl ? "dark" : "raised"}
                  className="w-full h-11"
                >
                  {tr("Начать", "Boshlash")}
                </NeuButton>
              </NeuCard>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
