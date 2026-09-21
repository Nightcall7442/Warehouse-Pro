import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Подтверждение почты при регистрации с сайта — решение владельца 21.09.2026.
 *
 * Регистрация заводила директора на слово: адрес никто не проверял. Теперь
 * директор заводится с пустым email_verified_at, ему уходит письмо с
 * подписанной ссылкой, а вход закрыт до перехода по ней. Все прочие пути
 * создания человека берут умолчание «подтверждён» — их заводит кто-то,
 * кто уже внутри.
 *
 * Здесь: токен (подпись, срок, чужой токен того же секрета), подтверждение
 * (ставит дату один раз, повтор безвреден), повторное письмо (только
 * неподтверждённым, ответ один), ручки (лимиты), схема и миграции, экраны.
 * Регистрация и вход проверяются в tenant-router и login-multi-tenant.
 *
 * Нарочная поломка: убери «ev.» из нагрузки — упадёт «токен привязки
 * Telegram не подходит»; сними isNull из confirmEmail — упадёт «повтор не
 * переписывает дату»; убери проверку emailVerifiedAt из входа — упадёт
 * login-multi-tenant.
 */
vi.mock("../lib/env", () => ({ env: { appSecret: "тест-секрет", appUrl: "https://wp.test", isProduction: false } }));
vi.mock("../lib/mailer", () => ({ sendVerifyEmail: vi.fn(async () => {}), sendEmail: vi.fn(async () => {}) }));
vi.mock("../lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("../lib/rate-limit", async () => (await import("./helpers/rate-limit-mock")).rateLimitMock());

import {
  createEmailVerifyToken, readEmailVerifyToken, verifyEmailUrl, confirmEmail, resendVerification, VERIFY_TTL_MS,
} from "../services/email-verification";
import { createLinkToken } from "../telegram/link-token";
import { sendVerifyEmail } from "../lib/mailer";
import { users } from "@db/schema";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

/** Условие drizzle — в текст и подстановки тем же диалектом, что и драйвер. */
const render = (cond: unknown) => new MySqlDialect().sqlToQuery(cond as SQL);

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("токен подтверждения", () => {
  it("читается обратно тем же id, живёт три дня, после срока — «устарела»", () => {
    const now = 1_800_000_000_000;
    const token = createEmailVerifyToken(42, now);
    expect(token.startsWith("ev.42.")).toBe(true);
    expect(readEmailVerifyToken(token, now)).toEqual({ ok: true, userId: 42 });
    expect(readEmailVerifyToken(token, now + VERIFY_TTL_MS - 1)).toEqual({ ok: true, userId: 42 });
    expect(readEmailVerifyToken(token, now + VERIFY_TTL_MS + 1)).toEqual({ ok: false, reason: "expired" });
    expect(VERIFY_TTL_MS).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it("подделка: другой id, другой срок, битая подпись — «недействительна», а не «устарела»", () => {
    const now = 1_800_000_000_000;
    const [, id, exp, sig] = createEmailVerifyToken(42, now).split(".");
    expect(readEmailVerifyToken(`ev.43.${exp}.${sig}`, now)).toEqual({ ok: false, reason: "invalid" });
    expect(readEmailVerifyToken(`ev.${id}.${Number(exp) + 1}.${sig}`, now)).toEqual({ ok: false, reason: "invalid" });
    expect(readEmailVerifyToken(`ev.${id}.${exp}.${sig.slice(0, -1)}x`, now)).toEqual({ ok: false, reason: "invalid" });
    // Просроченный И поддельный — «недействительна»: срок проверяется после подписи.
    expect(readEmailVerifyToken(`ev.43.${exp}.${sig}`, now + VERIFY_TTL_MS * 2)).toEqual({ ok: false, reason: "invalid" });
    expect(readEmailVerifyToken("", now)).toEqual({ ok: false, reason: "invalid" });
    expect(readEmailVerifyToken("ev.0.1.x", now)).toEqual({ ok: false, reason: "invalid" });
  });

  it("токен привязки Telegram того же человека не подходит — секрет один, нагрузка разная", () => {
    // Оба подписаны APP_SECRET. Без префикса «ev.» ссылка «связать Telegram»
    // из чужих рук подтверждала бы чей-то адрес — и наоборот.
    const now = 1_800_000_000_000;
    const tg = createLinkToken(42, now);
    expect(readEmailVerifyToken(tg, now)).toEqual({ ok: false, reason: "invalid" });
    expect(readEmailVerifyToken(`ev.${tg}`, now)).toEqual({ ok: false, reason: "invalid" });
  });

  it("ссылка ведёт на /verify-email приложения с токеном", () => {
    const url = verifyEmailUrl("https://wp.test", 7);
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://wp.test/verify-email");
    expect(readEmailVerifyToken(u.searchParams.get("token")!)).toEqual({ ok: true, userId: 7 });
  });
});

/** Стенд базы: одна таблица users, update по id с условием «ещё пусто». */
function fakeDb(rows: Array<{ id: number; email: string; name: string; tenantId: number; emailVerifiedAt: Date | null }>) {
  const updates: Array<{ set: Record<string, unknown>; where: unknown }> = [];
  const db = {
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async (cond: unknown) => {
          expect(table).toBe(users);
          updates.push({ set: values, where: cond });
          // Условие drizzle: and(eq(id, X), isNull(emailVerifiedAt)). Воспроизводим смысл.
          const { sql: text, params } = render(cond);
          expect(text, "подтверждение не ограничено «ещё пусто»").toMatch(/email_verified_at.? is null/);
          const id = params.find(v => typeof v === "number") as number;
          for (const r of rows) if (r.id === id && r.emailVerifiedAt === null) r.emailVerifiedAt = values.emailVerifiedAt as Date;
        },
      }),
    }),
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: async (cond: unknown) => {
            const { sql: text, params } = render(cond);
            expect(text, "повторное письмо не ограничено неподтверждёнными").toMatch(/email_verified_at.? is null/);
            const email = params.find(v => typeof v === "string") as string;
            return rows.filter(r => r.email === email && r.emailVerifiedAt === null).map(r => ({ id: r.id, name: r.name, orgName: `Орг ${r.tenantId}` }));
          },
        }),
      }),
    }),
  };
  return { db: db as never, updates };
}

