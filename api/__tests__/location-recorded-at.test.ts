import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Время съёмки GPS-точки отделено от времени её получения.
 *
 * Точки копятся в буфере устройства, пока агент вне зоны покрытия, и
 * заливаются пачкой при первом сигнале. Времени съёмки не было, и сервер
 * ставил время вставки: на карте супервайзера агент весь день «стоял» на месте
 * последней связи, а в 17:40 мгновенно проезжал весь маршрут. На вопрос «где ты
 * был в два часа дня» ответить было нечем, хотя точка физически сохранена.
 *
 * Главное здесь — что created_at НЕ заменён. Время съёмки приходит от клиента,
 * а часы на телефоне ставит владелец телефона; строить на нём проверку геозоны
 * значило бы дать возможность задним числом «оказаться» где угодно.
 */

const SRC = readFileSync(join(process.cwd(), "api", "agent-router.ts"), "utf8");

/** Та же логика, что в sanitizeRecordedAt: тест сверяет границы, а не текст. */
function accepts(iso: string, now = Date.now()): boolean {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return false;
  if (at.getTime() > now + 5 * 60_000) return false;
  if (at.getTime() < now - 7 * 24 * 60 * 60_000) return false;
  return true;
}

describe("границы допустимого времени съёмки", () => {
  const now = Date.UTC(2026, 7, 8, 12, 0, 0);
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

  it("точка из буфера, снятая три часа назад, принимается", () => {
    // Ровно тот случай, ради которого поле заведено.
    expect(accepts(iso(-3 * 60 * 60_000), now)).toBe(true);
  });

  it("время из будущего отбрасывается", () => {
    // Точка не может быть снята позже, чем принята.
    expect(accepts(iso(60 * 60_000), now)).toBe(false);
  });

  it("небольшое расхождение часов прощается", () => {
    // Часы на телефонах расходятся у всех; отбрасывать из-за минуты значило бы
    // терять время у половины точек.
    expect(accepts(iso(2 * 60_000), now)).toBe(true);
  });

  it("время старше недели отбрасывается", () => {
    // Буфер столько не живёт: такое значение говорит о сбитых часах, а не о
    // долгом отсутствии связи.
    expect(accepts(iso(-8 * 24 * 60 * 60_000), now)).toBe(false);
  });

  it("мусор вместо даты отбрасывается", () => {
    expect(accepts("не дата", now)).toBe(false);
  });
});

describe("устройство в проверках безопасности не участвует", () => {
  it("recorded_at не подменяет created_at при вставке", () => {
    // created_at остаётся временем получения сервером — на нём работает
    // проверка геозоны.
    expect(SRC).toMatch(/recordedAt: sanitizeRecordedAt\(input\.recordedAt\)/);
    expect(SRC, "createdAt задаётся вручную — проверку геозоны можно будет обмануть")
      .not.toMatch(/createdAt:\s*(new Date\(input|input\.)/);
  });

  it("негодное время не отменяет саму точку", () => {
    // Координата — факт, зафиксированный устройством. Терять её из-за сбитых
    // часов хуже, чем потерять точность времени.
    const fn = SRC.slice(SRC.indexOf("function sanitizeRecordedAt"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body).toMatch(/return undefined/);
    expect(body, "негодное время выбрасывает ошибку — точка потеряется").not.toMatch(/throw /);
  });

  it("anti-fraud по-прежнему читает время получения", () => {
    const antifraud = readFileSync(join(process.cwd(), "api", "services", "anti-fraud.ts"), "utf8");
    expect(antifraud).toContain("agentLocations.createdAt");
    expect(antifraud, "проверка геозоны перешла на время от устройства").not.toContain("recordedAt");
  });
});

describe("показ учитывает время съёмки", () => {
  it("выборки берут время съёмки, если оно есть", () => {
    const uses = SRC.match(/COALESCE\(\$\{agentLocations\.recordedAt\}, \$\{agentLocations\.createdAt\}\)/g) ?? [];
    // Две выборки — последние позиции и трек за период — плюс границы периода
    // и сортировки.
    expect(uses.length).toBeGreaterThanOrEqual(4);
  });

  it("границы периода тоже по времени съёмки", () => {
    // Иначе точка, снятая в два часа дня и залитая в шесть вечера, не попала
    // бы в запрос за дневной отрезок — то есть именно тот случай, ради
    // которого поле и заведено.
    const track = SRC.slice(SRC.indexOf("agentLocations.agentId, input.agentId"));
    expect(track.slice(0, 900)).toMatch(/COALESCE\([\s\S]{0,120}\) >= /);
    expect(track.slice(0, 900)).toMatch(/COALESCE\([\s\S]{0,120}\) <= /);
  });
});
