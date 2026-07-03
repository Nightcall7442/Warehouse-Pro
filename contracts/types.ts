export type * from "../db/schema";
export * from "./errors";

export type Role = "superadmin" | "ceo" | "operator" | "agent" | "supervisor" | "merchandiser" | "courier";

// ── Money branded type for decimal precision ──────────────────────────────────
export type Money = string & { readonly __brand: unique symbol };

export function toMoney(value: number | string): Money {
  return Number(value).toFixed(2) as Money;
}
