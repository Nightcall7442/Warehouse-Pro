/**
 * Гарнитура веба умеет кириллицу — и приезжает с нашего сервера.
 *
 * Веб был набран DM Sans — у него только latin и latin-ext. Каждое русское
 * слово браузер молча набирал системным шрифтом: «Serena Trade» — геометрикой,
 * «Касса» рядом — Segoe UI. Это и читалось как «дёшево». Решение владельца от
 * 07.09.2026 для мобилки — Manrope + JetBrains Mono — теперь и на вебе.
 *
 * Шрифты грузились с Google Fonts — дважды (<link> в index.html и @import в
 * css), с чужого домена и цепочкой «CSS → файл» до первого текста. Теперь
 * они свои: переменные файлы @fontsource-variable, наборы latin и cyrillic, в
 * public/fonts с лицензией OFL.
 *
 *   · DM Sans / DM Mono нигде не упоминаются как гарнитура;
 *   · ни index.html, ни css не ходят на Google Fonts;
 *   · @font-face для Manrope и JetBrains Mono — кириллица и латиница, каждый
 *     файл на месте и это настоящий woff2; других наборов не лежит;
 *   · лицензия OFL — рядом со шрифтами;
 *   · кириллический Manrope предзагружается — тем же файлом, что в @font-face;
 *   · CSP приложения и сайта Google Fonts не разрешает (справочнику /manual —
 *     разрешает: он до сих пор берёт шрифты оттуда);
 *   · service worker кладёт шрифты в кэш при первом запросе, а не в предкэш;
 *   · body, tailwind и токены F — Manrope; моно — JetBrains Mono; цифры
 *     данных — табличные, чтобы суммы вставали по разрядам.
 *
 * Нарочная поломка: вернуть @import Google Fonts в index.css — падает «не с
 * Google»; переименовать файл в public/fonts — «файлы на месте»; вернуть
 * fonts.gstatic.com в fontSrc без forManual — «CSP»; добавить woff2 в
 * globPatterns — «service worker».
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { CSP_DIRECTIVES } from "../../api/lib/csp";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__" && name !== "node_modules") walk(p); }
    else if (/\.(tsx?|css|svg|html)$/.test(name)) files.push(p);
  }
};
walk(join(ROOT, "src"));
files.push(join(ROOT, "index.html"), join(ROOT, "tailwind.config.js"));

const css = read("src/index.css");
const html = read("index.html");

/** @font-face из index.css: семейство, файл и диапазон знаков. */
const faces = [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => ({
  family: /font-family:\s*'([^']+)'/.exec(m[1])?.[1] ?? "",
  urls: [...m[1].matchAll(/url\('([^']+)'\)/g)].map(u => u[1]),
  range: /unicode-range:\s*([^;]+);/.exec(m[1])?.[1] ?? "",
  display: /font-display:\s*([^;]+);/.exec(m[1])?.[1] ?? "",
}));

