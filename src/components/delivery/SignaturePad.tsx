import { useEffect, useRef, useState } from "react";
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
*/

export function SignaturePad({ onChange, height = 160 }: {
  onChange: (sig: Signature | null) => void;
  height?: number;
}) {
  const t = useTranslate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<RawPoint[][]>([]);
  const drawingRef = useRef(false);
  const [empty, setEmpty] = useState(true);

  // Холст в настоящих пикселях экрана: иначе линия на телефоне мыльная.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(r.width * dpr));
    c.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = c.getContext?.("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = getComputedStyle(c).color;
    }
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>): RawPoint => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
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
    const r = e.currentTarget.getBoundingClientRect();
    const sig = normalizeSignature(strokesRef.current, r.width, r.height);
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
