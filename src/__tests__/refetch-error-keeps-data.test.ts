import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Сорванное обновление не должно стирать уже показанное.
 *
 * react-query при неудачном ОБНОВЛЕНИИ ставит статус «error», не трогая
 * полученные раньше данные. Страницы же проверяли один isError и уходили на
 * экран «не удалось загрузить» при живых данных в памяти.
 *
 * Для агента это выглядело так: открыл «Каталог», ушёл в заказ, вернулся уже
 * внутри магазина со слабой связью — вместо сетки товаров красный треугольник,
 * хотя товары, цены и остатки лежат в телефоне целиком. Кнопка «Повторить»
 * повторяла тот же отказ. Сходится это легко: у клиента retry отключён,
 * staleTime 30 секунд и обновление при возврате на вкладку — любое
 * возвращение позже полуминуты запускает перезапрос.
 *
 * Правильный признак у библиотеки уже есть и считается ею самой:
 * isLoadingError = isError && !hasData. Своей арифметики не нужно.
 */
const ROOTS = ["src/pages", "src/components/settings"];

function sources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  for (const root of ROOTS) {
    const dir = path.resolve(process.cwd(), root);
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".tsx")) continue;
      out.push({ file: `${root}/${name}`, text: fs.readFileSync(path.join(dir, name), "utf8") });
    }
  }
  return out;
}

describe("экран ошибки только когда показывать нечего", () => {
  it("ни одна страница не уходит на экран ошибки по одному isError", () => {
    const bad = sources()
      // Комментарии не считаем: в Home.tsx разбор прошлой беды цитирует
      // именно старую строчку, и переписывать цитату незачем.
      .filter(({ text }) => /^\s*if \(isError\) return <QueryErrorFallback/m.test(text))
      .map(({ file }) => file);
    expect(bad, `безусловный уход на экран ошибки: ${bad.join(", ")}`).toEqual([]);
  });

  it("проверка вообще осталась — иначе тест выше стережёт пустоту", () => {
    const good = sources().filter(({ text }) => text.includes("if (isLoadingError) return <QueryErrorFallback"));
    expect(good.length, "ни одной страницы с проверкой — правило переписали?").toBeGreaterThan(10);
  });
});
