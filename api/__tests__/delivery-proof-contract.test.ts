/**
 * Подпись вручения — одно правило для экрана и сервера (contracts/
 * delivery-proof.ts).
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Росчерки с экрана любого размера становятся подписью, которую сервер
 *     примет: бо́льшая сторона — 1000, целые, внутри рамки.
 *  2. Длинная роспись прореживается под предел точек, концы штрихов целы.
 *  3. Пустая роспись — null (кнопка «Сохранить» не шлёт пустоту).
 *  4. Ломаная для карточки заказа собирается только из чисел: штрих с
 *     чем-то, кроме чисел, выпадает целиком, а не попадает в разметку.
 *  5. Сервер и экран читают одни пределы: сервис реэкспортирует контракт.
 *  6. Отпечаток файла — тот же, что помнит тест мобилки: у телефона побайтная
 *     копия (src/lib/delivery-proof.ts). Поменял контракт — перенеси его в
 *     мобилку и обнови отпечаток в обоих тестах.
 *
 * Нарочная поломка: в normalizeSignature убери Math.round в clamp — падает
 * 1; убери проверку every(Number.isFinite) в signaturePolylines — падает 4.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeSignature, signatureProblem, signaturePolylines,
  SIGNATURE_MAX_POINTS, SIGNATURE_SCALE, SIGNATURE_STROKE_MAX_POINTS,
} from "@contracts/delivery-proof";
import * as service from "../services/delivery-proof";

describe("normalizeSignature", () => {
  it("1. холст 375×160 → рамка 1000×427, целые точки внутри", () => {
    const sig = normalizeSignature([[{ x: 0, y: 0 }, { x: 187.5, y: 80.3 }, { x: 375, y: 160 }, { x: 400, y: -5 }]], 375, 160)!;
    expect(sig.w).toBe(SIGNATURE_SCALE);
    expect(sig.h).toBe(427);
    expect(sig.strokes[0]).toEqual([0, 0, 500, 214, 1000, 427, 1000, 0]);
    expect(signatureProblem(sig)).toBeNull();
  });

  it("1. повторы подряд выкидываются; точка-касание — тоже штрих", () => {
    const sig = normalizeSignature([[{ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 }], [{ x: 50, y: 50 }]], 100, 100)!;
    expect(sig.strokes).toEqual([[100, 100], [500, 500]]);
    expect(signatureProblem(sig)).toBeNull();
  });

  it("2. долгая роспись — прореженная под предел, концы штрихов на месте", () => {
    const long = Array.from({ length: 5000 }, (_, i) => ({ x: i % 300, y: (i * 7) % 150 }));
    const sig = normalizeSignature([long, long.slice(0, 1500)], 300, 150)!;
    const points = sig.strokes.reduce((s, st) => s + st.length / 2, 0);
    expect(points).toBeLessThanOrEqual(SIGNATURE_MAX_POINTS);
    for (const st of sig.strokes) expect(st.length / 2).toBeLessThanOrEqual(SIGNATURE_STROKE_MAX_POINTS);
    const last = long[long.length - 1];
    const k = SIGNATURE_SCALE / 300;
    expect(sig.strokes[0].slice(-2)).toEqual([Math.round(last.x * k), Math.round(last.y * k)]);
    expect(signatureProblem(sig)).toBeNull();
  });

  it("3. пусто или без размера — null", () => {
    expect(normalizeSignature([], 300, 150)).toBeNull();
    expect(normalizeSignature([[]], 300, 150)).toBeNull();
    expect(normalizeSignature([[{ x: 1, y: 1 }]], 0, 150)).toBeNull();
    expect(normalizeSignature([[{ x: Number.NaN, y: 1 }]], 300, 150)).toBeNull();
  });
});

describe("signaturePolylines", () => {
  it("4. числа — в строку точек; штрих с чужим значением выпадает", () => {
    const parsed = signaturePolylines({ w: 1000, h: 400, strokes: [[0, 0, 10, 20], ["0\"/><script>", 1] as unknown as number[], [5, 5]] });
    expect(parsed).toEqual({ w: 1000, h: 400, lines: ["0,0 10,20", "5,5 6,5"] });
    expect(signaturePolylines({ w: "x", h: 1, strokes: [[1, 1]] })).toBeNull();
    expect(signaturePolylines(null)).toBeNull();
    expect(signaturePolylines({ w: 10, h: 10, strokes: "1,1" })).toBeNull();
  });
});

describe("сервер читает те же пределы", () => {
  it("5. сервис отдаёт значения контракта, а не свои копии", () => {
    expect(service.SIGNATURE_SCALE).toBe(SIGNATURE_SCALE);
    expect(service.SIGNATURE_MAX_POINTS).toBe(SIGNATURE_MAX_POINTS);
    expect(service.signatureProblem).toBe(signatureProblem);
  });
});

describe("копия в мобилке", () => {
  it("6. отпечаток файла совпадает с тем, что помнит копия в мобилке", () => {
    const text = readFileSync(resolve(__dirname, "../../contracts/delivery-proof.ts"), "utf8");
    const sha = createHash("sha256").update(text).digest("hex");
    expect(sha, "contracts/delivery-proof.ts изменился: перенеси его в мобилку (src/lib/delivery-proof.ts) и обнови отпечаток здесь и в её тесте").toBe(
      "726343a6ab3614caf2bd7c1e22e2c586274fcfcc235f95cb87b0540820120b51",
    );
  });
});
