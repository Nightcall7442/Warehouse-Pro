/**
 * Все тексты отказов, которые сервер может показать человеку, — прямо из исходников.
 *
 * Читает api/ компилятором TypeScript и собирает сообщения двух видов:
 *
 *  - `new TRPCError({ message })` с любым кодом, кроме INTERNAL_SERVER_ERROR
 *    (внутренние ошибки форматтер прячет за общей фразой);
 *  - `new Error("…")` с кириллицей — бизнес-отказ голым throw, который
 *    форматтер пропускает человеку (isOperatorFacingError в middleware.ts);
 *  - свой текст проверки входа zod: `.min(1, "Введите пароль")`,
 *    `.refine(f, "…")`, `ctx.addIssue({ message })` — его форматтер
 *    показывает вместо общей фразы о поле;
 *  - ответ REST-входа, обёрнутый в `say("…")` (api/http/auth.ts).
 *
 * Сообщение приводится к форме каталога (contracts/error-messages.ts): каждая
 * вставка `${…}` шаблона становится `{}`, склейка строк плюсом — одной
 * строкой, тернарник — двумя формами. Что статически не вычислить
 * (переменная, вызов функции), попадает в `unresolved` с файлом и строкой.
 */
import fs from "fs";
import path from "path";
import ts from "typescript";
import { ErrorMessages } from "@contracts/constants";

export interface MessageSite {
  file: string;
  line: number;
  kind: "trpc" | "error" | "zod" | "http";
  /** Код TRPCError, если он записан литералом. */
  code?: string;
  /** Формы сообщения: текст с `{}` на месте вставок. */
  forms: string[];
  /** Части, которые не вычислить статически. */
  unresolved: string[];
}

const CYRILLIC = /[А-Яа-яЁё]/;

/** Методы zod, последним аргументом которых бывает текст ошибки. */
const ZOD_METHODS = new Set([
  "min", "max", "length", "regex", "refine", "superRefine", "int", "email", "url",
  "positive", "nonnegative", "negative", "nonpositive", "nonempty", "gt", "gte", "lt", "lte",
  "multipleOf", "number", "string", "boolean", "date", "datetime", "array", "enum", "startsWith", "endsWith",
]);

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      walkFiles(full, out);
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Строковые константы файла: `const X = "…"` на верхнем уровне и в функциях. */
type ConstRef = { expr: ts.Expression; sf: ts.SourceFile };

/** Экспортированные константы всех просмотренных файлов — для импортов вида PHOTO_VALUE_ERROR. */
const GLOBAL_CONSTS = new Map<string, ConstRef>();

function collectConsts(sf: ts.SourceFile): Map<string, ConstRef> {
  const map = new Map<string, ConstRef>();
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer
      && n.parent && (n.parent.flags & ts.NodeFlags.Const)) {
      map.set(n.name.text, { expr: unwrapConst(n.initializer), sf });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return map;
}

/** `{…} as const` и `(…)` — к самому значению. */
function unwrapConst(e: ts.Expression): ts.Expression {
  while (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
  return e;
}

type Forms = { forms: string[]; unresolved: string[] };

function evaluate(expr: ts.Expression, consts: Map<string, ConstRef>, sf: ts.SourceFile, depth = 0): Forms {
  if (depth > 6) return { forms: [], unresolved: [expr.getText(sf)] };
  if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr)) return evaluate(expr.expression, consts, sf, depth + 1);
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return { forms: [expr.text], unresolved: [] };
  if (ts.isTemplateExpression(expr)) {
    // Вставка — всегда `{}`: её значение известно только в момент отказа.
    let s = expr.head.text;
    for (const span of expr.templateSpans) s += "{}" + span.literal.text;
    return { forms: [s], unresolved: [] };
  }
  if (ts.isConditionalExpression(expr)) {
    const a = evaluate(expr.whenTrue, consts, sf, depth + 1);
    const b = evaluate(expr.whenFalse, consts, sf, depth + 1);
    return { forms: [...a.forms, ...b.forms], unresolved: [...a.unresolved, ...b.unresolved] };
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = evaluate(expr.left, consts, sf, depth + 1);
    const r = evaluate(expr.right, consts, sf, depth + 1);
    const lf = l.forms.length && !l.unresolved.length ? l.forms : ["{}"];
    const rf = r.forms.length && !r.unresolved.length ? r.forms : ["{}"];
    const forms: string[] = [];
    for (const x of lf) for (const y of rf) forms.push(x + y);
    return { forms, unresolved: [] };
  }
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    const a = evaluate(expr.left, consts, sf, depth + 1);
    const b = evaluate(expr.right, consts, sf, depth + 1);
    return { forms: [...a.forms, ...b.forms], unresolved: [...a.unresolved, ...b.unresolved] };
  }
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === "ErrorMessages") {
    const v = (ErrorMessages as Record<string, string>)[expr.name.text];
    if (typeof v === "string") return { forms: [v], unresolved: [] };
  }
  if (ts.isIdentifier(expr)) {
    const local = consts.get(expr.text) ?? GLOBAL_CONSTS.get(expr.text);
    if (local) return evaluate(local.expr, local.sf === sf ? consts : collectConsts(local.sf), local.sf, depth + 1);
  }
  // PHONE_ERROR.ru — поле объекта-константы.
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    const holder = consts.get(expr.expression.text) ?? GLOBAL_CONSTS.get(expr.expression.text);
    if (holder && ts.isObjectLiteralExpression(holder.expr)) {
      for (const p of holder.expr.properties) {
        if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === expr.name.text) {
          return evaluate(p.initializer, holder.sf === sf ? consts : collectConsts(holder.sf), holder.sf, depth + 1);
        }
      }
    }
  }
  return { forms: [], unresolved: [expr.getText(sf)] };
}

