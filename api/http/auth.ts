import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import * as cookie from "cookie";
import { Session } from "@contracts/constants";
import { verifyPassword } from "../auth/password";
import { findUsersByEmailAnyTenant, updateUserLastSignIn } from "../queries/users";
import { findTenantById } from "../queries/tenants";
import { signSessionToken } from "../auth/session";
import { checkRateLimit, rateLimitSubject } from "../lib/rate-limit";
import { invalidateAuthUser } from "../auth";

/*
  Вход, выход, обновление сессии, выход отовсюду. Вынесено из boot.ts как
  есть; монтируется после общего bodyLimit, как и раньше.
*/
const routes = new Hono();

// ── Simple endpoints (без tRPC) ──────────────────────────────────────────────

const LOGIN_RATE_LIMIT = { windowMs: 15 * 60 * 1000, limit: 20, namespace: "login" };

/**
 * Второй счёт — по адресу в сети.
 *
 * ── Чего не хватало ─────────────────────────────────────────────────────────
 *
 * Попытки считались только по аккаунту. Против перебора пароля к ОДНОМУ
 * человеку это верная защита, и считать глобально нельзя — двадцать чужих
 * ошибок запирали продукт всей платформе.
 *
 * Но есть обратная атака: один расхожий пароль на СОТНЮ адресов. По каждому
 * аккаунту это одна попытка из двадцати, счётчик не срабатывает ни разу, и
 * перебирать можно бесконечно. Так подбирают не пароль к человеку, а человека
 * к паролю, и в организации на двадцать сотрудников кто-нибудь да поставил
 * «12345678».
 *
 * Предел здесь щедрее аккаунтного и намеренно: за одним адресом сидит целый
 * офис, и рабочий день с общего NAT не должен упираться в защиту. Сто попыток
 * в четверть часа с одного адреса — это уже не люди.
 */
const LOGIN_IP_RATE_LIMIT = { windowMs: 15 * 60 * 1000, limit: 100, namespace: "login-ip" };

