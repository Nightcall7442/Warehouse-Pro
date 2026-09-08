/**
 * Где вёрстка ушла мимо системы оформления.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Владелец раз за разом показывает пальцем: «вот тут дёшево». Каждый раз это
 * оказывается один и тот же набор признаков — цвет, вписанный числом, обводка
 * в один пиксель вместо тени, свой словарь оформления поверх общего. Искать их
 * глазами по трёмстам файлам бессмысленно: найдётся то, на что смотрели.
 *
 * Скрипт считает признаки и раскладывает файлы по тяжести. Его же можно
 * запустить после правок и увидеть, стало ли меньше.
 *
 *     node scripts/design-audit.mjs           — сводка
 *     node scripts/design-audit.mjs --detail  — с номерами строк
 *
 * ── Что НЕ считается нарушением ─────────────────────────────────────────────
 *
 * Запасное значение внутри var(--token, #hex): токен может не подгрузиться.
 * Файлы палитр — index.css, chartTheme (цвета рядов графиков), landing-tokens
 * (у лендинга своя типографика намеренно, это отдельный мир). И «#fff» внутри
 * SVG-заливок, где он не про тему.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "src");

/*
  Бумага — не экран.

  documents.ts, print.ts, export.ts и окно печати накладной готовят печатный
  лист и книгу Excel. У печати нет тёмной темы, а Excel не знает про наши
  переменные: цвет числом там единственно возможный. Считать это долгом
  оформления значит гоняться за призраком.
*/
const PAPER = [
  join("src", "lib", "documents.ts"),
  join("src", "lib", "print.ts"),
  join("src", "lib", "export.ts"),
  join("src", "components", "orders", "InvoicePrintModal.tsx"),
  join("src", "components", "shops", "ShopStatement.tsx"),
];

/*
  Лендинг — отдельный мир намеренно.

  У него своя типографика «чернила по бумаге» (landing-tokens.ts): тонкие
  линейки и обводки там не признак дешевизны, а сам приём. Считается отдельно,
  чтобы не смешивать с долгом приложения.
*/
const LANDING = join("src", "components", "landing") + sep;

/** Палитры — им цвета числом положены по должности. */
const PALETTES = [
  join("src", "lib", "chartTheme.ts"),
  join("src", "components", "landing", "landing-tokens.ts"),
  join("src", "components", "landing", "app-skin.ts"),
  join("src", "components", "superadmin", "types.ts"),
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Текст без комментариев: они часто ЦИТИРУЮТ то, что чинят. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, m => "\n".repeat((m.match(/\n/g) ?? []).length))
    .replace(/\/\/.*$/gm, "");
}

