/**
 * KPI icon tiles used to be filled solid with a saturated gradient and a white
 * glyph — six of them in a row read as a strip of colour swatches competing
 * with the numbers they were meant to label. The hue still carries meaning
 * (new · in progress · shipped · delivered · cancelled), so it stays; it just
 * moves from the fill to the glyph, over a barely-there tint of itself.
 *
 * Call sites pass a `linear-gradient(...)` string, so the colour is read back
 * out of it rather than changing every page.
 */

const HEX = /#[0-9a-f]{3,8}/gi;

/** The colour a tile should carry: the gradient's last stop, or the accent. */
export function kpiAccent(gradient?: string): string {
  const found = gradient?.match(HEX);
  return found?.[found.length - 1] ?? "var(--color-primary)";
}

/** A ground faint enough that the glyph, not the tile, is what registers. */
export function kpiTint(gradient?: string): string {
  return `color-mix(in srgb, ${kpiAccent(gradient)} 14%, transparent)`;
}
