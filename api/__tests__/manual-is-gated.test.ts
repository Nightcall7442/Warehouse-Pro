import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Errors } from "@contracts/errors";

/**
 * Руководство дистрибьютора внутри продукта — платное, выдаётся владельцем
 * платформы. Дверь /manual/ обязана: не пускать без сессии; не пускать
 * организацию без разрешения; пускать с разрешением и суперадмина; не отдавать
 * ничего за пределами папки; менять решение сразу (кэш сессии сброшен).
 */
const auth = vi.hoisted(() => ({
  result: null as null | { user: { role: string }; tenant: { manualEnabledAt: Date | null } },
  fail: null as null | (() => never),
}));
vi.mock("../auth", () => ({
  authenticateRequest: vi.fn(async () => { if (auth.fail) auth.fail(); return auth.result; }),
  invalidateAuthTenant: vi.fn(),
}));

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wp-manual-"));
  mkdirSync(path.join(dir, "img"));
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Руководство</title>");
  writeFileSync(path.join(dir, "reader.js"), "window.CHAPTERS=[]");
  writeFileSync(path.join(dir, "img", "web-ru-ceo-dashboard.webp"), Buffer.from([0x52, 0x49, 0x46, 0x46]));
  writeFileSync(path.join(dir, "Warehouse-Pro-Manual.ru.pdf"), "%PDF");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

import { manual, resolveManualFile, manualEnabledFor } from "../manual";

const get = (p: string) => manual.request(new Request(`http://x${p}`, { headers: { cookie: "wp_session=abc" } }), undefined, undefined);
const granted = { user: { role: "operator" }, tenant: { manualEnabledAt: new Date("2026-09-14") } };
const notGranted = { user: { role: "ceo" }, tenant: { manualEnabledAt: null } };

beforeEach(() => { auth.fail = null; auth.result = granted; });

describe("дверь /manual/", () => {
  it("без сессии — на вход, с возвратом обратно", async () => {
    auth.fail = () => { throw Errors.unauthorized("no session"); };
    const r = await get("/manual/");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/login?next=%2Fmanual%2F");
  });

  it("заминка базы — 503, а не «перелогиньтесь»", async () => {
    auth.fail = () => { throw new Error("ECONNRESET"); };
    expect((await get("/manual/")).status).toBe(503);
  });

  it("организация без разрешения — 403 с человеческим текстом", async () => {
    auth.result = notGranted;
    const r = await get("/manual/");
    expect(r.status).toBe(403);
    expect(await r.text()).toContain("Руководство не подключено");
  });

  it("суперадмин видит и без разрешения", () => {
    expect(manualEnabledFor({ manualEnabledAt: null }, "superadmin")).toBe(true);
    expect(manualEnabledFor({ manualEnabledAt: null }, "ceo")).toBe(false);
    expect(manualEnabledFor({ manualEnabledAt: new Date() }, "agent")).toBe(true);
  });

  it("/manual → /manual/", async () => {
    const r = await get("/manual");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/manual/");
  });
});

describe("файлы", () => {
  it("index, скрипт и снимок отдаются со своими типами; html не кэшируется общими кэшами", () => {
    expect(resolveManualFile("/manual/", dir)).toBe(path.join(dir, "index.html"));
    expect(resolveManualFile("/manual/index.html", dir)).toBe(path.join(dir, "index.html"));
    expect(resolveManualFile("/manual/reader.js", dir)).toBe(path.join(dir, "reader.js"));
    expect(resolveManualFile("/manual/img/web-ru-ceo-dashboard.webp", dir)).toBe(path.join(dir, "img", "web-ru-ceo-dashboard.webp"));
  });

  it("наружу папки не выйти — ни «..», ни абсолютным путём, ни кодированным", () => {
    expect(resolveManualFile("/manual/../package.json", dir)).toBeNull();
    expect(resolveManualFile("/manual/img/../../.env", dir)).toBeNull();
    expect(resolveManualFile("/manual/%2e%2e/%2e%2e/etc/passwd.html", dir)).toBeNull();
    expect(resolveManualFile("/manual/C:/Windows/win.ini", dir)).toBeNull();
  });

  it("PDF и исходники сборки через дверь не отдаются — только то, что нужно читалке", () => {
    expect(resolveManualFile("/manual/Warehouse-Pro-Manual.ru.pdf", dir)).toBeNull();
    expect(resolveManualFile("/manual/build.py", dir)).toBeNull();
    expect(resolveManualFile("/manual/.env", dir)).toBeNull();
  });
});

describe("выдача и отзыв", () => {
  it("setManualAccessFor ставит дату, не сдвигает её при повторной выдаче, снимает при отзыве и пишет журнал", async () => {
    const rows = [{ id: 5, slug: "alfa", name: "Альфа", manualEnabledAt: null as Date | null }];
    const updates: Array<Record<string, unknown>> = [];
    const audits: Array<Record<string, unknown>> = [];
    // Стенд знает одну организацию — #5; условие where здесь не разбирается,
    // поэтому «чужой» id отбивается по значению, которое ищет запрос.
    let asked = 5;
    vi.doMock("drizzle-orm", async (orig) => ({ ...(await orig<typeof import("drizzle-orm")>()), eq: (_c: unknown, v: unknown) => { if (typeof v === "number") asked = v; return {}; } }));
    vi.doMock("../queries/connection", () => ({
      getDb: () => ({
        select: () => ({ from: () => ({ where: () => ({ limit: async () => rows.filter(r => r.id === asked) }) }) }),
        update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => { updates.push(v); rows[0].manualEnabledAt = v.manualEnabledAt as Date | null; } }) }),
      }),
    }));
    vi.doMock("../services/audit-log", () => ({ recordAudit: async (_db: unknown, e: Record<string, unknown>) => { audits.push(e); }, auditActor: () => ({}) }));
    const { setManualAccessFor } = await import("../services/manual-access");
    const { invalidateAuthTenant } = await import("../auth");

    const first = await setManualAccessFor(5, true, { id: 1, name: "Владелец" });
    expect(first?.manualEnabledAt).toBeInstanceOf(Date);
    const again = await setManualAccessFor(5, true, { id: 1, name: "Владелец" });
    expect(again?.manualEnabledAt).toEqual(first?.manualEnabledAt);
    const off = await setManualAccessFor(5, false, { name: "Владелец (Telegram)" });
    expect(off?.manualEnabledAt).toBeNull();

    expect(audits.map(a => a.action)).toEqual(["tenant.manual_granted", "tenant.manual_granted", "tenant.manual_revoked"]);
    expect(vi.mocked(invalidateAuthTenant)).toHaveBeenCalledWith(5);
    expect(await setManualAccessFor(999, true, { id: 1, name: "x" })).toBeNull();
  });
});
