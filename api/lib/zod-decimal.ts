/**
 * Zod schemas for MySQL DECIMAL columns fed from string inputs.
 *
 * Why this exists: `z.string().default("0.000")` only fires when the key is
 * **absent**. Web forms send `""` for a field the user left blank, so the empty
 * string sails through validation and reaches MySQL, which rejects it in strict
 * mode ("Incorrect decimal value: '' for column ..."). Likewise
 * `.refine(v => Number(v) >= 0)` accepts `""` because `Number("") === 0`.
 *
 * These helpers treat `""` / whitespace as "not provided": they fall back to the
 * declared default, or stay `undefined` when there is none. Everything else is
 * validated as a finite decimal number, range-checked, and normalised to a
 * fixed-scale string so what we hand Drizzle always matches the column.
 */
import { z } from "zod";

export interface DecimalStringOptions {
  /** Lower bound, inclusive unless `exclusiveMin` is set. */
  min?: number;
  /** Upper bound, inclusive. */
  max?: number;
  /** Make `min` strict — the value must be greater than `min`. */
  exclusiveMin?: boolean;
  /** Fraction digits of the target column. Defaults to 2. */
  scale?: number;
  /** Used when the input is absent, empty or whitespace-only. */
  default?: string;
  /** Overrides the message for range and "value required" failures. */
  message?: string;
  /** Overrides the message for values that are not a decimal number. */
  invalidMessage?: string;
}

/** Options for the required variant — a default would never be reachable. */
export type RequiredDecimalStringOptions = Omit<DecimalStringOptions, "default">;

const DEFAULT_SCALE = 2;
const MSG_INVALID = "Некорректное число";
const MSG_REQUIRED = "Значение обязательно";

/** Plain decimal or exponent notation. Rejects "1,5", "0x10", "NaN", "Infinity". */
const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
/** Plain decimal only — the shape we can rescale exactly, without float error. */
const PLAIN_DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?$/;

function stripLeadingZeros(digits: string): string {
  const trimmed = digits.replace(/^0+/, "");
  return trimmed === "" ? "0" : trimmed;
}

/** Adds 1 to a string of decimal digits, growing it when it overflows ("99" → "100"). */
function incrementDigits(digits: string): string {
  const out = digits.split("");
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] === "9") {
      out[i] = "0";
      continue;
    }
    out[i] = String(Number(out[i]) + 1);
    return out.join("");
  }
  return `1${out.join("")}`;
}

/**
 * Renders `raw` with exactly `scale` fraction digits.
 *
 * Rounding is **half away from zero** ("1.2345" → "1.235" at scale 3,
 * "-1.2345" → "-1.235"), matching how MySQL rounds DECIMAL. It is done on the
 * digit string, so it is exact — `Number("1.005").toFixed(2)` would give
 * "1.00" because of IEEE-754, this gives "1.01". Exponent notation ("1e3") is
 * the one shape we cannot rescale textually; it falls back to `toFixed`.
 */
export function toFixedScale(raw: string, scale: number): string {
  const parts = PLAIN_DECIMAL.exec(raw);
  if (!parts) return Number(raw).toFixed(scale);

  const negative = parts[1] === "-";
  const int = parts[2] === "" ? "0" : parts[2];
  const frac = parts[3] ?? "";

  let digits: string;
  if (frac.length <= scale) {
    digits = int + frac.padEnd(scale, "0");
  } else {
    digits = int + frac.slice(0, scale);
    if (frac.charCodeAt(scale) - 48 >= 5) digits = incrementDigits(digits);
  }

  const cut = digits.length - scale;
  const intPart = stripLeadingZeros(digits.slice(0, cut));
  const body = scale > 0 ? `${intPart}.${digits.slice(cut)}` : intPart;

  // "-0.4" at scale 0 must not become "-0"
  const isZero = /^0(?:\.0*)?$/.test(body);
  return negative && !isZero ? `-${body}` : body;
}

interface Resolved {
  scale: number;
  min?: number;
  max?: number;
  exclusiveMin: boolean;
  fallback?: string;
  message?: string;
  invalidMessage: string;
}

function resolve(opts: DecimalStringOptions): Resolved {
  return {
    scale: opts.scale ?? DEFAULT_SCALE,
    min: opts.min,
    max: opts.max,
    exclusiveMin: opts.exclusiveMin ?? false,
    fallback: opts.default,
    message: opts.message,
    invalidMessage: opts.invalidMessage ?? MSG_INVALID,
  };
}

type Outcome = { ok: true; value: string | undefined } | { ok: false; message: string };

function evaluate(raw: string | undefined, o: Resolved, required: boolean): Outcome {
  const trimmed = raw === undefined ? "" : raw.trim();

  if (trimmed === "") {
    if (required) return { ok: false, message: o.message ?? MSG_REQUIRED };
    return { ok: true, value: o.fallback };
  }

  if (!NUMERIC.test(trimmed)) return { ok: false, message: o.invalidMessage };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, message: o.invalidMessage };

  if (o.min !== undefined && (o.exclusiveMin ? !(n > o.min) : !(n >= o.min))) {
    const fallbackMsg = o.exclusiveMin
      ? `Значение должно быть больше ${o.min}`
      : `Значение не может быть меньше ${o.min}`;
    return { ok: false, message: o.message ?? fallbackMsg };
  }
  if (o.max !== undefined && n > o.max) {
    return { ok: false, message: o.message ?? `Значение не может быть больше ${o.max}` };
  }

  return { ok: true, value: toFixedScale(trimmed, o.scale) };
}

type OptionalDecimalSchema<Out> = z.ZodPipe<
  z.ZodOptional<z.ZodString>,
  z.ZodTransform<Out, string | undefined>
>;

type RequiredDecimalSchema = z.ZodPipe<z.ZodString, z.ZodTransform<string, string>>;

/**
 * An optional decimal string.
 *
 * Absent, `""` and whitespace-only all mean "not provided" and resolve to
 * `opts.default`, or `undefined` when no default is given (so the column keeps
 * its own default / is left untouched on update).
 */
export function decimalString(
  opts: DecimalStringOptions & { default: string },
): OptionalDecimalSchema<string>;
export function decimalString(opts?: DecimalStringOptions): OptionalDecimalSchema<string | undefined>;
export function decimalString(opts: DecimalStringOptions = {}): OptionalDecimalSchema<string | undefined> {
  const o = resolve(opts);
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const outcome = evaluate(raw, o, false);
      if (!outcome.ok) {
        ctx.addIssue(outcome.message);
        return z.NEVER;
      }
      return outcome.value;
    });
}

/**
 * A required decimal string: absent, `""` and whitespace-only are all errors.
 * Use for NOT NULL columns without a usable default (e.g. `products.unit_price`).
 *
 * The key stays required in the inferred input type, so omitting it is both a
 * type error and a parse error.
 */
export function requiredDecimalString(opts: RequiredDecimalStringOptions = {}): RequiredDecimalSchema {
  const o = resolve(opts);
  return z.string({ error: o.message ?? MSG_REQUIRED }).transform((raw, ctx) => {
    const outcome = evaluate(raw, o, true);
    if (!outcome.ok) {
      ctx.addIssue(outcome.message);
      return z.NEVER;
    }
    // `required` guarantees a value; the "not provided" branch is unreachable.
    return outcome.value as string;
  });
}
