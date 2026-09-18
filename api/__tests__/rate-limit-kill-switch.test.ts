import { describe, it, expect, vi } from "vitest";

/**
 * RATE_LIMIT_DISABLED=1 — только для нагрузочного стенда: сотни виртуальных
 * людей ходят под пятью учётками засева, и лимит «на человека» измерил бы
 * себя, а не сервер. Выключатель обязан быть явным, громким при старте и
 * не должен срабатывать от чего-то, кроме ровно «1».
 */
vi.mock("../lib/env", () => ({ env: { rateLimitDisabled: true, redisUrl: undefined } }));
vi.mock("../lib/redis", () => ({ getRedis: () => null, isRedisAvailable: () => false }));

import { checkRateLimit } from "../lib/rate-limit";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("выключатель лимитов для нагрузочного стенда", () => {
  it("с RATE_LIMIT_DISABLED=1 лимит не срабатывает никогда", async () => {
    for (let i = 0; i < 50; i++) {
      expect(await checkRateLimit("user:1", { windowMs: 60_000, limit: 3, namespace: "t" })).toBe(true);
    }
  });

  it("включается только ровно единицей и объявляется при старте", () => {
    const env = readFileSync(resolve(__dirname, "../lib/env.ts"), "utf8");
    expect(env).toContain('rateLimitDisabled:    optional("RATE_LIMIT_DISABLED") === "1"');
    const boot = readFileSync(resolve(__dirname, "../boot.ts"), "utf8");
    expect(boot).toMatch(/if \(env\.rateLimitDisabled\) logger\.warn\("RATE_LIMIT_DISABLED=1/);
    // В бою переменной нет: ни в Dockerfile, ни в railway.json, ни в примере окружения.
    for (const f of ["../../Dockerfile", "../../railway.json", "../../.env.example"]) {
      expect(readFileSync(resolve(__dirname, f), "utf8"), f).not.toContain("RATE_LIMIT_DISABLED");
    }
  });
});
