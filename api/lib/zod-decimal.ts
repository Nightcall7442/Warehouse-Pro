import { z } from "zod";

/**
 * Form inputs send "" (not undefined) when a numeric field is left blank, which
 * bypasses Zod's .default() (only triggers on undefined) and lands an empty
 * string in a MySQL DECIMAL column — a 500 under strict SQL mode. Map "" to the
 * intended default before the rest of the chain (.refine/.default/.optional) runs.
 */
export function decimalOrDefault(defaultValue: string) {
  return z.preprocess((v) => (v === "" ? defaultValue : v), z.string());
}
