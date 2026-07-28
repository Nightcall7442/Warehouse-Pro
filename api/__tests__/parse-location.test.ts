/**
 * Tests for GPS coordinate parsing from various URL formats.
 */
import { describe, it, expect } from "vitest";
import { parseLocationFromUrl } from "../lib/parse-location";

describe("parseLocationFromUrl", () => {
  // ── Direct coordinates ─────────────────────────────────────────────────────
  describe("direct coordinates", () => {
    it("parses 'lat, lng' format", () => {
      const result = parseLocationFromUrl("41.3603, 69.2853");
      expect(result).toEqual({ lat: 41.3603, lng: 69.2853 });
    });

    it("parses 'lat,lng' without spaces", () => {
      const result = parseLocationFromUrl("41.3603,69.2853");
      expect(result).toEqual({ lat: 41.3603, lng: 69.2853 });
    });

    it("parses negative coordinates", () => {
      const result = parseLocationFromUrl("-33.8688, 151.2093");
      expect(result).toEqual({ lat: -33.8688, lng: 151.2093 });
    });
  });

  // ── Google Maps URLs ──────────────────────────────────────────────────────
  describe("Google Maps", () => {
    it("parses ?q=lat,lng", () => {
      const result = parseLocationFromUrl("https://maps.google.com/?q=41.3603,69.2853");
      expect(result).toEqual({ lat: 41.3603, lng: 69.2853 });
    });

    it("parses ?query=lat,lng", () => {
      const result = parseLocationFromUrl("https://maps.google.com/?query=41.3603,69.2853");
      expect(result).toEqual({ lat: 41.3603, lng: 69.2853 });
    });

    it("parses @lat,lng in path", () => {
      const result = parseLocationFromUrl("https://www.google.com/maps/place/Tashkent/@41.3603,69.2853,15z");
      expect(result).toEqual({ lat: 41.3603, lng: 69.2853 });
    });
  });

  // ── Yandex Maps ───────────────────────────────────────────────────────────
  describe("Yandex Maps", () => {
    it("parses ?pt=lng,lat (note: Yandex uses lng,lat order)", () => {
      const result = parseLocationFromUrl("https://yandex.ru/maps/?pt=69.2853,41.3603&z=18");
      expect(result).toEqual({ lat: 41.3603, lng: 69.2853 });
    });
  });

  // ── Telegram share links ──────────────────────────────────────────────────
  describe("Telegram share", () => {
    it("parses Telegram share with embedded Google Maps link", () => {
      const url = "https://t.me/share/url?url=https%3A%2F%2Fmaps.google.com%2F%3Fq%3D41.3603%2C69.2853&text=Shop+location";
      const result = parseLocationFromUrl(url);
      expect(result).toEqual({ lat: 41.3603, lng: 69.2853 });
    });
  });

  // ── Fallback regex ────────────────────────────────────────────────────────
  describe("fallback regex", () => {
    it("extracts coordinates from arbitrary URL with high-precision decimals", () => {
      const result = parseLocationFromUrl("https://example.com/shop/41.36030000,69.28530000");
      expect(result).toEqual({ lat: 41.3603, lng: 69.2853 });
    });
  });

  // ── Invalid input ─────────────────────────────────────────────────────────
  describe("invalid input", () => {
    it("returns null for empty string", () => {
      expect(parseLocationFromUrl("")).toBeNull();
    });

    it("returns null for random text", () => {
      expect(parseLocationFromUrl("hello world")).toBeNull();
    });

    it("returns null for out-of-range latitude", () => {
      expect(parseLocationFromUrl("91.0, 69.0")).toBeNull();
    });

    it("returns null for out-of-range longitude", () => {
      expect(parseLocationFromUrl("41.0, 181.0")).toBeNull();
    });

    it("returns null for null input", () => {
      expect(parseLocationFromUrl(null as unknown as string)).toBeNull();
    });
  });
});
