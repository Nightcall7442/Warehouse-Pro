import { useState, useEffect } from "react";

export function AnimatedBox() {
  const [rotate, setRotate] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setRotate((p) => p + 0.5), 50);
    return () => clearInterval(t);
  }, []);
  return (
    <svg width="60" height="60" viewBox="0 0 60 60" fill="none" style={{ transform: `rotate(${rotate}deg)` }}>
      <rect x="10" y="10" width="40" height="40" rx="8" stroke="rgba(167,139,250,0.3)" strokeWidth="1.5" fill="rgba(167,139,250,0.03)" />
      <rect x="18" y="18" width="24" height="24" rx="4" stroke="rgba(167,139,250,0.5)" strokeWidth="1" fill="rgba(167,139,250,0.05)" />
      <circle cx="30" cy="30" r="4" fill="rgba(167,139,250,0.6)" />
    </svg>
  );
}

export function Typewriter({ words, className = "" }: { words: string[]; className?: string }) {
  const [index, setIndex] = useState(0);
  const [text, setText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentWord = words[index];
    const timeout = setTimeout(() => {
      if (!isDeleting) {
        setText(currentWord.slice(0, text.length + 1));
        if (text.length === currentWord.length) {
          setTimeout(() => setIsDeleting(true), 2000);
        }
      } else {
        setText(currentWord.slice(0, text.length - 1));
        if (text.length === 0) {
          setIsDeleting(false);
          setIndex((prev) => (prev + 1) % words.length);
        }
      }
    }, isDeleting ? 50 : 100);

    return () => clearTimeout(timeout);
  }, [text, isDeleting, index, words]);

  return (
    <span className={className}>
      {text}
      <span className="animate-pulse">|</span>
    </span>
  );
}

export function LiveStatsTicker() {
  const [stats, setStats] = useState({
    orders: 12847,
    products: 3420,
    agents: 156,
    uptime: 99.9,
  });

  useEffect(() => {
    const t = setInterval(() => {
      setStats(prev => ({
        orders: prev.orders + Math.floor(Math.random() * 3),
        products: prev.products + (Math.random() > 0.8 ? 1 : 0),
        agents: prev.agents + (Math.random() > 0.95 ? 1 : 0),
        uptime: 99.9 + Math.random() * 0.09,
      }));
    }, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-wrap justify-center gap-6 md:gap-10">
      {[
        { label: "Заказов сегодня", value: stats.orders.toLocaleString(), color: "#8b5cf6" },
        { label: "Товаров в системе", value: stats.products.toLocaleString(), color: "#06b6d4" },
        { label: "Агентов онлайн", value: stats.agents.toString(), color: "#10b981" },
        { label: "Uptime", value: stats.uptime.toFixed(1) + "%", color: "#f59e0b" },
      ].map((stat, i) => (
        <div key={i} className="text-center">
          <p className="text-2xl md:text-3xl font-black tracking-tight" style={{ color: stat.color }}>
            {stat.value}
          </p>
          <p className="text-[11px] text-gray-400 mt-1 font-medium uppercase tracking-wider">
            {stat.label}
          </p>
        </div>
      ))}
    </div>
  );
}

export function FloatingNotification() {
  const [visible, setVisible] = useState(false);
  const [notification, setNotification] = useState({ name: "", action: "", time: "" });

  const notifications = [
    { name: "Акбар", action: "создал заказ на 2.4M сум", time: "только что" },
    { name: "Дилшод", action: "доставил 12 заказов", time: "2 мин назад" },
    { name: "Шерзод", action: "завершил визит в TradeHub", time: "5 мин назад" },
    { name: "Нозим", action: "синхронизировал 1С", time: "только что" },
  ];

  useEffect(() => {
    let idx = 0;
    const show = () => {
      setNotification(notifications[idx % notifications.length]);
      setVisible(true);
      setTimeout(() => setVisible(false), 4000);
      idx++;
    };
    const t = setInterval(show, 8000);
    setTimeout(show, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className={cn(
      "fixed bottom-6 left-6 z-50 transition-all duration-500",
      visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0 pointer-events-none"
    )}>
      <div className="bg-white/90 backdrop-blur-xl rounded-2xl px-4 py-3 shadow-xl shadow-gray-900/10 border border-gray-200/40 flex items-center gap-3 max-w-xs">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
          {notification.name[0]}
        </div>
        <div>
          <p className="text-sm font-medium text-gray-900">
            <span className="font-semibold">{notification.name}</span>{" "}
            <span className="text-gray-500">{notification.action}</span>
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">{notification.time}</p>
        </div>
      </div>
    </div>
  );
}

export function OrbitalDots() {
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

const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");
