#!/usr/bin/env node
/*
  Контракт мобилки против роутера.

  ── Что ловит ───────────────────────────────────────────────────────────────

  Мобильное приложение зовёт tRPC строками («order.getById») и описывает
  ответы рукописными интерфейсами (src/api.ts в Warehouse-Pro-Mobile).
  Переименование поля на сервере проходило CI веба и ломало APK у агентов —
  узнавали от них. Здесь из api.ts вынимаются все вызовы trpcQuery /
  trpcMutation, и для каждого генерируется проверка типов:

    · ответ сервера (inferRouterOutputs, Date → string, как в JSON) должен
      быть присваиваем типу, который ждёт мобилка;
    · то, что мобилка шлёт (объект из параметров функции), должно быть
      присваиваемо входу процедуры (inferRouterInputs);
    · процедура существует и того же рода (query/mutation) — это проверяет
      vitest по contracts/mobile-procedures.json, без второго репозитория.

  ── Как запускать ───────────────────────────────────────────────────────────

    node scripts/mobile-contract.mjs --mobile ../Warehouse-Pro-Mobile   # генерирует и проверяет
    node scripts/mobile-contract.mjs --mobile ../Warehouse-Pro-Mobile --emit-json  # + обновить json

  Нужны только node_modules веба. В CI веба мобилка выкачивается
  actions/checkout (репозиторий публичный), в CI мобилки — наоборот.

  Сгенерированное (node_modules/.tmp/mobile-contract.check.ts и tsconfig
  рядом) в git не идёт. Из api.ts берутся только типы и подписи функций —
  текстом, поэтому node_modules мобилки не нужны.
*/
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const mobile = resolve(flag("--mobile") ?? "../Warehouse-Pro-Mobile");
const emitJson = args.includes("--emit-json");
const apiPath = resolve(mobile, "src", "api.ts");
if (!existsSync(apiPath)) {
  console.error(`::error::не найден ${apiPath} — укажите --mobile <путь к Warehouse-Pro-Mobile>`);
  process.exit(2);
}

const source = readFileSync(apiPath, "utf8");
const sf = ts.createSourceFile(apiPath, source, ts.ScriptTarget.ES2022, true);

/*
  Из api.ts берутся только типы и ПОДПИСИ функций — текстом, без тел и без
  импортов. Так проверка компилируется внутри серверного tsconfig и не тянет
  react-native: его глобальные типы (fetch, setTimeout → number) ломают
  серверные файлы, если оказаться с ними в одной программе.
*/
const decls = [];
for (const st of sf.statements) {
  if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) {
    decls.push(st.getText(sf).replace(/^export\s+/, ""));
    continue;
  }
  const isExport = st.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
  if (isExport && ts.isFunctionDeclaration(st) && st.name) {
    const params = st.parameters.map(p => {
      const name = p.name.getText(sf);
      const type = p.type ? p.type.getText(sf) : "any";
      const opt = p.questionToken || p.initializer ? "?" : "";
      return `${p.dotDotDotToken ? "..." : ""}${name}${opt}: ${type}`;
    }).join(", ");
    const tparams = st.typeParameters ? `<${st.typeParameters.map(t => t.getText(sf)).join(", ")}>` : "";
    const ret = st.type ? st.type.getText(sf) : "Promise<unknown>";
    decls.push(`declare function ${st.name.text}${tparams}(${params}): ${ret};`);
  }
}

// ── вызовы trpcQuery / trpcMutation внутри экспортированных функций ────────
const calls = [];      // { fn, kind, path, typeArg, inputExpr, params, direct, inputIdents }
const unchecked = [];  // { fn, reason }

/** Свободные переменные выражения: имена свойств ({ a: b }, x.y) — не переменные. */
function identsOf(node, out = new Set()) {
  if (ts.isIdentifier(node)) { if (node.text !== "undefined") out.add(node.text); return out; }
  if (ts.isPropertyAccessExpression(node)) return identsOf(node.expression, out);
  if (ts.isPropertyAssignment(node)) return identsOf(node.initializer, out);
  if (ts.isShorthandPropertyAssignment(node)) { out.add(node.name.text); return out; }
  node.forEachChild(ch => { identsOf(ch, out); });
  return out;
}