describe("подтверждение", () => {
  it("ставит дату по годному токену; повтор не переписывает дату; чужой токен — отказ", async () => {
    const rows = [{ id: 5, email: "a@x.uz", name: "А", tenantId: 1, emailVerifiedAt: null as Date | null }];
    const { db, updates } = fakeDb(rows);
    const token = createEmailVerifyToken(5);

    await expect(confirmEmail(db, token)).resolves.toEqual({ ok: true });
    expect(rows[0].emailVerifiedAt).toBeInstanceOf(Date);
    const first = rows[0].emailVerifiedAt;

    await new Promise(r => setTimeout(r, 5));
    await expect(confirmEmail(db, token)).resolves.toEqual({ ok: true });
    expect(rows[0].emailVerifiedAt, "повтор переписал дату подтверждения").toBe(first);
    expect(updates).toHaveLength(2);

    await expect(confirmEmail(db, "ev.5.1.подпись")).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Ссылка недействительна." });
    await expect(confirmEmail(db, createEmailVerifyToken(5, Date.now() - VERIFY_TTL_MS - 1000)))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("устарела") });
  });
});

describe("письмо ещё раз", () => {
  beforeEach(() => vi.mocked(sendVerifyEmail).mockClear());

  it("уходит каждой неподтверждённой записи с адресом и никому больше; ответ один", async () => {
    const rows = [
      { id: 1, email: "a@x.uz", name: "А в первой", tenantId: 1, emailVerifiedAt: null },
      { id: 2, email: "a@x.uz", name: "А во второй", tenantId: 2, emailVerifiedAt: null },
      { id: 3, email: "a@x.uz", name: "А подтверждённый", tenantId: 3, emailVerifiedAt: new Date() },
      { id: 4, email: "b@x.uz", name: "Б", tenantId: 1, emailVerifiedAt: null },
    ];
    const { db } = fakeDb(rows);
    await expect(resendVerification(db, "a@x.uz", "https://wp.test")).resolves.toBeUndefined();
    expect(sendVerifyEmail).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(sendVerifyEmail).mock.calls;
    expect(calls.map(c => [c[0], c[1], c[2]])).toEqual([["a@x.uz", "А в первой", "Орг 1"], ["a@x.uz", "А во второй", "Орг 2"]]);
    expect(readEmailVerifyToken(new URL(calls[0][3]).searchParams.get("token")!)).toEqual({ ok: true, userId: 1 });
    expect(readEmailVerifyToken(new URL(calls[1][3]).searchParams.get("token")!)).toEqual({ ok: true, userId: 2 });

    vi.mocked(sendVerifyEmail).mockClear();
    await expect(resendVerification(db, "nobody@x.uz", "https://wp.test")).resolves.toBeUndefined();
    expect(sendVerifyEmail).not.toHaveBeenCalled();
  });

  it("сбой почты не роняет вызов — пишется в журнал", async () => {
    vi.mocked(sendVerifyEmail).mockRejectedValueOnce(new Error("smtp down"));
    const { db } = fakeDb([{ id: 1, email: "a@x.uz", name: "А", tenantId: 1, emailVerifiedAt: null }]);
    await expect(resendVerification(db, "a@x.uz", "https://wp.test")).resolves.toBeUndefined();
    const { logger } = await import("../lib/logger");
    expect(logger.error).toHaveBeenCalledWith("Failed to send verification email", expect.objectContaining({ userId: 1, error: "smtp down" }));
  });
});

