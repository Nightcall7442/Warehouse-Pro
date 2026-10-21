// @vitest-environment jsdom
/**
 * Подпись пальцем: холст — по раскладке, а не по рамке на экране.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Растр холста берётся из clientWidth/clientHeight. Окно подтверждения
 *     въезжает с масштабом 0.95, и getBoundingClientRect в этот миг на 5%
 *     меньше: растр по нему был меньше холста, линия ложилась мимо пальца.
 *  2. Точка пальца переводится из экранной рамки в раскладку: середина
 *     рамки — середина холста и при масштабе.
 *  3. Новый размер (поворот телефона) — растр пересчитан, штрихи растянуты
 *     за ним: подпись не съезжает и не теряется.
 *
 * Нарочная поломка: в SignaturePad верни размер из getBoundingClientRect —
 * падает 1; убери пересчёт штрихов в fit() — падает 3.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("@/i18n", () => ({ useTranslate: () => (ru: string) => ru }));

const { SignaturePad } = await import("./SignaturePad");

let layout = { w: 400, h: 160 };
/** Рамка на экране — в масштабе 0.95, как в середине анимации окна. */
const rect = () => ({ left: 10, top: 20, width: layout.w * 0.95, height: layout.h * 0.95, right: 0, bottom: 0, x: 10, y: 20, toJSON: () => ({}) });
let resize: (() => void) | null = null;

beforeEach(() => {
  layout = { w: 400, h: 160 };
  Object.defineProperty(HTMLCanvasElement.prototype, "clientWidth", { configurable: true, get: () => layout.w });
  Object.defineProperty(HTMLCanvasElement.prototype, "clientHeight", { configurable: true, get: () => layout.h });
  HTMLCanvasElement.prototype.getBoundingClientRect = rect as unknown as () => DOMRect;
  vi.stubGlobal("ResizeObserver", class { constructor(cb: () => void) { resize = cb; } observe() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resize = null;
});

describe("подпись пальцем", () => {
  it("1. растр — по раскладке, не по сжатой рамке", () => {
    render(<SignaturePad onChange={() => {}} />);
    const c = screen.getByTestId("signature-pad") as HTMLCanvasElement;
    expect(c.width).toBe(400 * (window.devicePixelRatio || 1));
    expect(c.height).toBe(160 * (window.devicePixelRatio || 1));
  });

  it("2. середина рамки — середина холста и при масштабе", () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const c = screen.getByTestId("signature-pad");
    const r = rect();
    fireEvent.pointerDown(c, { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 1 });
    fireEvent.pointerMove(c, { clientX: r.left + r.width, clientY: r.top + r.height, pointerId: 1 });
    fireEvent.pointerUp(c, { pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith({ w: 1000, h: 400, strokes: [[500, 200, 1000, 400]] });
  });

  it("3. поворот — растр новый, штрихи растянуты за ним", () => {
    const onChange = vi.fn();
    render(<SignaturePad onChange={onChange} />);
    const c = screen.getByTestId("signature-pad") as HTMLCanvasElement;
    fireEvent.pointerDown(c, { clientX: 10, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(c, { clientX: 10 + rect().width, clientY: 20 + rect().height, pointerId: 1 });
    layout = { w: 800, h: 320 };
    resize?.();
    expect(c.width).toBe(800 * (window.devicePixelRatio || 1));
    fireEvent.pointerUp(c, { pointerId: 1 });
    expect(onChange).toHaveBeenLastCalledWith({ w: 1000, h: 400, strokes: [[0, 0, 1000, 400]] });
  });
});
