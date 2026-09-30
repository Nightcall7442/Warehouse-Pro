import { describe, it, expect } from "vitest";
import { createRouter, publicQuery } from "../middleware";

/**
 * Заголовок, который процедура пишет в ответ, доходит до ответа.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Слой withCorrelationId подменял ctx.resHeaders копией (new Headers), а
 * адаптер (http/trpc-adapter.ts) пересылает в ответ исходный объект. Всё,
 * что процедура туда писала, пропадало молча. Нашлось 01.10.2026:
 * user.changeMyLogin выдаёт текущей вкладке новую куку после смены логина
 * суперадмином — кука не доезжала, и вкладка вылетала вместе с прочими
 * сессиями. Настоящим путём (HTTP, кука, база) это проверяет
 * real-db/superadmin-change-own-login.test.ts; здесь — без базы, на цепочке
 * слоёв, чтобы поломку ловил и прогон без MySQL.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Процедура за общими слоями (метрики, номер запроса) пишет set-cookie и свой
 * заголовок — оба оказываются в том самом объекте, который отдал адаптер.
 */
describe("заголовки процедуры доходят до ответа", () => {
  it("set-cookie из процедуры попадает в resHeaders адаптера, а не в копию", async () => {
    const router = createRouter({
      touch: publicQuery.mutation(({ ctx }) => {
        ctx.resHeaders.append("set-cookie", "app_sid=fresh; Path=/; HttpOnly");
        ctx.resHeaders.set("x-probe", "1");
        return { ok: true };
      }),
    });
    const resHeaders = new Headers();
    const caller = router.createCaller({ req: new Request("http://localhost/api/trpc/touch", { method: "POST" }), resHeaders, db: {} } as never);
    await expect(caller.touch()).resolves.toEqual({ ok: true });
    expect(resHeaders.get("x-probe")).toBe("1");
    expect(resHeaders.get("set-cookie")).toContain("app_sid=");
  });
});
