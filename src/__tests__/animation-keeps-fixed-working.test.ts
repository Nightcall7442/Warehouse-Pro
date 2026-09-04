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

  it("обёртка страницы всё ещё помечена этим классом", () => {
    // Если класс с <main> уберут, беда исчезнет сама и тест станет лишним —
    // пусть тогда упадёт и заставит перечитать эту заметку.
    expect(read("src/components/Layout.tsx")).toContain("animate-fade-up");
  });
});
