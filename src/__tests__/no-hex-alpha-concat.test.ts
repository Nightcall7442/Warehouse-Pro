import { describe, it, expect } from "vitest";
import { readFileSync, globSync } from "node:fs";
import { colorMix } from "@/lib/color-mix";

/**
 * Guard against the hex-alpha concatenation pattern coming back.
 *
 * `${COLORS.danger}20` was a common way to get a translucent tint while every
 * colour in the codebase was a literal hex string. When colours moved to theme
 * tokens the same expression started producing `var(--color-danger)20`, which
 * is not a colour — the browser silently drops the whole declaration. That is
 * how the Orders filter chips lost their tint and got a fully-opaque border
 * instead of a faint one, with no error anywhere to point at it.
 *
 * The failure mode is invisible, so a test is the only thing that catches it.
 * Use colorMix() instead — it works with hex, rgb() and var() alike.
 */
const HEX_ALPHA_CONCAT = /\$\{[^}]+\}[0-9a-fA-F]{2}\b/;

describe("colour tints", () => {
  it("never appends a hex alpha pair to an interpolated colour", () => {
    const files = globSync("src/**/*.{ts,tsx}", { cwd: process.cwd() })
      // This file and the helper both *document* the banned pattern.
      .filter(f => !f.includes("no-hex-alpha-concat") && !f.includes("color-mix"));

    expect(files.length).toBeGreaterThan(100); // the glob actually matched

    const offenders = files.flatMap(file =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ file, line: i + 1, text: line.trim() }))
        .filter(l => HEX_ALPHA_CONCAT.test(l.text)),
    );

    expect(
      offenders.map(o => `${o.file}:${o.line}  ${o.text}`),
    ).toEqual([]);
  });

  it("colorMix produces a valid CSS colour from a token", () => {
    expect(colorMix("var(--color-danger)", 19)).toBe(
      "color-mix(in srgb, var(--color-danger) 19%, transparent)",
    );
  });
});
