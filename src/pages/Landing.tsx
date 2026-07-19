import { useNavigate } from "react-router";
import { useEffect, useState, useRef, useMemo, type ReactNode } from "react";
import { useTranslate } from "@/i18n";
import {
  Warehouse,
  Truck,
  BarChart3,
  Users,
  Shield,
  Smartphone,
  CheckCircle2,
  ArrowRight,
  Star,
  Play,
  TrendingUp,
  Package,
  MapPin,
  Rocket,
  Target,
  Eye,
  Layers,
  FileText,
  Boxes,
  Route,
  ChevronDown,
  Zap,
  Headphones,
  Menu,
  X,
  Settings as SettingsIcon,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS — Soft UI / Neumorphic
// Warm cream canvas, single light source (top-left), dual soft shadows,
// one accent color (clay), pastel role colors used sparingly.
// ═══════════════════════════════════════════════════════════════════════════

const cn = (...classes: (string | false | null | undefined)[]) =>
  classes.filter(Boolean).join(" ");

const NEU = {
  bg: "#f2f0ec",
  text: "#2a2924",
  textSecondary: "#6b6a61",
  textMuted: "#8a887c",
  border: "rgba(163,158,143,0.22)",
  accent: "#c9884a",
  accentSoft: "#e7d3ba",
  green: "#7fa669",
  blue: "#8ba3c9",
  coral: "#c97a5a",
};

const raised = "shadow-[6px_6px_14px_rgba(163,158,143,0.35),-6px_-6px_14px_rgba(255,255,255,0.9)]";
const raisedSm = "shadow-[3px_3px_7px_rgba(163,158,143,0.35),-3px_-3px_7px_rgba(255,255,255,0.9)]";
const raisedLg = "shadow-[9px_9px_22px_rgba(163,158,143,0.38),-9px_-9px_22px_rgba(255,255,255,0.92)]";
const insetSm = "shadow-[inset_2px_2px_5px_rgba(163,158,143,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.75)]";

const ROLE_TONES = [NEU.accent, NEU.blue, NEU.green, NEU.coral];

// ═══════════════════════════════════════════════════════════════════════════
// PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════

function FadeIn({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.05, rootMargin: "0px 0px -60px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        "transition-all duration-700 ease-out",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6",
        className
      )}
    >
      {children}
    </div>
  );
}

function Stagger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.05, rootMargin: "0px 0px -60px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {Array.isArray(children)
        ? children.map((child, i) => (
            <div
              key={i}
              style={{ transitionDelay: `${i * 70}ms` }}
              className={cn(
                "transition-all duration-500 ease-out",
                visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              )}
            >
              {child}
            </div>
          ))
        : children}
    </div>
  );
}

function Counter({ target }: { target: number }) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const duration = 1400;
          const start = performance.now();
          const tick = (now: number) => {
            const progress = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            setValue(Math.round(target * eased));
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [target]);

  return <span ref={ref}>{value.toLocaleString("ru-RU")}</span>;
}

/** Small SVG progress ring — used instead of conic-gradient hacks. */
function ProgressRing({
  percent,
  color,
  size = 30,
}: {
  percent: number;
  color: string;
  size?: number;
}) {
  const r = size / 2 - 3;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - percent / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgba(163,158,143,0.22)"
        strokeWidth={3.2}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

function NeuButton({
  children,
  onClick,
  variant = "raised",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "raised" | "inset" | "dark";
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-xl font-medium text-[13px] transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2",
        variant === "raised" && cn("text-[#33322d]", raisedSm, "hover:shadow-[4px_4px_9px_rgba(163,158,143,0.4),-4px_-4px_9px_rgba(255,255,255,0.95)]"),
        variant === "inset" && cn("text-[#6b6a61]", insetSm),
        variant === "dark" && "bg-[#2a2924] text-[#f2f0ec] shadow-[4px_4px_10px_rgba(163,158,143,0.35)] hover:bg-[#33322d]",
        className
      )}
      style={{ background: variant !== "dark" ? NEU.bg : undefined }}
    >
      {children}
    </button>
  );
}

function NeuCard({
  children,
  className,
  hover = true,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl transition-all duration-300",
        raised,
        hover && "hover:shadow-[8px_8px_18px_rgba(163,158,143,0.42),-8px_-8px_18px_rgba(255,255,255,0.95)] hover:-translate-y-0.5",
        className
      )}
      style={{ background: NEU.bg }}
    >
      {children}
    </div>
  );
}

