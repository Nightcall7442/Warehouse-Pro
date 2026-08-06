import { describe, it, expect, vi, beforeEach } from "vitest";
import { lookup } from "node:dns/promises";
import { isPrivateAddress, assertPublicHttpUrl, BlockedAddressError } from "../lib/safe-fetch";

/**
 * The 1C bridge calls a URL a tenant's director typed. These tests are the
 * boundary between "our customer's own server" and "the private network this
 * process happens to run in".
 */

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(),
}));
const mockLookup = vi.mocked(lookup);

// mockClear, а не mockReset: в vitest 4 сброс возвращает моку исходную
// реализацию, и заданный после него бросок до проверяемого кода не доходит —
// тест краснеет на верном коде. Историю вызовов чистить достаточно: свою
// реализацию каждый тест ставит сам.
beforeEach(() => mockLookup.mockClear());

function resolvesTo(...addresses: string[]) {
  mockLookup.mockResolvedValue(addresses.map(address => ({ address, family: address.includes(":") ? 6 : 4 })) as never);
}

describe("isPrivateAddress", () => {
  const blocked = [
    ["10.0.0.5", "частная сеть"],
    ["172.16.0.1", "частная сеть"],
    ["172.31.255.254", "верхняя граница 172.16/12"],
    ["192.168.1.1", "домашняя сеть"],
    ["127.0.0.1", "петля"],
    ["0.0.0.0", "эта сеть"],
    ["169.254.169.254", "метаданные облака"],
    ["100.64.0.1", "адреса Railway за NAT провайдера"],
    ["::1", "петля IPv6"],
    ["fd00::1", "уникальные локальные IPv6"],
    ["fe80::1", "локальные для канала IPv6"],
    ["::ffff:10.0.0.1", "IPv4 в обёртке IPv6"],
    ["не адрес", "вообще не адрес"],
  ] as const;

  for (const [ip, why] of blocked) {
    it(`блокирует ${ip} — ${why}`, () => expect(isPrivateAddress(ip)).toBe(true));
  }

  const allowed = ["8.8.8.8", "84.54.72.10", "172.32.0.1", "192.169.0.1", "2a00:1450::1"];
  for (const ip of allowed) {
    it(`пропускает публичный ${ip}`, () => expect(isPrivateAddress(ip)).toBe(false));
  }
});

describe("assertPublicHttpUrl", () => {
  it("пропускает обычный публичный адрес", async () => {
    resolvesTo("84.54.72.10");
    await expect(assertPublicHttpUrl("https://1c.example.uz/odata")).resolves.toBeInstanceOf(URL);
  });

  it("отказывает, когда имя разрешается во внутренний адрес", async () => {
    // Свой домен можно направить куда угодно, поэтому проверяется не имя, а то,
    // куда оно ведёт.
    resolvesTo("127.0.0.1");
    await expect(assertPublicHttpUrl("https://ловушка.example.com/")).rejects.toThrow(BlockedAddressError);
  });

  it("отказывает, если хотя бы один из адресов внутренний", async () => {
    // Один публичный ответ рядом с приватным — всё ещё путь внутрь.
    resolvesTo("84.54.72.10", "10.1.2.3");
    await expect(assertPublicHttpUrl("https://оба.example.com/")).rejects.toThrow(BlockedAddressError);
  });

  it("отказывает по имени внутренним доменам, не спрашивая DNS", async () => {
    for (const host of ["localhost", "redis.railway.internal", "db.local"]) {
      await expect(assertPublicHttpUrl(`http://${host}/`)).rejects.toThrow(BlockedAddressError);
    }
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("отказывает всему, кроме http и https", async () => {
    for (const raw of ["file:///etc/passwd", "ftp://example.com/", "gopher://example.com/"]) {
      await expect(assertPublicHttpUrl(raw)).rejects.toThrow(BlockedAddressError);
    }
  });

  it("отказывает литеральному внутреннему адресу без обращения к DNS", async () => {
    await expect(assertPublicHttpUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(BlockedAddressError);
    await expect(assertPublicHttpUrl("http://[::1]:6379/")).rejects.toThrow(BlockedAddressError);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  // Случай «резолвер упал» вынесен в safe-fetch-resolver-failure.test.ts:
  // мок, который бросает, vitest засчитывает как необработанную ошибку, если в
  // том же файле этот мок уже трогали другие тесты.

  it("отказывает, когда DNS ответил пустым списком", async () => {
    resolvesTo();
    await expect(assertPublicHttpUrl("https://пусто.example/")).rejects.toThrow(BlockedAddressError);
  });
});
