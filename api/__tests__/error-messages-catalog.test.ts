/**
 * Каждый отказ сервера есть в словаре переводов.
 *
 * Словарь (contracts/error-messages.ts) работает, только пока он полон: отказ,
 * которого там нет, человек с узбекским интерфейсом увидит общей фразой «не
 * получилось», а не объяснением. Этот тест читает исходники сервера
 * (helpers/user-error-sources.ts) и требует перевод для каждого текста,
 * который может дойти до экрана: TRPCError, бизнес-отказ голым
 * `throw new Error("…")`, свой класс отказа, свой текст проверки zod.
 *
 * Исключения — только списком ниже и с причиной. Это внутренние проверки,
 * которые человеку не показываются: форматтер прячет их за «внутренней
 * ошибкой» (технический текст, нижний регистр, служебное задание).
 */
import path from "path";
import { describe, expect, it } from "vitest";
import { SERVER_ERROR_TEXT, localizeServerMessage } from "@contracts/error-messages";
import { STEP_UP_MESSAGES } from "../auth/step-up";
import { collectMessageSites, shapeOf, type MessageSite } from "./helpers/user-error-sources";

const ROOT = path.resolve(import.meta.dirname, "../..");

/** Внутренние тексты: человеку не показываются, переводить незачем. */
const INTERNAL: Record<string, string> = {
  "api/cron/restore-drill.ts": "учения по восстановлению копии — задание по расписанию, текст уходит в журнал",
  "api/lib/migration-lock.ts": "замок миграций при старте сервера",
  "api/services/db-dump.ts": "выгрузка копии базы",
  "api/services/stock-ledger.ts:145": "проверка аргументов движения остатка — ошибка кода, а не отказ",
  "api/services/stock-ledger.ts:148": "проверка аргументов движения остатка — ошибка кода, а не отказ",
  "api/services/stock-ledger.ts:404": "проверка партии на входе книги остатка — ошибка кода",
  "api/services/stock-ledger.ts:662": "проверка количества на входе книги остатка — ошибка кода",
  "api/services/onec-sync.ts:478": "в выгрузку оплат попала не оплата — ошибка кода",
};

/**
 * Отказы, текст которых приходит переменной. Сам текст проверяется там, где
 * он написан: у своего класса — в его super(), у второго фактора — ниже.
 */
const FROM_ELSEWHERE: Record<string, string> = {
  "api/audit-router.ts:step.message": "STEP_UP_MESSAGES",
  "api/tenant-router.ts:step.message": "STEP_UP_MESSAGES",
  "api/user-router.ts:step.message": "STEP_UP_MESSAGES",
  "api/platform-router.ts:e.message": "PaymentTenantMissing — super() в services/subscription-payments.ts",
  "api/shop-router.ts:err.message": "ShopHasHistoryError — super() в services/shop-archive.ts",
  "api/tenant-router.ts:e.message": "TenantNotSuspendedError — super() в services/tenant-offboard.ts",
  "api/tenant-router.ts:new TenantNotSuspendedError().message": "TenantNotSuspendedError — super() в services/tenant-offboard.ts",
};

/** Узбекский перевод, в котором кириллица нужна: (пока таких нет). */
const UZ_MAY_HAVE_CYRILLIC = new Set<string>();

const sites = collectMessageSites(["api", "contracts"], ROOT);
const isInternal = (s: MessageSite) => INTERNAL[s.file] !== undefined || INTERNAL[`${s.file}:${s.line}`] !== undefined;
const catalogShapes = new Set(Object.keys(SERVER_ERROR_TEXT).map(shapeOf));

