import * as jose from "jose";
import { env } from "../lib/env";

const JWT_ALG = "HS256";

export type SessionPayload = {
  userId: number;
  tv: number; // tokenVersion — for session revocation
};

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  const secret = new TextEncoder().encode(env.appSecret);
  return new jose.SignJWT(payload as Record<string, unknown>)
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(env.appSecret);
    const { payload } = await jose.jwtVerify(token, secret, {
      algorithms: [JWT_ALG],
    });
    const { userId, tv } = payload;
    if (typeof userId !== "number" || typeof tv !== "number") return null;
    return { userId, tv };
  } catch {
    return null;
  }
}
