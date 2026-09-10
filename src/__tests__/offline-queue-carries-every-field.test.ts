import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Офлайн-очередь обязана довозить ВСЁ, что довозит обычная отправка.
 *
 * ── Почему это отдельный страж ──────────────────────────────────────────────
 *
 * Заказ уходит на сервер двумя путями. Онлайн — payload из NewOrder.tsx.
 * Офлайн — та же запись ложится в очередь, а потом useOfflineSync
 * перечисляет поля РУКАМИ и отправляет заново.
 *
 * Из-за этого новое поле заказа появляется в одном месте и не появляется в
 * другом, а ошибка не видна ничем: заказ уйдёт, ничего не упадёт, просто
 * обещанный магазину срок (или скидка, или способ оплаты) до системы не
 * доедет. Заметить это можно только у клиента и только потом.
 *
 * Поэтому набор полей сверяется буквально, и добавивший поле обязан пройти
 * оба места.
 */

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

/** Комментарий с двоеточием — не поле. Убираем их до разбора. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Ключи объекта, записанные с начала строки: `имя:` и сокращённое `имя,`.
 *
 * Сокращённую запись учитывать обязательно: половина полей в payload
 * записана именно так (`shopId,`, `paymentMethod,`), и без неё страж сверял
 * бы половину набора, считая себя целым.
 */
function topLevelKeys(block: string): string[] {
  return [...stripComments(block).matchAll(/^\s*([A-Za-z_$][\w$]*)\s*(?::|,\s*$)/gm)].map(m => m[1]);
}

/** Кусок текста от открывающей скобки до её пары. */
function blockAfter(src: string, marker: string): string {
  const at = src.indexOf(marker);
  expect(at, `не найдено начало: ${marker}`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = at + marker.length - 1; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(`не закрыта скобка: ${marker}`);
}

describe("офлайн-очередь довозит то же, что и обычная отправка", () => {
  const ONLINE = blockAfter(read("src/pages/NewOrder.tsx"), "const payload = {");
  const OFFLINE = blockAfter(read("src/hooks/useOfflineSync.ts"), "await createOrder.mutateAsync({");

  it("наборы полей совпадают", () => {
    const online = topLevelKeys(ONLINE).sort();
    const offline = topLevelKeys(OFFLINE).sort();

    expect(online.length, "поля онлайн-отправки не разобрались").toBeGreaterThan(4);
    expect(
      offline,
      `офлайн не довозит: ${online.filter(k => !offline.includes(k)).join(", ") || "—"}; ` +
      `лишнее в офлайне: ${offline.filter(k => !online.includes(k)).join(", ") || "—"}`,
    ).toEqual(online);
  });

  it("обещанный срок среди них", () => {
    // Именно на нём это и поймали: агент называет срок магазину, связь на
    // складе пропадает регулярно, и потерянное обещание выглядит как срыв.
    expect(topLevelKeys(ONLINE)).toContain("promisedDeliveryAt");
    expect(topLevelKeys(OFFLINE)).toContain("promisedDeliveryAt");
  });
});