/*
  Строка готовит HTML для ПЕЧАТИ или письма, а не для экрана.

  Отличается надёжно: разметка в шаблонной строке пишет style="..." кавычками,
  а разметка экрана — style={{...}} фигурными скобками. У печатного листа нет
  тёмной темы и нет наших переменных, поэтому цвет числом там единственно
  возможный.
*/
const isMarkupString = (line) => {
  if (/style=\{\{/.test(line)) return false;
  // Разметка печатного листа: атрибут style="…" или голые теги таблицы.
  if (/style="|<(th|td|tr|table|body|h1)|@media print/.test(line)) return true;
  // Правила CSS в той же строке-шаблоне: «h1{…}», «.info span{color:…}».
  return /^[\s<]*(<style>)?[.#*]?[a-zA-Z][\w\s,.*>:#-]*\{[^}]*[:;]/.test(line);
};

const RULES = [
  {
    key: "цвет числом",
    weight: 3,
    why: "не знает про тему: на тёмной это светлая полоса или нечитаемый текст",
    find: (line) => {
      if (isMarkupString(line)) return false;
      // Запасное значение в var(...) законно — вырезаем перед поиском.
      const bare = line.replace(/var\([^)]*\)/g, "");
      return /#[0-9a-fA-F]{3,8}\b/.test(bare) && !/fill=|stroke=|<svg/.test(line);
    },
  },
  {
    key: "rgba числом",
    weight: 2,
    why: "тот же цвет числом, только в другой записи",
    find: (line) => !isMarkupString(line) && /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/.test(line) && !/var\(/.test(line),
  },
  {
    key: "обводка 1px числом",
    weight: 2,
    /*
      Считается только обводка ЧУЖИМ цветом.

      Линейка между строками таблицы — приём законный: строки нельзя разделить
      тенью, и `1px solid var(--color-border)` там верен. Дешевизну выдаёт не
      сама обводка, а цвет, который не знает про тему.
    */
    why: "обводка цветом, который не знает про тему",
    find: (line) => {
      if (isMarkupString(line)) return false;
      const m = line.match(/border(Top|Bottom|Left|Right)?:\s*[`"']?\s*1px solid\s*([^"'`,}]*)/);
      return Boolean(m) && !/var\(|color-mix\(|COLORS\.|LX\.|\$\{/.test(m[2]);
    },
  },
  {
    key: "наведение руками",
    weight: 2,
    why: "e.target — это значок внутри кнопки, а не кнопка; и состояние не возвращается",
    find: (line) => /onMouse(Enter|Leave)=\{/.test(line),
  },
  {
    key: "свой словарь оформления",
    weight: 4,
    why: "второй набор имён поверх общего — расходится молча",
    find: (line) => /from\s+["'][^"']*(designTokens|design-tokens)["']/.test(line),
  },
];

const files = walk(SRC);
const detail = process.argv.includes("--detail");
let report = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  if (PALETTES.some(p => rel.endsWith(p))) continue;
  if (PAPER.some(p => rel.endsWith(p))) continue;
  const isLanding = rel.includes(LANDING) || rel.endsWith(join("src", "pages", "Landing.tsx"));

  const lines = stripComments(readFileSync(file, "utf8")).split("\n");
  const hits = [];
  for (const rule of RULES) {
    for (let i = 0; i < lines.length; i++) {
      if (rule.find(lines[i])) hits.push({ rule, line: i + 1, text: lines[i].trim().slice(0, 96) });
    }
  }
  if (hits.length === 0) continue;

  const score = hits.reduce((s, h) => s + h.rule.weight, 0);
  report.push({ rel, score, hits, isLanding });
}

const landing = report.filter(r => r.isLanding);
report = report.filter(r => !r.isLanding);
report.sort((a, b) => b.score - a.score);

const total = report.reduce((s, r) => s + r.hits.length, 0);
const landingHits = landing.reduce((s, r) => s + r.hits.length, 0);
console.log(`ЭКРАНЫ ПРИЛОЖЕНИЯ: файлов ${report.length}, признаков ${total}`);
console.log(`Лендинг (свой мир, отдельно): файлов ${landing.length}, признаков ${landingHits}`);
console.log(`Бумага и палитры не считаются — см. PAPER и PALETTES выше.\n`);

const byRule = new Map();
for (const r of report) for (const h of r.hits) byRule.set(h.rule.key, (byRule.get(h.rule.key) ?? 0) + 1);
for (const [key, n] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
  const rule = RULES.find(x => x.key === key);
  console.log(`  ${String(n).padStart(4)}  ${key.padEnd(26)} ${rule.why}`);
}
console.log();

for (const r of report) {
  const counts = new Map();
  for (const h of r.hits) counts.set(h.rule.key, (counts.get(h.rule.key) ?? 0) + 1);
  const summary = [...counts.entries()].map(([k, n]) => `${k}×${n}`).join(", ");
  console.log(`${String(r.score).padStart(4)}  ${r.rel.split(sep).join("/")}  — ${summary}`);
  if (detail) for (const h of r.hits) console.log(`        ${h.line}: ${h.text}`);
}
