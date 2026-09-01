import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Порядок меток в журнале миграций.
 *
 * Drizzle применяет только те записи, чья метка `when` больше самой поздней
 * уже применённой. Ошибка в одной метке поэтому не портит эту миграцию — она
 * молча отменяет ВСЕ последующие с меньшим числом, без единой строки в логе.
 *
 * Так и вышло: у 0018, 0019 и 0020 стояли проставленные вручную даты из
 * будущего, и восемнадцать миграций с 0021 по 0038 не применились никогда.
 * Схема держалась на ручных доливках, а то, что долить забыли, вылезло через
 * несколько дней и в другом месте: супервайзер не мог создать план визита,
 * потому что колонки из 0038 в базе не было.
 *
 * Отдельная опасность в том, что метку выдаёт drizzle-kit по текущему времени.
 * Пока в журнале лежит дата из будущего, каждая миграция, созданная до этой
 * даты, получает меньшее число — то есть создаётся уже пропущенной. Здесь это
 * превращается в падение сборки с объяснением вместо тишины.
 */

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

interface JournalEntry { idx: number; tag: string; when: number }

function readJournal(): JournalEntry[] {
  const raw = readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8");
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

describe("журнал миграций", () => {
  it("метки строго растут вместе с номером", () => {
    const entries = [...readJournal()].sort((a, b) => a.idx - b.idx);

    const broken: string[] = [];
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1], cur = entries[i];
      if (cur.when <= prev.when) {
        broken.push(
          `${cur.tag} (${cur.when}) не позже, чем ${prev.tag} (${prev.when}) — ` +
          `эта миграция и все следующие с меньшей меткой не применятся никогда`,
        );
      }
    }

    expect(broken, broken.join("\n")).toEqual([]);
    // Страховка от «зелёного ни на чём»: если файл журнала не прочитается или
    // окажется пустым, цикл сравнения не выполнится ни разу и проверка выше
    // пройдёт вхолостую.
    // Порог «хотя бы одна»: 01.09.2026 историю из 51 файла свернули в один
    // baseline, и прежние «больше тридцати» сломались бы на верном состоянии.
    expect(entries.length).toBeGreaterThan(0);
  });

  it("самая свежая запись имеет наибольшую метку", () => {
    const entries = readJournal();
    const newest = entries.reduce((a, b) => (a.idx > b.idx ? a : b));
    const maxWhen = Math.max(...entries.map(e => e.when));

    // Отдельная формулировка того же правила, но с точки зрения того, кто
    // добавляет миграцию: новая обязана оказаться выше всех прежних, иначе
    // drizzle её не увидит.
    expect(
      newest.when,
      `последняя миграция ${newest.tag} имеет метку ${newest.when}, а в журнале есть ${maxWhen}. ` +
      `Поднимите её метку выше ${maxWhen}, иначе она будет пропущена молча.`,
    ).toBe(maxWhen);
  });

  it("каждой записи журнала соответствует файл, и наоборот", () => {
    const entries = readJournal();
    const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql"));

    const tags = new Set(entries.map(e => e.tag));
    const stems = new Set(files.map(f => f.replace(/\.sql$/, "")));

    // Файл без записи не выполнится вообще; запись без файла уронит запуск.
    expect([...stems].filter(s => !tags.has(s)), "есть файлы миграций без записи в журнале").toEqual([]);
    expect([...tags].filter(t => !stems.has(t)), "есть записи журнала без файла миграции").toEqual([]);
  });

  it("номера идут подряд, без пропусков и повторов", () => {
    const idxs = readJournal().map(e => e.idx).sort((a, b) => a - b);
    expect(idxs).toEqual(idxs.map((_, i) => i));
  });
});