describe("гарнитура веба", () => {
  it("DM Sans и DM Mono не остались нигде как гарнитура", () => {
    const offenders = files
      .filter(f => /['"]DM (Sans|Mono)['"]|DM\+(Sans|Mono)/.test(readFileSync(f, "utf8")))
      .map(f => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  it("шрифты не с Google: ни index.html, ни css туда не ходят", () => {
    for (const src of [html, css]) {
      expect(src.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    }
  });

  it("Manrope и JetBrains Mono — свои, кириллица и латиница, сразу по свопу", () => {
    for (const family of ["Manrope", "JetBrains Mono"]) {
      const own = faces.filter(f => f.family === family);
      // Кириллица — U+0400-045F, латиница — U+0000-00FF (с узбекскими oʻ gʻ — U+02BB).
      expect(own.some(f => f.range.includes("U+0400-045F")), `${family}: нет кириллицы`).toBe(true);
      expect(own.some(f => f.range.includes("U+0000-00FF") && f.range.includes("U+02BB")), `${family}: нет латиницы`).toBe(true);
      for (const f of own) {
        expect(f.display).toBe("swap");
        for (const u of f.urls) expect(u).toMatch(/^\/fonts\/[a-z-]+\.woff2$/);
      }
    }
  });

  it("файлы на месте и это woff2; других наборов не лежит; лицензия OFL рядом", () => {
    const used = new Set(faces.flatMap(f => f.urls).map(u => u.replace(/^\/fonts\//, "")));
    expect(used.size).toBe(4);
    for (const name of used) {
      const file = join(ROOT, "public", "fonts", name);
      expect(existsSync(file), name).toBe(true);
      expect(readFileSync(file).subarray(0, 4).toString("latin1"), name).toBe("wOF2");
    }
    const onDisk = readdirSync(join(ROOT, "public", "fonts"));
    expect(onDisk.filter(n => n.endsWith(".woff2")).sort()).toEqual([...used].sort());
    const licenses = onDisk.filter(n => /^OFL-.*\.txt$/.test(n));
    expect(licenses.sort()).toEqual(["OFL-JetBrainsMono.txt", "OFL-Manrope.txt"]);
    for (const l of licenses) expect(readFileSync(join(ROOT, "public", "fonts", l), "utf8")).toMatch(/SIL Open Font License, Version 1\.1/);
  });

  it("кириллический Manrope предзагружается — тем же файлом, что в @font-face", () => {
    const preload = /<link rel="preload" href="([^"]+)" as="font" type="font\/woff2" crossorigin \/>/.exec(html)?.[1];
    expect(preload, "в index.html нет предзагрузки шрифта").toBeTruthy();
    const cyr = faces.find(f => f.family === "Manrope" && f.range.includes("U+0400-045F"))!;
    expect(cyr.urls).toContain(preload);
  });

  it("CSP: приложению и сайту Google Fonts не разрешён, справочнику /manual — разрешён", async () => {
    const app = new Hono();
    app.use(secureHeaders({ contentSecurityPolicy: CSP_DIRECTIVES }));
    app.get("*", c => c.text("ok"));
    const csp = async (p: string) => (await app.request(p)).headers.get("content-security-policy") ?? "";
    for (const p of ["/", "/compare", "/uz", "/orders", "/manualx"]) {
      const v = await csp(p);
      expect(v, p).toMatch(/font-src 'self' data:/);
      expect(v, p).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);
    }
    for (const p of ["/manual", "/manual/", "/manual/manual.ru.html"]) {
      const v = await csp(p);
      expect(v, p).toMatch(/style-src [^;]*https:\/\/fonts\.googleapis\.com/);
      expect(v, p).toMatch(/font-src [^;]*https:\/\/fonts\.gstatic\.com/);
    }
  });

  it("service worker: шрифты не в предкэше, а в кэше при первом запросе", () => {
    const cfg = read("vite.config.ts");
    const glob = cfg.match(/globPatterns:\s*\[([^\]]*)\]/)?.[1] ?? "";
    expect(glob).not.toBe("");
    expect(glob).not.toMatch(/woff/);
    const rule = cfg.slice(cfg.indexOf("runtimeCaching"));
    expect(rule).toMatch(/startsWith\("\/fonts\/"\)[^\n]*\.woff2[\s\S]*?handler:\s*"CacheFirst"/);
  });

  it("тело, tailwind и токены F — Manrope; моно — JetBrains Mono; цифры данных табличные", () => {
    expect(css).toMatch(/body \{[^}]*font-family: 'Manrope'/);
    const tw = read("tailwind.config.js");
    expect(tw).toMatch(/display: \['"Manrope"'/);
    expect(tw).toMatch(/mono: {4}\['"JetBrains Mono"'/);
    expect(read("src/components/users/types.ts")).toContain("display: \"'Manrope'");
    expect(css).toMatch(/\.font-data \{\s*font-variant-numeric: tabular-nums;/);
  });
});
