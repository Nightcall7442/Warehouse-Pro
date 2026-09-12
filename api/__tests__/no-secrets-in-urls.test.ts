/**
 * Ключи и токены — заголовком, не в адресе.
 *
 * Адрес целиком оседает в журналах обращений на каждом узле по дороге —
 * прокси, сеть доставки, Loki — и живёт там дольше самого ключа. Здесь:
 * крон-ручки принимают только x-cron-secret, вебхук Alertmanager — только
 * Authorization: Bearer. Единственное исключение — ?token= у фото ради
 * старых сборок приложения; оно считается метрикой, чтобы знать, когда его
 * можно снять.
 *
 * Нарочная поломка: верни в cron-guard.ts `c.req.query("secret")` —
 * первый тест назовёт файл.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const API = join(__dirname, "..");
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") walk(p, out); }
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("секретов в адресе нет", () => {
  it("ни одна ручка не читает secret/token из query — кроме фото", () => {
    const offenders: string[] = [];
    for (const f of walk(API)) {
      const rel = relative(API, f).split("\\").join("/");
      if (rel === "photos.ts") continue;
      const src = read(f);
      if (/\.query\(\s*"(secret|token)"\s*\)/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("крон-ручки и Alertmanager — заголовком", () => {
    const guard = read(join(API, "http", "cron-guard.ts"));
    expect(guard).toContain('c.req.header("x-cron-secret")');
    for (const f of ["boot.ts", "http/backup.ts"]) {
      expect(read(join(API, f)), f).not.toMatch(/query\("secret"\)/);
      expect(read(join(API, f)), f).toContain("cronDenied(c)");
    }
    const am = read(join(API, "webhooks", "alertmanager.ts"));
    expect(am).toContain('c.req.header("authorization")');
    expect(am).toContain('auth.startsWith("Bearer ")');
  });

  it("фото: токен в адресе ещё принимается, но считается по версиям сборок", () => {
    const photos = read(join(API, "photos.ts"));
    expect(photos).toContain('legacyPhotoTokenTotal.inc(clientVersionOf(c.req.header("x-client-version")));');
    expect(read(join(API, "prometheus-metrics.ts"))).toContain('name: "legacy_photo_query_token_total"');
  });
});
