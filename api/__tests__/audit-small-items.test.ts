import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Мелочи аудита 20.09.2026 — одной пачкой.
 *
 *  • сброс пароля администратором (user.resetPassword) и суперадмином
 *    (tenant.resetOwnerPassword) гасит сессии по старому паролю
 *    (tokenVersion + сброс кэша) — уволенный не оставался в системе;
 *  • telegram.saveChatId — один чат на одного человека, как setUserChatId;
 *  • приглашение: занятость адреса — внутри своей организации, а не оракул
 *    по всей платформе (см. invite-router.test), закрывается условно;
 *  • черновики с ценами стираются на выходе (см. offline-copy.test);
 *  • scratch-* в корне репозитория не отслеживается.
 *
 * Нарочная поломка: убери tokenVersion из resetPassword — упадёт «сессии
 * гаснут»; убери проверку taken в saveChatId — упадёт «один чат».
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
/** Тело процедуры: от её имени до следующей процедуры того же роутера. */
const bodyOf = (src: string, proc: string) => {
  const at = src.indexOf(`\n  ${proc}:`);
  expect(at, `${proc} не найдена`).toBeGreaterThan(0);
  const next = src.slice(at + 1).search(/\n {2}[a-zA-Z]+: /);
  return next === -1 ? src.slice(at) : src.slice(at, at + 1 + next);
};

describe("сброс пароля гасит сессии", () => {
  it("user.resetPassword и tenant.resetOwnerPassword поднимают tokenVersion и сбрасывают кэш входа", () => {
    for (const [file, proc] of [["api/user-router.ts", "resetPassword"], ["api/tenant-router.ts", "resetOwnerPassword"]] as const) {
      const body = bodyOf(read(file), proc);
      expect(body, `${proc}: tokenVersion не поднят`).toContain("tokenVersion: sql`COALESCE(${users.tokenVersion}, 0) + 1`");
      expect(body, `${proc}: кэш входа не сброшен`).toMatch(/invalidateAuthUser\(input\.(id|userId)\)/);
      expect(body, `${proc}: без следа в журнале`).toContain("recordAudit(");
    }
  });
});

describe("Telegram: один чат — один человек", () => {
  it("saveChatId отказывает, если chat_id уже у другого", () => {
    const body = bodyOf(read("api/telegram-router.ts"), "saveChatId");
    expect(body).toContain("eq(users.telegramChatId, input.chatId), ne(users.id, ctx.user.id)");
    expect(body).toContain('code: "CONFLICT"');
  });
});

describe("приглашение", () => {
  it("закрывается условно — второй параллельный accept не заводит второго человека", () => {
    const body = bodyOf(read("api/invite-router.ts"), "accept");
    expect(body).toContain("isNull(invites.acceptedAt)))");
    expect(body).toContain("if (affectedRows(closed) === 0)");
  });
});

describe("репозиторий", () => {
  it("черновых проб в корне нет, и они игнорируются", () => {
    expect(fs.existsSync(path.resolve(process.cwd(), "scratch-probe-photos.cjs"))).toBe(false);
    expect(read(".gitignore")).toMatch(/^scratch-\*$/m);
  });
});
