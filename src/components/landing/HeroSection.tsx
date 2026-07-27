import { useNavigate } from "react-router";
import { useTranslate } from "@/i18n";
import { CheckCircle2, ArrowRight, Play } from "lucide-react";
import { cn, NEU, insetSm, FadeIn, NeuButton, ProductPreview } from "./landing-shared";

export default function HeroSection() {
  const navigate = useNavigate();
  const tr = useTranslate();

  return (
    <>
      <section className="relative pt-32 pb-20 md:pt-40 md:pb-28">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-14 items-center">
            <FadeIn>
              <div>
                <div className={cn("inline-flex items-center gap-2 rounded-full px-3.5 py-2 mb-7", insetSm)}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: NEU.green }} />
                  <span className="text-[11px]" style={{ color: NEU.textSecondary }}>
                    {tr("Работает у 40+ дистрибьюторов Узбекистана", "40+ O'zbekiston distribyutorlari foydalanadi")}
                  </span>
                </div>

                <h1 className="text-[2.3rem] md:text-[3.1rem] font-medium tracking-[-0.02em] leading-[1.1] mb-5">
                  {tr("Учёт склада и доставки", "Ombor va yetkazib berish hisobi")}
                  <br />
                  {tr("без разрывов между отделами", "bo'limlar orasida uzilishsiz")}
                </h1>

                <p className="text-[15px] md:text-base leading-relaxed mb-9 max-w-md" style={{ color: NEU.textSecondary }}>
                  {tr(
                    "Один источник данных для директора, склада, агентов и курьеров — вместо Excel-таблиц и звонков.",
                    "Direktor, ombor, agentlar va kuryerlar uchun bitta ma'lumot manbai — Excel jadvallar va qo'ng'iroqlar o'rniga."
                  )}
                </p>

                <div className="flex flex-wrap items-center gap-3 mb-10">
                  <NeuButton onClick={() => navigate("/register")} className="h-12 px-7 text-[14px]">
                    {tr("Начать бесплатно", "Bepul boshlash")}
                    <ArrowRight size={15} />
                  </NeuButton>
                  <NeuButton variant="inset" className="h-12 px-7 text-[14px]">
                    <Play size={12} fill={NEU.textSecondary} style={{ color: NEU.textSecondary }} />
                    {tr("Смотреть демо", "Demo ko'rish")}
                  </NeuButton>
                </div>

                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]" style={{ color: NEU.textMuted }}>
                  {[
                    tr("14 дней бесплатно", "14 kun bepul"),
                    tr("Без привязки карты", "Kartani bog'lash shart emas"),
                    tr("Настройка за 5 мин", "5 daqiqada sozlash"),
                  ].map(s => (
                    <span key={s} className="flex items-center gap-1.5">
                      <CheckCircle2 size={13} style={{ color: NEU.green }} />
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </FadeIn>

            <FadeIn delay={200}>
              <ProductPreview tr={tr} />
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Social proof */}
      <section className="py-10">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-[10px] uppercase tracking-[0.25em] mb-7 font-medium" style={{ color: NEU.textMuted }}>
            {tr("Используют ведущие дистрибьюторы", "Yetakchi distribyutorlar foydalanadi")}
          </p>
          <div className="flex items-center justify-center gap-10 md:gap-16 flex-wrap">
            {["Distrubia", "LogiMax", "TradeHub", "SupplyPro", "StockFlow"].map(n => (
              <span key={n} className="text-lg font-medium tracking-tight" style={{ color: "rgba(138,136,124,0.45)" }}>{n}</span>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
