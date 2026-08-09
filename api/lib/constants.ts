/** Time constants */
export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Rate limiting defaults */
export const RATE_LIMIT_WINDOW_15MIN = 15 * MS_PER_MINUTE;
export const RATE_LIMIT_WINDOW_1HOUR = MS_PER_HOUR;

/** Invite expiry */
export const INVITE_EXPIRY_MS = 48 * MS_PER_HOUR;

/** Body size limits */
export const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5MB
export const MAX_PHOTO_SIZE = 2_800_000; // ~2.8MB

/** Debt threshold for notifications (UZS) */
export const DEBT_NOTIFICATION_THRESHOLD = 500_000;

/** CORS */
export const CORS_MAX_AGE = 86_400; // 24 hours in seconds
