import { describe, it, expect } from "vitest";
import { reorderQuantity } from "../services/reorder";

/**
 * Сколько дозаказать — арифметика «Дозаказа» (services/reorder.ts).
 *
 *     цель = максимум запаса, не задан — 2 × точка;
 *     заказать = цель − свободно − в пути, не меньше нуля,
 *     вверх до упаковки / целой единицы / сотых.
 *
 * Было: «2 × порог − физический остаток», округлённое до целого в любую
 * сторону — без того, что едет, и без резерва под заказы магазинов.
 */

const base = { point: 20, max: null, available: 6, inbound: 0, packSize: null, unit: "pcs" } as const;

describe("сколько дозаказать", () => {
  it("без максимума — до двух точек, от свободного остатка", () => {
    expect(reorderQuantity(base)).toEqual({ target: 40, suggested: 34 });
  });

  it("максимум задан — до него, а не до двух точек", () => {
    expect(reorderQuantity({ ...base, max: 50 })).toEqual({ target: 50, suggested: 44 });
  });

  it("то, что едет, вычитается; едет больше нужного — заказывать нечего", () => {
    expect(reorderQuantity({ ...base, inbound: 30 }).suggested).toBe(4);
    expect(reorderQuantity({ ...base, inbound: 34 }).suggested).toBe(0);
    expect(reorderQuantity({ ...base, inbound: 100 }).suggested).toBe(0);
  });

  it("продано больше, чем лежит (свободно ниже нуля), — дозаказ покрывает и долг полки", () => {
    expect(reorderQuantity({ ...base, available: -4 }).suggested).toBe(44);
  });

  it("тара задана — вверх до целой упаковки", () => {
    // Нужно 34, в коробке 12 — три коробки.
    expect(reorderQuantity({ ...base, packSize: 12 }).suggested).toBe(36);
    // Ровно в упаковку — без лишней.
    expect(reorderQuantity({ ...base, available: 4, packSize: 12 }).suggested).toBe(36);
    // Дробная тара (мешок 2,5 кг) — тоже кратно ей.
    expect(reorderQuantity({ ...base, unit: "kg", available: 0, point: 1.5, packSize: 2.5 }).suggested).toBe(5);
  });

  it("штучное — вверх до целой единицы; весовое — до сотых, без хвоста дроби", () => {
    expect(reorderQuantity({ ...base, available: 6.5 }).suggested).toBe(34);
    expect(reorderQuantity({ ...base, unit: "box", available: 6.01 }).suggested).toBe(34);
    expect(reorderQuantity({ ...base, unit: "kg", point: 5.5, available: 2.25 }).suggested).toBe(8.75);
    // 0,3 − 0,1 − 0,1 в двоичной дроби — 0,09999999999999998; здесь — ровно 0,1.
    expect(reorderQuantity({ ...base, unit: "l", point: 0.15, available: 0.1, inbound: 0.1 }).suggested).toBe(0.1);
  });
});