function bindingNames(name, out = []) {
  if (ts.isIdentifier(name)) out.push(name.text);
  else for (const el of name.elements) if (!ts.isOmittedExpression(el)) bindingNames(el.name, out);
  return out;
}

for (const st of sf.statements) {
  const isExport = st.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
  if (!isExport || !ts.isFunctionDeclaration(st) || !st.name || !st.body) continue;
  const fn = st.name.text;
  const found = [];
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^trpc(Query|Mutation)$/.test(n.expression.text)) {
      const [p, inp] = n.arguments;
      if (p && ts.isStringLiteral(p)) {
        found.push({
          kind: n.expression.text === "trpcQuery" ? "query" : "mutation",
          path: p.text,
          typeArg: n.typeArguments?.[0]?.getText(sf),
          inputExpr: inp?.getText(sf),
          inputIdents: inp ? [...identsOf(inp)] : [],
          // прямой возврат: `return trpcX(...)` или `return await trpcX(...)`
          direct: (() => {
            let q = n.parent;
            if (q && ts.isAwaitExpression(q)) q = q.parent;
            return !!q && ts.isReturnStatement(q);
          })(),
        });
      }
    }
    n.forEachChild(visit);
  };
  visit(st.body);
  if (found.length === 0) continue;
  const params = st.parameters.map(p => ({ text: p.name.getText(sf), names: bindingNames(p.name), hasDefault: !!p.initializer }));
  if (found.length > 1) { unchecked.push({ fn, reason: `несколько вызовов (${found.map(f => f.path).join(", ")})` }); }
  for (const f of found) calls.push({ fn, params, single: found.length === 1, ...f });
}

// ── генерация проверки ─────────────────────────────────────────────────────
const lines = [];
lines.push("/* Сгенерировано scripts/mobile-contract.mjs (Warehouse-Pro). Не править, не коммитить. */");
lines.push("/* eslint-disable */");
lines.push(`import type { RouterInputs, RouterOutputs } from "../../api/contract";`);
lines.push("");
lines.push("// ── Типы и подписи из src/api.ts мобилки (текстом) ─────────────────────────");
lines.push(...decls);
lines.push("");
lines.push("// ── Проверки ────────────────────────────────────────────────────────────────");
lines.push(`
/** Так ответ выглядит после JSON: Date → строка (мобилка superjson-мету не читает). */
type Jsonify<T> =
  T extends Date ? string :
  T extends (infer U)[] ? Jsonify<U>[] :
  T extends object ? { [K in keyof T]: Jsonify<T[K]> } :
  T;
/**
 * Поблажка мобилке: где она объявила поле необязательным (\`?:\`), туда
 * сервер может слать и null — \`??\`, \`||\` и \`if\` ведут себя одинаково.
 * Обязательное поле против null сервера — по-прежнему ошибка.
 */
type Relax<T> =
  T extends (infer U)[] ? Relax<U>[] :
  T extends object ? { [K in keyof T]: undefined extends T[K] ? Relax<T[K]> | null : Relax<T[K]> } :
  T;
type Extends<A, B> = [A] extends [B] ? true : false;
type Assert<T extends true> = T;
type Out<P extends string> = P extends \`\${infer R}.\${infer Rest}\` ? (R extends keyof RouterOutputs ? Out2<RouterOutputs[R], Rest> : never) : never;
type Out2<T, P extends string> = P extends \`\${infer R}.\${infer Rest}\` ? (R extends keyof T ? Out2<T[R], Rest> : never) : (P extends keyof T ? T[P] : never);
type In<P extends string> = P extends \`\${infer R}.\${infer Rest}\` ? (R extends keyof RouterInputs ? In2<RouterInputs[R], Rest> : never) : never;
type In2<T, P extends string> = P extends \`\${infer R}.\${infer Rest}\` ? (R extends keyof T ? In2<T[R], Rest> : never) : (P extends keyof T ? T[P] : never);
`);

