import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Руководство обещает снимок — CI обязан его снять, а книга — показать.
 *
 * Снимок в scripts/manual_content.py задаётся тройкой (kind, role, screen);
 * scripts/build_manual.py молча выбрасывает фигуру, если PNG нет. Так книга
 * теряла главы без единой ошибки. Здесь три стража:
 *   · у каждой фигуры есть сценарий в scripts/screenshots.mjs для той же роли;
 *   · каждая выноска ссылается на метку — из сценария или screenshot-marks.json;
 *   · собранная книга docs/manual содержит картинку каждой фигуры на обоих
 *     языках — значит, CI на ветке docs/manual-* снял всё и пересобрал.
 * Третий страж падает на коммите с новым содержанием, пока CI не пересоберёт
 * книгу, — так и задумано: содержание без картинок в main не попадает.
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const content = read("scripts/manual_content.py");
const shots = read("scripts/screenshots.mjs");
const extra = JSON.parse(read("scripts/screenshot-marks.json")) as Record<string, Record<string, Record<string, [string, string][]>>>;

/* Фигуры книги: тройка и ключи выносок. */
type Fig = { kind: string; role: string; screen: string; callouts: string[]; line: number };
const figs: Fig[] = [];
{
  const lines = content.split("\n");
  const rx = /"fig": \("(\w+)", "(\w+)", "([\w-]+)"\)/;
  for (let i = 0; i < lines.length; i++) {
    const m = rx.exec(lines[i]);
    if (!m) continue;
    // выноски — на той же строке или следующей ("callouts": [["key", T(…)], …])
    const tail = lines[i] + (lines[i + 1] ?? "");
    const co = /"callouts": \[(.*)$/.exec(tail)?.[1] ?? "";
    const callouts = [...co.matchAll(/\["(\w+)", T\(/g)].map(x => x[1]);
    figs.push({ kind: m[1], role: m[2], screen: m[3], callouts, line: i + 1 });
  }
}

/* Сценарии CI: kind → role → screen → ключи меток. */
const scenarios: Record<string, Record<string, Record<string, Set<string>>>> = { web: {}, mobile: {} };
{
  let kind = "";
  let role = "";
  for (const line of shots.split("\n")) {
    if (line.startsWith("const WEB_SCENARIOS")) kind = "web";
    else if (line.startsWith("const MOBILE_SCENARIOS")) kind = "mobile";
    const r = /^ {2}(\w+): \[/.exec(line);
    if (r && kind) { role = r[1]; scenarios[kind][role] ??= {}; continue; }
    if (!kind || !role) continue;
    for (const chunk of line.split("{ name: \"").slice(1)) {
      const name = chunk.slice(0, chunk.indexOf("\""));
      const keys = new Set([...chunk.matchAll(/\["(\w+)", /g)].map(x => x[1]).filter(k => !["click", "fill", "key", "wait"].includes(k)));
      scenarios[kind][role][name] = keys;
    }
    // метки многострочного сценария — строка с marks: после строки с name
    if (/^\s+marks: \[/.test(line)) {
      const last = Object.keys(scenarios[kind][role]).at(-1);
      if (last) for (const m of line.matchAll(/\["(\w+)", /g)) scenarios[kind][role][last].add(m[1]);
    }
  }
  // Вход снимается вне списков сценариев — прямо в shootWeb/shootMobile.
  scenarios.web.login = { login: new Set(["email", "password", "submit"]) };
  scenarios.mobile.agent.login = new Set(["email", "password", "submit"]);
}

describe("фигуры руководства обеспечены сценариями", () => {
  it("в книге есть фигуры, а в CI — сценарии", () => {
    expect(figs.length).toBeGreaterThan(100);
    expect(Object.keys(scenarios.web.operator).length).toBeGreaterThan(30);
    expect(Object.keys(scenarios.mobile.agent).length).toBeGreaterThan(15);
  });

  it("у каждой фигуры есть сценарий той же роли", () => {
    const missing = figs.filter(f => !scenarios[f.kind]?.[f.role]?.[f.screen])
      .map(f => `manual_content.py:${f.line} (${f.kind}, ${f.role}, ${f.screen})`);
    expect(missing, "фигуры без сценария в scripts/screenshots.mjs — книга их молча выбросит:\n" + missing.join("\n")).toEqual([]);
  });

  it("каждая выноска ссылается на существующую метку", () => {
    const bad: string[] = [];
    for (const f of figs) {
      const own = scenarios[f.kind]?.[f.role]?.[f.screen] ?? new Set<string>();
      const more = new Set((extra[f.kind]?.[f.role]?.[f.screen] ?? []).map(x => x[0]));
      for (const k of f.callouts) if (!own.has(k) && !more.has(k)) bad.push(`manual_content.py:${f.line} ${f.kind}/${f.role}/${f.screen}: «${k}»`);
    }
    expect(bad, "выноски без метки — цифры на снимке не появятся:\n" + bad.join("\n")).toEqual([]);
  });

  for (const lang of ["ru", "uz"] as const) {
    it(`${lang}: собранная книга показывает каждую фигуру`, () => {
      const html = read(`docs/manual/manual.${lang}.html`);
      const missing: string[] = [];
      for (const f of figs) {
        const img = `img/${f.kind}-${lang}-${f.role}-${f.screen}.webp`;
        if (!html.includes(`src='${img}'`) || !existsSync(path.join(ROOT, "docs/manual", img))) missing.push(img);
      }
      const uniq = [...new Set(missing)];
      expect(uniq, "в docs/manual нет снимков — дождитесь коммита CI «Руководство: пересобрано…» на ветке docs/manual-* или почините сценарий:\n" + uniq.join("\n")).toEqual([]);
    });
  }
});
