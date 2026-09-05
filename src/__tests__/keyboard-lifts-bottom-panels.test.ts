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

describe("поля не заставляют телефон приближать страницу", () => {
  /*
    Жалоба владельца: «при открытии клавиатуры везде приближается к тексту,
    потом каждый раз надо уменьшать при работе».

    Safari на iPhone сам приближает страницу, когда фокус попадает в поле
    мельче 16 точек, и обратно НЕ возвращает. Базовый размер здесь 14, у
    .neo-input было 13, у поля количества в каталоге — тоже 13.

    Мета-тег viewport от этого не спасает, хотя в index.html и стояла такая
    подпись: помогло бы только maximum-scale=1, но iOS его игнорирует, а на
    остальных это отняло бы у людей щипок.
  */
  it("на касании поля ровно 16 точек", () => {
    const at = CSS.indexOf("@media (pointer: coarse)");
    expect(at, "правило для касания пропало — телефон снова начнёт приближать").toBeGreaterThan(0);
    const block = CSS.slice(at, CSS.indexOf("}", CSS.indexOf("font-size", at)));
    expect(block).toContain("font-size: 16px");
    // !important обязателен: у части полей размер стоит прямо в разметке
    // (поле количества, поиск по товарам), обычное правило их не перебьёт.
    expect(block, "без !important инлайновые размеры останутся мельче 16").toContain("!important");
  });

  it("размер задан в точках и не меньше порога", () => {
    /*
      16 — не круглое число, а порог, ниже которого Safari приближает. И
      именно в точках: rem здесь не годится, базовый размер 14px, и «1rem»
      дало бы 14 — снова ниже порога.
    */
    const at = CSS.indexOf("@media (pointer: coarse)");
    const block = CSS.slice(at, CSS.indexOf("}", CSS.indexOf("font-size", at)));
    const size = block.match(/font-size:\s*(\d+(?:\.\d+)?)(px|rem|em)/);
    expect(size, "размер шрифта в правиле не найден").not.toBeNull();
    expect(size![2], "размер не в точках — от базовых 14px выйдет меньше порога").toBe("px");
    expect(Number(size![1])).toBeGreaterThanOrEqual(16);
  });
});

describe("модальные окна над клавиатурой", () => {
  it("слой окна поднимается", () => {
    expect(rule(".keyboard-open .app-modal-shell")).toContain("var(--keyboard-inset");
  });

  it("высота панели считается с оглядкой на клавиатуру", () => {
    // Правилом отсюда её не перебить: высота задана инлайном в разметке.
    const modal = fs.readFileSync(path.resolve(process.cwd(), "src/components/ui/AppModal.tsx"), "utf8");
    expect(modal).toContain("var(--keyboard-inset");
  });

  it("форма нового магазина прокручивается и знает про клавиатуру", () => {
    // Восемь полей, GPS и заметки на 375×812 не помещались, а прокрутки не
    // было: до «Сохранить» нельзя было добраться вовсе.
    const shops = fs.readFileSync(path.resolve(process.cwd(), "src/pages/AgentShops.tsx"), "utf8");
    expect(shops).toContain("app-modal-shell");
    expect(shops).toContain("overflowY: \"auto\"");
    expect(shops).toContain("var(--keyboard-inset");
  });
});
