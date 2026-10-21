/**
 * Порядок обхода «ближайший сосед» — один на агента и курьера.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Цикл ближайшего соседа жил внутри agent.getOptimizedRoute. Курьерский
 * развоз («Предложить порядок») получил бы вторую копию — и при первой правке
 * две копии разошлись бы. Теперь обе ручки зовут contracts/route-order.ts.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *  1. Из точки старта — в ближайшую, дальше — в ближайшую к ней.
 *  2. Без старта первая остановка — первая точка с координатами.
 *  3. Точки без координат (и с нулём) — в конце, в пришедшем порядке.
 *  4. Длина маршрута — от старта по точкам с координатами.
 *  5. Обе ручки (agent.getOptimizedRoute, courier.suggestRoute) пользуются
 *     общим модулем, своего цикла в них нет.
 *
 * Нарочная поломка: в nearestNeighbour верни `[...unlocated, ...out]` —
 * падает 3; замени `km < bestKm` на `km > bestKm` — падает 1.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { nearestNeighbour, routeKm, coordsOf } from "@contracts/route-order";
import { haversineKm } from "@contracts/geo";

// Три магазина на одной широте, к востоку от старта: 1 км, 3 км, 2 км.
const start = { lat: 41.3, lng: 69.2 };
const east = (km: number) => 69.2 + km / (111.32 * Math.cos((41.3 * Math.PI) / 180));
const A = { id: "A", lat: 41.3, lng: east(1) };
const B = { id: "B", lat: 41.3, lng: east(3) };
const C = { id: "C", lat: 41.3, lng: east(2) };
const NOGPS = { id: "N", lat: null, lng: null };
const ZERO = { id: "Z", lat: "0", lng: "0" };

describe("ближайший сосед", () => {
  it("1. из старта — в ближайшую, дальше — в ближайшую к ней", () => {
    expect(nearestNeighbour([B, C, A], start).map(p => p.id)).toEqual(["A", "C", "B"]);
    // Старт за дальним концом — обход идёт обратно.
    expect(nearestNeighbour([A, B, C], { lat: 41.3, lng: east(10) }).map(p => p.id)).toEqual(["B", "C", "A"]);
  });

  it("2. без старта первая остановка — первая точка с координатами", () => {
    expect(nearestNeighbour([NOGPS, C, A, B]).map(p => p.id)).toEqual(["C", "A", "B", "N"]);
  });

  it("3. точки без координат и с нулём — в конце, в пришедшем порядке", () => {
    expect(nearestNeighbour([ZERO, B, NOGPS, A], start).map(p => p.id)).toEqual(["A", "B", "Z", "N"]);
    expect(nearestNeighbour([NOGPS, ZERO], start).map(p => p.id)).toEqual(["N", "Z"]);
    expect(nearestNeighbour([], start)).toEqual([]);
    expect(coordsOf(ZERO)).toBeNull();
    expect(coordsOf({ lat: "41.3", lng: "69.2" })).toEqual({ lat: 41.3, lng: 69.2 });
  });

  it("4. длина — от старта по точкам с координатами", () => {
    const km = routeKm([A, NOGPS, C, B], start);
    expect(km).toBeCloseTo(3, 1);
    expect(routeKm([A, C], null)).toBeCloseTo(haversineKm(A.lat, A.lng, C.lat, C.lng), 6);
    expect(routeKm([NOGPS], start)).toBe(0);
  });

  it("5. маршрут агента и «Предложить порядок» курьера зовут общий модуль, своего цикла нет", () => {
    const read = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
    const agent = read("agent-router.ts");
    const route = agent.slice(agent.indexOf("getOptimizedRoute:"), agent.indexOf("updatePlanStatus:"));
    expect(route).toContain("nearestNeighbour(");
    expect(route).not.toMatch(/while \(remaining\.length/);

    const board = read("services/dispatch-board.ts");
    const suggest = board.slice(board.indexOf("export async function suggestCourierRoute"));
    expect(suggest).toContain("nearestNeighbour(");
    expect(suggest).not.toMatch(/while \(/);
    expect(read("courier-router.ts")).toMatch(/suggestRoute: managementQuery[\s\S]*?suggestCourierRoute\(/);
  });
});
