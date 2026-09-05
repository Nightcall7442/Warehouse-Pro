import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Обёртка страницы не должна оставаться с transform после анимации.
 *
 * Любой transform, кроме none, делает элемент точкой отсчёта для position:
 * fixed внутри него. Обёртка в Layout.tsx — animate-fade-up, поэтому «низ
 * экрана» для всего её содержимого означал низ обёртки: панель с кнопкой
 * «Продолжить» на новом заказе вставала посреди экрана, а под ней до нижней
 * навигации зияла мёртвая полоса в 55 точек. Ту же ловушку раньше словила
 * выдвижная корзина — её увели в портал (ProductSelector.tsx).
 *
 * Держит transform не последний кадр, а forwards. Написать в кадре
 * `transform: none` мало: заливка оставляет свойство анимированным, и браузер
 * считает его матрицей — проверено, computed остаётся matrix(1, 0, 0, 1, 0, 0)
 * даже с none в кадре. Поэтому проверяется именно отсутствие forwards.
 *
 * Правил два и они одноимённые: animate-fade-up объявлен и в
 * tailwind.config.js, и в index.css. Побеждает первый — утилиты Tailwind идут
 * в каскаде позже. На этом легко обжечься: правка только в index.css выглядит
 * применённой, а на экране ничего не меняется. Проверяются оба.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

/**
 * Строка, объявляющая анимацию для класса animate-fade-up.
 *
 * Ищем именно её, а не всё, где встречается имя кадров: те же кадры тянет
 * .stagger-children, и там forwards нужен — у его детей базовая opacity 0, без
 * заливки они после анимации просто исчезли бы. Fixed внутри них не бывает.
 */
function fadeUpRule(src: string): string {
  const line = src.split("\n").find((l) => /"fade-up":\s+"|\.animate-fade-up\s*\{/.test(l));
  if (!line) throw new Error("объявление animate-fade-up не найдено — переименовали?");
  return line;
}

describe("анимация обёртки не ломает position: fixed", () => {
  it("правило animate-fade-up не заливает результат", () => {
    // Оба файла: побеждает Tailwind, но при смене порядка каскада выстрелит
    // второе, и беда вернётся молча.
    expect(fadeUpRule(read("tailwind.config.js")), "forwards вернулся в Tailwind").not.toContain("forwards");
    expect(fadeUpRule(read("src/index.css")), "forwards вернулся в index.css").not.toContain("forwards");
  });

  it("ни одна анимация-утилита не заливает результат", () => {
    /*
      Правило шире одного класса: forwards держит transform у ЛЮБОЙ анимации,
      а живут они в карточках, таблицах и всплывающих окнах — то есть ровно
      там, где потом заводится position: fixed. Так и осталось у slide-up,
      scale-in, count-up и slide-in после того, как fade-up вылечили.

      Проверено в браузере 06.09.2026: с forwards computed остаётся
      matrix(1, 0, 0, 1, 0, 0) и когда в последнем кадре «transform: none», и
      когда transform там не упомянут вовсе. Помогает только отказ от заливки;
      где она нужна ради opacity (stagger-children), её заменяет backwards —
      он показывает первый кадр ДО старта и ничего не держит после конца.
    */
    const css = read("src/index.css");
    const cssRules = css.split("\n").filter(l => /^\s*\.(animate-[\w-]+|stagger-children\b)/.test(l) || /^\s*animation:\s/.test(l));
    expect(cssRules.length, "правила анимаций не нашлись").toBeGreaterThan(5);
    for (const rule of cssRules) {
      expect(rule, `заливка вернулась: ${rule.trim()}`).not.toMatch(/\bforwards\b/);
    }

    const tw = read("tailwind.config.js");
    const at = tw.indexOf("animation: {");
    expect(at, "список анимаций Tailwind не найден").toBeGreaterThan(0);
    const list = tw.slice(at, tw.indexOf("},", at));
    for (const line of list.split("\n").filter(l => /^\s*"[\w-]+":\s*"/.test(l))) {
      expect(line, `заливка вернулась в Tailwind: ${line.trim()}`).not.toMatch(/\bforwards\b/);
    }
  });

  it("обёртка страницы всё ещё помечена этим классом", () => {
    // Если класс с <main> уберут, беда исчезнет сама и тест станет лишним —
    // пусть тогда упадёт и заставит перечитать эту заметку.
    expect(read("src/components/Layout.tsx")).toContain("animate-fade-up");
  });
});