routes.post("/api/login", async (c) => {
  try {
    // tenantId необязателен и нужен только для одного случая: адрес и пароль
    // совпали сразу в нескольких организациях. Тогда первый запрос отвечает
    // 409 со списком, а клиент повторяет его с выбранной организацией.
    // code — одноразовый код из приложения-аутентификатора, только у тех,
    // кто включил двухфакторную защиту (user.totpEnabledAt).
    const { email, password, tenantId: tenantIdFromBody, code: totpFromBody } = await c.req.json();
    if (!email || !password) return c.json({ error: "Email and password required" }, 400);

    // Per account, read after the body so the address is available. Brute force
    // targets one account, so counting attempts against that account is both
    // the real defence and unspoofable — unlike a client-supplied IP header.
    // Counting them globally, as this did, meant twenty wrong passwords from
    // anyone locked every tenant out of the product for fifteen minutes.
    const subject = rateLimitSubject(c.req.raw, `email:${String(email).trim().toLowerCase()}`);
    if (!(await checkRateLimit(subject, LOGIN_RATE_LIMIT))) {
      return c.json({ error: "Too many login attempts. Please try again in 15 minutes." }, 429);
    }

    /*
      И по адресу в сети — против перебора аккаунтов одним паролем.

      Счёт по аккаунту такую атаку не видит: на каждый адрес приходится по одной
      попытке. Оба счётчика нужны вместе — они ловят разные атаки.
    */
    const fromAddress = rateLimitSubject(c.req.raw);
    if (fromAddress && !(await checkRateLimit(fromAddress, LOGIN_IP_RATE_LIMIT))) {
      return c.json({ error: "Too many login attempts. Please try again in 15 minutes." }, 429);
    }

    const GENERIC_AUTH_ERROR = "Неверный email или пароль";
    const dummyHash = "pbkdf2$100000$00000000000000000000000000000000$" + "0".repeat(128);

    // Один адрес может принадлежать разным организациям — схема это прямо
    // разрешает (uq_user_email_tenant по паре email + tenant_id). Раньше вход
    // брал запись с наименьшим id и сверял пароль только с ней, поэтому второй
    // человек с тем же адресом не мог войти НИКОГДА: его правильный пароль
    // сверялся с чужим хешем. Сброс пароля не помогал, и со стороны это
    // выглядело как необъяснимая поломка учётной записи.
    //
    // Теперь пароль сверяется со всеми кандидатами. У разных людей пароли
    // разные, поэтому почти всегда подойдёт ровно один — и вход проходит так
    // же незаметно, как раньше.
    const candidates = await findUsersByEmailAnyTenant(email);

    // Ни одной записи — всё равно считаем один хеш. Без этого ответ по
    // несуществующему адресу приходил бы заметно быстрее, чем по существующему,
    // и перебором можно было бы узнать, кто здесь зарегистрирован.
    if (candidates.length === 0) {
      await verifyPassword(password, dummyHash);
      return c.json({ error: GENERIC_AUTH_ERROR }, 401);
    }

    const matched: typeof candidates = [];
    for (const candidate of candidates) {
      if (candidate.passwordHash && await verifyPassword(password, candidate.passwordHash)) {
        matched.push(candidate);
      }
    }
    if (matched.length === 0) return c.json({ error: GENERIC_AUTH_ERROR }, 401);

    // Отключённые записи отсеиваются уже после сверки пароля: ответ на
    // отключённую запись должен приходить за то же время, что и на живую.
    // Заодно они не попадают в список организаций ниже — предлагать выбрать
    // ту, куда всё равно не пустят, незачем.
    const usable = matched.filter(u => u.status === "active");
    if (usable.length === 0) return c.json({ error: GENERIC_AUTH_ERROR }, 401);

    // Пароль подошёл к нескольким организациям сразу — то есть человек завёл
    // один адрес и один пароль в двух местах. Выбрать за него нельзя: любой
    // выбор молча пустит не туда, а данные там разные.
    //
    // Организации называются в ответе, потому что владение паролем к каждой из
    // них уже доказано — скрывать от человека список его собственных
    // организаций незачем. Клиент повторяет запрос, добавив tenantId.
    let user = usable[0];
    if (usable.length > 1) {
      const wanted = Number(tenantIdFromBody ?? NaN);
      const chosen = usable.find(u => u.tenantId === wanted);
      if (!chosen) {
        const orgs = await Promise.all(usable.map(async u => {
          const t = await findTenantById(u.tenantId);
          return { tenantId: u.tenantId, name: t?.name ?? `Организация #${u.tenantId}` };
        }));
        return c.json({
          error: "Этот адрес используется в нескольких организациях. Выберите нужную.",
          code: "TENANT_REQUIRED",
          organizations: orgs,
        }, 409);
      }
      user = chosen;
    }

    const tenant = await findTenantById(user.tenantId);
    if (!tenant || tenant.status !== "active") return c.json({ error: GENERIC_AUTH_ERROR }, 401);

    /*
      Второй фактор. Пароль уже подошёл — только теперь можно сказать, что
      нужен код: до этого ответ выдал бы, у кого защита включена. Секрет
      лежит запечатанным (secret-box), как пароль 1С.
    */
    if (user.totpEnabledAt && user.totpSecret) {
      if (!totpFromBody) {
        return c.json({ error: "Введите код из приложения-аутентификатора", code: "TOTP_REQUIRED" }, 401);
      }
      const { verifyTotp } = await import("../lib/totp");
      const { open } = await import("../lib/secret-box");
      if (!verifyTotp(open(user.totpSecret), String(totpFromBody))) {
        return c.json({ error: "Неверный код подтверждения", code: "TOTP_INVALID" }, 401);
      }
    }

    await updateUserLastSignIn(user.id);
    const token = await signSessionToken({ userId: user.id, tv: user.tokenVersion ?? 0 });

    c.header("set-cookie", cookie.serialize(Session.cookieName, token, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: Session.maxAgeMs / 1000,
    }));

    // Токен возвращается в теле — для мобильного приложения.
    //
    // Веб живёт на httpOnly-куке, выставленной выше, и token в теле не читает.
    // А мобильный клиент кладёт в каждый запрос заголовок Authorization и
    // берёт значение из SecureStore, куда записывает ровно это поле
    // (src/api.ts: if (payload?.token) setItemAsync("session_token", ...)).
    // Поля не было — условие не срабатывало ни разу, и токен не сохранялся
    // никогда.
    //
    // Приложение при этом работало: нативный HTTP-слой Android хранит куку сам
    // и подставляет её к следующим запросам. Но hydrate() при запуске читает
    // именно SecureStore и, не найдя токена, сразу показывает экран входа —
    // ДО того, как дойдёт до отката на сохранённый профиль. Отсюда и жалоба
    // «приложение выходит из аккаунта»: агент вводил пароль заново каждый раз,
    // когда Android выгружал приложение из памяти, то есть почти каждое утро.
    return c.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug } },
    });
  } catch (e) {
    console.error("[LOGIN ERROR]", e instanceof Error ? e.message : String(e), e instanceof Error ? e.stack : "");
    return c.json({ error: "Login failed" }, 500);
  }
});

