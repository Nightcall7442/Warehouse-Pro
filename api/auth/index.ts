import * as cookie from "cookie";
import { Session } from "@contracts/constants";
import { Errors } from "@contracts/errors";
import { verifySessionToken } from "./session";
import { findUserById } from "../queries/users";
import { findTenantById } from "../queries/tenants";
import type { Tenant, User } from "@db/schema";

export type AuthResult = {
  user: User;
  tenant: Tenant;
};

export async function authenticateRequest(headers: Headers): Promise<AuthResult> {
  // 1) Mobile / API clients: Authorization: Bearer <jwt>
  // 2) Web: httpOnly session cookie
  let token: string | undefined;

  const authHeader = headers.get("authorization") ?? headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else {
    const cookies = cookie.parse(headers.get("cookie") || "");
    token = cookies[Session.cookieName];
  }

  if (!token) throw Errors.forbidden("Invalid authentication token.");

  const claim = await verifySessionToken(token);
  if (!claim)  throw Errors.forbidden("Invalid authentication token.");

  const user = await findUserById(claim.userId);
  if (!user)   throw Errors.forbidden("User not found. Please re-login.");
  if (user.status !== "active") throw Errors.forbidden("Account is inactive.");

  const tenant = await findTenantById(user.tenantId);
  if (!tenant || tenant.status !== "active") throw Errors.forbidden("Organisation is suspended.");

  return { user, tenant };
}

export { signSessionToken, verifySessionToken } from "./session";
