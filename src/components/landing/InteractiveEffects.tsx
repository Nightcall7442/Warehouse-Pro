import { useState, useRef, useCallback, type ReactNode, type CSSProperties } from "react";

const cn = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

export function MagneticButton({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
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

export function GlowCard({ children, className = "" }: { children: ReactNode; className?: string }) {
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
        style={{ background: `radial-gradient(400px circle at ${mousePos.x}px ${mousePos.y}px, rgba(167,139,250,0.06), transparent 50%)` }}
      />
      {children}
    </div>
  );
}

export function TiltCard({ children, className = "" }: { children: ReactNode; className?: string }) {
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
