/**
 * Обмен с 1С отчитывается измерением, а не проверкой связи.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * На экране настроек 1С две плитки: «Последняя синхронизация» и «Ошибки». Обе
 * показывали не то, что обещали.
 *
 * «Последняя синхронизация» читала `onec_config.last_tested_at` — время
 * последней ПРОВЕРКИ СВЯЗИ. Нажал «Проверить соединение» — и экран сообщает,
 * что данные только что синхронизированы. Обмен при этом мог не запускаться
 * ни разу.
 *
 * «Ошибки» считались как `lastTestOk === false ? 1 : 0`. То есть отражали исход
 * той же проверки связи. Обмен мог падать сутками: пока соединение
 * проверялось успешно, плитка светилась зелёным нулём.
 *
 * И третья, самая тихая: даже настоящий счётчик `sync_status.error_count`
 * считать не умел. В updateSyncStatus стояло
 * `errorCount: status === 'failed' ? undefined : 0` — при отказе поле
 * пропускалось (drizzle не пишет undefined), при успехе обнулялось. Прибавить
 * его было нечему, и он вечно показывал ноль.
 *
 * ── Почему это важнее, чем кажется ──────────────────────────────────────────
 *
 * Обмен с 1С — единственное место, где данные уходят наружу и приходят
 * снаружи. Молчаливый отказ здесь означает расхождение остатков и выручки с
 * бухгалтерией, и обнаруживается он не на экране, а при сверке в конце месяца.
 * Зелёный ноль на этом экране — не украшение, а обещание, что сверять нечего.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ── Заглушка базы: запоминает, что записали ─────────────────────────────────
const written: Array<Record<string, unknown>> = [];
let existingRow: Array<{ id: number; errorCount: number | null }> = [];

vi.mock("../queries/connection", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(existingRow),
        }),
      }),
    }),
    update: () => ({
      set: (data: Record<string, unknown>) => ({
        where: () => { written.push(data); return Promise.resolve(); },
      }),
    }),
    insert: () => ({
      values: (data: Record<string, unknown>) => { written.push(data); return Promise.resolve(); },
    }),
  }),
}));

import { updateSyncStatus } from "../services/onec-status";

beforeEach(() => { written.length = 0; existingRow = []; });

describe("счётчик отказов обмена", () => {
  it("растёт на каждом отказе, а не остаётся нулём", async () => {
    existingRow = [{ id: 7, errorCount: 3 }];

    await updateSyncStatus(1, "product", "from1c", "failed", 0, "1С не ответила");

    expect(written).toHaveLength(1);
    expect(written[0].errorCount).toBe(4);
    expect(written[0].lastError).toBe("1С не ответила");
  });

  it("первый отказ по строке, которой ещё нет, даёт единицу", async () => {
    existingRow = [];

    await updateSyncStatus(1, "order", "to1c", "failed", 0, "таймаут");

    expect(written).toHaveLength(1);
    expect(written[0].errorCount).toBe(1);
  });

  it("удачный обмен обнуляет счёт и ставит время", async () => {
    existingRow = [{ id: 7, errorCount: 5 }];

    await updateSyncStatus(1, "product", "from1c", "completed", 120);

    expect(written[0].errorCount).toBe(0);
    expect(written[0].lastSuccessfulSync).toBeInstanceOf(Date);
    expect(written[0].recordsProcessed).toBe(120);
  });

  it("отказ НЕ ставит время удачного обмена", async () => {
    /*
      Иначе плитка «последняя синхронизация» показывала бы время неудачи —
      то есть снова говорила бы «обменялись», когда не обменялись.
    */
    existingRow = [{ id: 7, errorCount: 0 }];

    await updateSyncStatus(1, "product", "from1c", "failed", 0, "отказ");

    expect(written[0].lastSuccessfulSync).toBeUndefined();
  });
});

describe("ответ о состоянии обмена", () => {
  const router = readFileSync(join(__dirname, "../onec-router.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

  it("время обмена не берётся из времени проверки связи", () => {
    /*
      Правило про подстановку, а не про имя поля: проверка связи и обмен — два
      разных события, и одно не может отвечать за другое. Слить их обратно
      проще всего именно так, как было: рядом лежит готовое поле с датой.
    */
    expect(router).not.toMatch(/lastProductSync:\s*config\.lastTestedAt/);
    expect(router).not.toMatch(/lastOrderSync:\s*config\.lastTestedAt/);
  });

  it("число отказов не выводится из исхода проверки связи", () => {
    expect(router).not.toMatch(/errors:\s*config\.lastTestOk/);
  });

  it("нет полей, которые ничего не измеряют", () => {
    // `pendingOrders: 0` с пометкой TODO — обещание счёта без счёта.
    expect(router).not.toMatch(/pendingOrders:\s*0\b/);
    expect(router).not.toMatch(/lastOrderSync:\s*null,\s*\/\//);
  });

  it("состояние читается из таблицы обмена", () => {
    expect(router).toMatch(/getSyncStatus\(/);
  });
});
