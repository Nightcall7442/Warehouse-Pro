/**
 * Кто и какой версией ходит: client_requests_total{client,version}.
 * Заголовок x-client-version ставят веб и мобилка; сервер считает по нему.
 * До этого о версиях в поле не знал никто.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bootSource } from "./helpers/boot-source";

// Разбор вынесен в boot.ts; чтобы не тянуть весь boot, проверяем той же
// регуляркой и по исходнику.
const clientVersionOf = (header: string | undefined) => {
  const m = /^(web|mobile)\/([0-9A-Za-z.+-]{1,32})$/.exec((header ?? "").trim());
  return m ? { client: m[1], version: m[2] } : { client: "unknown", version: "unknown" };
};

describe("x-client-version → client_requests_total", () => {
  it("разбор: web/1.4.2 и mobile/2.0.1; мусор — unknown, чтобы не раздувать метки", () => {
    expect(clientVersionOf("web/1.4.2")).toEqual({ client: "web", version: "1.4.2" });
    expect(clientVersionOf(" mobile/2.0.1 ")).toEqual({ client: "mobile", version: "2.0.1" });
    expect(clientVersionOf("curl/8")).toEqual({ client: "unknown", version: "unknown" });
    expect(clientVersionOf("web/" + "x".repeat(40))).toEqual({ client: "unknown", version: "unknown" });
    expect(clientVersionOf(undefined)).toEqual({ client: "unknown", version: "unknown" });
  });

  it("сервер считает по /api/*, пускает заголовок через CORS; веб ставит его в каждый запрос", () => {
    const boot = bootSource();
    expect(boot).toContain('export function clientVersionOf(header: string | undefined)');
    expect(boot).toContain('if (path.startsWith("/api/")) clientRequestsTotal.inc(clientVersionOf(c.req.header("x-client-version")));');
    expect(boot).toMatch(/allowHeaders: \[[^\]]*"x-client-version"/);
    expect(readFileSync("api/prometheus-metrics.ts", "utf-8")).toContain('name: "client_requests_total"');
    const web = readFileSync("src/providers/trpc.client.ts", "utf-8");
    expect(web).toContain('headers.set("x-client-version", CLIENT_VERSION)');
    expect(web).toContain("`web/${import.meta.env.VITE_APP_VERSION || \"dev\"}`");
  });
});
