/**
 * Визит, отмеченный посещённым, несёт время визита.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Отметить визит можно тремя разными путями:
 *
 *   • agent.updatePlanStatus — «Отметить без фото»;
 *   • agent.saveVisitPhoto — «Отметить с фото», снимок магазина;
 *   • MerchandiserService.submitReport — отчёт мерчандайзера: фотографии,
 *     чек-лист по выкладке, заметки о конкурентах.
 *
 * Время визита ставил ТОЛЬКО первый. То есть колонка «Время визита» в журнале
 * визитов оказывалась заполненной ровно у тех, кто отметился без единого
 * доказательства, и пустой у тех, кто снял магазин или заполнил чек-лист.
 * Ровно наоборот тому, зачем всё это заводят.
 *
 * ── Почему правило, а не три проверки ───────────────────────────────────────
 *
 * Потому что путей стало три не сразу: их добавляли по одному, и каждый
 * следующий забывал про поле, о котором знал только предыдущий. Четвёртый
 * забудет так же. Здесь ловится сам класс: где статус становится «посещён»,
 * там же ставится время.
 *
 * Обратное тоже важно и проверяется отдельно: снятие отметки время СТИРАЕТ.
 * Оставшееся описывало бы визит, которого больше нет, — и в отчёте это
 * выглядело бы как состоявшийся обход.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const API = join(__dirname, "..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(API).map(f => ({ rel: relative(API, f), text: readFileSync(f, "utf8") }));

/**
 * Куски `.set({ … })`, внутри которых план становится посещённым.
 *
 * Ищется по содержимому набора, а не по имени таблицы рядом: правка плана
 * пишется и через переменную tx, и через db, и разбирать это выражением
 * дороже, чем стоит. Строка `status: "visited"` встречается только там, где
 * плану проставляют посещение.
 */
function visitedSetBlocks(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\.set\(\{[\s\S]{0,1200}?\}\)/g)) {
    if (/status:\s*"visited"/.test(m[0])) out.push(m[0]);
  }
  return out;
}

describe("отметка визита несёт время визита", () => {
  it("проверяются оба места, где статус пишется словом", () => {
    /*
      Иначе правило ниже прошло бы на пустом списке и ничего не значило.

      Третий путь, updatePlanStatus, сюда не попадает намеренно: статус там
      приходит переменной, и время он ставит условно — эта ветка проверяется
      отдельно, последней в файле.
    */
    const found = FILES
      .filter(f => visitedSetBlocks(f.text).length > 0)
      .map(f => f.rel.replace(/\\/g, "/"))
      .sort();
    expect(found).toEqual(["agent-router.ts", "services/merchandiser.ts"]);
  });

  it("везде, где план становится посещённым, ставится visitedAt", () => {
    const offenders: string[] = [];
    for (const { rel, text } of FILES) {
      for (const block of visitedSetBlocks(text)) {
        if (!/visitedAt:/.test(block)) {
          offenders.push(`${rel}: ${block.replace(/\s+/g, " ").slice(0, 90)}`);
        }
      }
    }
    expect(
      offenders,
      "визит отмечается посещённым без времени — в журнале он окажется без " +
      "часа, и отличить утренний обход от отметки задним числом будет нечем:\n" +
      offenders.join("\n"),
    ).toEqual([]);
  });

  it("снятие отметки время стирает", () => {
    /*
      Единственное место, где статус приходит переменной, — updatePlanStatus:
      он умеет и снять отметку. Там время обязано становиться пустым, иначе
      план без посещения носил бы час состоявшегося визита.
    */
    const agent = FILES.find(f => f.rel === "agent-router.ts")!;
    expect(agent.text).toMatch(
      /visitedAt:\s*input\.status === "visited"\s*\?\s*new Date\(\)\s*:\s*null/,
    );
  });
});
