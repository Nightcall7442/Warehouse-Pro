import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Супер-админка показывает ИИ-офис страницей внутри (iframe). Политика
 * безопасности страницы (CSP) без frame-src падает на default-src 'self' и
 * молча отдаёт пустой кадр с перечёркнутым листом — так и случилось.
 *
 * Страж читает boot.ts как текст: frame-src должен разрешать туннель
 * Cloudflare и localhost, а frame-ancestors — по-прежнему 'none' (саму
 * платформу никто не встраивает).
 *
 * Нарочная поломка: убери строку frameSrc — первая проверка упадёт.
 */
const boot = readFileSync(resolve(__dirname, "../boot.ts"), "utf-8");
const csp = boot.slice(boot.indexOf("contentSecurityPolicy:"), boot.indexOf("crossOriginEmbedderPolicy"));

describe("CSP пускает ИИ-офис в кадр супер-админки", () => {
  it("frame-src разрешает туннель Cloudflare и localhost", () => {
    const m = csp.match(/frameSrc:\s*\[([^\]]+)\]/);
    expect(m, "frameSrc не задан — iframe офиса пустой").toBeTruthy();
    const list = m![1];
    expect(list).toContain("https://*.trycloudflare.com");
    expect(list).toContain("http://localhost:*");
    expect(list).toContain("http://127.0.0.1:*");
  });

  it("саму платформу по-прежнему никто не встраивает", () => {
    expect(csp).toMatch(/frameAncestors:\s*\["'none'"\]/);
  });
});