let n = 0;
const json = [];
for (const c of calls) {
  n++;
  const id = `${c.fn}__${c.path.replace(/\./g, "_")}`;
  json.push({ fn: c.fn, path: c.path, kind: c.kind });
  lines.push(`// ${c.fn}  ←  ${c.kind} ${c.path}`);
  // существование процедуры: never — значит, такого пути нет
  lines.push(`export type exists_${id} = Assert<[Out<"${c.path}">] extends [never] ? false : true>;`);
  // выход
  if (c.typeArg === "void") {
    // мобилка ответ не читает — форма ответа ей безразлична
  } else if (c.typeArg) {
    lines.push(`export const out_${id}: Relax<${c.typeArg}> = null! as Jsonify<Out<"${c.path}">>;`);
  } else if (c.direct && c.single) {
    lines.push(`export const out_${id}: Relax<Awaited<ReturnType<typeof ${c.fn}>>> = null! as Jsonify<Out<"${c.path}">>;`);
  } else if (c.direct) {
    unchecked.push({ fn: c.fn, reason: `ответ ${c.path} не проверить: нет generic, а вызовов несколько` });
  }
  // иначе ответ не возвращается наружу (await без присваивания) — его форма безразлична
  // вход
  if (!c.single) continue;
  const paramNames = new Set(c.params.flatMap(p => p.names));
  if (!c.inputExpr) {
    // мобилка ничего не шлёт — процедура обязана принимать пустой вход
    lines.push(`export const in_${id}: In<"${c.path}"> = undefined as void;`);
  } else if (c.inputIdents.every(i => paramNames.has(i))) {
    const binds = c.params.map((p, i) => `const ${p.text} = a[${i}]${p.hasDefault ? ` as NonNullable<Parameters<typeof ${c.fn}>[${i}]>` : ""};`).join(" ");
    lines.push(`function _in_${id}(...a: Parameters<typeof ${c.fn}>) { ${binds} return (${c.inputExpr}); }`);
    lines.push(`export const in_${id}: In<"${c.path}"> = null! as ReturnType<typeof _in_${id}>;`);
  } else {
    unchecked.push({ fn: c.fn, reason: `вход ${c.path} собирается из локальных переменных` });
  }
}
lines.push("");
lines.push(`// Не проверено (${unchecked.length}):`);
for (const u of unchecked) lines.push(`//   ${u.fn}: ${u.reason}`);

mkdirSync(resolve(WEB, "node_modules", ".tmp"), { recursive: true });
const checkPath = resolve(WEB, "node_modules", ".tmp", "mobile-contract.check.ts");
const checkText = lines.join("\n") + "\n";
writeFileSync(checkPath, checkText);

const tsconfigPath = resolve(WEB, "node_modules", ".tmp", "tsconfig.contract.json");
writeFileSync(tsconfigPath, JSON.stringify({
  extends: "../../tsconfig.server.json",
  compilerOptions: {
    tsBuildInfoFile: "./tsconfig.contract.tsbuildinfo",
    noUnusedLocals: false, noUnusedParameters: false,
    baseUrl: "../..",
    paths: { "@/*": ["./src/*"], "@contracts/*": ["./contracts/*"], "@db/*": ["./db/*"] },
  },
  include: ["../../api/contract.ts", "./mobile-contract.check.ts"],
}, null, 2) + "\n");

if (emitJson) {
  const jsonPath = resolve(WEB, "contracts", "mobile-procedures.json");
  json.sort((a, b) => a.path.localeCompare(b.path) || a.fn.localeCompare(b.fn));
  writeFileSync(jsonPath, JSON.stringify(json, null, 2) + "\n");
  console.log(`contracts/mobile-procedures.json: ${json.length} вызовов`);
}

console.log(`проверок: ${n} вызовов из ${apiPath}; не проверено: ${unchecked.length}`);
const tsc = resolve(WEB, "node_modules", "typescript", "bin", "tsc");
const r = spawnSync(process.execPath, [tsc, "-p", tsconfigPath, "--pretty", "false"], { stdio: "pipe", encoding: "utf8" });
const out = (r.stdout || "") + (r.stderr || "");
if (r.status !== 0) {
  // каждая ошибка — со строкой-комментарием над проверкой, чтобы было видно, какой вызов
  const src = checkText.split("\n");
  for (const line of out.split("\n")) {
    const m = /mobile-contract\.check\.ts\((\d+),\d+\): error (TS\d+): (.*)/.exec(line);
    if (!m) { if (line.trim()) console.error(line); continue; }
    const ln = Number(m[1]);
    let k = ln - 1; while (k > 0 && !src[k].startsWith("// ")) k--;
    console.error(`::error::${src[k].replace(/^\/\/ /, "")} — ${m[3].slice(0, 300)}`);
  }
  process.exit(1);
}
console.log("контракт мобилки сходится с роутером");
