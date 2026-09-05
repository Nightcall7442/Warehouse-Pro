import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Всё, что прижато к низу экрана, должно подниматься над клавиатурой.
 *
 * Панели стоят с position: fixed и bottom, то есть у края ЭКРАНА, а не
 * видимой области. Клавиатура накрывает их целиком — вместе с кнопкой
 * «Продолжить» и полем количества в корзине, ради которого её и открывали.
 *
 * Спастись прокруткой нельзя: страница на время открытой корзины стоит с
 * overflow: hidden, а прокрутка окна фиксированный элемент не двигает.
 * Поднимать должна сама панель — на --keyboard-inset, который ставит
 * src/hooks/useKeyboardInset.ts.
 *
 * Высоту корзины приходится ограничивать отдельно: 82vh считается от полного
 * экрана, и с открытой клавиатурой панель оказывается выше, чем осталось
 * места.
 *
 * Проверено замером на 375×700 с клавиатурой в 330: корзина 58…370 при
 * свободных 370, поле 183…227 — видно целиком.
 */
const CSS = fs.readFileSync(path.resolve(process.cwd(), "src/index.css"), "utf8");

/** Тело правила с этим селектором. */
function rule(selector: string): string {
  const at = CSS.indexOf(selector + " {");
  expect(at, `правило ${selector} не найдено — переименовали?`).toBeGreaterThan(0);
  return CSS.slice(at, CSS.indexOf("}", at));
}

describe("клавиатура и нижние панели", () => {
  it("панель с «Продолжить» поднимается на высоту клавиатуры", () => {
    expect(rule(".keyboard-open .order-action-bar")).toContain("var(--keyboard-inset");
  });

  it("выдвижная корзина поднимается и укорачивается", () => {
    const body = rule(".keyboard-open .order-cart-sheet");
    expect(body, "корзина не поднимается — останется под клавиатурой").toContain("bottom: var(--keyboard-inset");
    expect(body, "высота не ограничена — панель выше оставшегося места").toContain("max-height");
  });

  it("нижняя навигация на время набора убирается", () => {
    // 60 точек в половине экрана дороги, а переходить во время набора незачем.
    expect(rule(".keyboard-open .bottom-nav-premium")).toContain("display: none");
  });

  it("переменную кто-то ставит — иначе все правила выше пустые", () => {
    const hook = fs.readFileSync(path.resolve(process.cwd(), "src/hooks/useKeyboardInset.ts"), "utf8");
    expect(hook).toContain('setProperty("--keyboard-inset"');
    expect(hook).toContain('classList.toggle("keyboard-open"');
  });

  it("прокрутка к полю сначала мгновенная, потом поправка", () => {
    /*
      Порядок важен: плавная прокрутка возвращает управление сразу, поэтому
      замер увидел бы ещё старое положение, и поправка легла бы поверх
      незавершённого движения — промах на всю его длину.
    */
    const hook = fs.readFileSync(path.resolve(process.cwd(), "src/hooks/useKeyboardInset.ts"), "utf8");
    const reveal = hook.slice(hook.indexOf("const revealFocused"), hook.indexOf("const apply"));
    expect(reveal, "scrollIntoView стал плавным — поправка промахнётся").toContain('behavior: "instant"');
    expect(reveal.indexOf("scrollIntoView")).toBeLessThan(reveal.indexOf("scrollBy"));
  });
});
