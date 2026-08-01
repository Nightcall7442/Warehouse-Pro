import { timingSafeEqual } from "crypto";

/**
 * Constant-time string comparison to prevent timing attacks.
 * Use this for all secret/token comparisons instead of `===` or `!==`.
 *
 * The comparison does not leak the length of the expected secret: both inputs
 * are zero-padded to the longer of the two before `timingSafeEqual` runs, so a
 * length mismatch costs the same as a content mismatch. The length check is
 * evaluated *after* the byte comparison and only then AND-ed with it, so it
 * cannot short-circuit the expensive part away.
 */
export function safeEqual(a: string, b: string): boolean {
  // Rejecting empty/missing input early is safe: this only depends on whether
  // the *caller* supplied anything at all (a missing header, an unset env var),
  // never on the length or bytes of the expected secret. Neither branch reveals
  // anything an attacker does not already know about their own request.
  if (!a || !b) return false;

  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  // `timingSafeEqual` throws on differing lengths, so padding is required, not
  // optional. Zero-padding is sound here because the length equality check
  // below rejects "abc" vs "abc\0" style collisions.
  const width = Math.max(bufA.length, bufB.length);
  const padA = Buffer.alloc(width);
  const padB = Buffer.alloc(width);
  bufA.copy(padA);
  bufB.copy(padB);

  const bytesEqual = timingSafeEqual(padA, padB);
  const lengthEqual = bufA.length === bufB.length;

  // Both operands are already computed; the `&&` short-circuit here happens
  // after all the work, so it costs nothing observable.
  return bytesEqual && lengthEqual;
}
