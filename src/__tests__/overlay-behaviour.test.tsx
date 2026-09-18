// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { lockScroll, scrollLockDepth, useOverlay } from "@/lib/overlay";
import { LangProvider } from "@/i18n";

const stub = vi.hoisted(() => ({ mutate: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/providers/trpc", () => ({ trpc: {
  shop: { addPayment: { useMutation: () => ({ mutate: stub.mutate, isPending: false }) } },
  useUtils: () => ({ shop: { invalidate: stub.invalidate }, dashboard: { invalidate: stub.invalidate } }),
  settings: { get: { useQuery: () => ({ data: undefined }) } },
  auth: { me: { useQuery: () => ({ data: undefined }) } },
} }));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

/**
 * Одно поведение для всех окон (владелец, 18.09.2026: «задняя страница
 * двигается вниз, и таких дохуя везде»).
 *
 *   · замок прибивает тело страницы на месте (fixed, top = −scrollY), не
 *     даёт ей дёрнуться вбок (отступ под полосу прокрутки) и возвращает
 *     прокрутку ровно туда, где была; окно поверх окна снимает замок только
 *     с последним; повторное снятие — ничего;
 *   · useOverlay: Escape закрывает пустое окно и не трогает окно с работой;
 *     фокус возвращается туда, откуда открыли;
 *   · КАЖДЫЙ файл со своим полноэкранным слоем (портал + fixed inset-0)
 *     либо стоит на AppModal, либо зовёт useOverlay — иначе у него нет ни
 *     замка, ни Escape. Список исключений — выпадашки и слои Radix — явный.
 *   · окно платежа магазина: общее окно, способ оплаты, деньги на странице
 *     обновляются целиком.
 */
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

describe("замок прокрутки", () => {
  beforeEach(() => { document.body.removeAttribute("style"); Object.defineProperty(window, "scrollY", { value: 480, configurable: true, writable: true }); });
  it("прибивает тело на месте, возвращает прокрутку, считает вложенность", () => {
    const scrollTo = vi.fn(); Object.defineProperty(window, "scrollTo", { value: scrollTo, configurable: true, writable: true });
    const a = lockScroll();
    expect(document.body.style.position).toBe("fixed");
    expect(document.body.style.top).toBe("-480px");
    expect(document.body.style.overflow).toBe("hidden");
    expect(scrollLockDepth()).toBe(1);
    const b = lockScroll();
    expect(scrollLockDepth()).toBe(2);
    b(); b(); // второе снятие — ничего
    expect(scrollLockDepth()).toBe(1);
    expect(document.body.style.position).toBe("fixed");
    a();
    expect(scrollLockDepth()).toBe(0);
    expect(document.body.style.position).toBe("");
    expect(document.body.style.top).toBe("");
    expect(scrollTo).toHaveBeenCalledWith(0, 480);
  });
  it("снимает залипший pointer-events с body", () => {
    document.body.style.pointerEvents = "none";
    const off = lockScroll();
    expect(document.body.style.pointerEvents).toBe("");
    off();
  });
});

function Probe({ dirty, onClose }: { dirty?: boolean; onClose: () => void }) {
  useOverlay({ open: true, onClose, dirty });
  return <div>окно</div>;
}

describe("useOverlay", () => {
  afterEach(cleanup);
  it("Escape закрывает пустое окно, не трогает окно с работой; фокус возвращается", () => {
    const btn = document.createElement("button"); document.body.appendChild(btn); btn.focus();
    const onClose = vi.fn();
    const r = render(<Probe onClose={onClose} />);
    expect(scrollLockDepth()).toBe(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    r.rerender(<Probe onClose={onClose} dirty />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    r.unmount();
    expect(scrollLockDepth()).toBe(0);
    expect(document.activeElement).toBe(btn);
    btn.remove();
  });
});

describe("все окна — на общем поведении", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".tsx") ? [p] : []; });
  // Не окна: выпадашки со слоем-ловушкой клика и слои Radix (react-remove-scroll держит их сам).
  const NOT_MODAL = new Set(["src/components/PremiumSelect.tsx", "src/components/products/CategoryAutocomplete.tsx", "src/components/orders/ColumnSettings.tsx", "src/components/ui/sheet.tsx", "src/components/Layout.tsx"]);
  it("файл с полноэкранным слоем зовёт useOverlay или стоит на AppModal", () => {
    const offenders: string[] = [];
    for (const abs of walk(join(ROOT, "src"))) {
      const rel = abs.slice(ROOT.length + 1).replace(/\\/g, "/");
      if (rel.startsWith("src/__tests__/") || rel === "src/components/ui/AppModal.tsx" || NOT_MODAL.has(rel)) continue;
      const src = read(rel);
      const overlay = /createPortal\(/.test(src) || /fixed inset-0/.test(src) || /position: "fixed", inset: 0/.test(src);
      if (!overlay) continue;
      if (!/useOverlay\(/.test(src) && !/<AppModal/.test(src)) offenders.push(rel);
    }
    expect(offenders, "окно без замка прокрутки и Escape").toEqual([]);
  });
  it("сканер выше любого окна, подтверждение — выше сканера", () => {
    // Сканер зовут из формы прихода и быстрого заказа (AppModal: 9999/10000).
    expect(read("src/components/BarcodeScanner.tsx")).toContain("fixed inset-0 z-[20000]");
    expect(read("src/components/ui/AppModal.tsx")).toContain("z-[10000]");
    expect(read("src/components/ConfirmDialog.tsx")).toContain("zIndex: 99999");
  });
  it("AppModal и ConfirmDialog не держат свой замок — только общий", () => {
    for (const p of ["src/components/ui/AppModal.tsx", "src/components/ConfirmDialog.tsx", "src/components/orders/ProductSelector.tsx"]) {
      expect(read(p), `${p}: свой overflow`).not.toContain('document.body.style.overflow = "hidden"');
      expect(read(p)).toContain("useOverlay(");
    }
  });
});

describe("окно платежа магазина", () => {
  it("общее окно, способ оплаты, обновляет все деньги страницы", () => {
    const src = read("src/pages/ShopDetail.tsx");
    const modal = src.slice(src.indexOf("function PaymentModal("), src.indexOf("export default function ShopDetail"));
    expect(modal).toContain("<AppModal open onClose={onClose} dirty={amount !== \"\" || notes !== \"\"}");
    expect(modal).toContain("utils.shop.invalidate();");
    expect(modal).toContain("paymentMethod: method");
    expect(modal).toContain("const valid = Number.isFinite(amt) && amt > 0;");
    expect(modal).not.toContain("createPortal");
    const router = read("api/shop-router.ts");
    expect(router).toContain('paymentMethod: z.enum(["cash", "card", "transfer"]).default("cash"),');
    const svc = read("api/services/payment.ts");
    expect(svc).toContain('receivedAt: type === "payment" && paymentMethod === "cash" ? new Date() : null,');
  });
  it("окно рисуется, форма закрыта до суммы, «Записать» шлёт способ", async () => {
    const { PaymentModal } = await import("@/pages/ShopDetail");
    render(<LangProvider><PaymentModal shopId={5} shopName="Магазин Альфа" onClose={() => {}} /></LangProvider>);
    const submit = screen.getByTestId("payment-submit") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("payment-amount"), { target: { value: "0" } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("payment-amount"), { target: { value: "150000" } });
    fireEvent.click(screen.getByTestId("payment-method-transfer"));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(stub.mutate).toHaveBeenCalledWith(expect.objectContaining({ shopId: 5, amount: "150000", type: "payment", paymentMethod: "transfer" }));
    cleanup();
  });
});
