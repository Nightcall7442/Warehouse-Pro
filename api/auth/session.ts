import * as jose from "jose";
import * as cookie from "cookie";
import { randomUUID } from "node:crypto";
import { Session } from "@contracts/constants";
import { env } from "../lib/env";

const JWT_ALG = "HS256";

export type SessionPayload = {
  userId: number;
  tv: number; // tokenVersion — for session revocation
};

/** Что читается из проверенного токена. jti/exp нет у токенов, выданных до отзыва по сессиям. */
export type SessionClaim = SessionPayload & { jti?: string; exp?: number };

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  const secret = new TextEncoder().encode(env.appSecret);
  return new jose.SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: JWT_ALG })
    // Идентификатор сессии — чтобы выход отзывал ИМЕННО её (auth/revocation.ts).
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<SessionClaim | null> {
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(env.appSecret);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALG],
    });
    const { userId, tv, jti, exp } = payload;
    if (typeof userId !== "number" || typeof tv !== "number") return null;
    return { userId, tv, jti: typeof jti === "string" ? jti : undefined, exp: typeof exp === "number" ? exp : undefined };
  } catch {
    return null;
  }
}

/**
 * Кука сессии для веба. Одна на два места: вход (/api/login) и перевыпуск
 * после смены логина (user.changeMyLogin) — иначе флаги куки однажды
 * разъедутся, и перевыпущенная сессия окажется слабее выданной при входе.
 */
export function sessionCookie(token: string): string {
  return cookie.serialize(Session.cookieName, token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: Session.maxAgeMs / 1000,
  });
}
