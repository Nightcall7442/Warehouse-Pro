import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { frameAt, type Listener } from "./scroll-scrub";

/* ═══════════════════════════════════════════════════════════════════════════
   ХОЛСТ-ПЛЁНКА

   Рисует кадр по прогрессу: между соседними кадрами — перекрёстное
   затухание, так что и четыре снимка программы, и сотня кадров из видео
   читаются как одно непрерывное движение. Под холстом всегда лежит первый
   кадр обычной картинкой: пока плёнка грузится (или холст недоступен),
   читатель видит кадр, а не дыру.

   Кадры декодируются заранее, начиная с первого; прогресс, попавший на ещё
   не готовый кадр, рисует ближайший готовый — плёнка не «мигает».
   ═══════════════════════════════════════════════════════════════════════════ */

export function SequenceCanvas({
  frames, subscribe, alt = "", fit = "cover", anchor = "top", className = "", style,
}: {
  frames: string[];
  subscribe: (fn: Listener) => () => void;
  alt?: string;
  /** cover — кадр заполняет холст (обрезка), contain — целиком. Позицию (absolute/relative) задаёт вызывающий через className. */
  fit?: "cover" | "contain";
  /** Откуда обрезать при cover: сверху (экраны приложения) или по центру. */
  anchor?: "top" | "center";
  className?: string;
  style?: CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const framesKey = frames.join("|");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || frames.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const images: Array<HTMLImageElement | null> = frames.map(() => null);
    let alive = true;
    let last = -1;

    const draw = (img: HTMLImageElement, alpha: number) => {
      const w = canvas.width, h = canvas.height;
      const s = fit === "cover" ? Math.max(w / img.naturalWidth, h / img.naturalHeight) : Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      const dx = (w - dw) / 2, dy = anchor === "top" ? 0 : (h - dh) / 2;
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, dx, dy, dw, dh);
    };
    const nearest = (i: number) => {
      for (let d = 0; d < images.length; d++) {
        if (images[i - d]) return images[i - d];
        if (images[i + d]) return images[i + d];
      }
      return null;
    };
    const render = (p: number) => {
      const [i, t] = frameAt(p, frames.length);
      const a = nearest(i), b = images[i + 1] ?? null;
      if (!a) return;
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      draw(a, 1);
      if (b && b !== a && t > 0) draw(b, t);
      ctx.globalAlpha = 1;
    };
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; render(last < 0 ? 0 : last); }
    };
    // Плёнка грузится, когда секция в полутора экранах от читателя, а не при
    // открытии страницы: у сотни кадров есть вес, у покупателя — 3G.
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      frames.forEach((src, i) => {
        const img = new Image();
        img.decoding = "async";
        img.onload = () => { if (!alive) return; images[i] = img; if (last >= 0) render(last); else if (i === 0) render(0); };
        img.src = src;
      });
    };
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === "undefined") load();
    else { io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { load(); io?.disconnect(); } }, { rootMargin: "150% 0px 150% 0px" }); io.observe(canvas); }
    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);
    const off = subscribe(p => { if (p !== last) { last = p; render(p); } });
    return () => { alive = false; off(); ro?.disconnect(); io?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framesKey, subscribe, fit, anchor]);

  return (
    <div className={`overflow-hidden ${className}`} style={style}>
      <img src={frames[0]} alt={alt} decoding="async" className="absolute inset-0 w-full h-full" style={{ objectFit: fit, objectPosition: anchor === "top" ? "top" : "center" }} />
      <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 w-full h-full" />
    </div>
  );
}
