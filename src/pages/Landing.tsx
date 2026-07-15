import { useNavigate } from "react-router";
import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslate } from "@/i18n";
import {
  Warehouse, Truck, BarChart3, Users, Shield, Smartphone,
  CheckCircle2, ArrowRight, Star, Play,
  TrendingUp, Package, MapPin, Clock, Rocket,
  Target, Eye, Layers, FileText,
  ArrowUpRight, Boxes, Route, Quote,
  Zap, Globe, Headphones, Sparkles, Menu, X,
} from "lucide-react";
import { FadeIn, Stagger, Counter, MagneticButton, GlowCard, TiltCard, ParticleField, MeshGradient, WaveTop, WaveBottom, Accordion, AnimatedBox, Typewriter, LiveStatsTicker, FloatingNotification, OrbitalDots } from "@/components/landing";

const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN LANDING COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function Landing() {
  const navigate = useNavigate();
  const tr = useTranslate();
  const [scrollY, setScrollY] = useState(0);
  const [activeTab, setActiveTab] = useState(0);
  const [activeTestimonial, setActiveTestimonial] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const h = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setActiveTab((p) => (p + 1) % 4), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setActiveTestimonial((p) => (p + 1) % 3), 6000);
    return () => clearInterval(t);
  }, []);

  const navLinks = useMemo(() => [
    { label: tr("Продукт", "Mahsulot"), href: "#features" },
    { label: tr("Как работает", "Qanday ishlaydi"), href: "#how" },
    { label: tr("Решения", "Yechimlar"), href: "#roles" },
    { label: tr("Отзывы", "Sharhlar"), href: "#testimonials" },
    { label: tr("Цены", "Narxlar"), href: "#pricing" },
  ], []);

  const features = useMemo(() => [
    { icon: Boxes, title: tr("Складской учёт", "Ombor hisobi"), desc: tr("Остатки, резервы, движения товаров. Контроль dead-stock в реальном времени.", "Qoldiqlar, zaxiralar, mahsulot harakatlari. Dead-stockni real vaqtda nazorat qiling."), stat: tr("19 таблиц", "19 jadval"), gradient: "from-violet-500 via-purple-500 to-indigo-600" },
    { icon: Route, title: tr("Доставка", "Yetkazib berish"), desc: tr("Назначение курьеров, GPS-трекинг, сбор наличных. Мобильное приложение.", "Kuryerlarni tayinlash, GPS kuzatuv, naqd pul yig'ish. Mobil ilova."), stat: "Real-time", gradient: "from-emerald-400 via-teal-500 to-cyan-600" },
    { icon: BarChart3, title: tr("Аналитика", "Tahlil"), desc: tr("Dashboard с KPI, отчёты по продажам, P&L, задолженности.", "KPI bilan boshqaruv paneli, sotish hisobotlari, P&L, qarzlar."), stat: tr("20+ отчётов", "20+ hisobot"), gradient: "from-amber-400 via-orange-500 to-red-500" },
    { icon: Users, title: tr("Команда", "Jamoa"), desc: tr("6 ролей с правами доступа: от директора до курьера.", "6 ta rol kirish huquqlari bilan: direktordan kuryergacha."), stat: tr("6 ролей", "6 ta rol"), gradient: "from-cyan-400 via-blue-500 to-indigo-600" },
    { icon: Smartphone, title: tr("Мобильное приложение", "Mobil ilova"), desc: tr("React Native с офлайн-режимом, камерой, GPS и хаптикой.", "React Native oflayn-rejim, kamera, GPS va haptika bilan."), stat: "iOS + Android", gradient: "from-pink-400 via-rose-500 to-red-500" },
    { icon: Shield, title: tr("Безопасность", "Xavfsizlik"), desc: tr("Мультитенантность, JWT, rate limiting, tenant-изоляция.", "Multi-tenant, JWT, rate limiting, tenant-izolyatsiya."), stat: "Enterprise", gradient: "from-red-400 via-orange-500 to-amber-500" },
  ], []);

  const roles = useMemo(() => [
    { role: tr("Директор", "Direktor"), icon: TrendingUp, color: "violet", features: [tr("Dashboard с KPI", "KPI bilan boshqaruv paneli"), tr("Финансовые отчёты", "Moliyaviy hisobotlar"), tr("Управление пользователями", "Foydalanuvchilarni boshqarish"), tr("Настройки биллинга", "To'lov sozlamalari")] },
    { role: tr("Оператор", "Operator"), icon: Package, color: "cyan", features: [tr("Управление заказами", "Buyurtmalarni boshqarish"), tr("Назначение курьеров", "Kuryerlarni tayinlash"), tr("Контроль склада", "Omborni nazorat qilish"), tr("Работа с 1C", "1C bilan ishlash")] },
    { role: tr("Агент", "Agent"), icon: MapPin, color: "emerald", features: [tr("Создание заказов", "Buyurtmalar yaratish"), tr("План визитов", "Tashrif rejası"), tr("GPS-трекинг", "GPS kuzatuv"), tr("Офлайн-режим", "Oflayn-rejim")] },
    { role: tr("Супервайзер", "Supervisor"), icon: Eye, color: "amber", features: [tr("Мониторинг агентов", "Agentlarni monitoring qilish"), tr("Управление планами", "Rejalarni boshqarish"), tr("Отчёты по визитам", "Tashriflar hisobotlari"), tr("Трекинг в реальном времени", "Real vaqtda kuzatuv")] },
    { role: tr("Мерчандайзер", "Merchandayzer"), icon: FileText, color: "pink", features: [tr("Отчёты о визитах", "Tashriflar hisobotlari"), tr("Фото-фиксация", "Rasmga olish"), tr("Чек-лист товаров", "Mahsulotlar chek-listi"), tr("Заметки о конкурентах", "Raqobatchilar haqida eslatmalar")] },
    { role: tr("Курьер", "Kuryer"), icon: Truck, color: "orange", features: [tr("Список доставок", "Yetkazib berish ro'yxati"), tr("Навигация на карте", "Xaritada navigatsiya"), tr("Сбор наличных", "Naqd pul yig'ish"), tr("GPS-трекинг", "GPS kuzatuv")] },
  ], []);

  const testimonials = useMemo(() => [
    { name: "Акбар Расулов", role: "Директор, LogiMax", text: tr("Warehouse Pro полностью изменил наш подход к дистрибуции. Агенты работают эффективнее, а я вижу всё в реальном времени. Раньше тратил часы на отчёты, теперь всё автоматически.", "Warehouse Pro distribyutsiya yondashuvimizni butunlay o'zgartirdi. Agentlar samaraliroq ishlaydi, men hammasini real vaqtda ko'raman. Oldin hisobotlar uchun soatlab vaqt sarflardim, endi hammasi avtomatik."), rating: 5, avatar: "АР" },
    { name: "Дилшод Камолдинов", role: "Оператор, TradeHub", text: tr("Раньше все заказы велись в Excel. Теперь всё автоматизировано. Ошибок стало в 10 раз меньше, а скорость обработки заказов выросла втрое. Команда в восторге.", "Oldin barcha buyurtmalar Excel da olib borilardi. Endi hammasi avtomatlashtirilgan. Xatolar 10 marta kamaydi, buyurtmalarni qayta ishlash tezligi 3 barobar o'sdi. Jamoa xursand."), rating: 5, avatar: "ДК" },
    { name: "Шерзод Абдуллаев", role: "Курьер, SupplyPro", text: tr("Мобильное приложение очень удобное. Офлайн-режим работает идеально — можно принимать заказы даже без интернета. GPS-трекинг помогает оптимизировать маршруты.", "Mobil ilova juda qulay. Oflayn-rejim ajoyib ishlaydi — internetmasdan ham buyurtmalarni qabul qilish mumkin. GPS-kuzatuv marshrutlarni optimallashtirishga yordam beradi."), rating: 5, avatar: "ША" },
  ], []);

  const faqItems = useMemo(() => [
    { q: tr("Сколько времени занимает настройка?", "Sozlash qancha vaqt oladi?"), a: tr("Базовая настройка занимает 5-10 минут. Вы регистрируетесь, добавляете компанию и товары, приглашаете команду — и система готова к работе. Для сложных интеграций с 1С мы предоставляем бесплатную помощь.", "Asosiy sozlash 5-10 daqiqa oladi. Siz ro'yxatdan o'tasiz, kompaniya va mahsulotlarni qo'shasiz, jamoani taklif qilasiz — va tizim ishlashga tayyor. 1C bilan murakkab integratsiyalar uchun biz bepul yordam beramiz.") },
    { q: tr("Можно ли интегрировать с 1С:Предприятие?", "1C:Predpriyatiye bilan integratsiya qilish mumkinmi?"), a: tr("Да, Warehouse Pro поддерживает двустороннюю синхронизацию с 1С:Предприятие. Товары, заказы, остатки и документы автоматически синхронизируются между системами.", "Ha, Warehouse Pro 1C:Predpriyatiye bilan ikki tomonlama sinxronlashtirishni qo'llab-quvvatlaydi. Mahsulotlar, buyurtmalar, qoldiqlar va hujjatlar tizimlar o'rtasida avtomatik sinxronlashtiriladi.") },
    { q: tr("Как работает мобильное приложение?", "Mobil ilova qanday ishlaydi?"), a: tr("Мобильное приложение построено на React Native и работает на iOS и Android. Оно поддерживает офлайн-режим, GPS-трекинг, камеру для фото-фиксации и push-уведомления.", "Mobil ilova React Native asosida qurilgan va iOS va Android da ishlaydi. U oflayn-rejim, GPS kuzatuv, rasmga olish uchun kamera va push-bildirishnomalarni qo'llab-quvvatlaydi.") },
    { q: tr("Безопасны ли мои данные?", "Ma'lumotlarim xavfsizmi?"), a: tr("Да, мы используем JWT-аутентификацию, шифрование данных, tenant-изоляцию и регулярные бэкапы. Все данные хранятся на защищённых серверах с сертификатами безопасности.", "Ha, biz JWT-autentifikatsiya, ma'lumotlarni shifrlash, tenant-izolyatsiya va muntazam zaxiralardan foydalanamiz. Barcha ma'lumotlar xavfsizlik sertifikatlari bilan himoyalangan serverlarda saqlanadi.") },
    { q: tr("Есть ли бесплатный период?", "Bepul davr bormi?"), a: tr("Да, вы можете бесплатно пользоваться системой 14 дней без ограничений. Привязка карты не требуется. После окончания пробного периода вы можете выбрать подходящий тариф.", "Ha, siz tizimdan 14 kun cheksiz bepul foydalanishingiz mumkin. Kartani bog'lash shart emas. Sinov muddati tugagandan keyin mos tarifni tanlashingiz mumkin.") },
    { q: tr("Какая поддержка предоставляется?", "Qanday qo'llab-quvvatlash beriladi?"), a: tr("Для Basic — email-поддержка в рабочие дни. Для Pro — приоритетная поддержка и персональный менеджер. Для Exclusive — круглосуточная поддержка 24/7 и выделенный сервер.", "Basic uchun — ish kunlari email-qo'llab-quvvatlash. Pro uchun — ustuvor qo'llab-quvvatlash va shaxsiy menejer. Exclusive uchun — 24/7 doimiy qo'llab-quvvatlash va ajratilgan server.") },
  ], []);

  return (
    <div className="min-h-screen bg-[#fafafa] text-gray-900 selection:bg-violet-200 selection:text-violet-900 overflow-x-hidden">
      <MeshGradient />
      <ParticleField />
      <FloatingNotification />

      {/* ── Scroll Progress ── */}
      <ScrollProgress />

      {/* ── Nav ── */}
      <nav className={cn(
        "fixed top-0 inset-x-0 z-50 transition-all duration-700",
        scrollY > 20 ? "bg-white/70 backdrop-blur-2xl border-b border-gray-200/30 shadow-[0_1px_3px_rgba(0,0,0,0.02)]" : "bg-transparent"
      )}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 via-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
              <Warehouse size={16} color="#fff" strokeWidth={2.5} />
            </div>
            <span className="font-bold tracking-tight text-[15px]">Warehouse Pro</span>
          </div>

          <div className="hidden md:flex items-center gap-0.5">
            {navLinks.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="px-3.5 py-2 text-[13px] text-gray-500 hover:text-gray-900 rounded-lg hover:bg-gray-100/50 transition-all duration-200 font-medium"
              >
                {item.label}
              </a>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <button onClick={() => navigate("/login")} className="text-[13px] text-gray-500 hover:text-gray-900 transition-colors px-3 py-2 rounded-lg hover:bg-gray-100/50 font-medium">
              {tr("Войти", "Kirish")}
            </button>
            <MagneticButton
              onClick={() => navigate("/register")}
              className="h-9 px-5 bg-gray-900 text-white text-[13px] font-semibold rounded-xl hover:bg-gray-800 transition-all duration-300 shadow-sm hover:shadow-lg hover:shadow-gray-900/15"
            >
              {tr("Начать", "Boshlash")}
            </MagneticButton>
          </div>

          <button className="md:hidden p-2 rounded-lg hover:bg-gray-100/50" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Mobile menu */}
        <div className={cn("md:hidden transition-all duration-500 overflow-hidden", mobileMenuOpen ? "max-h-80 opacity-100" : "max-h-0 opacity-0")}>
          <div className="px-6 pb-6 space-y-1 bg-white/80 backdrop-blur-xl border-b border-gray-200/30">
            {navLinks.map((item) => (
              <a key={item.label} href={item.href} onClick={() => setMobileMenuOpen(false)} className="block px-3 py-2.5 text-sm text-gray-600 hover:text-gray-900 rounded-lg hover:bg-gray-50 transition-colors">
                {item.label}
              </a>
            ))}
            <div className="pt-2 flex gap-2">
              <button onClick={() => navigate("/login")} className="flex-1 h-10 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                {tr("Войти", "Kirish")}
              </button>
              <button onClick={() => navigate("/register")} className="flex-1 h-10 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors">
                {tr("Начать", "Boshlash")}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* ═══════════════ HERO ═══════════════ */}
      <section className="relative pt-36 pb-20 md:pt-48 md:pb-28">
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <FadeIn>
            <div className="text-center max-w-4xl mx-auto">
              {/* Badge */}
              <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full border border-gray-200/60 bg-white/60 backdrop-blur-sm text-xs text-gray-500 mb-8 shadow-sm hover:shadow-md transition-shadow duration-300 cursor-default">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                {tr("Версия 2.0 — Уже доступна", "Versiya 2.0 — Allaqachon mavjud")}
                <span className="w-px h-3 bg-gray-200" />
                <span className="text-violet-600 font-semibold bg-violet-50 px-2 py-0.5 rounded-full">{tr("Новое", "Yangi")}</span>
              </div>

              {/* Headline */}
              <h1 className="text-[2.6rem] md:text-[4rem] lg:text-[5rem] font-black tracking-[-0.04em] leading-[0.92] mb-6">
                <span className="block text-gray-900">{tr("Управление", "Boshqarish")}</span>
                <span className="block bg-gradient-to-r from-violet-600 via-purple-500 to-indigo-600 bg-clip-text text-transparent">
                  <Typewriter words={[tr("складом", "omboni"), tr("доставкой", "yetkazish"), tr("продажами", "sotish"), tr("командой", "jamoa")]} />
                </span>
              </h1>

              {/* Subtitle */}
              <p className="text-[17px] md:text-lg text-gray-500 mb-10 max-w-lg mx-auto leading-relaxed">
                {tr("Мультитенантная WMS для дистрибьюторских компаний.", "Multi-tenant WMS distribyutor kompaniyalari uchun.")}
                <br className="hidden md:block" />
                {tr("Заказы, склад, доставка — всё в одном приложении.", "Buyurtmalar, ombor, yetkazib berish — hammasi bitta ilovada.")}
              </p>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
                <MagneticButton
                  onClick={() => navigate("/register")}
                  className="group h-13 px-8 bg-gray-900 text-white rounded-2xl font-semibold text-[15px] hover:bg-gray-800 transition-all duration-300 flex items-center justify-center gap-2.5 shadow-xl shadow-gray-900/15 hover:shadow-2xl hover:shadow-gray-900/20 hover:-translate-y-0.5"
                >
                  {tr("Начать бесплатно", "Bepul boshlash")}
                  <ArrowRight size={17} className="group-hover:translate-x-1 transition-transform duration-300" />
                </MagneticButton>
                <button
                  onClick={() => setActiveTab(1)}
                  className="group h-13 px-8 border border-gray-200/80 rounded-2xl font-semibold text-[15px] text-gray-600 hover:bg-white hover:border-gray-300 transition-all duration-300 flex items-center justify-center gap-3 bg-white/50 backdrop-blur-sm hover:shadow-lg hover:-translate-y-0.5"
                >
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center group-hover:bg-violet-50 group-hover:scale-110 transition-all duration-300">
                    <Play size={13} className="fill-gray-500 group-hover:fill-violet-500 ml-0.5" />
                  </div>
                  {tr("Смотреть демо", "Demo ko'rish")}
                </button>
              </div>

              {/* Trust badges */}
              <div className="flex items-center justify-center gap-6 text-xs text-gray-400">
                <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-400" /> {tr("14 дней бесплатно", "14 kun bepul")}</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-400" /> {tr("Без привязки карты", "Kartani bog'lash shart emas")}</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-400" /> {tr("Настройка за 5 мин", "5 daqiqada sozlash")}</span>
              </div>
            </div>
          </FadeIn>

          {/* Live Stats */}
          <FadeIn delay={400}>
            <div className="mt-12">
              <LiveStatsTicker />
            </div>
          </FadeIn>

          {/* ── Product preview ── */}
          <FadeIn delay={300}>
            <div className="relative max-w-5xl mx-auto mt-16">
              {/* Glow behind */}
              <div className="absolute -inset-2 bg-gradient-to-r from-violet-300/30 via-indigo-300/20 to-cyan-300/30 rounded-3xl blur-3xl" />
              <TiltCard>
                <div className="relative rounded-2xl bg-white border border-gray-200/40 overflow-hidden shadow-2xl shadow-gray-900/[0.08]">
                  {/* Window chrome */}
                  <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100/80 bg-gradient-to-b from-gray-50/80 to-white/40">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-[#ff5f56] shadow-sm" />
                      <div className="w-3 h-3 rounded-full bg-[#ffbd2e] shadow-sm" />
                      <div className="w-3 h-3 rounded-full bg-[#27c93f] shadow-sm" />
                    </div>
                    <div className="flex-1 flex justify-center">
                      <div className="flex gap-0.5 bg-gray-100/60 rounded-xl p-0.5">
                        {["Dashboard", tr("Карта", "Xarita"), tr("Мобильное", "Mobil"), tr("Аналитика", "Tahlil")].map((tab, i) => (
                          <button
                            key={tab}
                            onClick={() => setActiveTab(i)}
                            className={cn(
                              "px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-400",
                              activeTab === i
                                ? "bg-white text-gray-900 shadow-md shadow-gray-900/5"
                                : "text-gray-400 hover:text-gray-600"
                            )}
                          >
                            {tab}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="w-16" />
                  </div>
                  {/* Content */}
                  <div className="p-5 min-h-[400px] bg-gradient-to-b from-white to-gray-50/30">
                    {activeTab === 0 && <DashboardPreview />}
                    {activeTab === 1 && <MapPreview />}
                    {activeTab === 2 && <MobilePreview />}
                    {activeTab === 3 && <AnalyticsPreview />}
                  </div>
                </div>
              </TiltCard>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── Social proof ── */}
      <section className="py-12 relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-center text-[10px] text-gray-400 uppercase tracking-[0.3em] mb-8 font-medium">{tr("Используют ведущие дистрибьюторы", "Yetakchi distribyutorlar foydalanadi")}</p>
          <div className="flex items-center justify-center gap-10 md:gap-20 flex-wrap">
            {["Distrubia", "LogiMax", "TradeHub", "SupplyPro", "StockFlow"].map((n) => (
              <div key={n} className="text-lg md:text-xl font-black tracking-tighter text-gray-200 hover:text-gray-400 transition-all duration-500 cursor-default select-none">
                {n}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ HOW IT WORKS ═══════════════ */}
      <section id="how" className="py-28 relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          <FadeIn>
            <div className="text-center max-w-2xl mx-auto mb-20">
              <div className="inline-flex items-center gap-2.5 text-emerald-600 text-xs font-bold tracking-widest uppercase mb-5 bg-emerald-50 px-4 py-1.5 rounded-full">
                <Zap size={14} /> {tr("Как работает", "Qanday ishlaydi")}
              </div>
              <h2 className="text-3xl md:text-[2.5rem] font-black tracking-tight leading-tight mb-5">
                {tr("Три шага до полного контроля", "To'liq nazoratga 3 qadam")}
              </h2>
              <p className="text-gray-500 text-lg leading-relaxed">{tr("Начните за 5 минут. Без установки, без сложной настройки.", "5 daqiqada boshlang. O'rnatish shart emas, murakkab sozlash kerak emas.")}</p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-8 relative">
            <div className="hidden md:block absolute top-20 left-[22%] right-[22%] h-px">
              <div className="w-full h-full bg-gradient-to-r from-transparent via-violet-300 to-transparent" />
            </div>

            {[
              { step: "01", title: tr("Регистрация", "Ro'yxatdan o'tish"), desc: tr("Создайте аккаунт за 30 секунд. Настройте компанию, добавьте склад и товары.", "30 sekundda akkaunt yarating. Kompaniyani sozlang, ombor va mahsulotlarni qo'shing."), icon: Zap, color: "violet", bg: "from-violet-500 to-purple-600" },
              { step: "02", title: tr("Настройка", "Sozlash"), desc: tr("Добавьте команду, назначьте роли, настройте интеграции с 1С и доставкой.", "Jamoa qo'shing, rollarni tayinlang, 1C va yetkazib berish integratsiyalarini sozlang."), icon: Settings, color: "indigo", bg: "from-indigo-500 to-blue-600" },
              { step: "03", title: tr("Работа", "Ish"), desc: tr("Агенты создают заказы, курьеры доставляют, директор видит всё в реальном времени.", "Agentlar buyurtmalar yaratadi, kuryerlar yetkazib beradi, direktor hammasini real vaqtda ko'radi."), icon: Rocket, color: "cyan", bg: "from-cyan-500 to-teal-600" },
            ].map((item, i) => (
              <FadeIn key={item.step} delay={i * 150}>
                <div className="relative text-center group">
                  <div className="relative inline-flex mb-8">
                    <div className={cn("w-16 h-16 rounded-2xl bg-gradient-to-br flex items-center justify-center relative z-10 shadow-xl transition-transform duration-500 group-hover:scale-110 group-hover:-rotate-3", item.bg)}>
                      <item.icon size={24} className="text-white" strokeWidth={2} />
                    </div>
                    <div className="absolute -top-2.5 -right-2.5 w-8 h-8 rounded-full bg-white border-2 border-gray-900 text-gray-900 text-xs font-black flex items-center justify-center shadow-lg z-20">
                      {item.step}
                    </div>
                  </div>
                  <h3 className="font-bold text-lg mb-2">{item.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed max-w-xs mx-auto">{item.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ FEATURES ═══════════════ */}
      <section id="features" className="py-28 relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          <FadeIn>
            <div className="max-w-2xl mb-16">
              <div className="inline-flex items-center gap-2.5 text-violet-600 text-xs font-bold tracking-widest uppercase mb-5 bg-violet-50 px-4 py-1.5 rounded-full">
                <Layers size={14} /> {tr("Продукт", "Mahsulot")}
              </div>
              <h2 className="text-3xl md:text-[2.5rem] font-black tracking-tight leading-tight mb-5">
                {tr("Всё что нужно", "Sizga kerakli hammasi")}
                <br />
                <span className="text-gray-300">{tr("для вашего бизнеса", "biznesingiz uchun")}</span>
              </h2>
              <p className="text-gray-500 text-lg leading-relaxed">{tr("От склада до доставки — полный контроль над процессами дистрибуции.", "Ombordan yetkazib berishgacha — distribyutsiya jarayonlarini to'liq nazorat qiling.")}</p>
            </div>
          </FadeIn>

          <Stagger className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f, i) => (
              <GlowCard key={f.title}>
                <div className="relative p-7 rounded-[1.25rem] border border-gray-200/40 bg-white hover:shadow-2xl hover:shadow-gray-900/[0.04] hover:border-gray-300/50 transition-all duration-500 h-full stagger-item">
                  <div className={cn("w-12 h-12 rounded-2xl bg-gradient-to-br flex items-center justify-center mb-5 shadow-lg transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3", f.gradient)}>
                    <f.icon size={20} className="text-white" strokeWidth={2} />
                  </div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-[15px]">{f.title}</h3>
                    <span className="text-[10px] text-gray-400 bg-gray-100/80 px-2.5 py-0.5 rounded-full font-semibold">{f.stat}</span>
                  </div>
                  <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
                  <ArrowUpRight size={13} className="absolute right-5 top-5 text-gray-200 group-hover:text-violet-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-300" />
                </div>
              </GlowCard>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ═══════════════ MAP FEATURE ═══════════════ */}
      <section id="map" className="py-28 relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <FadeIn>
              <div>
                <div className="inline-flex items-center gap-2.5 text-emerald-600 text-xs font-bold tracking-widest uppercase mb-5 bg-emerald-50 px-4 py-1.5 rounded-full">
                  <MapPin size={14} /> {tr("GPS-трекинг", "GPS kuzatuv")}
                </div>
                <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-5">
                  {tr("Отслеживайте агентов", "Agentlarni kuzating")}
                  <br />
                  <span className="text-gray-300">{tr("в реальном времени", "real vaqtda")}</span>
                </h2>
                <p className="text-gray-500 text-lg leading-relaxed mb-8">
                  {tr("GPS-трекинг всех агентов и курьеров на карте. История маршрутов, контроль посещений, оптимизация доставки.", "Barcha agentlar va kuryerlarni xaritada GPS kuzatuv. Marshrut tarixi, tashriflarni nazorat qilish, yetkazib berishni optimallashtirish.")}
                </p>
                <ul className="space-y-4">
                  {[
                    tr("Живая карта с позициями всех агентов", "Barcha agentlar pozitsiyalari bilan jonli xarita"),
                    tr("История маршрутов за день / неделю / месяц", "Kun/hafta/oy ichida marshrut tarixi"),
                    tr("Контроль посещения торговых точек", "Savdo nuqtalariga tashriflarni nazorat qilish"),
                    tr("Оптимизация маршрутов доставки", "Yetkazib berish marshrutlarini optimallashtirish"),
                    tr("Уведомления о выходе за пределы зоны", "Zonadan chiqish haqida bildirishnomalar"),
                  ].map((item, idx) => (
                    <li key={item} className="flex items-center gap-3 text-sm text-gray-600">
                      <div className="w-6 h-6 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 size={14} className="text-emerald-500" />
                      </div>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </FadeIn>

            <FadeIn delay={200} direction="right">
              <div className="relative">
                <div className="absolute -inset-4 bg-gradient-to-br from-emerald-200/30 via-teal-200/20 to-cyan-200/30 rounded-3xl blur-3xl" />
                <div className="relative bg-white rounded-2xl border border-gray-200/40 shadow-2xl shadow-gray-900/[0.06] overflow-hidden">
                  <MapPreview />
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══════════════ STATS ═══════════════ */}
      <section className="py-20 relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          <FadeIn>
            <div className="bg-white rounded-3xl border border-gray-200/40 shadow-xl shadow-gray-900/[0.03] p-12">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-12">
                {[
                  { v: 500, s: "+", l: tr("Компаний", "Kompaniyalar"), color: "text-violet-600" },
                  { v: 10000, s: "+", l: tr("Заказов в день", "Buyurtmalar kuniga"), color: "text-emerald-600" },
                  { v: 99, s: ".9%", l: "Uptime", color: "text-amber-600" },
                  { v: 24, s: "/7", l: tr("Поддержка", "Qo'llab-quvvatlash"), color: "text-cyan-600" },
                ].map((stat) => (
                  <div key={stat.l} className="text-center">
                    <p className={cn("text-4xl md:text-5xl font-black tracking-tight mb-2", stat.color)}>
                      <Counter target={stat.v} />{stat.s}
                    </p>
                    <p className="text-sm text-gray-400 font-semibold">{stat.l}</p>
                  </div>
                ))}
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══════════════ ROLES ═══════════════ */}
      <section id="roles" className="py-28 relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          <FadeIn>
            <div className="max-w-2xl mb-16">
              <div className="inline-flex items-center gap-2.5 text-emerald-600 text-xs font-bold tracking-widest uppercase mb-5 bg-emerald-50 px-4 py-1.5 rounded-full">
                <Users size={14} /> {tr("Решения", "Yechimlar")}
              </div>
              <h2 className="text-3xl md:text-[2.5rem] font-black tracking-tight leading-tight mb-5">
                {tr("Для каждой", "Har bir")}
                <br />
                <span className="text-gray-300">{tr("роли в команде", "jamoa a'zosi uchun")}</span>
              </h2>
              <p className="text-gray-500 text-lg leading-relaxed">{tr("Каждый сотрудник видит только то, что ему нужно.", "Har bir xodim faqat o'ziga kerakli narsalarni ko'radi.")}</p>
            </div>
          </FadeIn>

          <Stagger className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roles.map((r) => (
              <div key={r.role} className="stagger-item">
                <div className="group p-6 rounded-2xl border border-gray-200/40 bg-white hover:shadow-2xl hover:shadow-gray-900/[0.04] hover:border-gray-300/50 transition-all duration-500 h-full">
                  <div className={cn("w-11 h-11 rounded-xl bg-gradient-to-br flex items-center justify-center mb-4 transition-all duration-500 group-hover:scale-110 group-hover:-rotate-6", getRoleGradient(r.color))}>
                    <r.icon size={19} className="text-white" strokeWidth={2} />
                  </div>
                  <h3 className="font-bold text-[15px] mb-3">{r.role}</h3>
                  <ul className="space-y-2.5">
                    {r.features.map((f) => (
                      <li key={f} className="flex items-center gap-2.5 text-sm text-gray-500">
                        <CheckCircle2 size={13} className="text-gray-300 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ═══════════════ INTEGRATIONS ═══════════════ */}
      <section className="py-24 relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          <FadeIn>
            <div className="text-center mb-14">
              <div className="inline-flex items-center gap-2.5 text-amber-600 text-xs font-bold tracking-widest uppercase mb-5 bg-amber-50 px-4 py-1.5 rounded-full">
                <Target size={14} /> {tr("Интеграции", "Integratsiyalar")}
              </div>
              <h2 className="text-3xl md:text-4xl font-black tracking-tight">
                {tr("Работает с вашими инструментами", "Sizning vositalaringiz bilan ishlaydi")}
              </h2>
            </div>
          </FadeIn>

          <Stagger className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { name: "1С:Предприятие", icon: "1C", desc: tr("Синхронизация данных", "Ma'lumotlarni sinxronlashtirish"), color: "hover:text-violet-600 hover:bg-violet-50" },
              { name: "Stripe", icon: "S", desc: tr("Безопасные платежи", "Xavfsiz to'lovlar"), color: "hover:text-indigo-600 hover:bg-indigo-50" },
              { name: "Telegram", icon: "T", desc: tr("Уведомления", "Bildirishnomalar"), color: "hover:text-cyan-600 hover:bg-cyan-50" },
              { name: "AWS S3", icon: "A", desc: tr("Хранилище файлов", "Fayllar xotirasi"), color: "hover:text-amber-600 hover:bg-amber-50" },
            ].map((item) => (
              <div key={item.name} className="stagger-item">
                <div className={cn("group p-6 rounded-2xl border border-gray-200/40 bg-white hover:shadow-xl hover:shadow-gray-900/[0.04] hover:border-gray-300/50 transition-all duration-500 text-center", item.color)}>
                  <div className={cn("w-14 h-14 rounded-2xl bg-gray-50 flex items-center justify-center text-xl font-black mx-auto mb-4 transition-all duration-500 group-hover:scale-125 group-hover:rotate-6", item.color)}>
                    {item.icon}
                  </div>
                  <p className="font-bold text-sm mb-1">{item.name}</p>
                  <p className="text-xs text-gray-400">{item.desc}</p>
                </div>
              </div>
            ))}
          </Stagger>
        </div>
      </section>

      {/* ═══════════════ TESTIMONIALS ═══════════════ */}
      <section id="testimonials" className="py-28 relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          <FadeIn>
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2.5 text-violet-600 text-xs font-bold tracking-widest uppercase mb-5 bg-violet-50 px-4 py-1.5 rounded-full">
                <Quote size={14} /> {tr("Отзывы", "Sharhlar")}
              </div>
              <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-4">{tr("Нам доверяют", "Bizga ishonadi")}</h2>
              <p className="text-gray-500 text-lg">{tr("Что говорят наши клиенты", "Mijozlarimiz nima deydi")}</p>
            </div>
          </FadeIn>

          <Stagger className="grid md:grid-cols-3 gap-5">
            {testimonials.map((t, i) => (
              <div key={t.name} className="stagger-item">
                <div className={cn(
                  "relative p-7 rounded-2xl border transition-all duration-500 h-full overflow-hidden",
                  activeTestimonial === i
                    ? "border-violet-200 bg-gradient-to-br from-violet-50/50 to-white shadow-xl shadow-violet-500/10"
                    : "border-gray-200/40 bg-white hover:border-gray-300/50 hover:shadow-lg"
                )}>
                  {/* Decorative quote */}
                  <Quote size={40} className="absolute top-4 right-4 text-violet-100" />

                  <div className="flex gap-0.5 mb-5">
                    {Array.from({ length: t.rating }).map((_, j) => (
                      <Star key={j} size={14} className="fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed mb-6 relative z-10">"{t.text}"</p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold shadow-lg shadow-violet-500/20">
                      {t.avatar}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900">{t.name}</p>
                      <p className="text-xs text-gray-400">{t.role}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </Stagger>

          <div className="flex justify-center gap-2 mt-10">
            {[0, 1, 2].map((i) => (
              <button
                key={i}
                onClick={() => setActiveTestimonial(i)}
                className={cn(
                  "h-2 rounded-full transition-all duration-500",
                  activeTestimonial === i ? "bg-violet-500 w-8" : "bg-gray-200 hover:bg-gray-300 w-2"
                )}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ PRICING ═══════════════ */}
      <section id="pricing" className="py-28 relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          <FadeIn>
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2.5 text-violet-600 text-xs font-bold tracking-widest uppercase mb-5 bg-violet-50 px-4 py-1.5 rounded-full">
                <Star size={14} /> {tr("Тарифы", "Tariflar")}
              </div>
              <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-4">{tr("Прозрачные цены", "Shaffof narxlar")}</h2>
              <p className="text-gray-500 text-lg">{tr("Начните бесплатно, растите с бизнесом.", "Bepul boshlang, biznesingiz bilan o'sing.")}</p>
            </div>
          </FadeIn>

          {/* Trial notice */}
          <div className="text-center mb-8">
            <p className="text-sm text-gray-500">{tr("Все тарифы включают", "Barcha tariflarga kiradi")} <span className="font-semibold text-violet-600">{tr("14 дней бесплатно", "14 kun bepul")}</span> {tr("без привязки карты", "karta bog'lash shart emas")}</p>
          </div>

          <div className="grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {[
              {
                name: "Basic",
                price: "299 000",
                period: tr("сум/мес", "so'm/oy"),
                features: [
                  tr("До 5 пользователей", "5 tagacha foydalanuvchi"),
                  tr("До 50 товаров", "50 tagacha mahsulot"),
                  tr("Управление складом", "Omborni boshqarish"),
                  tr("Базовая аналитика (остатки, движения)", "Asosiy tahlil (qoldiqlar, harakatlar)"),
                  tr("Создание и обработка заказов", "Buyurtmalar yaratish va qayta ishlash"),
                  tr("Мобильное приложение для агентов", "Agentlar uchun mobil ilova"),
                  tr("Списки товаров и магазинов", "Mahsulotlar va do'konlar ro'yxati"),
                  tr("Email-поддержка", "Email-qo'llab-quvvatlash"),
                ],
                hl: false,
              },
              {
                name: "Pro",
                price: "599 000",
                period: tr("сум/мес", "so'm/oy"),
                features: [
                  tr("До 20 пользователей", "20 tagacha foydalanuvchi"),
                  tr("До 100 товаров", "100 tagacha mahsulot"),
                  tr("Всё из Basic", "Basic dagi hammasi"),
                  tr("Полная аналитика (20+ отчётов, графики, P&L)", "To'liq tahlil (20+ hisobot, grafiklar, P&L)"),
                  tr("GPS-трекинг агентов и курьеров", "Agentlar va kuryerlarning GPS kuzatuvi"),
                  tr("Интеграция с 1С:Предприятие", "1C:Predpriyatiye bilan integratsiya"),
                  tr("Управление доставкой и курьерами", "Yetkazib berish va kuryerlarni boshqarish"),
                  tr("Аудит-лог действий", "Amallar audit jurnali"),
                  tr("Приоритетная поддержка", "Ustuvor qo'llab-quvvatlash"),
                ],
                hl: true,
              },
              {
                name: "Exclusive",
                price: "1 299 000",
                period: tr("сум/мес", "so'm/oy"),
                features: [
                  tr("Без ограничений по пользователям", "Foydalanuvchilar bo'yicha cheksiz"),
                  tr("Без ограничений по товарам", "Mahsulotlar bo'yicha cheksiz"),
                  tr("Всё из Pro", "Pro dagi hammasi"),
                  tr("API доступ для интеграций", "Integratsiyalar uchun API kirish"),
                  tr("White-label (ваш бренд)", "White-label (sizning brendingiz)"),
                  tr("Система мониторинга сервера", "Server monitoring tizimi"),
                  tr("Персональный менеджер", "Shaxsiy menejer"),
                  tr("Выделенный сервер", "Ajratilgan server"),
                  tr("Круглосуточная поддержка 24/7", "24/7 doimiy qo'llab-quvvatlash"),
                ],
                hl: false,
              },
            ].map((plan, i) => (
              <FadeIn key={plan.name} delay={i * 100}>
                <div className={cn(
                  "relative p-7 rounded-2xl border transition-all duration-500 h-full flex flex-col",
                  plan.hl
                    ? "border-violet-200 bg-gradient-to-b from-violet-50/60 to-white shadow-2xl shadow-violet-500/10 scale-[1.03]"
                    : "border-gray-200/40 bg-white hover:shadow-xl hover:shadow-gray-900/[0.04] hover:border-gray-300/50"
                )}>
                  {plan.hl && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 px-5 py-1.5 bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-500 rounded-full text-[10px] font-bold text-white tracking-widest shadow-lg shadow-violet-500/30 uppercase">
                      {tr("Популярный", "Mashhur")}
                    </div>
                  )}
                  <h3 className="text-lg font-bold mb-1">{plan.name}</h3>
                  <div className="mb-7 mt-3">
                    <span className="text-5xl font-black tracking-tight">{plan.price}</span>
                    <span className="text-gray-400 text-sm ml-2">{plan.period}</span>
                  </div>
                  <ul className="space-y-3 mb-7 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-center gap-2.5 text-sm text-gray-600">
                        <CheckCircle2 size={14} className="text-gray-300 flex-shrink-0" />{f}
                      </li>
                    ))}
                  </ul>
                  <MagneticButton
                    onClick={() => navigate("/register")}
                    className={cn(
                      "w-full h-12 rounded-xl font-semibold text-sm transition-all duration-300",
                      plan.hl
                        ? "bg-gray-900 text-white hover:bg-gray-800 shadow-lg shadow-gray-900/15 hover:shadow-xl hover:shadow-gray-900/20"
                        : "bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300"
                    )}
                  >
                    {tr("Начать", "Boshlash")}
                  </MagneticButton>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════ FAQ ═══════════════ */}
      <section className="py-28 relative z-10">
        <div className="max-w-3xl mx-auto px-6">
          <FadeIn>
            <div className="text-center mb-14">
              <div className="inline-flex items-center gap-2.5 text-cyan-600 text-xs font-bold tracking-widest uppercase mb-5 bg-cyan-50 px-4 py-1.5 rounded-full">
                <Headphones size={14} /> FAQ
              </div>
              <h2 className="text-3xl md:text-4xl font-black tracking-tight">{tr("Частые вопросы", "Ko'p beriladigan savollar")}</h2>
            </div>
          </FadeIn>
          <FadeIn delay={100}>
            <Accordion items={faqItems} />
          </FadeIn>
        </div>
      </section>

      {/* ═══════════════ CTA ═══════════════ */}
      <section className="py-28 relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          <FadeIn>
            <div className="relative rounded-3xl overflow-hidden">
              {/* Background */}
              <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-900 to-violet-950" />
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(167,139,250,0.15),transparent_50%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(6,182,212,0.1),transparent_50%)]" />
              {/* Decorative elements */}
              <div className="absolute top-0 right-0 w-96 h-96 bg-violet-600/10 rounded-full blur-[100px]" />
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-cyan-600/10 rounded-full blur-[80px]" />
              {/* Grid pattern */}
              <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

              <div className="relative px-8 py-20 md:px-16 md:py-24 text-center">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5 text-xs text-gray-400 mb-8 backdrop-blur-sm">
                  <Sparkles size={14} className="text-violet-400" /> {tr("Присоединяйтесь к 500+ компаниям", "500+ kompaniyaga qo'shiling")}
                </div>
                <h2 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-5">{tr("Готовы начать?", "Boshlashga tayyormisiz?")}</h2>
                <p className="text-gray-400 text-lg mb-10 max-w-md mx-auto leading-relaxed">{tr("14 дней бесплатно. Без привязки карты. Настройка за 5 минут.", "14 kun bepul. Kartani bog'lash shart emas. 5 daqiqada sozlash.")}</p>
                <MagneticButton
                  onClick={() => navigate("/register")}
                  className="h-14 px-12 bg-white text-gray-900 rounded-2xl font-bold text-[15px] hover:bg-gray-100 transition-all duration-300 inline-flex items-center gap-3 shadow-2xl shadow-white/10 hover:shadow-white/15 hover:-translate-y-0.5"
                >
                  {tr("Начать бесплатно", "Bepul boshlash")} <ArrowRight size={18} />
                </MagneticButton>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ═══════════════ FOOTER ═══════════════ */}
      <footer className="pt-16 pb-10 relative z-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-5 gap-10 mb-12">
            <div className="md:col-span-2">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 via-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                  <Warehouse size={15} color="#fff" strokeWidth={2.5} />
                </div>
                <span className="font-bold text-base">Warehouse Pro</span>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed max-w-xs mb-6">{tr("Современная WMS для дистрибьюторов. Управляйте складом, заказами и доставкой из одного приложения.", "Distribyutorlar uchun zamonaviy WMS. Ombor, buyurtmalar va yetkazib berishni bitta ilovadan boshqaring.")}</p>
              <div className="flex gap-3">
                {["Twitter", "GitHub", "Discord"].map((s) => (
                  <span key={s} className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-200 cursor-pointer transition-all duration-200 font-medium">
                    {s[0]}
                  </span>
                ))}
              </div>
            </div>
            {[
              { t: tr("Продукт", "Mahsulot"), items: [tr("Возможности", "Imkoniyatlar"), tr("Тарифы", "Tariflar"), tr("Интеграции", "Integratsiyalar"), "API", tr("Документация", "Hujjatlar")] },
              { t: tr("Компания", "Kompaniya"), items: [tr("О нас", "Biz haqimizda"), tr("Контакты", "Kontaktlar"), tr("Блог", "Blog"), tr("Вакансии", "Bo'sh o'rinlar")] },
              { t: tr("Поддержка", "Qo'llab-quvvatlash"), items: [tr("Центр помощи", "Yordam markazi"), tr("Статус системы", "Tizim holati"), tr("Безопасность", "Xavfsizlik"), tr("Контакты", "Kontaktlar")] },
            ].map((col) => (
              <div key={col.t}>
                <h4 className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-5">{col.t}</h4>
                <ul className="space-y-3">
                  {col.items.map((item) => (
                    <li key={item} className="text-sm text-gray-500 hover:text-gray-900 cursor-pointer transition-colors duration-200">{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="pt-8 border-t border-gray-200/40 flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-xs text-gray-400">&copy; 2026 Warehouse Pro. {tr("Все права защищены.", "Barcha huquqlar himoyalangan.")}</p>
            <div className="flex gap-6">
              {[tr("Политика конфиденциальности", "Maxfiylik siyosati"), tr("Условия использования", "Foydalanish shartlari")].map((s) => (
                <span key={s} className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer transition-colors duration-200">{s}</span>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCROLL PROGRESS BAR
// ═══════════════════════════════════════════════════════════════════════════════

function ScrollProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const h = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(docHeight > 0 ? (scrollTop / docHeight) * 100 : 0);
    };
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);
  return (
    <div className="fixed top-0 left-0 right-0 z-[60] h-[2px]">
      <div
        className="h-full bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-500 transition-all duration-150"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROLE GRADIENT HELPER
// ═══════════════════════════════════════════════════════════════════════════════

function getRoleGradient(color: string): string {
  const map: Record<string, string> = {
    violet: "from-violet-500 to-purple-600",
    cyan: "from-cyan-500 to-blue-600",
    emerald: "from-emerald-500 to-teal-600",
    amber: "from-amber-500 to-orange-600",
    pink: "from-pink-500 to-rose-600",
    orange: "from-orange-500 to-red-600",
  };
  return map[color] || "from-gray-500 to-gray-600";
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS ICON
// ═══════════════════════════════════════════════════════════════════════════════

function Settings({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PREVIEW COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function DashboardPreview() {
  const tr = useTranslate();
  return (
    <div className="space-y-3 animate-fade-in">
      <div className="grid grid-cols-4 gap-2.5">
        {[
          { l: tr("Заказы", "Buyurtmalar"), v: "1,247", c: "+12.5%", color: "text-emerald-600", icon: Package },
          { l: tr("Выручка", "Tushum"), v: "89.5M", c: "+8.3%", color: "text-emerald-600", icon: TrendingUp },
          { l: tr("Товары", "Mahsulotlar"), v: "3,421", c: "+5.1%", color: "text-emerald-600", icon: Boxes },
          { l: tr("Агенты", "Agentlar"), v: "24", c: tr("онлайн", "onlayn"), color: "text-blue-600", icon: Users },
        ].map((s) => (
          <div key={s.l} className="p-3.5 rounded-xl bg-gradient-to-br from-gray-50/80 to-white border border-gray-200/30 hover:border-gray-300/50 transition-colors duration-300">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold">{s.l}</div>
              <s.icon size={12} className="text-gray-300" />
            </div>
            <div className="text-xl font-black tracking-tight text-gray-900">{s.v}</div>
            <div className={cn("text-[10px] mt-1 font-semibold", s.color)}>{s.c}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <div className="col-span-2 p-4 rounded-xl bg-gradient-to-br from-gray-50/80 to-white border border-gray-200/30">
          <div className="text-[9px] text-gray-400 uppercase tracking-wider mb-3 font-semibold">{tr("Продажи за месяц", "Oylik sotish")}</div>
          <div className="h-32 flex items-end gap-1">
            {[35, 55, 40, 70, 50, 85, 65, 80, 55, 90, 70, 88].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t transition-all duration-700 hover:opacity-100"
                style={{
                  height: `${h}%`,
                  background: `linear-gradient(to top, rgba(167,139,250,${i === 11 ? 0.8 : 0.2}), rgba(75,108,246,${i === 11 ? 0.5 : 0.05}))`,
                }}
              />
            ))}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-gradient-to-br from-gray-50/80 to-white border border-gray-200/30">
          <div className="text-[9px] text-gray-400 uppercase tracking-wider mb-3 font-semibold">{tr("Статусы", "Holatlar")}</div>
          <div className="space-y-3">
            {[{ l: tr("Новые", "Yangi"), v: 23, c: "#c7c9f8" }, { l: tr("В работе", "Jarayonda"), v: 15, c: "#e8a830" }, { l: tr("Выполнены", "Bajarildi"), v: 89, c: "#34c473" }].map((s) => (
              <div key={s.l}>
                <div className="flex justify-between text-[11px] mb-1">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ background: s.c }} />
                    <span className="text-gray-500">{s.l}</span>
                  </div>
                  <span className="font-bold text-gray-900">{s.v}</span>
                </div>
                <div className="h-1.5 bg-gray-200/40 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${s.v}%`, background: s.c }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MapPreview() {
  const tr = useTranslate();
  return (
    <div className="h-[360px] rounded-xl relative overflow-hidden border border-gray-200/30 bg-[#e8e4df]">
      {/* Map background */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #d4cfc7 0%, #e8e4df 25%, #d9d5cd 50%, #e0dbd3 75%, #cec9c1 100%)" }} />
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 600 360" preserveAspectRatio="none">
        <path d="M0,180 L600,180" stroke="#fff" strokeWidth="7" fill="none" opacity="0.85" />
        <path d="M300,0 L300,360" stroke="#fff" strokeWidth="7" fill="none" opacity="0.85" />
        <path d="M0,90 L600,90" stroke="#fff" strokeWidth="3" fill="none" opacity="0.55" />
        <path d="M0,270 L600,270" stroke="#fff" strokeWidth="3" fill="none" opacity="0.55" />
        <path d="M150,0 L150,360" stroke="#fff" strokeWidth="3" fill="none" opacity="0.55" />
        <path d="M450,0 L450,360" stroke="#fff" strokeWidth="3" fill="none" opacity="0.55" />
        <rect x="85" y="55" width="50" height="28" rx="2" fill="var(--color-text-tertiary, #98a0b8)" opacity="0.45" />
        <rect x="160" y="55" width="35" height="24" rx="2" fill="var(--color-text-tertiary, #98a0b8)" opacity="0.45" />
        <rect x="310" y="55" width="45" height="26" rx="2" fill="var(--color-text-tertiary, #98a0b8)" opacity="0.45" />
        <rect x="85" y="195" width="45" height="30" rx="2" fill="var(--color-text-tertiary, #98a0b8)" opacity="0.45" />
        <rect x="310" y="195" width="50" height="28" rx="2" fill="var(--color-text-tertiary, #98a0b8)" opacity="0.45" />
        <rect x="460" y="100" width="70" height="50" rx="8" fill="rgba(74,222,128,.10)" opacity="0.4" />
        <rect x="60" y="290" width="60" height="40" rx="8" fill="rgba(74,222,128,.10)" opacity="0.4" />
        <ellipse cx="520" cy="290" rx="45" ry="25" fill="#60a5fa" opacity="0.3" />
      </svg>
      {/* Route */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 600 360">
        <defs>
          <linearGradient id="routeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#c7c9f8" />
            <stop offset="100%" stopColor="#60a5fa" />
          </linearGradient>
        </defs>
        <path d="M140,120 L180,120 L180,160 L260,160 L260,200 L320,200 L320,160 L380,160 L380,220 L320,220 L320,280 L260,280"
          stroke="url(#routeGrad)" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
        <path d="M140,120 L180,120 L180,160 L260,160 L260,200 L320,200 L320,160 L380,160 L380,220 L320,220 L320,280 L260,280"
          stroke="url(#routeGrad)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="8 4" opacity="0.4" />
      </svg>
      {/* Agents */}
      {[
        { x: 140, y: 120, name: "А. Каримов", status: "online", speed: "45 км/ч" },
        { x: 320, y: 160, name: "Б. Турсунов", status: "online", speed: "32 км/ч" },
        { x: 380, y: 220, name: "В. Назаров", status: "delivery", speed: "12 км/ч" },
      ].map((agent, i) => (
        <div key={i} className="absolute z-20" style={{ left: agent.x, top: agent.y, transform: "translate(-50%, -100%)" }}>
          {agent.status === "online" && (
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-emerald-400/20 animate-ping" style={{ animationDuration: "2s" }} />
          )}
          <div className="relative">
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center shadow-lg border-2 border-white transition-transform duration-300 hover:scale-125",
              agent.status === "online" ? "bg-gradient-to-br from-emerald-400 to-emerald-600" : "bg-gradient-to-br from-amber-400 to-amber-600"
            )}>
              <MapPin size={13} className="text-white" />
            </div>
          </div>
          <div className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap bg-white rounded-lg shadow-lg border border-gray-200/60 px-2.5 py-1 z-30">
            <div className="text-[9px] font-bold text-gray-900">{agent.name}</div>
            <div className="text-[7px] text-gray-400">{agent.speed}</div>
          </div>
        </div>
      ))}
      {/* Shops */}
      {[
        { x: 180, y: 160, name: "Рынок 'Боғ'" },
        { x: 260, y: 200, name: "Магазин 'Умид'" },
        { x: 260, y: 280, name: "Точка 'Нур'" },
      ].map((shop, i) => (
        <div key={i} className="absolute z-15" style={{ left: shop.x, top: shop.y, transform: "translate(-50%, -50%)" }}>
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-400 to-violet-600 flex items-center justify-center shadow-md border border-white">
            <Package size={10} className="text-white" />
          </div>
          <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap bg-white/95 text-gray-600 text-[7px] px-1.5 py-0.5 rounded-md border border-gray-200/60 shadow-sm font-semibold">
            {shop.name}
          </div>
        </div>
      ))}
      {/* Panel */}
      <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-xl rounded-xl border border-gray-200/50 shadow-xl p-3.5 w-52 z-30">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[9px] text-gray-400 uppercase tracking-wider font-bold">Live Tracking</span>
        </div>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">{tr("Агенты онлайн", "Agentlar onlayn")}</span>
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">2</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">{tr("Курьеры в пути", "Kuryerlar yo'lda")}</span>
            <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">1</span>
          </div>
          <div className="h-px bg-gray-100" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">{tr("Прогресс", "Progress")}</span>
            <span className="text-[10px] font-bold text-violet-600">71%</span>
          </div>
        </div>
      </div>
      {/* Zoom */}
      <div className="absolute bottom-3 right-3 bg-white rounded-lg shadow-lg border border-gray-200/50 overflow-hidden z-30">
        <button className="w-7 h-7 flex items-center justify-center text-gray-500 hover:bg-gray-50 border-b border-gray-100 text-sm font-light">+</button>
        <button className="w-7 h-7 flex items-center justify-center text-gray-500 hover:bg-gray-50 text-sm font-light">&minus;</button>
      </div>
    </div>
  );
}

function MobilePreview() {
  const tr = useTranslate();
  return (
    <div className="flex justify-center py-4">
      <div className="w-56 h-[380px] rounded-[2.5rem] bg-gradient-to-b from-gray-50 to-gray-100 border-[3px] border-gray-300 overflow-hidden shadow-2xl shadow-gray-900/10 relative">
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-6 bg-gray-900 rounded-b-2xl z-10" />
        <div className="h-10 bg-white flex items-center justify-center border-b border-gray-200/60">
          <div className="text-[8px] text-gray-400 font-semibold">9:41</div>
        </div>
        <div className="p-3.5 space-y-2 bg-white">
          <div className="text-center text-[9px] text-gray-400 font-bold tracking-widest uppercase mb-1">{tr("Главная", "Bosh sahifa")}</div>
          <div className="grid grid-cols-2 gap-2">
            {[{ i: Package, l: tr("Заказы", "Buyurtmalar"), v: "12", c: "from-violet-500 to-indigo-500" }, { i: MapPin, l: tr("Магазины", "Do'konlar"), v: "48", c: "from-emerald-500 to-teal-500" }, { i: TrendingUp, l: tr("Выручка", "Tushum"), v: "2.1M", c: "from-amber-500 to-orange-500" }, { i: Clock, l: tr("Планы", "Rejalar"), v: "6/8", c: "from-cyan-500 to-blue-500" }].map((item) => (
              <div key={item.l} className="bg-gray-50/80 rounded-xl p-2.5 border border-gray-200/30">
                <div className={cn("w-6 h-6 rounded-lg bg-gradient-to-br flex items-center justify-center mb-1.5", item.c)}>
                  <item.i size={10} className="text-white" />
                </div>
                <div className="text-[7px] text-gray-400 font-medium">{item.l}</div>
                <div className="text-[11px] font-black text-gray-900 mt-0.5">{item.v}</div>
              </div>
            ))}
          </div>
          <div className="bg-gray-50/80 rounded-xl p-2.5 border border-gray-200/30">
            <div className="text-[7px] text-gray-400 mb-1.5 font-semibold">{tr("Прогресс дня", "Kunning progressi")}</div>
            <div className="h-1.5 bg-gray-200/40 rounded-full overflow-hidden">
              <div className="h-full w-[75%] bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full" />
            </div>
            <div className="text-[8px] text-emerald-600 mt-1 font-bold">75% · {tr("6 из 8 визитов", "8 tashrifdan 6 tasi")}</div>
          </div>
          <div className="bg-gray-50/80 rounded-xl p-2.5 border border-gray-200/30">
            <div className="text-[7px] text-gray-400 mb-1 font-semibold">{tr("Ближайший визит", "Keyingi tashrif")}</div>
            <div className="text-[10px] font-bold text-gray-900">Рынок "Боғ"</div>
            <div className="text-[7px] text-gray-400 mt-0.5">ул. Беруни, 42 · 2.3 км</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalyticsPreview() {
  const tr = useTranslate();
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="p-4 rounded-xl bg-gradient-to-br from-gray-50/80 to-white border border-gray-200/30">
        <div className="text-[9px] text-gray-400 uppercase tracking-wider mb-3 font-bold">{tr("Топ товары", "Top mahsulotlar")}</div>
        <div className="space-y-2.5">
          {[{ n: "Помидоры", q: 1247, s: "4.2M" }, { n: "Огурцы", q: 892, s: "2.8M" }, { n: "Лук репчатый", q: 654, s: "1.9M" }, { n: "Картофель", q: 543, s: "1.5M" }].map((p, i) => (
            <div key={p.n} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-gray-300 w-4 text-right text-xs font-bold">{i + 1}</span>
                <span className="text-gray-700 font-semibold text-xs">{p.n}</span>
              </div>
              <div className="text-right">
                <span className="text-gray-900 font-bold text-xs">{p.q.toLocaleString()}</span>
                <span className="text-gray-400 ml-1.5 text-[10px]">&middot; {p.s}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="p-4 rounded-xl bg-gradient-to-br from-gray-50/80 to-white border border-gray-200/30">
        <div className="text-[9px] text-gray-400 uppercase tracking-wider mb-3 font-bold">{tr("По регионам", "Viloyatlar bo'yicha")}</div>
        <div className="space-y-3">
          {[{ n: "Ташкент", p: 65 }, { n: "Самарканд", p: 20 }, { n: "Бухара", p: 10 }, { n: "Фергана", p: 5 }].map((r) => (
            <div key={r.n}>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-gray-500">{r.n}</span>
                <span className="text-gray-900 font-bold">{r.p}%</span>
              </div>
              <div className="h-1.5 bg-gray-200/40 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full" style={{ width: `${r.p}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
