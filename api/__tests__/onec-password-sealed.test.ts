/**
 * Пароль клиента к 1С не лежит в базе открытым текстом.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * onec_config.password — varchar(500), saveConfig писал input.password как
 * есть, ни одного createCipheriv в api/. Учётка 1С с правом создавать и
 * проводить документы реализации попадала в каждый дамп базы и была видна
 * любому, кто читает MySQL. Для B2B-продажи это вопрос первого же
 * ИБ-опросника; утечка дампа превращалась в инцидент у каждого клиента с
 * обменом.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * 1. seal/open — обратимы, IV случайный (два seal одного пароля различны),
 *    подделанный шифртекст отвергается, унаследованная открытая строка
 *    проходит через open как есть.
 * 2. Оба места записи в onec_config шифруют; оба места чтения расшифровывают.
 *    По тексту, потому что сама запись идёт через подделку базы.
 *
 * Нарочная поломка: замени seal(input.password) на input.password в одном из
 * двух мест — вторая группа называет, в каком.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../lib/env", () => ({ env: { appSecret: "test-secret-of-sufficient-length-1234567890" } }));

const { seal, open, isSealed } = await import("../lib/secret-box");

describe("secret-box", () => {
  it("шифрует и расшифровывает, IV каждый раз новый", () => {
    const a = seal("Пароль-1С!");
    const b = seal("Пароль-1С!");
    expect(a).not.toBe(b);
    expect(isSealed(a)).toBe(true);
    expect(open(a)).toBe("Пароль-1С!");
    expect(open(b)).toBe("Пароль-1С!");
    expect(a).not.toContain("Пароль");
  });

  it("подделанный шифртекст отвергается", () => {
    const sealed = seal("secret");
    const parts = sealed.split(":");
    parts[4] = parts[4].replace(/.$/, c => (c === "A" ? "B" : "A"));
    expect(() => open(parts.join(":"))).toThrow();
  });

  it("унаследованная открытая строка проходит как есть", () => {
    expect(isSealed("plain-old-password")).toBe(false);
    expect(open("plain-old-password")).toBe("plain-old-password");
  });
});

describe("onec_config.password", () => {
  const ROUTER = readFileSync(resolve(__dirname, "../onec-router.ts"), "utf-8");
  const BRIDGE = readFileSync(resolve(__dirname, "../lib/onec-bridge.ts"), "utf-8");

  it("оба места записи шифруют", () => {
    const save = ROUTER.slice(ROUTER.indexOf("saveConfig: adminQuery"), ROUTER.indexOf("clearBridgeCache();", ROUTER.indexOf("saveConfig: adminQuery")));
    // Записи в базу, не схема входа (password: z.string()).
    const writes = (save.match(/password: [^,\n]+/g) ?? []).filter(w => !w.includes("z.string"));
    expect(writes.length, "ожидались две записи пароля (update и insert)").toBe(2);
    for (const w of writes) expect(w, "запись пароля без seal()").toBe("password: seal(input.password)");
  });

  it("оба места чтения расшифровывают", () => {
    expect(BRIDGE).toContain("password: open(config.password)");
    expect(BRIDGE).not.toMatch(/password: config\.password,/);
    const test = ROUTER.slice(ROUTER.indexOf("testSavedConnection"));
    expect(test).toContain("password: open(config.password)");
  });
});
