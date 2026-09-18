 
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, needsRehash, ITERATIONS } from "../auth/password";

describe("password hashing", () => {
  it("hashes a password and verifies it correctly", async () => {
    const hash = await hashPassword("correcthorsebatterystaple");
    expect(ITERATIONS).toBe(600_000);
    expect(hash).toMatch(/^pbkdf2\$600000\$/);
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

  it("старый хеш на 100 000 итераций проходит проверку и помечается к перехешу", async () => {
    // Хеш формата pbkdf2$<iter>$<salt>$<key>: число итераций читается из него.
    const { pbkdf2Sync } = await import("crypto");
    const salt = "0123456789abcdef0123456789abcdef";
    const legacy = `pbkdf2$100000$${salt}$${pbkdf2Sync("secret", salt, 100_000, 64, "sha256").toString("hex")}`;
    await expect(verifyPassword("secret", legacy)).resolves.toBe(true);
    await expect(verifyPassword("wrong", legacy)).resolves.toBe(false);
    expect(needsRehash(legacy)).toBe(true);
    expect(needsRehash(await hashPassword("secret"))).toBe(false);
    expect(needsRehash("not-a-hash")).toBe(false);
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
