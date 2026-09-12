/**
 * Ошибка — это наша вина, а не чужая неудача.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * В журнал ошибок писался ЛЮБОЙ ответ от 400 и выше, и он же шёл в долю ошибок
 * на странице мониторинга. Журнал состоял из чужих неудач:
 *
 *   · после каждой выкладки вкладки на прежней сборке просят свои куски
 *     приложения по старым именам с хэшем и получают 404 — десятками подряд.
 *     Приложение чинит это само, человек ничего не замечает;
 *   · 401 приходит на каждое обращение без входа, включая проверки снаружи;
 *   · 403 — это отработавшая защита, а не поломка.
 *
 * Владелец открыл мониторинг и увидел экран, забитый строками «HTTP 404
 * /assets/…». Доля ошибок при этом показывала 1,8% на исправной системе — по
 * такому числу нельзя понять ничего.
 *
 * ── Правило ─────────────────────────────────────────────────────────────────
 *
 * Ошибка — это 5xx. Тем же правилом уже считают Prometheus
 * (httpRequestErrorsTotal) и тревоги в AlertManager; страница расходилась с
 * ними, то есть один и тот же вопрос имел два ответа.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { noteStaleAssetHit, getStaleAssetHits, resetStaleAssetHits } from "../lib/deploy-signals";
import { bootSource } from "./helpers/boot-source";

const BOOT = bootSource();

/** Условие, которым boot.ts решает, что запрос был ошибкой. */
function requestCounterRule(): string {
  const at = BOOT.indexOf("recordRequest(ms,");
  expect(at, "вызов recordRequest не найден — правило ниже пустое").toBeGreaterThan(0);
  return BOOT.slice(at, at + 60);
}

describe("что считается ошибкой", () => {
  it("в долю ошибок идёт только 5xx", () => {
    // 400 здесь означало бы «чужая неудача — тоже наша ошибка», и доля ошибок
    // снова стала бы числом, по которому ничего не решить.
    expect(requestCounterRule()).toContain(">= 500");
    expect(requestCounterRule(), "в счётчик ошибок вернули 4xx").not.toContain(">= 400");
  });

  it("страница мониторинга считает так же, как Prometheus", () => {
    // Один и тот же вопрос не должен иметь двух ответов: тревоги настроены на
    // долю 5xx, и страница обязана показывать то же самое.
    expect(BOOT).toMatch(/if \(Number\(status\) >= 500\) httpRequestErrorsTotal\.inc/);
  });

  it("в журнал ошибок пишутся только 5xx", () => {
    const at = BOOT.indexOf("if (status >= 500) {");
    expect(at, "запись в журнал перестала быть ограничена 5xx").toBeGreaterThan(0);
    // logError вызывается внутри этой ветви, а не до неё.
    expect(BOOT.slice(at, at + 300)).toContain("logError({");
  });

  it("отказ входа и отказ прав не считаются поломкой", () => {
    expect(BOOT).toMatch(/if \(status === 401 \|\| status === 403\) return;/);
  });
});

describe("ошибки tRPC", () => {
  /*
    Владелец увидел на мониторинге три записи подряд: auth.me, branding.get,
    warehouseMulti.list — все КРИТИЧЕСКИЕ, все с кодом 500, все с текстом
    «Authentication required».

    Сервер при этом вёл себя правильно: в middleware.ts стоит
    TRPCError({ code: "UNAUTHORIZED" }), то есть честный 401 «вы не вошли». А
    это ровно те запросы, что уходят до входа или на истёкшей сессии — обычный
    ход дел, а не поломка.

    Врал журнал: statusCode был зашит числом 500 для ЛЮБОЙ ошибки tRPC, и в
    журнал писалась тоже любая.
  */
  it("код ответа берётся из кода ошибки, а не зашит числом", () => {
    expect(BOOT, "statusCode снова зашит числом").not.toMatch(/statusCode: 500,/);
    expect(BOOT).toContain("const statusCode = TRPC_STATUS[error.code] ?? 500;");
  });

  it("отказ входа не считается сбоем сервера", () => {
    const m = BOOT.match(/const TRPC_STATUS: Record<string, number> = \{([\s\S]*?)\};/);
    expect(m, "перечень кодов пропал").not.toBeNull();
    const table = m![1];
    // Ровно те коды, из-за которых журнал и был забит: «не вошёл» и «нельзя».
    expect(table).toMatch(/UNAUTHORIZED: 401/);
    expect(table).toMatch(/FORBIDDEN: 403/);
    expect(table).toMatch(/INTERNAL_SERVER_ERROR: 500/);
  });

  it("в журнал уходит только то, что 5xx", () => {
    const at = BOOT.indexOf("const statusCode = TRPC_STATUS[error.code]");
    expect(BOOT.slice(at, at + 200)).toContain("if (statusCode >= 500) {");
  });

  it("неизвестный код считается нашей виной", () => {
    // Безопасная сторона ошибки: лучше записать лишнее, чем потерять сбой.
    expect(BOOT).toContain("TRPC_STATUS[error.code] ?? 500");
  });
});

describe("вкладки на прежней сборке", () => {
  beforeEach(() => resetStaleAssetHits());

  it("узнаются по имени куска с хэшем", () => {
    const m = BOOT.match(/const HASHED_ASSET = (\/.*\/);/);
    expect(m, "правило распознавания куска сборки пропало").not.toBeNull();
    const re = new RegExp(m![1].slice(1, m![1].lastIndexOf("/")));

    // То, что присылают старые вкладки после выкладки.
    expect(re.test("/assets/Shops-BYCKANnN.js")).toBe(true);
    expect(re.test("/assets/ExcelImport-DMcNYeFS.js")).toBe(true);
    expect(re.test("/assets/index-DL-_d9yM.js")).toBe(true);
    expect(re.test("/assets/main-abc123.css")).toBe(true);

    // А это не куски сборки, и прятать их 404 нельзя.
    expect(re.test("/api/trpc/shop.list")).toBe(false);
    expect(re.test("/assets/logo.png")).toBe(false);
    expect(re.test("/orders/12")).toBe(false);
  });

  it("считаются отдельно, а не выбрасываются", () => {
    /*
      Совсем терять их тоже неверно: число само по себе полезно — по нему
      видно, что выкладка прошла и часть людей ещё работает со старым.
    */
    expect(getStaleAssetHits()).toBe(0);
    noteStaleAssetHit();
    noteStaleAssetHit();
    expect(getStaleAssetHits()).toBe(2);
  });

  it("счётчик вызывается там, где раньше писалась ошибка", () => {
    expect(BOOT).toMatch(/HASHED_ASSET\.test\(c\.req\.path\)\)\s*\{\s*\n\s*noteStaleAssetHit\(\);/);
  });
});
