import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Вход считает попытки дважды — и это не избыточность.
 *
 * ── Две разные атаки ────────────────────────────────────────────────────────
 *
 * Перебор пароля бьёт в ОДИН аккаунт: тысяча паролей на один адрес. Ловится
 * счётом по аккаунту, и считать его глобально нельзя — двадцать чужих ошибок
 * запирали бы продукт всей платформе. Так и было сделано.
 *
 * Распыление бьёт наоборот: ОДИН расхожий пароль на сотню адресов. По каждому
 * аккаунту это одна попытка из двадцати, аккаунтный счётчик не срабатывает ни
 * разу — а в организации на двадцать сотрудников кто-нибудь да поставил
 * «12345678». Ловится только счётом по адресу в сети.
 *
 * Убери любой из двух — и одна из атак перестанет считаться вовсе.
 */
const boot = readFileSync(join(process.cwd(), "api", "boot.ts"), "utf8");
const LOGIN = boot.slice(boot.indexOf('app.post("/api/login"'), boot.indexOf("GENERIC_AUTH_ERROR"));

describe("вход считает попытки по аккаунту и по адресу", () => {
  it("по аккаунту — против перебора пароля", () => {
    expect(LOGIN).toContain("`email:${String(email).trim().toLowerCase()}`");
    expect(LOGIN).toContain("LOGIN_RATE_LIMIT");
  });

  it("по адресу — против перебора аккаунтов", () => {
    expect(LOGIN).toContain("LOGIN_IP_RATE_LIMIT");
    // Без второго аргумента rateLimitSubject отдаёт адрес клиента.
    expect(LOGIN).toContain("rateLimitSubject(c.req.raw)");
  });

  it("счётчики разведены по разным пространствам", () => {
    /*
      Общее пространство слило бы их в один счёт: попытки к одному аккаунту
      съедали бы лимит адреса и наоборот, и оба предела потеряли бы смысл.
    */
    expect(boot).toContain('namespace: "login"');
    expect(boot).toContain('namespace: "login-ip"');
  });

  it("предел по адресу щедрее аккаунтного", () => {
    /*
      За одним адресом сидит целый офис: общий NAT, десяток сотрудников, у
      каждого утром по паре опечаток. Строгий предел здесь запер бы рабочий
      день, а не атаку.
    */
    const perAccount = Number(boot.match(/namespace: "login" \}/) ? boot.match(/limit: (\d+), namespace: "login" \}/)?.[1] : 0);
    const perAddress = Number(boot.match(/limit: (\d+), namespace: "login-ip" \}/)?.[1] ?? 0);
    expect(perAccount).toBeGreaterThan(0);
    expect(perAddress).toBeGreaterThan(perAccount);
  });

  it("вход по-прежнему не говорит, есть ли такой аккаунт", () => {
    // Иначе перебор адресов даёт список сотрудников, даже не подобрав пароля.
    expect(boot).toContain('const GENERIC_AUTH_ERROR = "Неверный email или пароль"');
    expect(boot).toContain("dummyHash");
  });
});
