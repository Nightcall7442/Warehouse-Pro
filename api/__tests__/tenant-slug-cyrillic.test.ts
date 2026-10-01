/**
 * Адрес организации из кириллического названия и подтверждение удаления.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * slugify выбрасывал всё, что не \w, а \w в JavaScript — только латиница.
 * «Борис Животное» получила пустой slug, «Прайм Дистрибюция» МЧЖ — «-1».
 * 01.10.2026 владелец не смог удалить «Борис Животное»: окно просило
 * набрать slug, а пустую строку сервер не принимает.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 *   - кириллица (русская и узбекская) переводится в латиницу, латиница — как
 *     была, пустой результат — «org»;
 *   - подтверждение удаления: slug, а при пустом slug — «#номер»;
 *   - сервер и окно удаления сверяют одним и тем же правилом.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { slugify, offboardConfirmWord } from "@contracts/tenant-slug";

describe("slug из названия", () => {
  it("русская кириллица — латиницей", () => {
    expect(slugify("Борис Животное")).toBe("boris-jivotnoe");
    expect(slugify("«Прайм Дистрибюция» МЧЖ")).toBe("praym-distribyutsiya-mchj");
  });

  it("узбекская кириллица — по узбекскому обычаю", () => {
    expect(slugify("Олтин Йўл Дистрибуция")).toBe("oltin-yol-distributsiya");
    expect(slugify("Ҳамкор Қурилиш Ғалла")).toBe("hamkor-qurilish-galla");
  });

  it("латиница — как раньше", () => {
    expect(slugify("Fresh MCHJ")).toBe("fresh-mchj");
    expect(slugify("  Nokdaun   mchj  ")).toBe("nokdaun-mchj");
    expect(slugify("O'zbek Savdo")).toBe("ozbek-savdo");
  });

  it("ни одной буквы — «org», а не пустота", () => {
    expect(slugify("«»!!!")).toBe("org");
    expect(slugify("")).toBe("org");
  });
});

describe("подтверждение удаления", () => {
  it("обычная организация — её slug", () => {
    expect(offboardConfirmWord({ id: 7, slug: "gosha-drink" })).toBe("gosha-drink");
    expect(offboardConfirmWord({ id: 9, slug: "-1" })).toBe("-1");
  });

  it("пустой slug — номер организации", () => {
    expect(offboardConfirmWord({ id: 12, slug: "" })).toBe("#12");
    expect(offboardConfirmWord({ id: 12, slug: "  " })).toBe("#12");
    expect(offboardConfirmWord({ id: 12, slug: null })).toBe("#12");
  });

  it("сервер и окно удаления сверяют одним правилом", () => {
    const router = readFileSync(resolve(__dirname, "../tenant-router.ts"), "utf8");
    const at = router.indexOf("offboard: superAdminQuery");
    expect(at).toBeGreaterThan(0);
    const body = router.slice(at, at + 2500);
    expect(body).toContain("offboardConfirmWord(t)");
    expect(body).not.toContain("!== t.slug");
    const ui = readFileSync(resolve(__dirname, "../../src/components/superadmin/TenantDetail.tsx"), "utf8");
    expect(ui).toContain("offboardSlug.trim() !== offboardConfirmWord(tenant)");
    expect(ui).toContain("Для подтверждения наберите: ${offboardConfirmWord(tenant)}");
  });
});
