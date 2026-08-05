// @vitest-environment jsdom
// recoverFromStaleApp touches sessionStorage, caches and location — this suite
// needs a DOM, and the project default is the node environment.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { isStaleChunkError, recoverFromStaleApp } from "@/lib/stale-app-recovery";

/**
 * These cover the two properties that decide whether a user on a stale cache
 * gets rescued or gets stuck, both of which are easy to break by "tidying" the
 * matcher or the guard later.
 */
describe("isStaleChunkError", () => {
  // Each browser words this differently, and matching only Chrome's phrasing
  // would leave Firefox and Safari users on the broken screen.
  it.each([
    ["Chrome/Edge", "Failed to fetch dynamically imported module: https://x/assets/Shops-a91Ff.js"],
    ["Firefox", "error loading dynamically imported module"],
    ["Safari", "Importing a module script failed."],
    ["Vite CSS preload", "Unable to preload CSS for /assets/Shops-a91Ff.css"],
  ])("recognises the %s phrasing", (_browser, message) => {
    expect(isStaleChunkError(new Error(message))).toBe(true);
  });

  it("recognises a ChunkLoadError by name", () => {
    expect(isStaleChunkError(Object.assign(new Error("boom"), { name: "ChunkLoadError" }))).toBe(true);
  });

  // The dangerous direction: treating an ordinary crash as a stale cache would
  // reload the page instead of surfacing the bug, hiding it from the user and
  // from Sentry.
  it.each([
    ["an ordinary runtime bug", new TypeError("Cannot read properties of undefined (reading 'map')")],
    ["a network failure", new Error("NetworkError when attempting to fetch resource.")],
    ["nothing at all", null],
  ])("does not claim %s", (_case, error) => {
    expect(isStaleChunkError(error)).toBe(false);
  });
});

describe("recoverFromStaleApp", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal("caches", { keys: vi.fn().mockResolvedValue([]), delete: vi.fn() });
    // jsdom refuses to navigate and logs "Not implemented: navigation" when
    // reload() is called; replacing the whole location object is the one way
    // to silence it, and the guard's return value is what we actually assert.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: vi.fn() },
    });
  });

  it("reloads once, then refuses until the guard window passes", async () => {
    await expect(recoverFromStaleApp()).resolves.toBe(true);
    // A second failure right after — e.g. the fresh build is broken too —
    // must not reload again, or the user is stuck in a refresh loop with no
    // error ever shown.
    await expect(recoverFromStaleApp()).resolves.toBe(false);
  });

  it("allows another attempt once the window has passed", async () => {
    await recoverFromStaleApp();
    sessionStorage.setItem("stale_app_reloaded_at", String(Date.now() - 60_000));
    await expect(recoverFromStaleApp()).resolves.toBe(true);
  });
});
