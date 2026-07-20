/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { signSessionToken, verifySessionToken } from "../auth/session";

// Set a test secret before importing env-dependent modules
process.env.APP_SECRET = "test-secret-that-is-long-enough-for-tests-32chars";

describe("JWT session tokens", () => {
  it("signs and verifies a token", async () => {
    const token   = await signSessionToken({ userId: 42, tv: 0 });
    const payload = await verifySessionToken(token);
    expect(payload).toEqual({ userId: 42, tv: 0 });
  });

  it("returns null for an empty string", async () => {
    expect(await verifySessionToken("")).toBeNull();
  });

  it("returns null for a tampered token", async () => {
    const token   = await signSessionToken({ userId: 1, tv: 0 });
    const tampered = token.slice(0, -5) + "XXXXX";
    expect(await verifySessionToken(tampered)).toBeNull();
  });

  it("returns null for a token signed with a different secret", async () => {
    // Simulate a token from another environment
    const { SignJWT } = await import("jose");
    const wrongSecret = new TextEncoder().encode("totally-different-secret-here-xx");
    const foreignToken = await new SignJWT({ userId: 99 })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(wrongSecret);
    expect(await verifySessionToken(foreignToken)).toBeNull();
  });

  it("returns null for a token with missing userId", async () => {
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(process.env.APP_SECRET);
    const token  = await new SignJWT({ notUserId: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(secret);
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(process.env.APP_SECRET);
    const token  = await new SignJWT({ userId: 1 })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("-1s") // expired 1 second ago
      .sign(secret);
    expect(await verifySessionToken(token)).toBeNull();
  });
});
