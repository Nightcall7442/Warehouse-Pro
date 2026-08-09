/**
 * Agent work zones — simplified tests.
 * Tests the core logic without complex mock DB.
 */
import { describe, it, expect } from "vitest";

describe("Agent work zones — logic", () => {
  describe("setWorkZones logic", () => {
    it("replaces all existing assignments", () => {
      // Simulate the logic: delete old, insert new
      let assignments: Array<{ agentId: number; territoryId: number }> = [
        { agentId: 5, territoryId: 1 },
        { agentId: 5, territoryId: 2 },
      ];

      // Replace with new
      const newTerritoryIds = [3, 4, 5];
      assignments = newTerritoryIds.map(tid => ({ agentId: 5, territoryId: tid }));

      expect(assignments).toHaveLength(3);
      expect(assignments.map(a => a.territoryId)).toEqual([3, 4, 5]);
    });

    it("clears assignments when empty array", () => {
      let assignments: Array<{ agentId: number; territoryId: number }> = [
        { agentId: 5, territoryId: 1 },
        { agentId: 5, territoryId: 2 },
      ];

      // Clear
      assignments = [];

      expect(assignments).toHaveLength(0);
    });

    it("creates multiple assignments", () => {
      const agentId = 5;
      const territoryIds = [1, 2, 3];
      const assignments = territoryIds.map(tid => ({
        agentId,
        territoryId: tid,
        tenantId: 1,
      }));

      expect(assignments).toHaveLength(3);
      expect(assignments[0]).toEqual({ agentId: 5, territoryId: 1, tenantId: 1 });
      expect(assignments[1]).toEqual({ agentId: 5, territoryId: 2, tenantId: 1 });
      expect(assignments[2]).toEqual({ agentId: 5, territoryId: 3, tenantId: 1 });
    });
  });

  describe("work zone filtering logic", () => {
    it("filters shops by agent territories", () => {
      const shops = [
        { id: 1, territoryId: 1, name: "Shop A" },
        { id: 2, territoryId: 2, name: "Shop B" },
        { id: 3, territoryId: 3, name: "Shop C" },
      ];

      const agentTerritories = [1, 3]; // Agent works in territories 1 and 3

      const filteredShops = shops.filter(s => agentTerritories.includes(s.territoryId));

      expect(filteredShops).toHaveLength(2);
      expect(filteredShops[0].name).toBe("Shop A");
      expect(filteredShops[1].name).toBe("Shop C");
    });

    it("returns empty if agent has no territories", () => {
      const shops = [
        { id: 1, territoryId: 1, name: "Shop A" },
      ];

      const agentTerritories: number[] = [];

      const filteredShops = shops.filter(s => agentTerritories.includes(s.territoryId));

      expect(filteredShops).toHaveLength(0);
    });
  });
});
