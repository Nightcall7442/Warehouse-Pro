import type { CookieOptions } from "hono/utils/cookie";

export function getSessionCookieOptions(_headers: Headers): CookieOptions {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  };
}
