import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Цвет, записанный числом, — то, по чему владелец узнаёт «дёшево».
 *
 * ── Откуда правило ──────────────────────────────────────────────────────────
 *
 * Оно не выдумано, а сказано вслух, и не один раз: чат поддержки, страница
 * суперадмина, настройки, уведомления, экраны входа — каждый раз «выглядит
 * дёшево». Отличает такие экраны не палитра (токены-то те же), а два признака:
 * обводка `1px solid` и цвет числом.
 *
 * Сегодня оно поймало карточку достижений. Там стояли «#9ca3af» и «#cd7f32» —
 * серебро и бронза, — и на тёмной теме они оставались прежними: серое пятно и
 * рыжее пятно на угольном холсте. Число темы не знает.
 *
 * ── Почему храповик, а не запрет ────────────────────────────────────────────
 *
 * Разом переписать 1263 вхождения в 143 файлах нельзя, а запрет, который
 * нельзя выполнить, отключают в первый же день. Число заморожено и опускается
 * по мере уборки; выросло — проверка падает и требует объяснить, зачем
 * понадобился ещё один.
 *
 * Тот же приём, что у BASELINE в scripts/typecheck.mjs и у мёртвых ручек.
 */
const SRC = path.resolve(process.cwd(), "src");

/** Убрать комментарии: разбор, называющий прежний цвет, — не цвет. */
const strip = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Где цвет числом уместен и не считается.
 *
 * Печать — бумага, а не экран: документ уходит в отдельное окно строкой HTML,
 * и переменных темы там нет вовсе (см. разбор в самих файлах). Токены лендинга
 * — это и есть объявление палитры, запрещать числа в объявлении бессмысленно.
 */
const ALLOWED = [
  path.join("src", "lib", "documents.ts"),
  path.join("src", "lib", "print.ts"),
  path.join("src", "components", "landing", "landing-tokens.ts"),
];

/** #abc, #aabbcc, #aabbccdd, rgb(…), rgba(…) — всё, что задаёт цвет числом. */
const BY_NUMBER = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g;

function countColours(): { total: number; byFile: Array<[string, number]> } {
  const byFile: Array<[string, number]> = [];
  let total = 0;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        // Проверки сюда не входят: в них цвет числом — это стенд, а не вид.
        if (entry !== "node_modules" && entry !== "__tests__") walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry) || /\.test\./.test(entry)) continue;
      const rel = path.relative(process.cwd(), full);
      if (ALLOWED.some(a => rel.endsWith(a))) continue;

      const found = strip(fs.readFileSync(full, "utf8")).match(BY_NUMBER);
      if (found) { byFile.push([rel, found.length]); total += found.length; }
    }
  };
  walk(SRC);
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile };
}

/**
 * Сколько цветов числом сейчас в экранах.
 *
 * 1088 — замер 10.09.2026, после уборки карточки достижений. Опускается, когда
 * экран переводят на токены; расти не должен.
 */
const BASELINE = 1088;

describe("цвет числом", () => {
  const { total, byFile } = countColours();

  it("разбор нашёл файлы, а не пустоту", () => {
    // Проверка, которая ничего не разобрала, зелена всегда.
    expect(byFile.length, "исходники экранов не прочитаны").toBeGreaterThan(20);
  });

  it("комментарий с цветом за цвет не считается", () => {
    // Поймано на себе: разбор рядом с правкой называет прежний «#cd7f32».
    expect(strip("// был #cd7f32").match(BY_NUMBER)).toBeNull();
    expect(strip("/* был #cd7f32 */").match(BY_NUMBER)).toBeNull();
    expect(strip('const c = "#cd7f32";').match(BY_NUMBER)!.length).toBe(1);
  });

  it("их не становится больше", () => {
    const worst = byFile.slice(0, 8).map(([f, n]) => `  ${n}\t${f}`).join("\n");
    expect(
      total,
      total <= BASELINE ? "" :
        `Цветов числом стало ${total} (было ${BASELINE}).\n${worst}\n\n` +
        `Число темы не знает: на тёмной теме такой цвет остаётся прежним, и\n` +
        `экран выглядит вставленным из чужого продукта — это и есть то самое\n` +
        `«дёшево». Берите токен из src/index.css (--color-*, --kpi-*) или\n` +
        `colorMix поверх него.`,
    ).toBeLessThanOrEqual(BASELINE);
  });

  it("храповик крутится в одну сторону", () => {
    expect(
      total,
      `Цветов числом стало меньше (${total} вместо ${BASELINE}) — опустите ` +
      `BASELINE, чтобы они не вернулись.`,
    ).toBe(BASELINE);
  });

  it("в карточке достижений их нет вовсе", () => {
    /*
      Экран, с которого началось правило. Здесь запрет полный, а не храповик:
      файл только что вычищен, и вернуть в него число — значит вернуть ровно ту
      картинку, на которую пожаловались.
    */
    const card = strip(fs.readFileSync(path.join(SRC, "components", "GamificationCard.tsx"), "utf8"));
    expect(card.match(BY_NUMBER), "в карточке достижений снова цвет числом").toBeNull();
  });
});
