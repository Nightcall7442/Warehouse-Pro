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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { noteStaleAssetHit, getStaleAssetHits, resetStaleAssetHits } from "../lib/deploy-signals";

const BOOT = readFileSync(join(__dirname, "..", "boot.ts"), "utf8");

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
