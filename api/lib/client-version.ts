/**
 * Разбор x-client-version: «web/1.4.2» или «mobile/2.0.1». Всё, что не
 * похоже на это, — unknown: метка из произвольной строки раздула бы метрику.
 */
export function clientVersionOf(header: string | undefined): { client: string; version: string } {
  const m = /^(web|mobile)\/([0-9A-Za-z.+-]{1,32})$/.exec((header ?? "").trim());
  return m ? { client: m[1], version: m[2] } : { client: "unknown", version: "unknown" };
}
