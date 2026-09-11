/**
 * Проверки идут на той же мажорной версии MySQL, что и бой.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * В CI, compose и документации стояла MySQL 8, а боевая база на Railway —
 * образ mysql:9.4 (снято с панели 11.09.2026). Проверки с настоящей базой,
 * накат миграций с нуля и сквозные сценарии подтверждали поведение не той
 * версии, что обслуживает клиентов: разница в SQL-режимах, в удалённых
 * возможностях 9.x (mysql_native_password) и в планировщике запросов
 * осталась бы невидимой до боя.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Все три места объявляют один образ. Версию берём из одной константы:
 * когда бой обновят (Railway предлагает 9.7), менять её здесь — и все три
 * файла проверка приведёт к ней.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Мажор.минор боевой базы (Railway → MySQL-avuz → Settings → Source Image). */
const PRODUCTION_MYSQL = "mysql:9.4";

describe("образ MySQL в проверках", () => {
  for (const file of [".github/workflows/ci.yml", ".github/workflows/test-migrations.yml", "docker-compose.yml"]) {
    it(`${file} использует ${PRODUCTION_MYSQL}`, () => {
      const src = readFileSync(resolve(__dirname, "../..", file), "utf-8");
      const images = src.match(/image: mysql:[^\s]+/g) ?? [];
      expect(images.length, "объявление образа не найдено").toBeGreaterThan(0);
      for (const img of images) expect(img).toBe(`image: ${PRODUCTION_MYSQL}`);
    });
  }
});
