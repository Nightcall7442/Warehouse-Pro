import { useMemo } from "react";
import { useTranslate } from "@/i18n";
import {
  BarChart3,
  Users,
  Shield,
  Smartphone,
  CheckCircle2,
  Package,
  MapPin,
  Rocket,
  Eye,
  Layers,
  FileText,
  Boxes,
  Route,
  Zap,
  Truck,
  TrendingUp,
  Settings as SettingsIcon,
} from "lucide-react";
import { cn, NEU, insetSm, ROLE_TONES, FadeIn, Stagger, NeuCard, Eyebrow } from "./landing-shared";
import { colorMix } from "@/lib/color-mix";

export default function FeaturesSection() {
  const tr = useTranslate();

  const features = useMemo(
    () => [
      {
        icon: Boxes,
        title: tr("Складской учёт", "Ombor hisobi"),
        desc: tr("Остатки, резервы, движения товаров. Контроль dead-stock в реальном времени.", "Qoldiqlar, zaxiralar, mahsulot harakatlari. Dead-stockni real vaqtda nazorat qiling."),
        stat: tr("19 таблиц", "19 jadval"),
      },
      {
        icon: Route,
        title: tr("Доставка", "Yetkazib berish"),
        desc: tr("Назначение курьеров, GPS-трекинг, сбор наличных. Мобильное приложение.", "Kuryerlarni tayinlash, GPS kuzatuv, naqd pul yig'ish. Mobil ilova."),
        stat: "Real-time",
      },
      {
        icon: BarChart3,
        title: tr("Аналитика", "Tahlil"),
        desc: tr("Dashboard с KPI, отчёты по продажам, P&L, задолженности.", "KPI bilan boshqaruv paneli, sotish hisobotlari, P&L, qarzlar."),
        stat: tr("20+ отчётов", "20+ hisobot"),
      },
      {
        icon: Users,
        title: tr("Команда", "Jamoa"),
        desc: tr("6 ролей с правами доступа: от директора до курьера.", "6 ta rol kirish huquqlari bilan: direktordan kuryergacha."),
        stat: tr("6 ролей", "6 ta rol"),
      },
      {
        icon: Smartphone,
        title: tr("Мобильное приложение", "Mobil ilova"),
        desc: tr("React Native с офлайн-режимом, камерой, GPS и хаптикой.", "React Native oflayn-rejim, kamera, GPS va haptika bilan."),
        stat: "iOS + Android",
      },
      {
        icon: Shield,
        title: tr("Безопасность", "Xavfsizlik"),
        desc: tr("Мультитенантность, JWT, rate limiting, tenant-изоляция.", "Multi-tenant, JWT, rate limiting, tenant-izolyatsiya."),
        stat: "Enterprise",
      },
    ],
    [tr]
  );

  const roles = useMemo(
    () => [
      { role: tr("Директор", "Direktor"), icon: TrendingUp, features: [tr("Dashboard с KPI", "KPI bilan boshqaruv paneli"), tr("Финансовые отчёты", "Moliyaviy hisobotlar"), tr("Управление пользователями", "Foydalanuvchilarni boshqarish"), tr("Настройки биллинга", "To'lov sozlamalari")] },
      { role: tr("Оператор", "Operator"), icon: Package, features: [tr("Управление заказами", "Buyurtmalarni boshqarish"), tr("Назначение курьеров", "Kuryerlarni tayinlash"), tr("Контроль склада", "Omborni nazorat qilish"), tr("Работа с 1C", "1C bilan ishlash")] },
      { role: tr("Агент", "Agent"), icon: MapPin, features: [tr("Создание заказов", "Buyurtmalar yaratish"), tr("План визитов", "Tashrif rejasi"), tr("GPS-трекинг", "GPS kuzatuv"), tr("Офлайн-режим", "Oflayn-rejim")] },
      { role: tr("Супервайзер", "Supervisor"), icon: Eye, features: [tr("Мониторинг агентов", "Agentlarni monitoring qilish"), tr("Управление планами", "Rejalarni boshqarish"), tr("Отчёты по визитам", "Tashriflar hisobotlari"), tr("Трекинг в реальном времени", "Real vaqtda kuzatuv")] },
      { role: tr("Мерчандайзер", "Merchandayzer"), icon: FileText, features: [tr("Отчёты о визитах", "Tashriflar hisobotlari"), tr("Фото-фиксация", "Rasmga olish"), tr("Чек-лист товаров", "Mahsulotlar chek-listi"), tr("Заметки о конкурентах", "Raqobatchilar haqida eslatmalar")] },
      { role: tr("Курьер", "Kuryer"), icon: Truck, features: [tr("Список доставок", "Yetkazib berish ro'yxati"), tr("Навигация на карте", "Xaritada navigatsiya"), tr("Сбор наличных", "Naqd pul yig'ish"), tr("GPS-трекинг", "GPS kuzatuv")] },
    ],
    [tr]
  );

  const steps = useMemo(
    () => [
      { step: "01", title: tr("Регистрация", "Ro'yxatdan o'tish"), desc: tr("Создайте аккаунт за 30 секунд. Настройте компанию, добавьте склад и товары.", "30 sekundda akkaunt yarating. Kompaniyani sozlang, ombor va mahsulotlarni qo'shing."), icon: Zap },
      { step: "02", title: tr("Настройка", "Sozlash"), desc: tr("Добавьте команду, назначьте роли, настройте интеграции с 1С и доставкой.", "Jamoa qo'shing, rollarni tayinlang, 1C va yetkazib berish integratsiyalarini sozlang."), icon: SettingsIcon },
      { step: "03", title: tr("Работа", "Ish"), desc: tr("Агенты создают заказы, курьеры доставляют, директор видит всё в реальном времени.", "Agentlar buyurtmalar yaratadi, kuryerlar yetkazib beradi, direktor hammasini real vaqtda ko'radi."), icon: Rocket },
    ],
    [tr]
  );

  return (
    <>
      {/* How it works */}
      <section id="how" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <FadeIn>
            <div className="text-center max-w-xl mx-auto mb-16">
              <Eyebrow icon={Zap}>{tr("Как работает", "Qanday ishlaydi")}</Eyebrow>
              <h2 className="text-2xl md:text-[2.1rem] font-medium tracking-tight leading-tight mb-4">
                {tr("Три шага до полного контроля", "To'liq nazoratga 3 qadam")}
              </h2>
              <p className="text-[15px]" style={{ color: NEU.textSecondary }}>
                {tr("Начните за 5 минут. Без установки, без сложной настройки.", "5 daqiqada boshlang. O'rnatish shart emas.")}
              </p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-6">
            {steps.map((item, i) => (
              <FadeIn key={item.step} delay={i * 120}>
                <NeuCard className="p-7 h-full" hover={false}>
                  <div className="flex items-center justify-between mb-6">
                    <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center", insetSm)}>
                      <item.icon size={19} style={{ color: NEU.accent }} strokeWidth={2} />
                    </div>
                    <span className="text-[11px] font-mono" style={{ color: NEU.textMuted }}>{item.step}</span>
                  </div>
                  <h3 className="font-medium text-[15px] mb-2">{item.title}</h3>
                  <p className="text-[13px] leading-relaxed" style={{ color: NEU.textSecondary }}>{item.desc}</p>
                </NeuCard>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <FadeIn>
            <div className="max-w-xl mb-14">
              <Eyebrow icon={Layers}>{tr("Продукт", "Mahsulot")}</Eyebrow>
              <h2 className="text-2xl md:text-[2.1rem] font-medium tracking-tight leading-tight mb-4">
                {tr("Всё что нужно", "Sizga kerakli hammasi")}
                <br />
                <span style={{ color: NEU.textMuted }}>{tr("для вашего бизнеса", "biznesingiz uchun")}</span>
              </h2>
              <p className="text-[15px]" style={{ color: NEU.textSecondary }}>
                {tr("От склада до доставки — полный контроль над процессами дистрибуции.", "Ombordan yetkazib berishgacha — to'liq nazorat.")}
              </p>
            </div>
          </FadeIn>

          <Stagger className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f, i) => (
              <NeuCard key={f.title} className="p-6">
                <div className={cn("w-11 h-11 rounded-2xl flex items-center justify-center mb-5", insetSm)}>
                  <f.icon size={18} style={{ color: ROLE_TONES[i % ROLE_TONES.length] }} strokeWidth={2} />
                </div>
                <div className="flex items-center justify-between mb-2.5">
                  <h3 className="font-medium text-[14.5px]">{f.title}</h3>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ color: NEU.textMuted, background: "rgba(163,158,143,0.12)" }}>{f.stat}</span>
                </div>
                <p className="text-[13px] leading-relaxed" style={{ color: NEU.textSecondary }}>{f.desc}</p>
              </NeuCard>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Map Feature */}
      <section id="map" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-14 items-center">
            <FadeIn>
              <div>
                <Eyebrow icon={MapPin}>{tr("GPS-трекинг", "GPS kuzatuv")}</Eyebrow>
                <h2 className="text-2xl md:text-[2rem] font-medium tracking-tight mb-4">
                  {tr("Отслеживайте агентов", "Agentlarni kuzating")}
                  <br />
                  <span style={{ color: NEU.textMuted }}>{tr("в реальном времени", "real vaqtda")}</span>
                </h2>
                <p className="text-[15px] leading-relaxed mb-7" style={{ color: NEU.textSecondary }}>
                  {tr("GPS-трекинг всех агентов и курьеров на карте. История маршрутов, контроль посещений, оптимизация доставки.", "Barcha agentlar va kuryerlarni xaritada GPS kuzatuv.")}
                </p>
                <ul className="space-y-3.5">
                  {[
                    tr("Живая карта с позициями всех агентов", "Barcha agentlar pozitsiyalari bilan jonli xarita"),
                    tr("История маршрутов за день / неделю / месяц", "Kun/hafta/oy ichida marshrut tarixi"),
                    tr("Контроль посещения торговых точек", "Savdo nuqtalariga tashriflarni nazorat qilish"),
                    tr("Уведомления о выходе за пределы зоны", "Zonadan chiqish haqida bildirishnomalar"),
                  ].map(item => (
                    <li key={item} className="flex items-center gap-3 text-[13.5px]" style={{ color: NEU.textSecondary }}>
                      <div className={cn("w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0", insetSm)}>
                        <CheckCircle2 size={13} style={{ color: NEU.green }} />
                      </div>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </FadeIn>
            <FadeIn delay={150}>
              <div className={cn("rounded-2xl p-5 h-[220px] relative overflow-hidden", "shadow-[3px_3px_7px_rgba(163,158,143,0.35),-3px_-3px_7px_rgba(255,255,255,0.9)]")} style={{ background: NEU.bg }}>
                <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 opacity-40">
                  <path d="M0,30 Q30,10 60,25 T100,20" stroke={NEU.border} strokeWidth="0.6" fill="none" />
                  <path d="M0,70 Q40,55 70,72 T100,65" stroke={NEU.border} strokeWidth="0.6" fill="none" />
                  <path d="M20,0 Q35,40 20,100" stroke={NEU.border} strokeWidth="0.6" fill="none" />
                  <path d="M75,0 Q65,50 80,100" stroke={NEU.border} strokeWidth="0.6" fill="none" />
                </svg>
                {[
                  { x: 28, y: 32, tone: NEU.green },
                  { x: 58, y: 20, tone: NEU.accent },
                  { x: 74, y: 55, tone: NEU.green },
                  { x: 40, y: 66, tone: NEU.blue },
                  { x: 85, y: 30, tone: NEU.green },
                ].map((p, i) => (
                  <div
                    key={i}
                    className="absolute w-2.5 h-2.5 rounded-full"
                    style={{ left: `${p.x}%`, top: `${p.y}%`, background: p.tone, boxShadow: `0 0 0 4px ${colorMix(p.tone, 13)}` }}
                  />
                ))}
                <div className={cn("absolute bottom-3 left-3 right-3 rounded-xl px-3 py-2.5 flex items-center gap-2", "shadow-[3px_3px_7px_rgba(163,158,143,0.35),-3px_-3px_7px_rgba(255,255,255,0.9)]")} style={{ background: NEU.bg }}>
                  <MapPin size={13} style={{ color: NEU.accent }} />
                  <span className="text-[11px]" style={{ color: NEU.text }}>Бехруз — Мирзо-Улугбек, 12 мин назад</span>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Roles */}
      <section id="roles" className="py-24">
        <div className="max-w-7xl mx-auto px-6">
          <FadeIn>
            <div className="max-w-xl mb-14">
              <Eyebrow icon={Users}>{tr("Решения", "Yechimlar")}</Eyebrow>
              <h2 className="text-2xl md:text-[2.1rem] font-medium tracking-tight leading-tight mb-4">
                {tr("Для каждой", "Har bir")}
                <br />
                <span style={{ color: NEU.textMuted }}>{tr("роли в команде", "jamoa a'zosi uchun")}</span>
              </h2>
              <p className="text-[15px]" style={{ color: NEU.textSecondary }}>
                {tr("Каждый сотрудник видит только то, что ему нужно.", "Har bir xodim faqat o'ziga kerakli narsalarni ko'radi.")}
              </p>
            </div>
          </FadeIn>

          <Stagger className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roles.map((r, i) => (
              <NeuCard key={r.role} className="p-6">
                <div className={cn("w-11 h-11 rounded-2xl flex items-center justify-center mb-4", insetSm)}>
                  <r.icon size={18} style={{ color: ROLE_TONES[i % ROLE_TONES.length] }} strokeWidth={2} />
                </div>
                <h3 className="font-medium text-[14.5px] mb-3">{r.role}</h3>
                <ul className="space-y-2">
                  {r.features.map(f => (
                    <li key={f} className="flex items-center gap-2.5 text-[13px]" style={{ color: NEU.textSecondary }}>
                      <CheckCircle2 size={13} style={{ color: NEU.textMuted }} className="flex-shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
              </NeuCard>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Integrations */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-6">
          <FadeIn>
            <div className="text-center mb-12">
              <Eyebrow icon={MapPin}>{tr("Интеграции", "Integratsiyalar")}</Eyebrow>
              <h2 className="text-2xl md:text-[2rem] font-medium tracking-tight">
                {tr("Работает с вашими инструментами", "Sizning vositalaringiz bilan ishlaydi")}
              </h2>
            </div>
          </FadeIn>

          <Stagger className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { name: "1С:Предприятие", icon: "1C", desc: tr("Синхронизация данных", "Ma'lumotlarni sinxronlashtirish") },
              { name: "Payme / Click", icon: "P", desc: tr("Приём платежей", "To'lovlarni qabul qilish") },
              { name: "Telegram", icon: "T", desc: tr("Уведомления", "Bildirishnomalar") },
              { name: "AWS S3", icon: "A", desc: tr("Хранилище файлов", "Fayllar xotirasi") },
            ].map((item, i) => (
              <NeuCard key={item.name} className="p-6 text-center">
                <div className={cn("w-13 h-13 rounded-2xl flex items-center justify-center text-lg font-medium mx-auto mb-4", insetSm)} style={{ color: ROLE_TONES[i % ROLE_TONES.length], width: 52, height: 52 }}>
                  {item.icon}
                </div>
                <p className="font-medium text-[13.5px] mb-1">{item.name}</p>
                <p className="text-[12px]" style={{ color: NEU.textMuted }}>{item.desc}</p>
              </NeuCard>
            ))}
          </Stagger>
        </div>
      </section>
    </>
  );
}
