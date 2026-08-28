/**
 * Панель модального окна красится из темы, а не литералом.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * У формы «Добавить платёж» панель была задана классом `bg-[#ffffff]`, а весь
 * текст внутри — токенами темы. В тёмной теме это давало почти белый текст на
 * белом фоне. Замеры в браузере, на собранном CSS:
 *
 *     заголовок  #ede9e3 на #ffffff → контраст 1.21 : 1
 *     подпись    #a39d92 на #ffffff → контраст 2.69 : 1
 *
 * Норма для основного текста — 4.5. То есть форму нельзя было прочитать; её
 * заполняли по памяти. Та же панель была скопирована в экран агента.
 *
 * ── Почему проверка именно такая ────────────────────────────────────────────
 *
 * Модалка рисуется через createPortal, то есть вне обычного дерева страницы:
 * она не наследует ни фон карточки, ни что-либо ещё. Свой фон ей нужен
 * обязательно — и он обязан быть переменной темы. Литерал ломает ровно одну из
 * двух тем, и заметить это можно только переключившись.
 *
 * Проверяются классы, а не текст файла: в комментариях слово bg-[#ffffff]
 * встречается как рассказ о прошлом, и падать на объяснении было бы глупо.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (entry.name.endsWith(".tsx")) yield full;
  }
}

/** Жёсткий фон внутри className — literal-цвет или bg-white. */
const HARDCODED_BG = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g;

describe("модальные окна берут фон из темы", () => {
  const offenders: string[] = [];

  for (const file of sourceFiles(SRC)) {
    const src = fs.readFileSync(file, "utf8");
    // Интересуют только окна поверх страницы: они рисуются вне дерева и
    // собственный фон им обязателен.
    if (!src.includes("createPortal")) continue;

    for (const m of src.matchAll(HARDCODED_BG)) {
      const classes = m[1] ?? m[2] ?? "";
      const bad = classes.split(/\s+/).filter(c => /^bg-\[#/.test(c) || c === "bg-white");
      if (bad.length === 0) continue;
      offenders.push(`${path.relative(SRC, file).split(path.sep).join("/")}: ${bad.join(" ")}`);
    }
  }

  it("ни одна панель не залита цветом-литералом", () => {
    expect(
      offenders,
      "Панель окна рисуется через createPortal — вне дерева страницы, и свой " +
        "фон ей обязателен. Заданный литералом, он ломает одну из двух тем: " +
        "белая панель в тёмной теме получает почти белый текст (контраст 1.21 " +
        "при норме 4.5). Красьте через var(--color-surface), как в " +
        "components/warehouse/AdjustModal.tsx.",
    ).toEqual([]);
  });
});