export function collectMessageSites(dirs: string[], root: string): MessageSite[] {
  const sites: MessageSite[] = [];
  const parsed = dirs.flatMap((d) => walkFiles(path.join(root, d))).map((file) => {
    const text = fs.readFileSync(file, "utf8");
    return { file, text, sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true) };
  });
  GLOBAL_CONSTS.clear();
  for (const { sf } of parsed) {
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st) || !st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) GLOBAL_CONSTS.set(d.name.text, { expr: unwrapConst(d.initializer), sf });
      }
    }
  }
  for (const { file, text, sf } of parsed) {
    if (!CYRILLIC.test(text) && !text.includes("TRPCError")) continue;
    const consts = collectConsts(sf);
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const visit = (n: ts.Node) => {
      if (ts.isNewExpression(n) && ts.isIdentifier(n.expression)) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        const arg = n.arguments?.[0];
        if (n.expression.text === "TRPCError" && arg && ts.isObjectLiteralExpression(arg)) {
          let code: string | undefined;
          let msg: ts.Expression | undefined;
          for (const p of arg.properties) {
            if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
            if (p.name.text === "code" && ts.isStringLiteralLike(p.initializer)) code = p.initializer.text;
            if (p.name.text === "message") msg = p.initializer;
          }
          if (msg && code !== "INTERNAL_SERVER_ERROR") {
            const { forms, unresolved } = evaluate(msg, consts, sf);
            sites.push({ file: rel, line, kind: "trpc", code, forms, unresolved });
          }
        } else if (n.expression.text === "Error" && arg) {
          const { forms, unresolved } = evaluate(arg, consts, sf);
          const human = forms.filter((f) => CYRILLIC.test(f));
          if (human.length) sites.push({ file: rel, line, kind: "error", forms: human, unresolved });
        }
      }
      // Текст проверки zod: последний строковый аргумент или { message } / { error }.
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const method = n.expression.name.text;
        const zodish = ZOD_METHODS.has(method) || method === "addIssue";
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        if (zodish) {
          for (const a of n.arguments) {
            let target: ts.Expression | undefined = a;
            if (ts.isObjectLiteralExpression(a)) {
              target = undefined;
              for (const p of a.properties) {
                if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && (p.name.text === "message" || p.name.text === "error")) target = p.initializer;
              }
            }
            if (!target || ts.isArrowFunction(target) || ts.isFunctionExpression(target) || ts.isRegularExpressionLiteral(target)) continue;
            const { forms, unresolved } = evaluate(target, consts, sf);
            const human = forms.filter((f) => CYRILLIC.test(f));
            const loose = unresolved.filter((u) => /ERROR|MESSAGE|\.ru\b/.test(u));
            if (human.length || loose.length) sites.push({ file: rel, line, kind: "zod", forms: human, unresolved: loose });
          }
        }
      }
      // Ответ REST-входа через say("…") (api/http/auth.ts) — тот же словарь.
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "say" && n.arguments[0]) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        const { forms, unresolved } = evaluate(n.arguments[0], consts, sf);
        sites.push({ file: rel, line, kind: "http", forms, unresolved });
      }
      // Свой класс отказа: `class ShopHasHistoryError extends Error { constructor() { super("…") } }`.
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.SuperKeyword && n.arguments[0]) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
        const { forms, unresolved } = evaluate(n.arguments[0], consts, sf);
        const human = forms.filter((f) => CYRILLIC.test(f));
        if (human.length) sites.push({ file: rel, line, kind: "error", forms: human, unresolved });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return sites;
}

/** Форма каталога: `{0}`, `{name}` → `{}` — для сравнения с исходником. */
export function shapeOf(template: string): string {
  return template.replace(/\{[A-Za-z0-9_]*\}/g, "{}");
}
