import { describe, it, expect } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { env } from "./env";
import {
  API_KEY_PREFIX,
  apiKeyPrefix,
  computeLegacyLookupHash,
  computeLookupHash,
  generateApiKey,
  hashApiKeySecret,
  lookupHashes,
  upgradeApiKeyHashes,
  verifyKey,
  type StoredApiKeyHashes,
} from "./api-key";

/** A row as it would come back from `select().from(apiKeys)`, minus the noise. */
function row(keyHash: string, keySecretHash: string | null): StoredApiKeyHashes {
  return { keyHash, keySecretHash };
}

/** A pre-P1.3 row: unsalted sha256 in keyHash, no Argon2 hash at all. */
function legacyRow(rawKey: string): StoredApiKeyHashes {
  return row(createHash("sha256").update(rawKey).digest("hex"), null);
}

describe("generateApiKey", () => {
  it("produces a wp_live_ key with a 12-char prefix and 192 bits of entropy", async () => {
    const key = await generateApiKey();
    expect(key.raw.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(key.raw).toHaveLength(API_KEY_PREFIX.length + 48);
    expect(key.prefix).toBe(key.raw.slice(0, 12));
    expect(key.prefix).toHaveLength(12);
  });

  it("stores the peppered HMAC as the lookup hash, not the raw key or a plain sha256", async () => {
    const key = await generateApiKey();
    expect(key.lookupHash).toBe(createHmac("sha256", env.appSecret).update(key.raw).digest("hex"));
    expect(key.lookupHash).toHaveLength(64);
    expect(key.lookupHash).not.toBe(createHash("sha256").update(key.raw).digest("hex"));
    expect(key.lookupHash).not.toContain(key.raw);
  });

  it("verifies against its own stored fields, and rejects a different key", async () => {
    const key = await generateApiKey();
    const stored = row(key.lookupHash, key.secretHash);

    const good = await verifyKey(stored, key.raw);
    expect(good).toEqual({ status: "ok", via: "argon2", needsUpgrade: false });

    const other = await generateApiKey();
    const bad = await verifyKey(stored, other.raw);
    expect(bad).toEqual({ status: "rejected", reason: "argon2-mismatch" });

    // Same key with one character changed.
    const tweaked = key.raw.slice(0, -1) + (key.raw.endsWith("a") ? "b" : "a");
    expect(await verifyKey(stored, tweaked)).toEqual({ status: "rejected", reason: "argon2-mismatch" });
  });
});

describe("argon2 hashing", () => {
  it("emits argon2id hashes that are salted (identical inputs, different hashes)", async () => {
    const raw = "wp_live_" + "ab".repeat(24);
    const a = await hashApiKeySecret(raw);
    const b = await hashApiKeySecret(raw);

    expect(a.startsWith("$argon2id$")).toBe(true);
    expect(b.startsWith("$argon2id$")).toBe(true);
    expect(a).not.toBe(b);

    // Both still verify — the difference is the salt, not the input.
    expect(await verifyKey(row("irrelevant", a), raw)).toMatchObject({ status: "ok", via: "argon2" });
    expect(await verifyKey(row("irrelevant", b), raw)).toMatchObject({ status: "ok", via: "argon2" });
  });

  it("records the configured cost parameters in the hash", async () => {
    const hash = await hashApiKeySecret("wp_live_cost_params");
    expect(hash).toContain("m=65536");
    expect(hash).toContain("t=3");
    expect(hash).toContain("p=4");
  });
});

describe("legacy rows", () => {
  it("verifies a legacy sha256-only row and reports that it needs an upgrade", async () => {
    const raw = "wp_live_" + "0123456789abcdef".repeat(3);
    const result = await verifyKey(legacyRow(raw), raw);
    expect(result).toEqual({ status: "ok", via: "legacy", needsUpgrade: true });
  });

  it("rejects a wrong key against a legacy row", async () => {
    const raw = "wp_live_" + "0123456789abcdef".repeat(3);
    const result = await verifyKey(legacyRow(raw), raw.replace(/f$/, "e"));
    expect(result).toEqual({ status: "rejected", reason: "lookup-mismatch" });
  });

  it("upgrade produces an HMAC lookup hash plus an Argon2 hash the same raw key verifies against", async () => {
    const raw = "wp_live_" + "0123456789abcdef".repeat(3);
    const legacy = legacyRow(raw);

    const upgraded = await upgradeApiKeyHashes(raw);

    expect(upgraded.keyHash).toBe(computeLookupHash(raw));
    expect(upgraded.keyHash).not.toBe(legacy.keyHash);
    expect(upgraded.keySecretHash.startsWith("$argon2id$")).toBe(true);

    // The rehashed row now verifies via Argon2 and no longer needs an upgrade.
    const after = await verifyKey(row(upgraded.keyHash, upgraded.keySecretHash), raw);
    expect(after).toEqual({ status: "ok", via: "argon2", needsUpgrade: false });

    // And it is still findable: the upgraded lookup hash is the "current" one.
    expect(lookupHashes(raw).current).toBe(upgraded.keyHash);
  });
});

describe("mismatched rows", () => {
  it("rejects when keySecretHash does not match, even though the lookup hash does", async () => {
    const raw = "wp_live_" + "11".repeat(24);
    const someoneElse = "wp_live_" + "22".repeat(24);

    // Lookup hash belongs to `raw`, Argon2 hash belongs to a different key.
    const tampered = row(computeLookupHash(raw), await hashApiKeySecret(someoneElse));

    expect(await verifyKey(tampered, raw)).toEqual({ status: "rejected", reason: "argon2-mismatch" });
    // Sanity: the lookup really would have matched this row.
    expect(tampered.keyHash).toBe(lookupHashes(raw).current);
  });

  it("fails closed on a corrupt keySecretHash instead of falling back to the lookup hash", async () => {
    const raw = "wp_live_" + "33".repeat(24);
    const corrupt = row(computeLookupHash(raw), "not-an-argon2-hash");
    expect(await verifyKey(corrupt, raw)).toEqual({ status: "rejected", reason: "argon2-error" });
  });
});

describe("lookupHashes", () => {
  it("returns the legacy sha256 unchanged and an HMAC that differs from it", () => {
    const raw = "wp_live_deadbeef";
    // sha256("wp_live_deadbeef")
    const knownSha256 = "b4e93a74e1d998d8e322dd6368e3df4b47c92826018dfa5efb1a475477bf6a2f";

    const { current, legacy } = lookupHashes(raw);

    expect(legacy).toBe(createHash("sha256").update(raw).digest("hex"));
    expect(legacy).toBe(knownSha256);
    expect(computeLegacyLookupHash(raw)).toBe(knownSha256);

    expect(current).toBe(createHmac("sha256", env.appSecret).update(raw).digest("hex"));
    expect(current).not.toBe(legacy);
    expect(current).toHaveLength(64);
  });

  it("apiKeyPrefix takes the first 12 characters", () => {
    expect(apiKeyPrefix("wp_live_abcdef0123456789")).toBe("wp_live_abcd");
  });
});
