import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { zipDeclaredSize } from "../lib/zip-declared-size";

/**
 * Пределы на тело запроса и на импорт — аудит 20.09.2026 (критично №4).
 *
 * 1. bodyLimit стоял в boot.ts после Stripe-вебхука, /r/:token/word,
 *    alertmanager, Telegram, /api/v1, /api/photos, справки и бэкапа: в Hono
 *    маршруты, смонтированные раньше, им не накрываются — аноним клал
 *    инстанс телом в гигабайты. Теперь предел стоит до первого маршрута.
 * 2. xlsx — это zip; exceljs разворачивает архив в память целиком, и 7 МБ
 *    файла раскрывались в гигабайты. Теперь оглавление архива читается до
 *    распаковки: обещает больше предела — отказ; base64 ограничен; строк —
 *    не больше предела.
 *
 * Нарочная поломка: верни `app.use(bodyLimit(...))` ниже
 * `registerStripeWebhook(app)` — упадёт «предел до маршрутов»; в parseFile
 * убери проверку `declared > IMPORT_MAX_UNZIPPED` — упадёт «бомба».
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("предел на тело запроса", () => {
  it("превышение отвечает 413, а не 500 с тревогой дежурному", () => {
    // bodyLimit бросает HTTPException(413); общий onError отдавал на всё 500
    // и будил Telegram — крупный запрос анонима становился «сбоем сервера».
    const boot = read("api/boot.ts");
    expect(boot).toContain("if (err instanceof HTTPException) return err.getResponse();");
    expect(boot).toContain("if (err instanceof HTTPException) throw err;");
  });

  it("стоит до первого маршрута и вебхука", () => {
    const boot = read("api/boot.ts");
    const limit = boot.indexOf("app.use(bodyLimit({ maxSize: 10 * 1024 * 1024 }))");
    expect(limit).toBeGreaterThan(0);
    for (const route of ["registerStripeWebhook(app)", 'app.route("/api/webhooks/alertmanager"', 'app.route("/api/v1"', 'app.route("/api/photos"', 'app.post("/r/:token/word"', "app.route(\"/\", backupRoutes)"]) {
      const at = boot.indexOf(route);
      expect(at, `${route} не найден`).toBeGreaterThan(0);
      expect(at, `${route} смонтирован раньше bodyLimit`).toBeGreaterThan(limit);
    }
  });
});

/** Минимальный zip: одна запись с объявленным размером до сжатия. */
function zipWithDeclared(uncompressed: number, extra?: { zip64?: boolean }): Buffer {
  const name = Buffer.from("xl/sharedStrings.xml");
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(name.length, 26); name.copy(local, 30);
  const cen = Buffer.alloc(46 + name.length);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt32LE(extra?.zip64 ? 0xffffffff : uncompressed, 24);
  cen.writeUInt16LE(name.length, 28); name.copy(cen, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cen.length, 12); eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, cen, eocd]);
}

describe("импорт: оглавление архива до распаковки", () => {
  it("честный файл: сумма объявленных размеров", () => {
    expect(zipDeclaredSize(zipWithDeclared(12_345))).toBe(12_345);
  });
  it("бомба: обещает гигабайты — видно без распаковки; ZIP64 — бесконечность", () => {
    expect(zipDeclaredSize(zipWithDeclared(3_000_000_000))).toBe(3_000_000_000);
    expect(zipDeclaredSize(zipWithDeclared(1, { zip64: true }))).toBe(Infinity);
  });
  it("не zip — null", () => {
    expect(zipDeclaredSize(Buffer.from("PK not really"))).toBeNull();
    expect(zipDeclaredSize(Buffer.alloc(5))).toBeNull();
  });
  it("parseFile сверяет оглавление и режет base64 и строки", () => {
    const src = read("api/import-router.ts");
    expect(src).toContain("const declared = zipDeclaredSize(bytes);");
    expect(src).toContain("declared > IMPORT_MAX_UNZIPPED");
    expect(src.match(/base64: z\.string\(\)\.max\(IMPORT_MAX_BASE64\)/g)?.length, "base64 без предела в одной из ручек").toBe(2);
    expect(src.match(/rows\.length > IMPORT_MAX_ROWS/g)?.length, "предел строк не в обоих разборах").toBe(2);
  });
});
