import * as jose from "jose";
import { randomUUID } from "node:crypto";
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
