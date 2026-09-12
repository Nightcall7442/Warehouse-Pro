// @vitest-environment jsdom
/**
 * Тосты на экранах арендатора — на языке интерфейса.
 *
 * Узбекский интерфейс с русскими вкраплениями: «Заказ удалён», «Товар
 * добавлен», «Нет данных для выгрузки» уходили одной строкой, минуя пару
 * (ru, uz). Здесь храповик: сырых русских тостов вне superadmin/* не больше,
 * чем сейчас, — и только меньше.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tt, currentLang } from "@/i18n";

const BASELINE = 0;

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) { if (e !== "__tests__" && e !== "superadmin") yield* walk(full); }
    else if (/\.tsx?$/.test(e)) yield full;
  }
}

describe("тосты арендатора", () => {
  it("сырых русских тостов вне superadmin — не больше базовой линии", () => {
    const offenders: string[] = [];
    for (const f of walk("src")) {
      // Мониторинг — экран суперадмина и по решению владельца остаётся русским,
      // как печать и Excel.
      if (f.endsWith("Monitoring.tsx")) continue;
      const s = readFileSync(f, "utf-8");
      for (const m of s.matchAll(/notify\.(success|error|info|warning)\("[^"]*[А-Яа-яЁё][^"]*"\)/g)) {
        offenders.push(`${f.split("\\").join("/")}: ${m[0]}`);
      }
    }
    expect(offenders, offenders.join("\n")).toHaveLength(BASELINE);
  });

  it("tt отвечает языком из хранилища, по умолчанию — русским", () => {
    localStorage.removeItem("lang");
    expect(currentLang()).toBe("ru");
    expect(tt("Да", "Ha")).toBe("Да");
    localStorage.setItem("lang", "uz");
    expect(tt("Да", "Ha")).toBe("Ha");
    localStorage.removeItem("lang");
  });
});
