import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
  Служба заказа разнесена по файлам (order.ts — фасад, тело в order-shared /
  order-read / order-create / order-status / order-items / order-settlement).
  Стражи, читающие её как текст, берут всё одним куском отсюда — иначе каждый
  из них должен знать, в каком файле теперь живёт нужная строка.
*/
export const ORDER_SERVICE_FILES = [
  "order.ts", "order-shared.ts", "order-read.ts", "order-create.ts",
  "order-status.ts", "order-items.ts", "order-settlement.ts",
];

export function orderSource(): string {
  return ORDER_SERVICE_FILES
    .map(f => readFileSync(join(process.cwd(), "api", "services", f), "utf8").replace(/\r\n/g, "\n"))
    .join("\n");
}

/**
 * Тело одного метода службы: от `export async function name(` до следующего
 * верхнеуровневого export/import. Пустая строка — метода нет (пусть страж
 * упадёт на своём ожидании, а не на срезе «-1»).
 */
export function orderMethod(name: string): string {
  const src = orderSource();
  const at = src.indexOf(`export async function ${name}(`);
  if (at < 0) return "";
  const rest = src.slice(at + 10);
  const next = rest.search(/\n(export |import )/);
  return next < 0 ? src.slice(at) : src.slice(at, at + 10 + next);
}
