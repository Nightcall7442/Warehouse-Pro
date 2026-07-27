import { useEffect, useState, useRef, type ReactNode } from "react";
import { ChevronDown, MapPin } from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS — Soft UI / Neumorphic
// ═══════════════════════════════════════════════════════════════════════════

export const cn = (...classes: (string | false | null | undefined)[]) =>
  classes.filter(Boolean).join(" ");

export const NEU = {
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

export const raised = "shadow-[6px_6px_14px_rgba(163,158,143,0.35),-6px_-6px_14px_rgba(255,255,255,0.9)]";
export const raisedSm = "shadow-[3px_3px_7px_rgba(163,158,143,0.35),-3px_-3px_7px_rgba(255,255,255,0.9)]";
export const raisedLg = "shadow-[9px_9px_22px_rgba(163,158,143,0.38),-9px_-9px_22px_rgba(255,255,255,0.92)]";
export const insetSm = "shadow-[inset_2px_2px_5px_rgba(163,158,143,0.3),inset_-2px_-2px_5px_rgba(255,255,255,0.75)]";

export const ROLE_TONES = [NEU.accent, NEU.blue, NEU.green, NEU.coral];

// ═══════════════════════════════════════════════════════════════════════════
// PRIMITIVES
// ═══════════════════════════════════════════════════════════════════════════

export function FadeIn({
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

export function Stagger({
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

export function Counter({ target }: { target: number }) {
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

export function ProgressRing({
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

export function NeuButton({
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

export function NeuCard({
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

export function Eyebrow({ icon: Icon, children }: { icon: typeof ChevronDown; children: ReactNode }) {
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

export function Accordion({ items }: { items: { q: string; a: string }[] }) {
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

export function ScrollProgress() {
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

export function ProductPreview({ tr }: { tr: (ru: string, uz: string) => string }) {
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