routes.post("/api/logout", async (c) => {
  /*
    Выход отзывает ЭТУ сессию, а не только стирает куку. Раньше токен жил
    свои 30 дней после выхода — из чужого браузера или украденный.
    Другие устройства человека не трогаются (для этого есть logout-all).
  */
  try {
    const authHeader = c.req.header("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : cookie.parse(c.req.header("cookie") ?? "")[Session.cookieName];
    if (token) {
      const { verifySessionToken } = await import("../auth/session");
      const { revokeSession } = await import("../auth/revocation");
      const claim = await verifySessionToken(token);
      if (claim?.jti && claim.exp) await revokeSession(claim.jti, claim.exp);
    }
  } catch (e) {
    logger.warn("logout: не удалось отозвать сессию", { error: e instanceof Error ? e.message : String(e) });
  }
  c.header("set-cookie", cookie.serialize(Session.cookieName, "", {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
    expires: new Date(0),
  }));
  return c.json({ success: true });
});

// Token refresh — issue a new session token before the current one expires
routes.post("/api/refresh-token", async (c) => {
  const authHeader = c.req.header("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;
  if (!token) return c.json({ error: "No token" }, 401);

  try {
    const { verifySessionToken, signSessionToken } = await import("../auth/session");
    const { getDb } = await import("../queries/connection");
    const { users } = await import("@db/schema");
    const { eq } = await import("drizzle-orm");

    const claim = await verifySessionToken(token);
    if (!claim) return c.json({ error: "Invalid token" }, 401);
    const { isSessionRevoked } = await import("../auth/revocation");
    if (claim.jti && await isSessionRevoked(claim.jti)) return c.json({ error: "Token revoked" }, 401);

    const db = getDb();
    const [user] = await db.select({ id: users.id, status: users.status, tokenVersion: users.tokenVersion })
      .from(users).where(eq(users.id, claim.userId)).limit(1);
    if (!user || user.status !== "active") return c.json({ error: "User not found or inactive" }, 401);
    if ((user.tokenVersion ?? 0) !== claim.tv) return c.json({ error: "Token revoked" }, 401);

    const newToken = await signSessionToken({ userId: user.id, tv: user.tokenVersion ?? 0 });

    /*
      Ротация: прежний токен отзывается, а не живёт до своего срока рядом с
      новым. Иначе украденный токен обновлялся бы бесконечно, а «выход»
      отзывал бы только последний из цепочки. Минута запаса — телефон мог
      отправить фоновую точку GPS старым токеном за мгновение до того, как
      записал новый; после минуты старый мёртв.
      ponytail: таймер живёт в процессе — при перезапуске в эту минуту
      старый токен доживает свой срок, как было до ротации.
    */
    if (claim.jti && claim.exp) {
      const { revokeSession } = await import("../auth/revocation");
      const { jti, exp } = claim;
      setTimeout(() => { revokeSession(jti, exp).catch(() => {}); }, 60_000).unref();
    }
    return c.json({ token: newToken });
  } catch {
    return c.json({ error: "Refresh failed" }, 500);
  }
});

// Logout all devices — invalidate all tokens by incrementing tokenVersion
routes.post("/api/logout-all", async (c) => {
  const authHeader = c.req.header("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : undefined;

  if (!token) return c.json({ error: "No token" }, 401);

  // Rate limit: 5 per 15 minutes per session token. The caller already proved
  // possession of one, so it names the subject better than any header does.
  const subject = rateLimitSubject(c.req.raw, `token:${token.slice(-24)}`);
  if (!(await checkRateLimit(subject, { windowMs: 15 * 60 * 1000, limit: 5, namespace: "logout-all" }))) {
    return c.json({ error: "Too many requests. Try again later." }, 429);
  }

  try {
    const { verifySessionToken } = await import("../auth/session");
    const { getDb } = await import("../queries/connection");
    const { users } = await import("@db/schema");
    const { eq } = await import("drizzle-orm");

    const claim = await verifySessionToken(token);
    if (!claim) return c.json({ error: "Invalid token" }, 401);

    const db = getDb();
    await db.update(users)
      .set({ tokenVersion: sql`COALESCE(${users.tokenVersion}, 0) + 1` })
      .where(eq(users.id, claim.userId));
    invalidateAuthUser(claim.userId);

    c.header("set-cookie", cookie.serialize(Session.cookieName, "", {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 0,
      expires: new Date(0),
    }));

    return c.json({ success: true });
  } catch (e) {
    console.error("[LOGOUT-ALL ERROR]", e);
    return c.json({ error: "Logout failed" }, 500);
  }
});

export default routes;
