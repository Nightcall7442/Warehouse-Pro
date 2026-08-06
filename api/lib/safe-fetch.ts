import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * fetch for addresses a customer typed in.
 *
 * The 1C bridge takes a URL from a tenant's director and calls it from the
 * server. `z.string().url()` is happy with http://10.0.0.5:6379/ and with
 * http://redis.railway.internal/, so without this the "проверить связь" button
 * is a port scanner pointed at the platform's own private network, driven by
 * anyone who pays for an account. The reply is only a boolean, but a boolean
 * per host and port is exactly what a scanner needs.
 *
 * Blocking private ranges costs nothing real here: the server runs in Railway
 * and a customer's own 1C machine has to be publicly reachable for the bridge
 * to work at all. An address that this function rejects could never have
 * answered.
 *
 * DNS is resolved before connecting, because the name is not the destination —
 * anyone can point their own domain at 127.0.0.1. Redirects are followed by
 * hand for the same reason: a public URL is allowed to answer 302 to an
 * internal one, and fetch would follow it without asking again.
 */

const MAX_REDIRECTS = 3;

/** Hostname suffixes that resolve only inside a provider's network. */
const INTERNAL_SUFFIXES = [".railway.internal", ".internal", ".local", ".localdomain"];

export class BlockedAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedAddressError";
  }
}

/** True for addresses that are not reachable from, or not meant for, the public internet. */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return true; // not an address at all — refuse rather than guess

  if (family === 6) {
    const v6 = ip.toLowerCase();
    // IPv4 written as IPv6 (::ffff:10.0.0.1) is still IPv4.
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (v6 === "::" || v6 === "::1") return true;
    if (v6.startsWith("fc") || v6.startsWith("fd")) return true;                 // unique local
    if (v6.startsWith("fe8") || v6.startsWith("fe9") ||
        v6.startsWith("fea") || v6.startsWith("feb")) return true;               // link local
    return false;
  }

  const [a, b] = ip.split(".").map(Number);
  if (a === 0)   return true;                       // this network
  if (a === 10)  return true;                       // private
  if (a === 127) return true;                       // loopback
  if (a === 169 && b === 254) return true;          // link local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true;          // private
  if (a === 192 && b === 0)   return true;          // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier NAT — Railway's own range
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true;                        // multicast and reserved
  return false;
}

/**
 * Reject anything that is not a plain public http(s) endpoint.
 * Returns the parsed URL so callers do not parse twice.
 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedAddressError("Некорректный адрес.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedAddressError(`Разрешены только адреса http и https, получено «${url.protocol}».`);
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || INTERNAL_SUFFIXES.some(s => host.endsWith(s))) {
    throw new BlockedAddressError("Адрес указывает во внутреннюю сеть.");
  }

  // A literal address needs no lookup; a name does, and every address it
  // resolves to has to pass — one public and one private answer is still a way in.
  //
  // try/catch rather than .catch(): a resolver that throws synchronously would
  // slip past a promise chain, and the failure would surface as a raw DNS error
  // instead of a refusal.
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      const records = await lookup(host, { all: true });
      addresses = records.map(r => r.address);
    } catch {
      throw new BlockedAddressError("Не удалось определить адрес хоста.");
    }
  }

  if (addresses.length === 0) throw new BlockedAddressError("Не удалось определить адрес хоста.");
  for (const ip of addresses) {
    if (isPrivateAddress(ip)) {
      throw new BlockedAddressError("Адрес указывает во внутреннюю сеть.");
    }
  }

  return url;
}

/**
 * fetch that validates the target, and every redirect hop, before connecting.
 *
 * Note the residual gap this cannot close: between the lookup and the connect,
 * the name could resolve differently. Closing that needs connection-level
 * pinning, which fetch does not expose. It raises the cost of an attack from
 * "type a URL" to "win a race against your own DNS", which for a scanner is the
 * difference that matters.
 */
export async function safeFetch(raw: string, init: RequestInit = {}): Promise<Response> {
  let target = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicHttpUrl(target);
    const res = await fetch(url.toString(), { ...init, redirect: "manual" });

    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location");
    if (!location) return res;
    target = new URL(location, url).toString();
  }

  throw new BlockedAddressError("Слишком много перенаправлений.");
}
