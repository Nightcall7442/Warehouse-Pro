/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../auth/password";

describe("password hashing", () => {
  it("hashes a password and verifies it correctly", async () => {
    const hash = await hashPassword("correcthorsebatterystaple");
    expect(hash).toMatch(/^pbkdf2\$100000\$/);
    await expect(verifyPassword("correcthorsebatterystaple", hash)).resolves.toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("correct-password");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("produces different hashes for same password (random salt)", async () => {
    const h1 = await hashPassword("same");
    const h2 = await hashPassword("same");
    expect(h1).not.toBe(h2);
  });

  it("rejects malformed stored hash", async () => {
    await expect(verifyPassword("any", "not-a-valid-hash")).resolves.toBe(false);
    await expect(verifyPassword("any", "")).resolves.toBe(false);
    await expect(verifyPassword("any", "pbkdf2$only$three")).resolves.toBe(false);
  });

  it("is constant-time: does not throw on length mismatch", async () => {
    const hash = await hashPassword("password");
    // Tamper with the stored key length
    const parts  = hash.split("$");
    parts[3]     = parts[3].slice(0, 10); // truncate stored key
    const tampered = parts.join("$");
    await expect(verifyPassword("password", tampered)).resolves.toBe(false);
  });
});
