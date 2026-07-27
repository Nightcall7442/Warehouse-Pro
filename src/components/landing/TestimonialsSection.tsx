import { useState, useEffect, useMemo } from "react";
import { useTranslate } from "@/i18n";
import { Star } from "lucide-react";
import { cn, NEU, insetSm, FadeIn, Stagger, NeuCard, Eyebrow } from "./landing-shared";

export default function TestimonialsSection() {
  const tr = useTranslate();
  const [activeTestimonial, setActiveTestimonial] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setActiveTestimonial(p => (p + 1) % 3), 6000);
    return () => clearInterval(t);
  }, []);

  const testimonials = useMemo(
    () => [
      { name: "Акбар Расулов", role: tr("Директор, LogiMax", "Direktor, LogiMax"), text: tr("Warehouse Pro полностью изменил наш подход к дистрибуции. Агенты работают эффективнее, а я вижу всё в реальном времени.", "Warehouse Pro distribyutsiya yondashuvimizni butunlay o'zgartirdi. Agentlar samaraliroq ishlaydi, men hammasini real vaqtda ko'raman."), rating: 5, avatar: "АР" },
      { name: "Дилшод Камолдинов", role: tr("Оператор, TradeHub", "Operator, TradeHub"), text: tr("Раньше все заказы велись в Excel. Теперь всё автоматизировано. Ошибок стало в 10 раз меньше.", "Oldin barcha buyurtmalar Excel da olib borilardi. Endi hammasi avtomatlashtirilgan. Xatolar 10 marta kamaydi."), rating: 5, avatar: "ДК" },
      { name: "Шерзод Абдуллаев", role: tr("Курьер, SupplyPro", "Kuryer, SupplyPro"), text: tr("Мобильное приложение очень удобное. Офлайн-режим работает идеально — можно принимать заказы даже без интернета.", "Mobil ilova juda qulay. Oflayn-rejim ajoyib ishlaydi — internetsiz ham buyurtmalarni qabul qilish mumkin."), rating: 5, avatar: "ША" },
    ],
    [tr]
  );

  return (
    <section id="testimonials" className="py-24">
      <div className="max-w-7xl mx-auto px-6">
        <FadeIn>
          <div className="text-center mb-14">
            <Eyebrow icon={Star}>{tr("Отзывы", "Sharhlar")}</Eyebrow>
            <h2 className="text-2xl md:text-[2rem] font-medium tracking-tight mb-3">{tr("Нам доверяют", "Bizga ishonadi")}</h2>
            <p className="text-[15px]" style={{ color: NEU.textSecondary }}>{tr("Что говорят наши клиенты", "Mijozlarimiz nima deydi")}</p>
          </div>
        </FadeIn>

        <Stagger className="grid md:grid-cols-3 gap-5">
          {testimonials.map((t, i) => (
            <NeuCard key={t.name} className={cn("p-7", activeTestimonial === i && "ring-1")} hover={false} >
              <div className="flex gap-0.5 mb-4">
                {Array.from({ length: t.rating }).map((_, j) => (
                  <Star key={j} size={13} fill={NEU.accent} style={{ color: NEU.accent }} />
                ))}
              </div>
              <p className="text-[13.5px] leading-relaxed mb-6" style={{ color: NEU.textSecondary }}>{t.text}</p>
              <div className="flex items-center gap-3">
                <div className={cn("w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-medium", insetSm)} style={{ color: NEU.accent }}>
                  {t.avatar}
                </div>
                <div>
                  <p className="text-[13px] font-medium">{t.name}</p>
                  <p className="text-[11.5px]" style={{ color: NEU.textMuted }}>{t.role}</p>
                </div>
              </div>
            </NeuCard>
          ))}
        </Stagger>

        <div className="flex justify-center gap-2 mt-8">
          {[0, 1, 2].map(i => (
            <button
              key={i}
              onClick={() => setActiveTestimonial(i)}
              className="h-1.5 rounded-full transition-all duration-500"
              style={{ width: activeTestimonial === i ? 24 : 6, background: activeTestimonial === i ? NEU.accent : "rgba(163,158,143,0.35)" }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
