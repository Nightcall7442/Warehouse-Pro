import { useNavigate } from "react-router";
import { useMemo } from "react";
import { useTranslate } from "@/i18n";
import {
  Warehouse,
  ArrowRight,
  Headphones,
} from "lucide-react";

import {
  cn,
  NEU,
  raisedSm,
  FadeIn,
  Counter,
  NeuCard,
  Eyebrow,
  Accordion,
  ScrollProgress,
} from "@/components/landing/landing-shared";

import LandingHeader from "@/components/landing/LandingHeader";
import HeroSection from "@/components/landing/HeroSection";
import FeaturesSection from "@/components/landing/FeaturesSection";
import TestimonialsSection from "@/components/landing/TestimonialsSection";
import PricingSection from "@/components/landing/PricingSection";

export default function Landing() {
  const tr = useTranslate();
  const navigate = useNavigate();

  const stats = useMemo(
    () => [
      { v: 500, s: "+", l: tr("Компаний", "Kompaniyalar") },
      { v: 10000, s: "+", l: tr("Заказов в день", "Buyurtmalar kuniga") },
      { v: 99, s: ".9%", l: "Uptime" },
      { v: 24, s: "/7", l: tr("Поддержка", "Qo'llab-quvvatlash") },
    ],
    [tr]
  );

  const faqItems = useMemo(
    () => [
      { q: tr("Сколько времени занимает настройка?", "Sozlash qancha vaqt oladi?"), a: tr("Базовая настройка занимает 5-10 минут. Вы регистрируетесь, добавляете компанию и товары, приглашаете команду. Для интеграций с 1С мы предоставляем бесплатную помощь.", "Asosiy sozlash 5-10 daqiqa oladi. Siz ro'yxatdan o'tasiz, kompaniya va mahsulotlarni qo'shasiz, jamoani taklif qilasiz. 1C integratsiyalari uchun biz bepul yordam beramiz.") },
      { q: tr("Можно ли интегрировать с 1С:Предприятие?", "1C:Predpriyatiye bilan integratsiya qilish mumkinmi?"), a: tr("Да, Warehouse Pro поддерживает двустороннюю синхронизацию с 1С:Предприятие. Товары, заказы, остатки и документы синхронизируются автоматически.", "Ha, Warehouse Pro 1C:Predpriyatiye bilan ikki tomonlama sinxronlashtirishni qo'llab-quvvatlaydi.") },
      { q: tr("Как работает мобильное приложение?", "Mobil ilova qanday ishlaydi?"), a: tr("Мобильное приложение построено на React Native и работает на iOS и Android. Поддерживает офлайн-режим, GPS-трекинг, камеру и push-уведомления.", "Mobil ilova React Native asosida qurilgan va iOS va Android da ishlaydi. Oflayn-rejim, GPS kuzatuv, kamera va push-bildirishnomalarni qo'llab-quvvatlaydi.") },
      { q: tr("Безопасны ли мои данные?", "Ma'lumotlarim xavfsizmi?"), a: tr("Да, мы используем JWT-аутентификацию, шифрование данных, tenant-изоляцию и регулярные бэкапы.", "Ha, biz JWT-autentifikatsiya, ma'lumotlarni shifrlash, tenant-izolyatsiya va muntazam zaxiralardan foydalanamiz.") },
      { q: tr("Есть ли бесплатный период?", "Bepul davr bormi?"), a: tr("Да, вы можете бесплатно пользоваться системой 14 дней без ограничений. Привязка карты не требуется.", "Ha, siz tizimdan 14 kun cheksiz bepul foydalanishingiz mumkin. Kartani bog'lash shart emas.") },
      { q: tr("Какая поддержка предоставляется?", "Qanday qo'llab-quvvatlash beriladi?"), a: tr("Для Basic — email-поддержка в рабочие дни. Для Pro — приоритетная поддержка и персональный менеджер. Для Exclusive — круглосуточная поддержка 24/7.", "Basic uchun — ish kunlari email-qo'llab-quvvatlash. Pro uchun — ustuvor qo'llab-quvvatlash. Exclusive uchun — 24/7 qo'llab-quvvatlash.") },
    ],
    [tr]
  );

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: NEU.bg, color: NEU.text }}>
      <ScrollProgress />
      <LandingHeader />
      <HeroSection />

      {/* Stats */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-6">
          <FadeIn>
            <NeuCard className="p-10" hover={false}>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                {stats.map(stat => (
                  <div key={stat.l} className="text-center">
                    <p className="text-3xl md:text-4xl font-medium tracking-tight mb-1.5" style={{ color: NEU.text }}>
                      <Counter target={stat.v} />{stat.s}
                    </p>
                    <p className="text-[12.5px] font-medium" style={{ color: NEU.textMuted }}>{stat.l}</p>
                  </div>
                ))}
              </div>
            </NeuCard>
          </FadeIn>
        </div>
      </section>

      <FeaturesSection />
      <TestimonialsSection />
      <PricingSection />

      {/* FAQ */}
      <section className="py-24">
        <div className="max-w-3xl mx-auto px-6">
          <FadeIn>
            <div className="text-center mb-12">
              <Eyebrow icon={Headphones}>FAQ</Eyebrow>
              <h2 className="text-2xl md:text-[2rem] font-medium tracking-tight">{tr("Частые вопросы", "Ko'p beriladigan savollar")}</h2>
            </div>
          </FadeIn>
          <FadeIn delay={100}>
            <Accordion items={faqItems} />
          </FadeIn>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <FadeIn>
            <div className="rounded-[2rem] px-8 py-16 md:px-16 md:py-20 text-center" style={{ background: "#2a2924" }}>
              <div className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-full mb-7")} style={{ background: "rgba(255,255,255,0.06)" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: NEU.accent }} />
                <span className="text-[11px]" style={{ color: "#b8b6ac" }}>{tr("Присоединяйтесь к 500+ компаниям", "500+ kompaniyaga qo'shiling")}</span>
              </div>
              <h2 className="text-3xl md:text-[2.4rem] font-medium tracking-tight mb-4" style={{ color: "#f2f0ec" }}>
                {tr("Готовы начать?", "Boshlashga tayyormisiz?")}
              </h2>
              <p className="text-[15px] mb-9 max-w-md mx-auto leading-relaxed" style={{ color: "#918f83" }}>
                {tr("14 дней бесплатно. Без привязки карты. Настройка за 5 минут.", "14 kun bepul. Kartani bog'lash shart emas.")}
              </p>
              <button
                onClick={() => navigate("/register")}
                className="h-13 px-9 rounded-2xl font-medium text-[14px] inline-flex items-center gap-2.5 transition-transform duration-200 hover:-translate-y-0.5"
                style={{ background: NEU.bg, color: NEU.text }}
              >
                {tr("Начать бесплатно", "Bepul boshlash")}
                <ArrowRight size={16} />
              </button>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Footer */}
      <footer className="pt-14 pb-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-5 gap-10 mb-12">
            <div className="md:col-span-2">
              <div className="flex items-center gap-2.5 mb-4">
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", raisedSm)}>
                  <Warehouse size={14} style={{ color: NEU.accent }} strokeWidth={2.2} />
                </div>
                <span className="font-medium text-[14px]">Warehouse Pro</span>
              </div>
              <p className="text-[13px] leading-relaxed max-w-xs mb-5" style={{ color: NEU.textMuted }}>
                {tr("Современная WMS для дистрибьюторов. Управляйте складом, заказами и доставкой из одного приложения.", "Distribyutorlar uchun zamonaviy WMS.")}
              </p>
            </div>
            {[
              { t: tr("Продукт", "Mahsulot"), items: [tr("Возможности", "Imkoniyatlar"), tr("Тарифы", "Tariflar"), tr("Интеграции", "Integratsiyalar"), "API"] },
              { t: tr("Компания", "Kompaniya"), items: [tr("О нас", "Biz haqimizda"), tr("Контакты", "Kontaktlar"), tr("Блог", "Blog")] },
              { t: tr("Поддержка", "Qo'llab-quvvatlash"), items: [tr("Центр помощи", "Yordam markazi"), tr("Статус системы", "Tizim holati"), tr("Безопасность", "Xavfsizlik")] },
            ].map(col => (
              <div key={col.t}>
                <h4 className="text-[11px] font-medium uppercase tracking-widest mb-4" style={{ color: NEU.textMuted }}>{col.t}</h4>
                <ul className="space-y-2.5">
                  {col.items.map(item => (
                    <li key={item} className="text-[13px] cursor-pointer" style={{ color: NEU.textSecondary }}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="pt-7 flex flex-col md:flex-row justify-between items-center gap-4" style={{ borderTop: `0.5px solid ${NEU.border}` }}>
            <p className="text-[12px]" style={{ color: NEU.textMuted }}>
              &copy; 2026 Warehouse Pro. {tr("Все права защищены.", "Barcha huquqlar himoyalangan.")}
            </p>
            <div className="flex gap-6">
              {[tr("Политика конфиденциальности", "Maxfiylik siyosati"), tr("Условия использования", "Foydalanish shartlari")].map(s => (
                <span key={s} className="text-[12px] cursor-pointer" style={{ color: NEU.textMuted }}>{s}</span>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
