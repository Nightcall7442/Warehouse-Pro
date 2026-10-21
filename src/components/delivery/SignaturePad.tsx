import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { useTranslate } from "@/i18n";
import { normalizeSignature, type RawPoint, type Signature } from "@contracts/delivery-proof";

/*
  Подпись получателя пальцем на экране курьера.

  На сервер уходит не картинка, а числа: рамка и штрихи (contracts/
  delivery-proof.ts). Так подпись весит сотни байт вместо сотен килобайт, а
  карточка заказа рисует её сама — и ничего, кроме линий, в ней оказаться не
  может.

  Цвет чернил берётся из вычисленного цвета самого холста (color из темы):
  canvas не понимает var(--…), а вписанное значение разошлось бы с тёмной
  темой.

  ── Размер — по раскладке, не по рамке на экране ───────────────────────────

  Холст мерился getBoundingClientRect() при открытии, а окно подтверждения
  въезжает с увеличением (animate-scale-in, 0.95 → 1): рамка в этот миг на
  5% меньше настоящей, холст получал меньший растр, и линия ложилась мимо
  пальца. Поворот телефона растр не менял вовсе. Теперь размер — clientWidth/
  clientHeight (их не трогают трансформации), пересчёт — по ResizeObserver,
  а точка пальца переводится из экранной рамки в раскладку.
*/

export function SignaturePad({ onChange, height = 160 }: {
  onChange: (sig: Signature | null) => void;
  height?: number;
}) {
  const t = useTranslate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<RawPoint[][]>([]);
  const drawingRef = useRef(false);
  /** Размер холста в раскладке, по которому записаны штрихи. */
  const sizeRef = useRef({ w: 0, h: 0 });
  const [empty, setEmpty] = useState(true);

  // Холст в настоящих пикселях экрана: иначе линия на телефоне мыльная.
  // Новый размер (поворот, конец анимации окна) — штрихи растягиваются за
  // ним и рисуются заново: подпись не пропадает и не съезжает.
  const fit = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    const old = sizeRef.current;
    if (old.w === w && old.h === h) return;
    if (old.w && old.h) {
      strokesRef.current = strokesRef.current.map(st => st.map(p => ({ x: (p.x * w) / old.w, y: (p.y * h) / old.h })));
    }
    sizeRef.current = { w, h };
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const ctx = c.getContext?.("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(c).color;
    for (const st of strokesRef.current) {
      if (st.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(st[0].x, st[0].y);
      for (const p of st.length > 1 ? st.slice(1) : [{ x: st[0].x + 0.1, y: st[0].y }]) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    fit();
    if (!c || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(c);
    return () => ro.disconnect();
  }, [fit]);

  /** Точка пальца — в координатах раскладки, даже пока окно ещё въезжает с масштабом. */
  const point = (e: React.PointerEvent<HTMLCanvasElement>): RawPoint => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    const sx = r.width > 0 && c.clientWidth > 0 ? c.clientWidth / r.width : 1;
    const sy = r.height > 0 && c.clientHeight > 0 ? c.clientHeight / r.height : 1;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    fit();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    const p = point(e);
    strokesRef.current.push([p]);
    const ctx = e.currentTarget.getContext?.("2d");
    if (ctx) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.1, p.y); ctx.stroke(); }
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    const prev = stroke[stroke.length - 1];
    const p = point(e);
    stroke.push(p);
    const ctx = e.currentTarget.getContext?.("2d");
    if (ctx) { ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const c = e.currentTarget;
    const sig = normalizeSignature(strokesRef.current, c.clientWidth || sizeRef.current.w, c.clientHeight || sizeRef.current.h);
    setEmpty(!sig);
    onChange(sig);
  };

  const clear = () => {
    strokesRef.current = [];
    const c = canvasRef.current;
    const ctx = c?.getContext?.("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up}
          aria-label={t("Поле для подписи", "Imzo maydoni")}
          role="img"
          className="w-full block rounded-xl"
          style={{ height, touchAction: "none", color: "var(--color-text-primary)", background: "var(--color-surface-light)", boxShadow: "var(--shadow-pressed)" }}
          data-testid="signature-pad"
        />
        {empty && (
          <span className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>
            {t("Распишитесь пальцем", "Barmoq bilan imzo qo'ying")}
          </span>
        )}
      </div>
      {!empty && (
        <button type="button" onClick={clear} className="neo-btn tap flex items-center gap-1.5 mt-2" style={{ minHeight: 40, padding: "0 12px", fontSize: 13 }}
          data-testid="signature-clear">
          <Eraser size={14} />{t("Стереть", "O'chirish")}
        </button>
      )}
    </div>
  );
}
