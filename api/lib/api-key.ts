/**
 * P1.3 — API key hashing and verification.
 *
 * Storage layout (see `apiKeys` in db/schema.ts):
 *   - `keyHash`       deterministic **lookup** value, unique-indexed. New/upgraded
 *                     rows hold `hmac-sha256(raw)` keyed with APP_SECRET (a pepper:
 *                     a leaked database alone is not enough to build a lookup
 *                     table). Legacy rows still hold the unsalted `sha256(raw)`.
 *   - `keySecretHash` Argon2id hash of the raw key, verified after the lookup.
 *                     NULL on legacy rows until their first successful use
 *                     rehashes them.
 *   - `keyPrefix`     `raw.slice(0, 12)`, for display and for keying the
 *                     verification rate limiter.
 *
 * Why the lookup value stays deterministic: Argon2 hashes are salted, so they
 * cannot be queried. Looking keys up by `keyPrefix` instead is not an option
 * either — the prefix carries only 16 bits of entropy, so many rows can share
 * one and an attacker could force an Argon2 verification per candidate row
 * (CPU exhaustion).
 */
import argon2 from "argon2";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { env } from "./env";
import { safeEqual } from "./safe-compare";

/** Human-visible prefix every issued key carries. */
export const API_KEY_PREFIX = "wp_live_";

/** Number of leading characters stored in `keyPrefix`. */
export const API_KEY_PREFIX_LENGTH = 12;

/** 24 random bytes = 192 bits of entropy, hex-encoded. */
const API_KEY_ENTROPY_BYTES = 24;

/** Argon2id parameters used for every `keySecretHash` written by this module. */
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const;

/** The subset of an `apiKeys` row that verification needs. */
export type StoredApiKeyHashes = {
  keyHash: string;
  keySecretHash?: string | null;
};

export type NewApiKey = {
  /** The raw key. Shown to the caller once, never stored. */
  raw: string;
  /** Goes into `apiKeys.keyHash`. */
  lookupHash: string;
  /** Goes into `apiKeys.keySecretHash`. */
  secretHash: string;
  /** Goes into `apiKeys.keyPrefix`. */
  prefix: string;
};

/** Both values a raw key may be stored under, so one query can find either. */
export type ApiKeyLookupHashes = {
  /** `hmac-sha256(raw)` keyed with APP_SECRET — how keys are stored now. */
  current: string;
  /** `sha256(raw)` — how keys were stored before P1.3. */
  legacy: string;
};

export type VerifyKeyResult =
  /** `keySecretHash` matched under Argon2id. Nothing to do. */
  | { status: "ok"; via: "argon2"; needsUpgrade: false }
  /** Matched the legacy unsalted lookup hash; the row should be rehashed. */
  | { status: "ok"; via: "legacy"; needsUpgrade: true }
  | { status: "rejected"; reason: "argon2-mismatch" | "argon2-error" | "lookup-mismatch" };

/** Deterministic, peppered lookup value for `apiKeys.keyHash`. */
export function computeLookupHash(rawKey: string): string {
  return createHmac("sha256", env.appSecret).update(rawKey).digest("hex");
}

/** Pre-P1.3 lookup value: plain, unsalted sha256 of the raw key. */
export function computeLegacyLookupHash(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Both candidate lookup values for a raw key. Query with
 * `inArray(apiKeys.keyHash, [current, legacy])` so rows written either way are
 * found in a single indexed lookup.
 */
export function lookupHashes(rawKey: string): ApiKeyLookupHashes {
  return { current: computeLookupHash(rawKey), legacy: computeLegacyLookupHash(rawKey) };
}

/** The stored `keyPrefix` for a raw key (also used as the rate-limit bucket). */
export function apiKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, API_KEY_PREFIX_LENGTH);
}

/** Argon2id hash of a raw key, using {@link ARGON2_OPTIONS}. */
export function hashApiKeySecret(rawKey: string): Promise<string> {
  return argon2.hash(rawKey, ARGON2_OPTIONS);
}

/** Mint a brand new key together with everything that gets persisted. */
export async function generateApiKey(): Promise<NewApiKey> {
  const raw = API_KEY_PREFIX + randomBytes(API_KEY_ENTROPY_BYTES).toString("hex");
  return {
    raw,
    lookupHash: computeLookupHash(raw),
    secretHash: await hashApiKeySecret(raw),
    prefix: apiKeyPrefix(raw),
  };
}

/**
 * Verify a raw key against a row that was already found by lookup hash.
 *
 * When `keySecretHash` is present it is authoritative: a mismatch is rejected
 * even though the lookup hash matched, so a tampered or mismatched row cannot
 * authenticate. Only rows with no Argon2 hash yet fall back to comparing the
 * legacy lookup value, and those report `needsUpgrade`.
 */
export async function verifyKey(row: StoredApiKeyHashes, rawKey: string): Promise<VerifyKeyResult> {
  if (row.keySecretHash) {
    try {
      const ok = await argon2.verify(row.keySecretHash, rawKey);
      return ok
        ? { status: "ok", via: "argon2", needsUpgrade: false }
        : { status: "rejected", reason: "argon2-mismatch" };
    } catch {
      // Unparseable/corrupt stored hash — fail closed rather than falling back
      // to the weaker comparison.
      return { status: "rejected", reason: "argon2-error" };
    }
  }

  // Legacy row: no Argon2 hash yet, so the deterministic lookup value is all we
  // have. Compare in constant time; accept the peppered form too in case a row
  // was migrated without a secret hash.
  const { current, legacy } = lookupHashes(rawKey);
  if (safeEqual(row.keyHash, legacy) || safeEqual(row.keyHash, current)) {
    return { status: "ok", via: "legacy", needsUpgrade: true };
  }
  return { status: "rejected", reason: "lookup-mismatch" };
}

/**
 * Fields to write back after a legacy verification: moves the row onto the
 * peppered lookup hash and gives it an Argon2id secret hash.
 */
export async function upgradeApiKeyHashes(
  rawKey: string,
): Promise<{ keyHash: string; keySecretHash: string }> {
  return {
    keyHash: computeLookupHash(rawKey),
    keySecretHash: await hashApiKeySecret(rawKey),
  };
}
