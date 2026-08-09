/**
 * Input sanitization utilities.
 * Strips HTML tags, control characters, and normalizes whitespace
 * to prevent XSS and injection attacks on all user-facing text fields.
 */

const HTML_TAG_RE = /<[^>]*>/g;
const CONTROL_CHARS = new Set<number>();
for (let i = 0; i <= 0x1F; i++) CONTROL_CHARS.add(i);
CONTROL_CHARS.add(0x7F);

function stripControlChars(input: string): string {
  let result = "";
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (!CONTROL_CHARS.has(code) && !(code >= 0x09 && code <= 0x0D)) result += input[i];
  }
  return result;
}
const MULTIPLE_SPACES_RE = /\s{2,}/g;

export function sanitizeString(input: string): string {
  return stripControlChars(input)
    .replace(HTML_TAG_RE, "")
    .replace(MULTIPLE_SPACES_RE, " ")
    .trim();
}

export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj };
  for (const key of Object.keys(result)) {
    if (typeof result[key] === "string") {
      (result as Record<string, unknown>)[key] = sanitizeString(result[key] as string);
    }
  }
  return result;
}

/** Validate a string looks like a safe URL (no javascript: or data: except images) */
export function isSafeUrl(url: string): boolean {
  const lower = url.toLowerCase().trim();
  if (lower.startsWith("javascript:") || lower.startsWith("vbscript:")) return false;
  if (lower.startsWith("data:") && !lower.startsWith("data:image/")) return false;
  return true;
}

/** Strip potential SQL injection patterns from search strings */
export function sanitizeSearch(input: string): string {
  return input
    .replace(/['";\\]/g, "")
    .replace(/--/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
}