describe("словарь отказов сервера", () => {
  it("читает исходники: отказов сотни, иначе сканер сломан", () => {
    expect(sites.length).toBeGreaterThan(400);
    expect(sites.some((s) => s.kind === "trpc")).toBe(true);
    expect(sites.some((s) => s.kind === "error")).toBe(true);
    expect(sites.some((s) => s.kind === "zod")).toBe(true);
  });

  it("у каждого отказа, который видит человек, есть перевод", () => {
    const missing: string[] = [];
    for (const s of sites) {
      if (isInternal(s)) continue;
      for (const form of s.forms) {
        if (!catalogShapes.has(shapeOf(form))) missing.push(`${s.file}:${s.line}  ${form}`);
      }
    }
    expect(missing, "добавьте перевод в contracts/error-messages.ts").toEqual([]);
  });

  it("текст, который не вычислить из исходника, объяснён списком", () => {
    const unknown: string[] = [];
    for (const s of sites) {
      if (isInternal(s)) continue;
      for (const u of s.unresolved) {
        if (!FROM_ELSEWHERE[`${s.file}:${u}`]) unknown.push(`${s.file}:${s.line}  ${u}`);
      }
    }
    expect(unknown, "текст отказа переменной: допишите FROM_ELSEWHERE или бросайте литерал").toEqual([]);
  });

  it("второй фактор отказывает переводимыми словами", () => {
    for (const m of Object.values(STEP_UP_MESSAGES)) expect(SERVER_ERROR_TEXT[m], m).toBeDefined();
  });

  it("в словаре нет мёртвых строк: каждая где-то бросается", () => {
    const used = new Set<string>(Object.values(STEP_UP_MESSAGES).map(shapeOf));
    for (const s of sites) for (const f of s.forms) used.add(shapeOf(f));
    const dead = Object.keys(SERVER_ERROR_TEXT).filter((k) => !used.has(shapeOf(k)));
    expect(dead, "этих текстов в коде сервера больше нет — уберите их из словаря").toEqual([]);
  });

  it("перевод — узбекский и со своими вставками", () => {
    const bad: string[] = [];
    for (const [key, e] of Object.entries(SERVER_ERROR_TEXT)) {
      const slots = [...key.matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1]));
      slots.forEach((n, i) => { if (n !== i) bad.push(`${key}: вставки нумеруются по порядку с нуля`); });
      for (const text of [e.uz, e.ru].filter((x): x is string => !!x)) {
        for (const m of text.matchAll(/\{(\d+)\}/g)) {
          if (Number(m[1]) >= slots.length) bad.push(`${key}: в переводе лишняя вставка {${m[1]}}`);
        }
      }
      if (!e.uz.trim()) bad.push(`${key}: пустой перевод`);
      if (/[А-Яа-яЁё]/.test(e.uz) && !UZ_MAY_HAVE_CYRILLIC.has(key)) bad.push(`${key}: кириллица в узбекском`);
      if (e.uz === key) bad.push(`${key}: перевод совпадает с исходником`);
      if (!/[А-Яа-яЁё]/.test(key) && !e.ru) bad.push(`${key}: исходник не русский — нужен ru`);
    }
    expect(bad).toEqual([]);
  });

  it("шаблон переносит значения и не путает похожие отказы", () => {
    expect(localizeServerMessage("Недостаточно товара: «Сок» — доступно 3, нужно ещё 7", "uz"))
      .toBe("Mahsulot yetarli emas: «Сок» — mavjud 3, yana 7 kerak");
    expect(localizeServerMessage("«Сок»: на складе 5, из них 2 просрочено — годных 3, а в заказе 4", "uz"))
      .toBe("«Сок»: omborda 5, shundan 2 muddati o'tgan — yaroqlisi 3, buyurtmada esa 4");
    expect(localizeServerMessage("«Сок»: на складе 5, а в заказе 9", "uz")).toBe("«Сок»: omborda 5, buyurtmada esa 9");
    // Русский — тот же текст, что бросил сервер.
    expect(localizeServerMessage("Заказ #12 не найден", "ru")).toBe("Заказ #12 не найден");
    expect(localizeServerMessage("Заказ #12 не найден", "uz")).toBe("#12 buyurtma topilmadi");
    // Незнакомый текст словарь не трогает.
    expect(localizeServerMessage("Что-то совсем новое", "uz")).toBeNull();
  });
});
