import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Арендатору без своего цвета не подставляют чужой.
 *
 * useBranding вписывает акцент прямо в <html>, а inline-стиль перебивает любое
 * правило таблицы, включая блок .dark. Пока подстановкой служил «#5b6d8a» —
 * цвет СВЕТЛОЙ темы — латунный акцент тёмной (#c9a227) не видел никто, кроме
 * тех, кто задал цвет вручную в настройках.
 *
 * Проверяем два условия сразу: в таблице цвет объявлен для обеих тем, а в
 * хуке нет запасного значения, которое бы это перекрыло.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

describe("акцент арендатора", () => {
  it("в таблице объявлен для светлой и тёмной темы", () => {
    const css = read("src/index.css");
    const at = [...css.matchAll(/--color-primary:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1]);
    // Ровно два значения: одно в :root, другое в .dark. Если останется одно —
    // одна из тем потеряла свой акцент.
    expect(at.length, `объявлений --color-primary: ${at.length}`).toBe(2);
    expect(at[0]).not.toBe(at[1]);
  });

  it("сервер не выдумывает цвет за арендатора без записи", () => {
    /*
      Клиентской правки мало: сервер подставлял «#5b6d8a» вместо пустого
      значения, и до клиента «цвет не выбран» просто не доходило. В базе
      записей с настоящим цветом единицы — всем остальным арендаторам светлый
      акцент навязывался поверх тёмной темы.
    */
    /*
      Правило, а не разметка: раньше здесь искалась строка «return row ?? {»,
      и стоило ветку «записи нет» назвать иначе — проверка резала пустой кусок
      и промолчала бы о любой подстановке. Теперь ищется сама подстановка:
      шестизначного цвета в роутере быть не должно нигде.
    */
    const router = read("api/tenant-branding-router.ts");
    const code = router.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const literals = [...code.matchAll(/#[0-9a-fA-F]{6}/g)].map(m => m[0]);
    expect(literals, `сервер снова подставляет цвет: ${literals.join(", ")}`).toEqual([]);

    // И «ничего не настроено» отдаётся пустыми значениями, а не отсутствием полей.
    const nothing = code.slice(code.indexOf("const NOTHING_SET"), code.indexOf("};", code.indexOf("const NOTHING_SET")));
    expect(nothing, "ветки «цвет не выбран» не стало").toContain("primaryColor:   null");
    expect(nothing).toContain("secondaryColor: null");
  });

  it("в хуке нет запасного цвета — иначе он перебьёт тему", () => {
    const hook = read("src/hooks/useBranding.ts");
    const effect = hook.slice(hook.indexOf("const primary = branding.primaryColor"));
    expect(effect, "вернулась подстановка цвета").not.toMatch(/primaryColor\s*\?\?\s*["']#/);
    // И снятие обязательно: без него убранный в настройках цвет висел бы до
    // перезагрузки страницы. Чем именно снимают — инлайновым removeProperty
    // или удалением вставленной таблицы — дело хука; важно, что у ветки
    // «цвета нет» есть что делать.
    expect(effect, "нет снятия бренда").toMatch(/removeProperty|.remove()/);
  });
});
