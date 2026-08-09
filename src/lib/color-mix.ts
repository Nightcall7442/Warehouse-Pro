/**
 * A translucent tint of a colour, for badge grounds, hover fills and borders.
 *
 * The codebase used to write this as string concatenation — `${COLORS.danger}20`
 * — appending a hex alpha pair to the colour. That worked only while every
 * colour was a literal hex. Once colours moved to theme tokens the same
 * expression produced `var(--color-danger)20`, which is not valid CSS: the
 * browser drops the whole declaration, so an "active" filter chip silently
 * lost its tint and its border came out fully opaque instead of faint.
 *
 * `color-mix()` does the same job without caring whether it is handed a hex, an
 * rgb(), or a custom property, so a colour can stay a token all the way to the
 * style attribute.
 *
 * @param color  Any CSS colour — including `var(--token)`.
 * @param percent  How much of it to keep, 0-100. The rest is transparent.
 */
export function colorMix(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}
