import { safeDateParse } from "./date-range";

/**
 * Pure retention logic for the nightly encrypted database dump.
 *
 * The upload job and the pruning job both need to agree on where a backup lives
 * and when it stops being worth keeping, so the naming scheme and the tier rules
 * live here rather than next to the S3 calls: no SDK, no filesystem and no clock
 * reads, which keeps the rules testable and keeps "what gets deleted" reviewable
 * without standing up a bucket.
 *
 * Days are "YYYY-MM-DD" strings interpreted in UTC — the job runs on a UTC
 * schedule, and a local-time reading would move the weekly/monthly boundaries.
 */

export type BackupTier = "daily" | "weekly" | "monthly";

/** How many backups each tier keeps. daily 7, weekly 4, monthly 12. */
export const RETENTION_LIMITS: Record<BackupTier, number> = {
  daily: 7,
  weekly: 4,
  monthly: 12,
};

const BASENAME_PREFIX = "warehouse-pro-";
const ARTIFACT_SUFFIX = ".sql.gz.enc";
const TIERS = Object.keys(RETENTION_LIMITS) as BackupTier[];

const INVALID_DAY_MESSAGE = "Некорректная дата резервной копии: ожидается формат ГГГГ-ММ-ДД";

function requireDay(day: string): string {
  const parsed = safeDateParse(day);
  if (parsed === null) throw new Error(INVALID_DAY_MESSAGE);
  return parsed;
}

/** S3 key prefix for a tier, e.g. "backups/daily/". */
export function tierPrefix(tier: BackupTier): string {
  return `backups/${tier}/`;
}

/** Object key for a tier and a "YYYY-MM-DD" day, e.g. "backups/daily/warehouse-pro-2026-07-31.sql.gz.enc". */
export function backupKey(tier: BackupTier, day: string): string {
  return `${tierPrefix(tier)}${BASENAME_PREFIX}${requireDay(day)}${ARTIFACT_SUFFIX}`;
}

/**
 * The "YYYY-MM-DD" day encoded in a key, or null when the key doesn't match the
 * naming scheme.
 *
 * The whole key is checked, not just its tail: the bucket also holds objects
 * this module knows nothing about, and `selectExpired` treats "unparsable" as
 * "not ours, leave it alone".
 */
export function dayFromKey(key: string): string | null {
  const tier = TIERS.find((candidate) => key.startsWith(tierPrefix(candidate)));
  if (tier === undefined) return null;

  const basename = key.slice(tierPrefix(tier).length);
  if (basename.includes("/")) return null;
  if (!basename.startsWith(BASENAME_PREFIX) || !basename.endsWith(ARTIFACT_SUFFIX)) return null;

  // safeDateParse, not a bare regex, so a malformed or impossible date is rejected.
  return safeDateParse(basename.slice(BASENAME_PREFIX.length, basename.length - ARTIFACT_SUFFIX.length));
}

/**
 * Which tiers a backup taken on `day` belongs to. Always "daily"; also "weekly"
 * on Sundays; also "monthly" on the 1st of the month. `day` is "YYYY-MM-DD" and
 * is interpreted in UTC.
 */
export function tiersForDay(day: string): BackupTier[] {
  const d = new Date(`${requireDay(day)}T00:00:00Z`);
  const tiers: BackupTier[] = ["daily"];
  if (d.getUTCDay() === 0) tiers.push("weekly");
  if (d.getUTCDate() === 1) tiers.push("monthly");
  return tiers;
}

/**
 * Keys to delete so a tier holds at most `limit` backups: the oldest ones beyond
 * the limit, newest kept. Input order is arbitrary. Keys that don't match the
 * naming scheme are never returned — pruning must not delete objects it doesn't
 * recognise.
 *
 * Returned oldest first. Days sort correctly as plain strings, so no date
 * parsing is needed beyond the recognition step.
 */
export function selectExpired(keys: string[], limit: number): string[] {
  // A negative or NaN limit means "keep nothing" rather than a nonsense slice.
  const keep = Number.isNaN(limit) ? 0 : Math.max(0, Math.floor(limit));

  const recognised = keys
    .map((key) => ({ key, day: dayFromKey(key) }))
    .filter((entry): entry is { key: string; day: string } => entry.day !== null)
    // Tie-break on the key so two tiers' keys for the same day order stably.
    .sort((a, b) => (a.day === b.day ? a.key.localeCompare(b.key) : a.day.localeCompare(b.day)));

  return recognised.slice(0, Math.max(0, recognised.length - keep)).map((entry) => entry.key);
}
