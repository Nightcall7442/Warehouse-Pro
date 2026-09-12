#!/usr/bin/env node
/*
  Выпуск: раздел в CHANGELOG.md из коммитов, версия в package.json, метка в git.

    node scripts/release.mjs 2026.09.13          # готовит выпуск v2026.09.13
    git push && git push --tags                   # CI собирает, release.yml публикует

  Версия — календарная (ГГГГ.ММ.ДД[.N]): у продукта одна ветка и выкладка
  каждый день, семантические числа тут ничего не значили бы. До этого меток
  не было вовсе, и «что вошло в выкладку» отвечали по памяти.

  Раздел собирается из тем коммитов (первая строка) с прошлой метки. Тема
  коммита здесь — русское предложение о том, что изменилось для дела; этого
  достаточно, чтобы список читался без git. Служебные («Merge pull request»,
  «Убран мёртвый it.skip») отфильтровываются по началу строки.
*/
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const version = process.argv[2];
if (!/^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/.test(version ?? "")) {
  console.error("Версия — календарная: node scripts/release.mjs 2026.09.13[.2]");
  process.exit(2);
}
const tag = `v${version}`;
const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();

if (sh("git status --porcelain")) { console.error("Рабочее дерево не чистое — сначала закоммитьте или уберите правки."); process.exit(1); }
if (sh("git tag -l " + tag)) { console.error(`Метка ${tag} уже есть.`); process.exit(1); }

const lastTag = sh("git describe --tags --abbrev=0 2>/dev/null || true");
const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
const NOISE = /^(Merge |Revert |chore|wip|tmp|fixup!|squash!)/i;
const subjects = sh(`git log ${range} --format=%s --no-merges`).split("\n").filter(s => s && !NOISE.test(s));
if (subjects.length === 0) { console.error("С прошлой метки нет коммитов — выпускать нечего."); process.exit(1); }

const date = new Date().toISOString().slice(0, 10);
const section = [`## ${tag} — ${date}`, "", ...subjects.map(s => `- ${s}`), ""].join("\n");

const path = "CHANGELOG.md";
const head = "# Что менялось\n\nРаздел на выпуск, строка на коммит — из тем коммитов с прошлой метки (scripts/release.mjs).\n\n";
// Шапка и раздел «Не выпущено» снимаются: его содержимое и есть этот выпуск.
const old = existsSync(path)
  ? readFileSync(path, "utf8")
      .replace(/^# Что менялось[\s\S]*?\n\n(?=## |$)/, "")
      .replace(/^## Не выпущено[\s\S]*?(?=\n## |$)/, "")
  : "";
writeFileSync(path, head + section + "\n" + old.replace(/^\n+/, ""));

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
pkg.version = version;
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");

sh(`git add CHANGELOG.md package.json`);
sh(`git commit -q -m "Выпуск ${tag}"`);
sh(`git tag -a ${tag} -m "${tag}"`);
console.log(`${tag}: ${subjects.length} записей в CHANGELOG.md, метка поставлена. Дальше: git push && git push --tags`);
