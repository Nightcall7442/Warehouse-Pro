/**
 * Выход отзывает сессию; второй фактор — по RFC 6238.
 *
 * Было: /api/logout стирал куку, а токен жил свои 30 дней — из чужого
 * браузера или украденный. Отозвать можно было только «везде сразу»
 * (tokenVersion). Второго фактора не было ни у кого, включая директора и
 * администратора платформы.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("../lib/redis", () => ({ getRedis: () => { throw new Error("no redis"); }, isRedisAvailable: () => false }));
vi.mock("../lib/env", () => ({ env: { appSecret: "test-secret-test-secret-test-secret-32" } }));

import { signSessionToken, verifySessionToken } from "../auth/session";
import { revokeSession, isSessionRevoked, _revocationInternals } from "../auth/revocation";
import { totpCode, verifyTotp, generateTotpSecret, base32Decode, base32Encode, otpauthUrl } from "../lib/totp";

describe("сессия: jti и отзыв", () => {
  beforeEach(() => _revocationInternals.memory.clear());

  it("у токена есть идентификатор и срок; два токена — два разных", async () => {
    const a = await verifySessionToken(await signSessionToken({ userId: 1, tv: 0 }));
    const b = await verifySessionToken(await signSessionToken({ userId: 1, tv: 0 }));
    expect(a?.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(a?.exp).toBeGreaterThan(Date.now() / 1000);
    expect(a?.jti).not.toBe(b?.jti);
  });

  it("отозванная сессия узнаётся; неотозванная — нет", async () => {
    const claim = (await verifySessionToken(await signSessionToken({ userId: 1, tv: 0 })))!;
    expect(await isSessionRevoked(claim.jti!)).toBe(false);
    await revokeSession(claim.jti!, claim.exp!);
    expect(await isSessionRevoked(claim.jti!)).toBe(true);
  });

  it("отзыв истекает вместе с токеном", async () => {
    await revokeSession("old", Math.floor(Date.now() / 1000) - 10);
    // ttl ≥ 1 c — сразу после отзыва ещё числится, а срок в памяти — на секунду вперёд
    const until = _revocationInternals.memory.get("old")!;
    expect(until - Date.now()).toBeLessThanOrEqual(1000);
  });

  it("authenticateRequest и refresh отказывают отозванной; logout отзывает", () => {
    const auth = readFileSync("api/auth/index.ts", "utf-8");
    expect(auth).toContain("if (claim.jti && await isSessionRevoked(claim.jti)) throw");
    const boot = readFileSync("api/boot.ts", "utf-8");
    const logout = boot.slice(boot.indexOf('app.post("/api/logout"'), boot.indexOf('app.post("/api/refresh-token"'));
    expect(logout).toContain("await revokeSession(claim.jti, claim.exp)");
    const refresh = boot.slice(boot.indexOf('app.post("/api/refresh-token"'), boot.indexOf('app.post("/api/logout-all"'));
    expect(refresh).toContain("isSessionRevoked(claim.jti)");
  });
});

describe("TOTP", () => {
  it("base32 туда и обратно", () => {
    const buf = Buffer.from("hello world!!");
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
  });

  it("контрольный вектор RFC 6238 (SHA1, секрет 12345678901234567890)", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    // Из приложения B RFC 6238 (8 цифр 94287082 → последние шесть 287082)
    expect(totpCode(secret, 59 * 1000)).toBe("287082");
    expect(totpCode(secret, 1111111109 * 1000)).toBe("081804");
  });

  it("код верен в своём шаге и в соседних, но не через два", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpCode(secret, now), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now + 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now + 90_000), now)).toBe(false);
    expect(verifyTotp(secret, "abc", now)).toBe(false);
  });

  it("ссылка для аутентификатора", () => {
    expect(otpauthUrl("Warehouse Pro", "a@b.c", "ABC")).toBe("otpauth://totp/Warehouse%20Pro%3Aa%40b.c?secret=ABC&issuer=Warehouse%20Pro&algorithm=SHA1&digits=6&period=30");
  });

  it("на входе код спрашивается только после верного пароля; секрет запечатан и наружу не идёт", () => {
    const boot = readFileSync("api/boot.ts", "utf-8");
    const login = boot.slice(boot.indexOf('app.post("/api/login"'), boot.indexOf('app.post("/api/logout"'));
    // после проверки пароля и до выдачи токена
    expect(login.indexOf("TOTP_REQUIRED")).toBeGreaterThan(login.indexOf("matched.length === 0"));
    expect(login.indexOf("TOTP_REQUIRED")).toBeLessThan(login.indexOf("signSessionToken({"));
    expect(login).toContain("verifyTotp(open(user.totpSecret)");

    const users = readFileSync("api/queries/users.ts", "utf-8");
    const proj = users.slice(users.indexOf("export async function findUserById"), users.indexOf("export async function findUserByIdWithPassword"));
    expect(proj).toContain("totpEnabledAt");
    expect(proj).not.toContain("totpSecret");
    expect(readFileSync("api/auth/index.ts", "utf-8")).toContain('Omit<User, "passwordHash" | "totpSecret">');

    const router = readFileSync("api/user-router.ts", "utf-8");
    expect(router).toContain("totpSecret: seal(secret)");
    expect(router).toContain("verifyTotp(unseal(row.totpSecret), input.code)");
  });

  it("веб: поле кода на входе и раздел в профиле", () => {
    expect(readFileSync("src/pages/Login.tsx", "utf-8")).toContain('data.code === "TOTP_REQUIRED"');
    const profile = readFileSync("src/components/settings/ProfileSettings.tsx", "utf-8");
    for (const id of ["totp-start", "totp-secret", "totp-enable", "totp-disable"]) expect(profile).toContain(`"${id}"`);
  });
});
