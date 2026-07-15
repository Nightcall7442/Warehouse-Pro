import { useState, useEffect, useRef } from "react";

export function ParticleField() {
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

export function MeshGradient() {
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
          background: "radial-gradient(circle, rgba(167,139,250,0.4), rgba(75,108,246,0.2), transparent)",
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
