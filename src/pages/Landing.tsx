import { useNavigate } from "react-router";
import { useEffect, useState, useRef, useCallback, useMemo, type ReactNode, type CSSProperties } from "react";
import {
  Warehouse, Truck, BarChart3, Users, Shield, Smartphone,
  CheckCircle2, ArrowRight, Star, Play,
  TrendingUp, Package, MapPin, Clock, Rocket,
  Target, Eye, Layers, FileText,
  ArrowUpRight, Boxes, Route, ChevronDown, Quote,
  Zap, Globe, Headphones, Sparkles, Menu, X,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATED COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

function FadeIn({
  children,
  delay = 0,
  className = "",
  direction = "up",
  distance = 40,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  direction?: "up" | "down" | "left" | "right" | "none";
  distance?: number;
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

  const dirMap: Record<string, string> = {
    up: `translate-y-[${distance}px]`,
    down: `-translate-y-[${distance}px]`,
    left: `translate-x-[${distance}px]`,
    right: `-translate-x-[${distance}px]`,
    none: "",
  };

  return (
    <div
      ref={ref}
      className={cn(
        "transition-all",
        visible ? "opacity-100 !translate-x-0 !translate-y-0" : `opacity-0 ${dirMap[direction]}`,
        className
      )}
      style={{
        transitionDuration: "900ms",
        transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
        transitionDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

function Stagger({ children, className = "" }: { children: ReactNode; className?: string }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold: 0.05 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} className={cn("stagger-grid", visible && "stagger-active", className)}>
      {children}
    </div>
  );
}

function Counter({ target, suffix = "", prefix = "" }: { target: number; suffix?: string; prefix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setStarted(true); obs.disconnect(); } }, { threshold: 0.5 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;
    let current = 0;
    const duration = 1200;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      current += step;
      if (current >= target) { setCount(target); clearInterval(timer); }
      else setCount(Math.floor(current));
    }, 16);
    return () => clearInterval(timer);
  }, [started, target]);

  return <span ref={ref}>{prefix}{count.toLocaleString()}{suffix}</span>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTERACTIVE EFFECTS
// ═══════════════════════════════════════════════════════════════════════════════

function MagneticButton({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});

  const handleMouse = useCallback((e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    setStyle({ transform: `translate(${x * 0.15}px, ${y * 0.15}px)` });
  }, []);

  const reset = useCallback(() => setStyle({ transform: "translate(0, 0)", transition: "transform 0.4s cubic-bezier(0.16,1,0.3,1)" }), []);

  return (
    <button ref={ref} onMouseMove={handleMouse} onMouseLeave={reset} onClick={onClick} className={className} style={style}>
      {children}
    </button>
  );
}

function GlowCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const handleMouse = useCallback((e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  return (
    <div ref={ref} onMouseMove={handleMouse} className={cn("relative group", className)}>
      <div className="absolute -inset-px rounded-[1.25rem] bg-gradient-to-br from-violet-400/0 via-violet-400/10 to-indigo-400/0 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
      <div
        className="absolute inset-0 rounded-[1.25rem] opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{ background: `radial-gradient(400px circle at ${mousePos.x}px ${mousePos.y}px, rgba(139,92,246,0.06), transparent 50%)` }}
      />
      {children}
    </div>
  );
}

function TiltCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState("perspective(1000px) rotateX(0deg) rotateY(0deg)");

  const handleMouse = useCallback((e: React.MouseEvent) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTransform(`perspective(1000px) rotateX(${-y * 8}deg) rotateY(${x * 8}deg) scale3d(1.02,1.02,1.02)`);
  }, []);

  const reset = useCallback(() => setTransform("perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)"), []);

  return (
    <div ref={ref} onMouseMove={handleMouse} onMouseLeave={reset} className={cn("transition-transform duration-300 ease-out", className)} style={{ transform, transformStyle: "preserve-3d" }}>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// BACKGROUND EFFECTS
// ═══════════════════════════════════════════════════════════════════════════════

function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const particles: { x: number; y: number; vx: number; vy: number; size: number; opacity: number }[] = [];

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < 40; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 2 + 0.5,
        opacity: Math.random() * 0.15 + 0.03,
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(139, 92, 246, ${p.opacity})`;
        ctx.fill();
      });
      // Connect nearby particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(139, 92, 246, ${0.03 * (1 - dist / 150)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      animId = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", resize); };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-0" />;
}

function MeshGradient() {
  const [time, setTime] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTime((p) => p + 0.005), 50);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      {/* Primary gradient blob */}
      <div
        className="absolute w-[800px] h-[800px] rounded-full blur-[180px] opacity-20"
        style={{
          background: "radial-gradient(circle, rgba(139,92,246,0.4), rgba(99,102,241,0.2), transparent)",
          left: `${30 + Math.sin(time) * 10}%`,
          top: `${10 + Math.cos(time * 0.7) * 8}%`,
          transform: "translate(-50%, -50%)",
        }}
      />
      {/* Secondary blob */}
      <div
        className="absolute w-[600px] h-[600px] rounded-full blur-[150px] opacity-15"
        style={{
          background: "radial-gradient(circle, rgba(6,182,212,0.3), rgba(34,211,238,0.15), transparent)",
          right: `${20 + Math.cos(time * 0.8) * 12}%`,
          top: `${40 + Math.sin(time * 0.6) * 10}%`,
          transform: "translate(50%, -50%)",
        }}
      />
      {/* Tertiary blob */}
      <div
        className="absolute w-[500px] h-[500px] rounded-full blur-[130px] opacity-10"
        style={{
          background: "radial-gradient(circle, rgba(16,185,129,0.3), rgba(52,211,153,0.15), transparent)",
          left: `${70 + Math.sin(time * 1.2) * 8}%`,
          bottom: `${10 + Math.cos(time * 0.5) * 6}%`,
          transform: "translate(-50%, 50%)",
        }}
      />
      {/* Noise texture overlay */}
      <div className="absolute inset-0 opacity-[0.012]" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")", backgroundSize: "128px" }} />
      {/* Dot grid */}
      <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: "radial-gradient(circle, #000 0.8px, transparent 0.8px)", backgroundSize: "28px 28px" }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SVG WAVE DIVIDERS
// ═══════════════════════════════════════════════════════════════════════════════

function WaveTop({ fill = "#fff", className = "" }: { fill?: string; className?: string }) {
  return (
    <div className={cn("absolute top-0 left-0 right-0 -translate-y-[99%]", className)}>
      <svg viewBox="0 0 1440 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full" preserveAspectRatio="none">
        <path d="M0,60 C360,10 720,80 1080,30 C1260,10 1380,40 1440,20 L1440,80 L0,80Z" fill={fill} />
      </svg>
    </div>
  );
}

function WaveBottom({ fill = "#fff", className = "" }: { fill?: string; className?: string }) {
  return (
    <div className={cn("absolute bottom-0 left-0 right-0 translate-y-[99%]", className)}>
      <svg viewBox="0 0 1440 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full" preserveAspectRatio="none">
        <path d="M0,20 C360,70 720,0 1080,50 C1260,70 1380,40 1440,60 L1440,0 L0,0Z" fill={fill} />
      </svg>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACCORDION
// ═══════════════════════════════════════════════════════════════════════════════

function Accordion({ items }: { items: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div
          key={i}
          className={cn(
            "border rounded-2xl bg-white overflow-hidden transition-all duration-500",
            open === i ? "border-violet-200 shadow-lg shadow-violet-500/5" : "border-gray-200/50 hover:border-gray-300/60 hover:shadow-md"
          )}
        >
          <button
            onClick={() => setOpen(open === i ? null : i)}
            className="w-full flex items-center justify-between p-6 text-left group"
          >
            <span className="font-semibold text-[15px] text-gray-900 pr-4 group-hover:text-violet-600 transition-colors">
              {item.q}
            </span>
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300",
              open === i ? "bg-violet-50 rotate-180" : "bg-gray-50 group-hover:bg-violet-50"
            )}>
              <ChevronDown size={16} className={cn("transition-colors", open === i ? "text-violet-500" : "text-gray-400")} />
            </div>
          </button>
          <div
            className={cn(
              "transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
              open === i ? "max-h-60 opacity-100" : "max-h-0 opacity-0"
            )}
          >
            <div className="px-6 pb-6 pt-0">
              <p className="text-sm text-gray-500 leading-relaxed">{item.a}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANIMATED ILLUSTRATIONS
// ═══════════════════════════════════════════════════════════════════════════════

function AnimatedBox() {
  const [rotate, setRotate] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setRotate((p) => p + 0.5), 50);
    return () => clearInterval(t);
  }, []);
  return (
    <svg width="60" height="60" viewBox="0 0 60 60" fill="none" style={{ transform: `rotate(${rotate}deg)` }}>
      <rect x="10" y="10" width="40" height="40" rx="8" stroke="rgba(139,92,246,0.3)" strokeWidth="1.5" fill="rgba(139,92,246,0.03)" />
      <rect x="18" y="18" width="24" height="24" rx="4" stroke="rgba(139,92,246,0.5)" strokeWidth="1" fill="rgba(139,92,246,0.05)" />
      <circle cx="30" cy="30" r="4" fill="rgba(139,92,246,0.6)" />
    </svg>
  );
}

function OrbitalDots() {
  const [angle, setAngle] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setAngle((p) => p + 0.8), 30);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="relative w-24 h-24">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-3 h-3 rounded-full bg-violet-500 shadow-lg shadow-violet-500/30" />
      </div>
      {[0, 60, 120, 180, 240, 300].map((offset, i) => (
        <div
          key={i}
          className="absolute w-2 h-2 rounded-full bg-violet-300"
          style={{
            left: `${50 + 40 * Math.cos(((angle + offset) * Math.PI) / 180)}%`,
            top: `${50 + 40 * Math.sin(((angle + offset) * Math.PI) / 180)}%`,
            transform: "translate(-50%, -50%)",
            opacity: 0.4 + 0.3 * Math.sin(((angle + offset) * Math.PI) / 180),
          }}
        />
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN LANDING COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function Landing() {
  const navigate = useNavigate();
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
    { label: "Продукт", href: "#features" },
    { label: "Как работает", href: "#how" },
    { label: "Решения", href: "#roles" },
    { label: "Отзывы", href: "#testimonials" },
    { label: "Цены", href: "#pricing" },
  ], []);

  const features = useMemo(() => [
    { icon: Boxes, title: "Складской учёт", desc: "Остатки, резервы, движения товаров. Контроль dead-stock в реальном времени.", stat: "19 таблиц", gradient: "from-violet-500 via-purple-500 to-indigo-600" },
    { icon: Route, title: "Доставка", desc: "Назначение курьеров, GPS-трекинг, сбор наличных. Мобильное приложение.", stat: "Real-time", gradient: "from-emerald-400 via-teal-500 to-cyan-600" },
    { icon: BarChart3, title: "Аналитика", desc: "Dashboard с KPI, отчёты по продажам, P&L, задолженности.", stat: "20+ отчётов", gradient: "from-amber-400 via-orange-500 to-red-500" },
    { icon: Users, title: "Команда", desc: "6 ролей с правами доступа: от директора до курьера.", stat: "6 ролей", gradient: "from-cyan-400 via-blue-500 to-indigo-600" },
    { icon: Smartphone, title: "Мобильное приложение", desc: "React Native с офлайн-режимом, камерой, GPS и хаптикой.", stat: "iOS + Android", gradient: "from-pink-400 via-rose-500 to-red-500" },
    { icon: Shield, title: "Безопасность", desc: "Мультитенантность, JWT, rate limiting, tenant-изоляция.", stat: "Enterprise", gradient: "from-red-400 via-orange-500 to-amber-500" },
  ], []);

  const roles = useMemo(() => [
    { role: "Директор", icon: TrendingUp, color: "violet", features: ["Dashboard с KPI", "Финансовые отчёты", "Управление пользователями", "Настройки биллинга"] },
    { role: "Оператор", icon: Package, color: "cyan", features: ["Управление заказами", "Назначение курьеров", "Контроль склада", "Работа с 1C"] },
    { role: "Агент", icon: MapPin, color: "emerald", features: ["Создание заказов", "План визитов", "GPS-трекинг", "Офлайн-режим"] },
    { role: "Супервайзер", icon: Eye, color: "amber", features: ["Мониторинг агентов", "Управление планами", "Отчёты по визитам", "Трекинг в реальном времени"] },
    { role: "Мерчандайзер", icon: FileText, color: "pink", features: ["Отчёты о визитах", "Фото-фиксация", "Чек-лист товаров", "Заметки о конкурентах"] },
    { role: "Курьер", icon: Truck, color: "orange", features: ["Список доставок", "Навигация на карте", "Сбор наличных", "GPS-трекинг"] },
  ], []);

  const testimonials = useMemo(() => [
    { name: "Акбар Расулов", role: "Директор, LogiMax", text: "Warehouse Pro полностью изменил наш подход к дистрибуции. Агенты работают эффективнее, а я вижу всё в реальном времени. Раньше тратил часы на отчёты, теперь всё автоматически.", rating: 5, avatar: "АР" },
    { name: "Дилшод Камолдинов", role: "Оператор, TradeHub", text: "Раньше все заказы велись в Excel. Теперь всё автоматизировано. Ошибок стало в 10 раз меньше, а скорость обработки заказов выросла втрое. Команда в восторге.", rating: 5, avatar: "ДК" },
    { name: "Шерзод Абдуллаев", role: "Курьер, SupplyPro", text: "Мобильное приложение очень удобное. Офлайн-режим работает идеально — можно принимать заказы даже без интернета. GPS-трекинг помогает оптимизировать маршруты.", rating: 5, avatar: "ША" },
  ], []);

  const faqItems = useMemo(() => [
    { q: "Сколько времени занимает настройка?", a: "Базовая настройка занимает 5-10 минут. Вы регистрируетесь, добавляете компанию и товары, приглашаете команду — и система готова к работе. Для сложных интеграций с 1С мы предоставляем бесплатную помощь." },
    { q: "Можно ли интегрировать с 1С:Предприятие?", a: "Да, Warehouse Pro поддерживает двустороннюю синхронизацию с 1С:Предприятие. Товары, заказы, остатки и документы автоматически синхронизируются между системами." },
    { q: "Как работает мобильное приложение?", a: "Мобильное приложение построено на React Native и работает на iOS и Android. Оно поддерживает офлайн-режим, GPS-трекинг, камеру для фото-фиксации и push-уведомления." },
    { q: "Безопасны ли мои данные?", a: "Да, мы используем JWT-аутентификацию, шифрование данных, tenant-изоляцию и регулярные бэкапы. Все данные хранятся на защищённых серверах с сертификатами безопасности." },
    { q: "Есть ли бесплатный период?", a: "Да, вы можете бесплатно пользоваться системой 14 дней без ограничений. Привязка карты не требуется. После окончания пробного периода вы можете выбрать подходящий тариф." },
    { q: "Какая поддержка предоставляется?", a: "Для Basic — email-поддержка в рабочие дни. Для Pro — приоритетная поддержка и персональный менеджер. Для Exclusive — круглосуточная поддержка 24/7 и выделенный сервер." },
  ], []);

  return (
    <div className="min-h-screen bg-[#fafafa] text-gray-900 selection:bg-violet-200 selection:text-violet-900 overflow-x-hidden">
      <MeshGradient />
      <ParticleField />

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
              Войти
            </button>
            <MagneticButton
              onClick={() => navigate("/register")}
              className="h-9 px-5 bg-gray-900 text-white text-[13px] font-semibold rounded-xl hover:bg-gray-800 transition-all duration-300 shadow-sm hover:shadow-lg hover:shadow-gray-900/15"
            >
              Начать
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
                Войти
              </button>
              <button onClick={() => navigate("/register")} className="flex-1 h-10 bg-gray-900 text-white rounded-xl text-sm font-semibold hover:bg-gray-800 transition-colors">
                Начать
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
                Версия 2.0 — Уже доступна
                <span className="w-px h-3 bg-gray-200" />
                <span className="text-violet-600 font-semibold bg-violet-50 px-2 py-0.5 rounded-full">Новое</span>
              </div>

              {/* Headline */}
              <h1 className="text-[2.6rem] md:text-[4rem] lg:text-[5rem] font-black tracking-[-0.04em] leading-[0.92] mb-6">
                <span className="block text-gray-900">Управление</span>
                <span className="block bg-gradient-to-r from-violet-600 via-purple-500 to-indigo-600 bg-clip-text text-transparent">складом</span>
              </h1>

              {/* Subtitle */}
              <p className="text-[17px] md:text-lg text-gray-500 mb-10 max-w-lg mx-auto leading-relaxed">
                Мультитенантная WMS для дистрибьюторских компаний.
                <br className="hidden md:block" />
                Заказы, склад, доставка — всё в одном приложении.
              </p>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8">
                <MagneticButton
                  onClick={() => navigate("/register")}
                  className="group h-13 px-8 bg-gray-900 text-white rounded-2xl font-semibold text-[15px] hover:bg-gray-800 transition-all duration-300 flex items-center justify-center gap-2.5 shadow-xl shadow-gray-900/15 hover:shadow-2xl hover:shadow-gray-900/20 hover:-translate-y-0.5"
                >
                  Начать бесплатно
                  <ArrowRight size={17} className="group-hover:translate-x-1 transition-transform duration-300" />
                </MagneticButton>
                <button
                  onClick={() => setActiveTab(1)}
                  className="group h-13 px-8 border border-gray-200/80 rounded-2xl font-semibold text-[15px] text-gray-600 hover:bg-white hover:border-gray-300 transition-all duration-300 flex items-center justify-center gap-3 bg-white/50 backdrop-blur-sm hover:shadow-lg hover:-translate-y-0.5"
                >
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center group-hover:bg-violet-50 group-hover:scale-110 transition-all duration-300">
                    <Play size={13} className="fill-gray-500 group-hover:fill-violet-500 ml-0.5" />
                  </div>
                  Смотреть демо
                </button>
              </div>

              {/* Trust badges */}
              <div className="flex items-center justify-center gap-6 text-xs text-gray-400">
                <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-400" /> 14 дней бесплатно</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-400" /> Без привязки карты</span>
                <span className="flex items-center gap-1.5"><CheckCircle2 size={13} className="text-emerald-400" /> Настройка за 5 мин</span>
              </div>
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
                        {["Dashboard", "Карта", "Мобильное", "Аналитика"].map((tab, i) => (
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
          <p className="text-center text-[10px] text-gray-400 uppercase tracking-[0.3em] mb-8 font-medium">Используют ведущие дистрибьюторы</p>
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
                <Zap size={14} /> Как работает
              </div>
              <h2 className="text-3xl md:text-[2.5rem] font-black tracking-tight leading-tight mb-5">
                Три шага до полного контроля
              </h2>
              <p className="text-gray-500 text-lg leading-relaxed">Начните за 5 минут. Без установки, без сложной настройки.</p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-8 relative">
            <div className="hidden md:block absolute top-20 left-[22%] right-[22%] h-px">
              <div className="w-full h-full bg-gradient-to-r from-transparent via-violet-300 to-transparent" />
            </div>

            {[
              { step: "01", title: "Регистрация", desc: "Создайте аккаунт за 30 секунд. Настройте компанию, добавьте склад и товары.", icon: Zap, color: "violet", bg: "from-violet-500 to-purple-600" },
              { step: "02", title: "Настройка", desc: "Добавьте команду, назначьте роли, настройте интеграции с 1С и доставкой.", icon: Settings, color: "indigo", bg: "from-indigo-500 to-blue-600" },
              { step: "03", title: "Работа", desc: "Агенты создают заказы, курьеры доставляют, директор видит всё в реальном времени.", icon: Rocket, color: "cyan", bg: "from-cyan-500 to-teal-600" },
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
                <Layers size={14} /> Продукт
              </div>
              <h2 className="text-3xl md:text-[2.5rem] font-black tracking-tight leading-tight mb-5">
                Всё что нужно
                <br />
                <span className="text-gray-300">для вашего бизнеса</span>
              </h2>
              <p className="text-gray-500 text-lg leading-relaxed">От склада до доставки — полный контроль над процессами дистрибуции.</p>
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
                  <MapPin size={14} /> GPS-трекинг
                </div>
                <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-5">
                  Отслеживайте агентов
                  <br />
                  <span className="text-gray-300">в реальном времени</span>
                </h2>
                <p className="text-gray-500 text-lg leading-relaxed mb-8">
                  GPS-трекинг всех агентов и курьеров на карте. История маршрутов, контроль посещений, оптимизация доставки.
                </p>
                <ul className="space-y-4">
                  {[
                    "Живая карта с позициями всех агентов",
                    "История маршрутов за день / неделю / месяц",
                    "Контроль посещения торговых точек",
                    "Оптимизация маршрутов доставки",
                    "Уведомления о выходе за пределы зоны",
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
                  { v: 500, s: "+", l: "Компаний", color: "text-violet-600" },
                  { v: 10000, s: "+", l: "Заказов в день", color: "text-emerald-600" },
                  { v: 99, s: ".9%", l: "Uptime", color: "text-amber-600" },
                  { v: 24, s: "/7", l: "Поддержка", color: "text-cyan-600" },
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
                <Users size={14} /> Решения
              </div>
              <h2 className="text-3xl md:text-[2.5rem] font-black tracking-tight leading-tight mb-5">
                Для каждой
                <br />
                <span className="text-gray-300">роли в команде</span>
              </h2>
              <p className="text-gray-500 text-lg leading-relaxed">Каждый сотрудник видит только то, что ему нужно.</p>
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
                <Target size={14} /> Интеграции
              </div>
              <h2 className="text-3xl md:text-4xl font-black tracking-tight">
                Работает с вашими инструментами
              </h2>
            </div>
          </FadeIn>

          <Stagger className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { name: "1С:Предприятие", icon: "1C", desc: "Синхронизация данных", color: "hover:text-violet-600 hover:bg-violet-50" },
              { name: "Stripe", icon: "S", desc: "Безопасные платежи", color: "hover:text-indigo-600 hover:bg-indigo-50" },
              { name: "Telegram", icon: "T", desc: "Уведомления", color: "hover:text-cyan-600 hover:bg-cyan-50" },
              { name: "AWS S3", icon: "A", desc: "Хранилище файлов", color: "hover:text-amber-600 hover:bg-amber-50" },
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
                <Quote size={14} /> Отзывы
              </div>
              <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-4">Нам доверяют</h2>
              <p className="text-gray-500 text-lg">Что говорят наши клиенты</p>
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
                <Star size={14} /> Тарифы
              </div>
              <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-4">Прозрачные цены</h2>
              <p className="text-gray-500 text-lg">Начните бесплатно, растите с бизнесом.</p>
            </div>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {[
              { name: "Basic", price: "299 000", period: "сум/мес", features: ["5 пользователей", "1 000 товаров", "Базовая аналитика", "Складской учёт", "Email-поддержка"], hl: false },
              { name: "Pro", price: "599 000", period: "сум/мес", features: ["20 пользователей", "10 000 товаров", "Полная аналитика", "GPS-трекинг", "Интеграция с 1С", "Приоритетная поддержка"], hl: true },
              { name: "Exclusive", price: "1 299 000", period: "сум/мес", features: ["Без ограничений", "Без ограничений товаров", "API доступ", "White-label", "Персональный менеджер", "Выделенный сервер", "24/7 поддержка"], hl: false },
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
                      Популярный
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
                    Начать
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
              <h2 className="text-3xl md:text-4xl font-black tracking-tight">Частые вопросы</h2>
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
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(139,92,246,0.15),transparent_50%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(6,182,212,0.1),transparent_50%)]" />
              {/* Decorative elements */}
              <div className="absolute top-0 right-0 w-96 h-96 bg-violet-600/10 rounded-full blur-[100px]" />
              <div className="absolute bottom-0 left-0 w-64 h-64 bg-cyan-600/10 rounded-full blur-[80px]" />
              {/* Grid pattern */}
              <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

              <div className="relative px-8 py-20 md:px-16 md:py-24 text-center">
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-white/10 bg-white/5 text-xs text-gray-400 mb-8 backdrop-blur-sm">
                  <Sparkles size={14} className="text-violet-400" /> Присоединяйтесь к 500+ компаниям
                </div>
                <h2 className="text-4xl md:text-5xl font-black tracking-tight text-white mb-5">Готовы начать?</h2>
                <p className="text-gray-400 text-lg mb-10 max-w-md mx-auto leading-relaxed">14 дней бесплатно. Без привязки карты. Настройка за 5 минут.</p>
                <MagneticButton
                  onClick={() => navigate("/register")}
                  className="h-14 px-12 bg-white text-gray-900 rounded-2xl font-bold text-[15px] hover:bg-gray-100 transition-all duration-300 inline-flex items-center gap-3 shadow-2xl shadow-white/10 hover:shadow-white/15 hover:-translate-y-0.5"
                >
                  Начать бесплатно <ArrowRight size={18} />
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
              <p className="text-sm text-gray-400 leading-relaxed max-w-xs mb-6">Современная WMS для дистрибьюторов. Управляйте складом, заказами и доставкой из одного приложения.</p>
              <div className="flex gap-3">
                {["Twitter", "GitHub", "Discord"].map((s) => (
                  <span key={s} className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-200 cursor-pointer transition-all duration-200 font-medium">
                    {s[0]}
                  </span>
                ))}
              </div>
            </div>
            {[
              { t: "Продукт", items: ["Возможности", "Тарифы", "Интеграции", "API", "Документация"] },
              { t: "Компания", items: ["О нас", "Контакты", "Блог", "Вакансии"] },
              { t: "Поддержка", items: ["Центр помощи", "Статус системы", "Безопасность", "Контакты"] },
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
            <p className="text-xs text-gray-400">&copy; 2026 Warehouse Pro. Все права защищены.</p>
            <div className="flex gap-6">
              {["Политика конфиденциальности", "Условия использования"].map((s) => (
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
  return (
    <div className="space-y-3 animate-fade-in">
      <div className="grid grid-cols-4 gap-2.5">
        {[
          { l: "Заказы", v: "1,247", c: "+12.5%", color: "text-emerald-600", icon: Package },
          { l: "Выручка", v: "89.5M", c: "+8.3%", color: "text-emerald-600", icon: TrendingUp },
          { l: "Товары", v: "3,421", c: "+5.1%", color: "text-emerald-600", icon: Boxes },
          { l: "Агенты", v: "24", c: "онлайн", color: "text-blue-600", icon: Users },
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
          <div className="text-[9px] text-gray-400 uppercase tracking-wider mb-3 font-semibold">Продажи за месяц</div>
          <div className="h-32 flex items-end gap-1">
            {[35, 55, 40, 70, 50, 85, 65, 80, 55, 90, 70, 88].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t transition-all duration-700 hover:opacity-100"
                style={{
                  height: `${h}%`,
                  background: `linear-gradient(to top, rgba(139,92,246,${i === 11 ? 0.8 : 0.2}), rgba(99,102,241,${i === 11 ? 0.5 : 0.05}))`,
                }}
              />
            ))}
          </div>
        </div>
        <div className="p-4 rounded-xl bg-gradient-to-br from-gray-50/80 to-white border border-gray-200/30">
          <div className="text-[9px] text-gray-400 uppercase tracking-wider mb-3 font-semibold">Статусы</div>
          <div className="space-y-3">
            {[{ l: "Новые", v: 23, c: "#8b5cf6" }, { l: "В работе", v: 15, c: "#f59e0b" }, { l: "Выполнены", v: 89, c: "#10b981" }].map((s) => (
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
        <rect x="85" y="55" width="50" height="28" rx="2" fill="#c9c4bc" opacity="0.45" />
        <rect x="160" y="55" width="35" height="24" rx="2" fill="#c9c4bc" opacity="0.45" />
        <rect x="310" y="55" width="45" height="26" rx="2" fill="#c9c4bc" opacity="0.45" />
        <rect x="85" y="195" width="45" height="30" rx="2" fill="#c9c4bc" opacity="0.45" />
        <rect x="310" y="195" width="50" height="28" rx="2" fill="#c9c4bc" opacity="0.45" />
        <rect x="460" y="100" width="70" height="50" rx="8" fill="#b8d4a8" opacity="0.4" />
        <rect x="60" y="290" width="60" height="40" rx="8" fill="#b8d4a8" opacity="0.4" />
        <ellipse cx="520" cy="290" rx="45" ry="25" fill="#a8c8d8" opacity="0.3" />
      </svg>
      {/* Route */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 600 360">
        <defs>
          <linearGradient id="routeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#06b6d4" />
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
            <span className="text-[11px] text-gray-500">Агенты онлайн</span>
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">2</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">Курьеры в пути</span>
            <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">1</span>
          </div>
          <div className="h-px bg-gray-100" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">Прогресс</span>
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
  return (
    <div className="flex justify-center py-4">
      <div className="w-56 h-[380px] rounded-[2.5rem] bg-gradient-to-b from-gray-50 to-gray-100 border-[3px] border-gray-300 overflow-hidden shadow-2xl shadow-gray-900/10 relative">
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-6 bg-gray-900 rounded-b-2xl z-10" />
        <div className="h-10 bg-white flex items-center justify-center border-b border-gray-200/60">
          <div className="text-[8px] text-gray-400 font-semibold">9:41</div>
        </div>
        <div className="p-3.5 space-y-2 bg-white">
          <div className="text-center text-[9px] text-gray-400 font-bold tracking-widest uppercase mb-1">Главная</div>
          <div className="grid grid-cols-2 gap-2">
            {[{ i: Package, l: "Заказы", v: "12", c: "from-violet-500 to-indigo-500" }, { i: MapPin, l: "Магазины", v: "48", c: "from-emerald-500 to-teal-500" }, { i: TrendingUp, l: "Выручка", v: "2.1M", c: "from-amber-500 to-orange-500" }, { i: Clock, l: "Планы", v: "6/8", c: "from-cyan-500 to-blue-500" }].map((item) => (
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
            <div className="text-[7px] text-gray-400 mb-1.5 font-semibold">Прогресс дня</div>
            <div className="h-1.5 bg-gray-200/40 rounded-full overflow-hidden">
              <div className="h-full w-[75%] bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full" />
            </div>
            <div className="text-[8px] text-emerald-600 mt-1 font-bold">75% · 6 из 8 визитов</div>
          </div>
          <div className="bg-gray-50/80 rounded-xl p-2.5 border border-gray-200/30">
            <div className="text-[7px] text-gray-400 mb-1 font-semibold">Ближайший визит</div>
            <div className="text-[10px] font-bold text-gray-900">Рынок "Боғ"</div>
            <div className="text-[7px] text-gray-400 mt-0.5">ул. Беруни, 42 · 2.3 км</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalyticsPreview() {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="p-4 rounded-xl bg-gradient-to-br from-gray-50/80 to-white border border-gray-200/30">
        <div className="text-[9px] text-gray-400 uppercase tracking-wider mb-3 font-bold">Топ товары</div>
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
        <div className="text-[9px] text-gray-400 uppercase tracking-wider mb-3 font-bold">По регионам</div>
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
