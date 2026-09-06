// @vitest-environment jsdom
/**
 * Окно «мало стока» показывает ровно то, что насчитала плитка.
 *
 * Плитка и список приходят из одного места: сервер отбирает
 * `available <= reorderPoint` при `reorderPoint > 0`. Пока окно рисовало
 * пришедшее как есть, число на плитке и длина списка совпадали.
 *
 * Стоило окну завести свой отбор — `currentStock < reorderPoint` — как оно
 * стало отвечать на другой вопрос: строго меньше вместо «не больше», и общий
 * остаток вместо свободного. Товар ровно на пороге и товар, у которого весь
 * запас в резерве, из списка выпадали; плитка их считала. «5 ниже порога» —
 * а в окне три строки, при одних резервах пусто.
 *
 * Проверка держит именно это: сколько прислали, столько и показали.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LowStockModal } from "@/components/warehouse/LowStockModal";

afterEach(cleanup);

const ITEMS = [
  // Ровно на пороге: сервер такой товар присылает (<=), свой отбор (<) — нет.
  { productName: "Сахар", productCode: "SUG-1", currentStock: 20, reorderPoint: 20 },
  // Весь запас в резерве: свободного 0 при остатке 50 — сервер смотрит на
  // свободный, свой отбор смотрел на общий и товар терял.
  { productName: "Мука", productCode: "FLR-1", currentStock: 50, reorderPoint: 30 },
  { productName: "Соль", productCode: "SLT-1", currentStock: 2, reorderPoint: 10 },
];

describe("окно «мало стока»", () => {
  it("показывает все присланные строки, не отбирая заново", () => {
    render(<LowStockModal lowCount={ITEMS.length} reorderSuggestions={ITEMS} onClose={() => {}} />);
    for (const item of ITEMS) {
      expect(screen.getByText(item.productCode), `${item.productName} пропал из списка`).toBeTruthy();
    }
  });

  it("пустой список объясняет себя, а не молчит", () => {
    render(<LowStockModal lowCount={0} reorderSuggestions={[]} onClose={() => {}} />);
    expect(screen.getByText(/Порог пополнения не задан/)).toBeTruthy();
  });
});
