/**
 * Открывается только бакет с фотографиями.
 *
 * ── Почему это отдельная проверка ───────────────────────────────────────────
 *
 * Скрипт заведения бакетов ставит разрешение «читать может кто угодно». Для
 * фотографий это и нужно: браузер тянет их напрямую. Для бакета копий это
 * означало бы опубликовать базу целиком — всех арендаторов, хеши паролей,
 * телефоны и долги магазинов.
 *
 * Разница между «правильно» и «катастрофа» здесь в одном имени переменной, и
 * ошибка ничем себя не проявит: фотографии будут открываться, копии будут
 * делаться, всё выглядит рабочим. Узнать можно только снаружи и поздно.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(join(__dirname, "..", "..", "scripts", "init-storage.mjs"), "utf8");

/** Текст без комментариев: пояснения сами называют то, что запрещают. */
const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("скрипт заведения бакетов", () => {
  it("разрешение ставится ровно одним вызовом", () => {
    // Второй вызов — это второй бакет, и он может оказаться бакетом копий.
    expect(code.match(/PutBucketPolicyCommand\(/g) ?? []).toHaveLength(1);
  });

  it("открывается бакет фотографий, а не копий", () => {
    expect(code).toMatch(/PutBucketPolicyCommand\(\{\s*Bucket:\s*photos\b/);
    expect(code).not.toMatch(/PutBucketPolicyCommand\(\{\s*Bucket:\s*backups\b/);
  });

  it("совпадение имён останавливает работу", () => {
    /*
      Задай кто-нибудь один бакет на всё — и «открыть фотографии» стало бы
      «открыть копии базы». Скрипт обязан отказаться, а не открыть.
    */
    expect(code).toMatch(/backups === photos/);
    expect(code).toMatch(/process\.exit\(1\)/);
  });

  it("разрешено только чтение объектов", () => {
    // Ни списка содержимого, ни записи: адрес бакета знает любой, кто открыл
    // карточку товара.
    expect(code).toContain('"s3:GetObject"');
    expect(code).not.toContain("s3:PutObject");
    expect(code).not.toContain("s3:ListBucket");
    expect(code).not.toContain("s3:DeleteObject");
    expect(code).not.toContain('"s3:*"');
  });

  it("повторный запуск не считается ошибкой", () => {
    // Иначе скрипт можно выполнить ровно один раз за жизнь хранилища, а
    // переменные меняют и хранилище переносят.
    expect(code).toContain("HeadBucketCommand");
  });

  it("без ключей не запускается вовсе", () => {
    expect(code).toMatch(/!S3_BUCKET \|\| !S3_ACCESS_KEY \|\| !S3_SECRET_KEY/);
  });
});
