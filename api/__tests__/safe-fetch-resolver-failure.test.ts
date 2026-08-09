import { describe, it, expect, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { assertPublicHttpUrl, BlockedAddressError } from "../lib/safe-fetch";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

/**
 * One case, one file, deliberately.
 *
 * A resolver that fails has to be expressed as a mock that throws, and vitest
 * reports that throw as an unhandled error the moment any other test in the
 * same file has already touched the same mock — the test then goes red while
 * the code under test behaved correctly. Rather than assert something weaker,
 * the case gets its own module registry.
 *
 * What it protects: assertPublicHttpUrl resolves the hostname before deciding,
 * and a failed lookup must come out as a refusal. If it came out as the raw DNS
 * error, a caller catching "не удалось соединиться" would treat an unchecked
 * address as merely unreachable.
 */
describe("assertPublicHttpUrl, когда резолвер падает", () => {
  it("отдаёт отказ, а не сырую ошибку DNS", async () => {
    // Синхронный бросок: цепочка .then().catch() его бы не поймала, поэтому в
    // safe-fetch стоит try/catch вокруг await.
    vi.mocked(lookup).mockImplementation(() => { throw new Error("ENOTFOUND"); });

    const err = await assertPublicHttpUrl("https://нет-такого.example/")
      .then(() => null, (e: unknown) => e);

    expect(err).toBeInstanceOf(BlockedAddressError);
  });
});