function Eyebrow({ icon: Icon, children }: { icon: typeof Zap; children: ReactNode }) {
  return (
    <div
      className={cn("inline-flex items-center gap-2 text-[11px] font-semibold tracking-wide uppercase mb-5 px-4 py-2 rounded-full", insetSm)}
      style={{ background: NEU.bg, color: NEU.accent }}
    >
      <Icon size={13} />
      {children}
    </div>
  );
}

function Accordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={item.q} className={cn("rounded-2xl overflow-hidden", raisedSm)} style={{ background: NEU.bg }}>
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between gap-4 px-6 py-4.5 text-left"
          >
            <span className="text-[14px] font-medium" style={{ color: NEU.text }}>{item.q}</span>
            <ChevronDown
              size={16}
              style={{ color: NEU.textMuted }}
              className={cn("transition-transform duration-300 flex-shrink-0", open === i && "rotate-180")}
            />
          </button>
          <div
            className="grid transition-all duration-300"
            style={{ gridTemplateRows: open === i ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden">
              <p className="px-6 pb-5 text-[13.5px] leading-relaxed" style={{ color: NEU.textSecondary }}>
                {item.a}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ScrollProgress() {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const handler = () => {
      const h = document.documentElement;
      const scrolled = h.scrollTop;
      const max = h.scrollHeight - h.clientHeight;
      setProgress(max > 0 ? (scrolled / max) * 100 : 0);
    };
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);
  return (
    <div className="fixed top-0 inset-x-0 h-[2px] z-[60]" style={{ background: "transparent" }}>
      <div
        className="h-full transition-[width] duration-150"
        style={{ width: `${progress}%`, background: NEU.accent }}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCT PREVIEW (tabbed mock of the real app)
// ═══════════════════════════════════════════════════════════════════════════

function KpiTile({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className={cn("rounded-2xl p-4", raisedSm)} style={{ background: NEU.bg }}>
      <div className="text-[9.5px] font-semibold tracking-wide uppercase mb-3" style={{ color: NEU.textMuted }}>{label}</div>
      <div className="text-[20px] font-medium mb-1" style={{ color: NEU.text }}>{value}</div>
      <div className="text-[10.5px]" style={{ color }}>{sub}</div>
    </div>
  );
}

function DashboardTab() {
  return (
    <div className="grid grid-cols-3 gap-3">
      <KpiTile label="Заказов" value="142" sub="↑ 18% за неделю" color={NEU.green} />
      <KpiTile label="Агентов в поле" value="18" sub="6 территорий" color={NEU.textMuted} />
      <div className={cn("rounded-2xl p-4 flex flex-col justify-between", raisedSm)} style={{ background: NEU.bg }}>
        <div className="flex items-center justify-between">
          <div className="text-[9.5px] font-semibold tracking-wide uppercase" style={{ color: NEU.textMuted }}>Dead-stock</div>
          <ProgressRing percent={74} color={NEU.accent} />
        </div>
        <div className="text-[20px] font-medium" style={{ color: NEU.text }}>&minus;12%</div>
      </div>
      <div className={cn("col-span-3 rounded-2xl p-4", raisedSm)} style={{ background: NEU.bg }}>
        <div className="text-[9.5px] font-semibold tracking-wide uppercase mb-4" style={{ color: NEU.textMuted }}>Динамика продаж, 7 дней</div>
        <svg viewBox="0 0 300 60" className="w-full h-14">
          <polyline
            points="0,45 40,38 80,42 120,20 160,26 200,10 240,18 300,6"
            fill="none"
            stroke={NEU.accent}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

function MapTab() {
  const pins = [
    { x: 28, y: 32, tone: NEU.green },
    { x: 58, y: 20, tone: NEU.accent },
    { x: 74, y: 55, tone: NEU.green },
    { x: 40, y: 66, tone: NEU.blue },
    { x: 85, y: 30, tone: NEU.green },
  ];
  return (
    <div className={cn("rounded-2xl p-5 h-[220px] relative overflow-hidden", raisedSm)} style={{ background: NEU.bg }}>
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 opacity-40">
        <path d="M0,30 Q30,10 60,25 T100,20" stroke={NEU.border} strokeWidth="0.6" fill="none" />
        <path d="M0,70 Q40,55 70,72 T100,65" stroke={NEU.border} strokeWidth="0.6" fill="none" />
        <path d="M20,0 Q35,40 20,100" stroke={NEU.border} strokeWidth="0.6" fill="none" />
        <path d="M75,0 Q65,50 80,100" stroke={NEU.border} strokeWidth="0.6" fill="none" />
      </svg>
      {pins.map((p, i) => (
        <div
          key={i}
          className="absolute w-2.5 h-2.5 rounded-full"
          style={{ left: `${p.x}%`, top: `${p.y}%`, background: p.tone, boxShadow: `0 0 0 4px ${p.tone}22` }}
        />
      ))}
      <div className={cn("absolute bottom-3 left-3 right-3 rounded-xl px-3 py-2.5 flex items-center gap-2", raisedSm)} style={{ background: NEU.bg }}>
        <MapPin size={13} style={{ color: NEU.accent }} />
        <span className="text-[11px]" style={{ color: NEU.text }}>Бехруз — Мирзо-Улугбек, 12 мин назад</span>
      </div>
    </div>
  );
}

function MobileTab() {
  return (
    <div className="flex justify-center">
      <div className={cn("rounded-[1.6rem] p-2.5 w-[160px]", raisedSm)} style={{ background: NEU.bg }}>
        <div className="rounded-[1.2rem] overflow-hidden" style={{ background: NEU.bg }}>
          <div className="px-3 pt-3 pb-2 flex items-center justify-between">
            <span className="text-[10px] font-medium" style={{ color: NEU.text }}>Заказы</span>
            <span className="text-[8px]" style={{ color: NEU.textMuted }}>11 всего</span>
          </div>
          <div className="px-3 space-y-2 pb-3">
            {[
              { s: "Новый", tone: NEU.blue },
              { s: "В работе", tone: NEU.accent },
              { s: "Выполнен", tone: NEU.green },
            ].map((o, i) => (
              <div key={i} className={cn("rounded-lg px-2.5 py-2", insetSm)}>
                <div className="text-[8.5px] font-medium mb-1" style={{ color: NEU.text }}>ORD-{1000 + i}</div>
                <div className="text-[7.5px]" style={{ color: o.tone }}>{o.s}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalyticsTab() {
  const bars = [40, 65, 30, 80, 55, 90, 45];
  return (
    <div className={cn("rounded-2xl p-5", raisedSm)} style={{ background: NEU.bg }}>
      <div className="flex items-end justify-between h-24 mb-3 gap-2">
        {bars.map((h, i) => (
          <div key={i} className="flex-1 rounded-t-md" style={{ height: `${h}%`, background: i === 5 ? NEU.accent : "rgba(163,158,143,0.3)" }} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 pt-3" style={{ borderTop: `0.5px solid ${NEU.border}` }}>
        <div>
          <div className="text-[9px]" style={{ color: NEU.textMuted }}>Выручка</div>
          <div className="text-[14px] font-medium" style={{ color: NEU.text }}>18.4М</div>
        </div>
        <div>
          <div className="text-[9px]" style={{ color: NEU.textMuted }}>Маржа</div>
          <div className="text-[14px] font-medium" style={{ color: NEU.green }}>24%</div>
        </div>
        <div>
          <div className="text-[9px]" style={{ color: NEU.textMuted }}>Долг</div>
          <div className="text-[14px] font-medium" style={{ color: NEU.coral }}>1.7М</div>
        </div>
      </div>
    </div>
  );
}

function ProductPreview({ tr }: { tr: (ru: string, uz: string) => string }) {
  const [tab, setTab] = useState(0);
  const tabs = ["Dashboard", tr("Карта", "Xarita"), tr("Мобильное", "Mobil"), tr("Аналитика", "Tahlil")];
  useEffect(() => {
    const t = setInterval(() => setTab(p => (p + 1) % 4), 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className={cn("rounded-[1.75rem] p-3", raisedLg)} style={{ background: NEU.bg }}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(163,158,143,0.3)" }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(163,158,143,0.3)" }} />
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: "rgba(163,158,143,0.3)" }} />
        </div>
        <div className="flex-1 flex justify-center">
          <div className={cn("flex gap-0.5 rounded-xl p-1", insetSm)}>
            {tabs.map((t, i) => (
              <button
                key={t}
                onClick={() => setTab(i)}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-[11px] font-medium transition-all duration-300",
                  tab === i ? raisedSm : ""
                )}
                style={{ color: tab === i ? NEU.text : NEU.textMuted, background: tab === i ? NEU.bg : "transparent" }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="w-16" />
      </div>
      <div className="p-4 pt-2">
        {tab === 0 && <DashboardTab />}
        {tab === 1 && <MapTab />}
        {tab === 2 && <MobileTab />}
        {tab === 3 && <AnalyticsTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════

export default function Landing() {
  const navigate = useNavigate();
  const tr = useTranslate();
  const [scrollY, setScrollY] = useState(0);
  const [activeTestimonial, setActiveTestimonial] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const h = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setActiveTestimonial(p => (p + 1) % 3), 6000);
    return () => clearInterval(t);
  }, []);

  const navLinks = useMemo(
    () => [
      { label: tr("Продукт", "Mahsulot"), href: "#features" },
      { label: tr("Как работает", "Qanday ishlaydi"), href: "#how" },
      { label: tr("Решения", "Yechimlar"), href: "#roles" },
      { label: tr("Отзывы", "Sharhlar"), href: "#testimonials" },
      { label: tr("Цены", "Narxlar"), href: "#pricing" },
    ],
    [tr]
  );

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

  const testimonials = useMemo(
    () => [
      { name: "Акбар Расулов", role: tr("Директор, LogiMax", "Direktor, LogiMax"), text: tr("Warehouse Pro полностью изменил наш подход к дистрибуции. Агенты работают эффективнее, а я вижу всё в реальном времени.", "Warehouse Pro distribyutsiya yondashuvimizni butunlay o'zgartirdi. Agentlar samaraliroq ishlaydi, men hammasini real vaqtda ko'raman."), rating: 5, avatar: "АР" },
      { name: "Дилшод Камолдинов", role: tr("Оператор, TradeHub", "Operator, TradeHub"), text: tr("Раньше все заказы велись в Excel. Теперь всё автоматизировано. Ошибок стало в 10 раз меньше.", "Oldin barcha buyurtmalar Excel da olib borilardi. Endi hammasi avtomatlashtirilgan. Xatolar 10 marta kamaydi."), rating: 5, avatar: "ДК" },
      { name: "Шерзод Абдуллаев", role: tr("Курьер, SupplyPro", "Kuryer, SupplyPro"), text: tr("Мобильное приложение очень удобное. Офлайн-режим работает идеально — можно принимать заказы даже без интернета.", "Mobil ilova juda qulay. Oflayn-rejim ajoyib ishlaydi — internetsiz ham buyurtmalarni qabul qilish mumkin."), rating: 5, avatar: "ША" },
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

  const pricingPlans = useMemo(
    () => [
      { name: "Basic", price: "299 000", features: [tr("До 5 пользователей", "5 tagacha foydalanuvchi"), tr("До 50 товаров", "50 tagacha mahsulot"), tr("Управление складом", "Omborni boshqarish"), tr("Базовая аналитика", "Asosiy tahlil"), tr("Создание и обработка заказов", "Buyurtmalar yaratish"), tr("Мобильное приложение для агентов", "Agentlar uchun mobil ilova"), tr("Email-поддержка", "Email-qo'llab-quvvatlash")], hl: false },
      { name: "Pro", price: "599 000", features: [tr("До 20 пользователей", "20 tagacha foydalanuvchi"), tr("До 100 товаров", "100 tagacha mahsulot"), tr("Всё из Basic", "Basic dagi hammasi"), tr("Полная аналитика (20+ отчётов)", "To'liq tahlil (20+ hisobot)"), tr("GPS-трекинг агентов и курьеров", "Agentlar va kuryerlarning GPS kuzatuvi"), tr("Интеграция с 1С:Предприятие", "1C bilan integratsiya"), tr("Аудит-лог действий", "Amallar audit jurnali"), tr("Приоритетная поддержка", "Ustuvor qo'llab-quvvatlash")], hl: true },
      { name: "Exclusive", price: "1 299 000", features: [tr("Без ограничений по пользователям", "Foydalanuvchilar bo'yicha cheksiz"), tr("Без ограничений по товарам", "Mahsulotlar bo'yicha cheksiz"), tr("Всё из Pro", "Pro dagi hammasi"), tr("API доступ для интеграций", "Integratsiyalar uchun API"), tr("White-label (ваш бренд)", "White-label (sizning brendingiz)"), tr("Персональный менеджер", "Shaxsiy menejer"), tr("Выделенный сервер", "Ajratilgan server"), tr("Поддержка 24/7", "24/7 qo'llab-quvvatlash")], hl: false },
    ],
    [tr]
  );

  const stats = useMemo(
    () => [
      { v: 500, s: "+", l: tr("Компаний", "Kompaniyalar") },
      { v: 10000, s: "+", l: tr("Заказов в день", "Buyurtmalar kuniga") },
      { v: 99, s: ".9%", l: "Uptime" },
      { v: 24, s: "/7", l: tr("Поддержка", "Qo'llab-quvvatlash") },
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
    <div className="min-h-screen overflow-x-hidden" style={{ background: NEU.bg, color: NEU.text }}>
      <ScrollProgress />

      {/* ── Nav ── */}
      <nav
        className={cn(
          "fixed top-0 inset-x-0 z-50 transition-all duration-500",
          scrollY > 20 && "backdrop-blur-sm"
        )}
        style={{ background: scrollY > 20 ? "rgba(242,240,236,0.85)" : "transparent" }}
      >
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", raisedSm)} style={{ background: NEU.bg }}>
              <Warehouse size={16} style={{ color: NEU.accent }} strokeWidth={2.2} />
            </div>
            <span className="font-medium tracking-tight text-[15px]">Warehouse Pro</span>
          </div>

          <div className="hidden md:flex items-center gap-0.5">
            {navLinks.map(item => (
              <a
                key={item.label}
                href={item.href}
                className="px-3.5 py-2 text-[13px] rounded-lg transition-colors duration-200"
                style={{ color: NEU.textSecondary }}
              >
                {item.label}
              </a>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <button
              onClick={() => navigate("/login")}
              className="text-[13px] px-3 py-2 rounded-lg font-medium"
              style={{ color: NEU.textSecondary }}
            >
              {tr("Войти", "Kirish")}
            </button>
            <NeuButton onClick={() => navigate("/register")} className="h-9 px-5">
              {tr("Начать", "Boshlash")}
            </NeuButton>
          </div>

          <button
            className={cn("md:hidden w-9 h-9 rounded-lg flex items-center justify-center", raisedSm)}
            style={{ background: NEU.bg }}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        <div
          className={cn("md:hidden transition-all duration-400 overflow-hidden", mobileMenuOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0")}
          style={{ background: "rgba(242,240,236,0.97)" }}
        >
          <div className="px-6 pb-6 space-y-1">
            {navLinks.map(item => (
              <a
                key={item.label}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className="block px-3 py-2.5 text-sm rounded-lg"
                style={{ color: NEU.textSecondary }}
              >
                {item.label}
              </a>
            ))}
            <div className="pt-2 flex gap-2">
              <NeuButton variant="inset" onClick={() => navigate("/login")} className="flex-1 h-10">{tr("Войти", "Kirish")}</NeuButton>
              <NeuButton onClick={() => navigate("/register")} className="flex-1 h-10">{tr("Начать", "Boshlash")}</NeuButton>
            </div>
          </div>
        </div>
      </nav>

      {/* ═══════════════ HERO ═══════════════ */}
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

      {/* ── Social proof ── */}
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

      {/* ═══════════════ HOW IT WORKS ═══════════════ */}
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

      {/* ═══════════════ FEATURES ═══════════════ */}
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

      {/* ═══════════════ MAP FEATURE ═══════════════ */}
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
              <MapTab />
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ═══════════════ STATS ═══════════════ */}
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

      {/* ═══════════════ ROLES ═══════════════ */}
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

      {/* ═══════════════ INTEGRATIONS ═══════════════ */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-6">
          <FadeIn>
            <div className="text-center mb-12">
              <Eyebrow icon={Target}>{tr("Интеграции", "Integratsiyalar")}</Eyebrow>
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

      {/* ═══════════════ TESTIMONIALS ═══════════════ */}
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

      {/* ═══════════════ PRICING ═══════════════ */}
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

      {/* ═══════════════ FAQ ═══════════════ */}
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

      {/* ═══════════════ CTA ═══════════════ */}
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

      {/* ═══════════════ FOOTER ═══════════════ */}
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
