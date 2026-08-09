import { describe, it, expect } from "vitest";
import { tgEscape, tgMessages } from "../telegram-router";

/**
 * Messages go out with parse_mode "HTML", so every value interpolated into one
 * is markup. Telegram rejects a message whose markup it cannot parse — with a
 * 400 that used to surface as a bare `false` — so a shop named «Восток <Азия>»
 * meant the director's "new order" notification silently never arrived.
 *
 * The generic test below is the point of this file: it walks whatever tgMessages
 * exports rather than naming today's seven templates, so a template added next
 * month is covered the day it is written.
 */

// Distinct from the <b> the templates legitimately contain, so the assertions
// can tell "the template's own markup" from "markup that came in as data".
const HOSTILE = '<i>ЗЛО</i> & "кавычки"';

describe("tgEscape", () => {
  it("escapes the three characters Telegram's HTML parser reserves", () => {
    expect(tgEscape('<b>x</b> & y')).toBe("&lt;b&gt;x&lt;/b&gt; &amp; y");
  });

  it("escapes & first, so escapes are not double-escaped", () => {
    // Getting this order wrong turns < into &amp;lt; — visible junk in chat.
    expect(tgEscape("<")).toBe("&lt;");
    expect(tgEscape("&lt;")).toBe("&amp;lt;");
  });

  it("survives null and undefined rather than printing them", () => {
    expect(tgEscape(null)).toBe("");
    expect(tgEscape(undefined)).toBe("");
  });
});

describe("tgMessages templates", () => {
  const templates = Object.entries(tgMessages) as [string, (...a: never[]) => string][];

  it("exports templates to check", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  for (const [name, fn] of templates) {
    it(`${name}: no value passed in reaches Telegram as live markup`, () => {
      // Every parameter gets the hostile string. The numeric parameter
      // (agentPlan's visit count) is unaffected by receiving a string here —
      // it is interpolated the same way either way.
      const out = fn(...(Array(fn.length).fill(HOSTILE) as never[]));

      expect(out).toContain("&lt;i&gt;ЗЛО&lt;/i&gt;");
      expect(out).toContain("&amp;");
      // The tag we fed in must not survive as a tag anywhere in the output.
      expect(out).not.toContain("<i>");
      expect(out).not.toContain("</i>");
    });

    it(`${name}: keeps its own bold heading`, () => {
      // Escaping the inputs must not escape the template's deliberate markup —
      // the fix is at the interpolation, not over the whole string.
      const out = fn(...(Array(fn.length).fill("обычный текст") as never[]));
      expect(out).toContain("<b>");
      expect(out).toContain("</b>");
    });
  }
});
