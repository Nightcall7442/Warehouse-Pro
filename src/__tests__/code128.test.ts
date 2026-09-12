/**
 * Code 128 своими силами: таблица без опечаток и известные кодировки.
 * Опечатка в одной ширине делает знак нечитаемым молча — потому таблица
 * проверяется целиком, а не «печатается ли что-нибудь».
 */
import { describe, it, expect } from "vitest";
import { CODE128_PATTERNS, code128Values, code128Modules, code128Svg } from "@/lib/code128";

describe("Code 128", () => {
  it("таблица: 107 знаков, каждый из 11 модулей (стоп — 13), штрихов и пробелов по три", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    CODE128_PATTERNS.forEach((p, i) => {
      const widths = [...p].map(Number);
      const sum = widths.reduce((a, b) => a + b, 0);
      if (i === 106) { expect(p).toBe("2331112"); expect(sum).toBe(13); return; }
      expect(widths, `знак ${i}`).toHaveLength(6);
      expect(sum, `знак ${i}: ${p}`).toBe(11);
    });
    // ни один знак не повторяется — иначе два значения были бы неразличимы
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
  });

  it("«A» в наборе B: старт 104, знак 33, контроль 34, стоп", () => {
    expect(code128Values("A")).toEqual([104, 33, 34, 106]);
    expect(code128Modules("A")).toBe("11010010000" + "10100011000" + "10001011000" + "1100011101011");
  });

  it("длинное число уходит в набор C парами, нечётный хвост — в B", () => {
    expect(code128Values("1234")).toEqual([105, 12, 34, (105 + 12 + 34 * 2) % 103, 106]);
    const v = code128Values("AB12345");
    expect(v.slice(0, 8)).toEqual([104, 33, 34, 99, 12, 34, 100, 21]);
    expect(v[v.length - 1]).toBe(106);
  });

  it("контрольный знак — взвешенная сумма по модулю 103", () => {
    const v = code128Values("A61-14");
    const body = v.slice(0, -2);
    const expected = body.reduce((s, x, i) => s + (i === 0 ? x : x * i), 0) % 103;
    expect(v[v.length - 2]).toBe(expected);
  });

  it("не кодирует пустое и не-ASCII, а SVG экранирует текст", () => {
    expect(() => code128Values("")).toThrow();
    expect(() => code128Values("Ж")).toThrow();
    const svg = code128Svg("A<B", { label: true });
    expect(svg).toContain("A&lt;B");
    expect(svg).toMatch(/^<svg /);
    expect((svg.match(/<rect /g) ?? []).length).toBeGreaterThan(10);
  });
});

describe("этикетки по приходу", () => {
  it("printLabels: столько наклеек, сколько пришло, с потолком; приход отдаёт штрих-код", async () => {
    const { readFileSync } = await import("node:fs");
    const docs = readFileSync("src/lib/documents.ts", "utf-8");
    expect(docs).toContain("export function printLabels(items: LabelItem[])");
    expect(docs).toContain("labels.length < MAX_LABELS");
    expect(readFileSync("src/pages/Arrivals.tsx", "utf-8")).toContain('data-testid="arrival-print-labels"');
    expect(readFileSync("api/arrival-router.ts", "utf-8")).toContain("p.barcode AS barcode");
    // одна разметка этикетки на весь продукт: страница «Штрих-коды» печатает тем же
    const page = readFileSync("src/pages/Barcode.tsx", "utf-8");
    expect(page).toContain('import { printLabels as printLabelSheet } from "@/lib/documents";');
    expect(page).not.toContain("label-print-area");
  });
});
