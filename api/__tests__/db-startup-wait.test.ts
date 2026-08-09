import { describe, it, expect, vi } from "vitest";

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { waitForDatabase } from "../boot";

/**
 * Ожидание базы при запуске.
 *
 * Код срабатывает ровно один раз — в аварии, когда посмотреть на него уже
 * некому. 7 августа приложение выходило с ошибкой за секунды, разрешённые
 * перезапуски сгорали за минуту, и сайт не поднимался сам даже после
 * возвращения базы. Здесь проверяется, что теперь поднимется.
 *
 * Часы и паузы подставляются снаружи: тест, который честно ждёт пять минут,
 * никто не будет запускать.
 */

/** База, отвечающая с N-й попытки. */
function dbFailingTimes(failures: number) {
  let calls = 0;
  return {
    calls: () => calls,
    getDb: () => ({
      execute: async () => {
        calls++;
        if (calls <= failures) throw Object.assign(new Error("ECONNREFUSED 127.0.0.1:3306"), { code: "ECONNREFUSED" });
        return [];
      },
    }),
  };
}

/** Часы, которые двигаются только на величину запрошенных пауз. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms; },
    elapsed: () => t,
  };
}

describe("ожидание базы при запуске", () => {
  it("поднимается, когда база вернулась не сразу", async () => {
    const db = dbFailingTimes(20);
    const clock = fakeClock();

    await waitForDatabase(db.getDb, 5 * 60_000, clock.sleep, clock.now);

    // Двадцать отказов подряд — это перезапускающийся MySQL, а не сломанная
    // схема. Прежний код выходил на первом же.
    expect(db.calls()).toBe(21);
    expect(clock.elapsed()).toBeLessThan(5 * 60_000);
  });

  it("сдаётся, если база не вернулась за отведённое время", async () => {
    const db = dbFailingTimes(Number.MAX_SAFE_INTEGER);
    const clock = fakeClock();

    // Ждать вечно нельзя: платформа так и не увидит рабочего экземпляра, а
    // причина останется незамеченной.
    await expect(waitForDatabase(db.getDb, 60_000, clock.sleep, clock.now)).rejects.toThrow(/ECONNREFUSED/);
    expect(clock.elapsed()).toBeGreaterThanOrEqual(60_000);
  });

  it("пробрасывает настоящую ошибку, а не свою формулировку", async () => {
    const getDb = () => ({
      execute: async () => { throw new Error("Access denied for user 'root'@'10.0.0.1'"); },
    });
    const clock = fakeClock();

    // Неверный пароль ожиданием не лечится, и подменять текст ошибки словами
    // «база недоступна» значит выбросить единственную подсказку.
    await expect(waitForDatabase(getDb, 1_000, clock.sleep, clock.now)).rejects.toThrow(/Access denied/);
  });

  it("не бомбардирует поднимающуюся базу — паузы растут", async () => {
    const db = dbFailingTimes(10);
    const delays: number[] = [];
    let t = 0;

    await waitForDatabase(db.getDb, 5 * 60_000, async ms => { delays.push(ms); t += ms; }, () => t);

    expect(delays.length).toBe(10);
    // Растут, но не бесконечно: иначе после долгого отсутствия базы
    // приложение заметило бы её возвращение с большим опозданием.
    expect(delays[0]).toBeLessThan(delays[delays.length - 1]);
    expect(Math.max(...delays)).toBeLessThanOrEqual(5_000);
  });

  it("успевшая база проверяется ровно один раз", async () => {
    const db = dbFailingTimes(0);
    const clock = fakeClock();

    await waitForDatabase(db.getDb, 5 * 60_000, clock.sleep, clock.now);

    // Обычный запуск не должен становиться медленнее из-за защиты от аварии.
    expect(db.calls()).toBe(1);
    expect(clock.elapsed()).toBe(0);
  });

  it("при нулевом лимите база всё равно спрашивается", async () => {
    const db = dbFailingTimes(0);
    const clock = fakeClock();

    // Проверка времени стоит после попытки; будь она до, запуск падал бы, ни
    // разу не обратившись к базе.
    await waitForDatabase(db.getDb, 0, clock.sleep, clock.now);
    expect(db.calls()).toBe(1);
  });
});