describe("ручки auth", () => {
  it("verifyEmail и resendVerification — публичные, под лимитами", async () => {
    const src = read("api/auth-router.ts");
    expect(src).toContain("verifyEmail: publicQuery");
    expect(src).toContain('namespace: "verifyEmail"');
    expect(src).toContain("resendVerification: publicQuery");
    expect(src).toContain('namespace: "resendVerify"');
  });

  it("лимит на письмо ещё раз — отказ TOO_MANY_REQUESTS до обращения к базе", async () => {
    const { checkRateLimit } = await import("../lib/rate-limit");
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    const { authRouter } = await import("../auth-router");
    let touched = 0;
    const ctx = { req: new Request("http://x/"), resHeaders: new Headers(), db: { select: () => { touched++; throw new Error("нельзя"); } } } as never;
    await expect(authRouter.createCaller(ctx).resendVerification({ email: "a@x.uz" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(touched).toBe(0);
  });
});

describe("схема и миграции", () => {
  it("email_verified_at: умолчание «сейчас», регистрация с сайта ставит NULL явно", () => {
    const schema = read("db/schema.ts");
    expect(schema).toContain('emailVerifiedAt: timestamp("email_verified_at").defaultNow()');
    const register = read("api/tenant-router.ts");
    const at = register.indexOf("emailVerifiedAt: null,");
    expect(at, "регистрация не ставит NULL — директор с формы засчитан подтверждённым").toBeGreaterThan(0);
    expect(at).toBeLessThan(register.indexOf("// ── Invite user внутри тенанта"));
    expect(register).toContain("await sendVerification(input.email, input.name, input.orgName,");
  });

  it("миграции: DDL отдельно, догон существующих — отдельно и идемпотентно", () => {
    const ddl = read("db/migrations/0062_email_verified_at.sql");
    expect(ddl).toContain("ALTER TABLE `users` ADD `email_verified_at` timestamp DEFAULT (now());");
    const backfill = read("db/migrations/0063_email_verified_backfill.sql");
    expect(backfill).toContain("UPDATE `users` SET `email_verified_at` = COALESCE(`createdAt`, NOW()) WHERE `email_verified_at` IS NULL;");
    expect(fs.existsSync(path.resolve(process.cwd(), "db/migrations/meta/0063_snapshot.json"))).toBe(true);
  });

  it("вход читает поле: findUserById называет его, /api/login отказывает кодом", () => {
    expect(read("api/queries/users.ts")).toContain("emailVerifiedAt: schema.users.emailVerifiedAt,");
    const login = read("api/http/auth.ts");
    expect(login).toContain("if (!user.emailVerifiedAt) {");
    expect(login).toContain('code: "EMAIL_UNVERIFIED",');
    // После пароля и организации, до второго фактора: код нужен только тому, чей пароль подошёл.
    expect(login.indexOf('code: "EMAIL_UNVERIFIED"')).toBeGreaterThan(login.indexOf("if (matched.length === 0)"));
    expect(login.indexOf('code: "EMAIL_UNVERIFIED"')).toBeLessThan(login.indexOf("TOTP_REQUIRED"));
  });
});

describe("экраны", () => {
  it("регистрация после успеха показывает «проверьте почту», а не идёт на главную", () => {
    const src = read("src/pages/Register.tsx");
    expect(src).not.toContain('navigate("/")');
    expect(src).toContain("onSuccess: () => setSentTo(form.email)");
    expect(src).toContain('data-testid="register-check-mail"');
    expect(src).toContain("trpc.auth.resendVerification.useMutation()");
    expect(src).toContain('tr("Проверьте почту", "Pochtangizni tekshiring")');
  });

  it("вход по коду EMAIL_UNVERIFIED предлагает письмо ещё раз", () => {
    const src = read("src/pages/Login.tsx");
    expect(src).toContain('data.code === "EMAIL_UNVERIFIED"');
    expect(src).toContain('data-testid="login-resend-verification"');
    expect(src).toContain("resend.mutate({ email })");
  });

  it("страница /verify-email подтверждает один раз и ведёт ко входу", () => {
    expect(read("src/App.tsx")).toContain('<Route path="/verify-email"       element={<VerifyEmail />} />');
    const src = read("src/pages/VerifyEmail.tsx");
    // Голым клиентом, не useMutation: мутация из эффекта при монтировании
    // под StrictMode теряла ответ, и экран висел на «одну секунду» (21.09.2026).
    expect(src).toContain("client.auth.verifyEmail.mutate({ token })");
    expect(src).not.toContain("verifyEmail.useMutation");
    expect(src).toContain("if (!token || fired.current) return;");
    expect(src).toContain('data-testid="verify-email-done"');
    expect(src).toContain('<Link to="/login"');
  });
});
