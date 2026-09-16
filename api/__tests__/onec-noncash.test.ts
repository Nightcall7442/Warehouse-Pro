/**
 * 1С и безнал.
 *
 * ── Что стережётся ──────────────────────────────────────────────────────────
 *
 *   · подбор поступление ↔ платёж: тот же контрагент, та же сумма, не раньше
 *     чем за сутки; одно поступление — один платёж, старшие первыми;
 *   · ПКО в 1С создаётся только на наличные: безнал приходит из выписки —
 *     в очередь не попадает, принудительно — «ждёт решения», не отказ;
 *   · поступление на счёт мы читаем, а не пишем: пресеты обоих конфигураций
 *     знают документ, проверка структуры его сверяет, эмулятор его заводит;
 *   · оплата из 1С по вебхуку без способа — перевод, подтверждённый учётом;
 *   · сверка стоит в кроне после контрагентов и на кнопке «Выгрузить очередь»;
 *   · инструкция админу 1С говорит об этом по-русски и по-узбекски.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { matchReceipts } from "../services/noncash";
import { PRESETS, requiredFields } from "../lib/onec-presets";
import { FakeOneC } from "./helpers/fake-onec";

const ROOT = join(__dirname, "..", "..");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\r\n]*\/\/.*$/gm, "");
const read = (p: string) => strip(readFileSync(join(ROOT, p), "utf8"));
const d = (iso: string) => new Date(iso);

describe("подбор поступлений", () => {
  const pay = (id: number, amount: number, at: string, counterparty = "cp1") => ({ id, counterparty, amount, createdAt: d(at) });
  const rc = (key: string, sum: number, at: string, counterparty = "cp1") => ({ key, number: key, date: d(at), counterparty, sum });

  it("тот же контрагент и сумма до тийина; чужой контрагент и другая сумма — мимо", () => {
    const hits = matchReceipts(
      [rc("a", 300, "2026-09-16T10:00:00Z"), rc("b", 300, "2026-09-16T10:00:00Z", "cp2"), rc("c", 300.01, "2026-09-16T10:00:00Z")],
      [pay(1, 300, "2026-09-15T09:00:00Z")],
    );
    expect(hits).toEqual([{ paymentId: 1, key: "a", number: "a", date: d("2026-09-16T10:00:00Z") }]);
  });

  it("поступление за сутки до записи — годится, за двое — нет", () => {
    expect(matchReceipts([rc("a", 100, "2026-09-14T09:00:00Z")], [pay(1, 100, "2026-09-15T09:00:00Z")])).toHaveLength(1);
    expect(matchReceipts([rc("a", 100, "2026-09-14T08:59:59Z")], [pay(1, 100, "2026-09-15T09:00:00Z")])).toHaveLength(0);
  });

  it("одно поступление закрывает один платёж — старший; два одинаковых перевода ждут двух поступлений", () => {
    const pending = [pay(2, 100, "2026-09-15T12:00:00Z"), pay(1, 100, "2026-09-15T09:00:00Z")];
    expect(matchReceipts([rc("a", 100, "2026-09-16T00:00:00Z")], pending).map(h => h.paymentId)).toEqual([1]);
    expect(matchReceipts([rc("a", 100, "2026-09-16T00:00:00Z"), rc("b", 100, "2026-09-16T01:00:00Z")], pending).map(h => [h.paymentId, h.key])).toEqual([[1, "a"], [2, "b"]]);
  });
});

describe("ПКО только на наличные", () => {
  const sync = read("api/services/onec-sync.ts");
  it("безнал в очередь не ставится, принудительно — «ждёт решения»", () => {
    expect(sync).toMatch(/eq\(payments\.paymentMethod, "cash"\), gte\(payments\.createdAt, config\.createdAt\)/);
    expect(sync).toContain('if (p.paymentMethod !== "cash") throw badRequest("Безнал приходит в 1С из выписки банка — ПКО не создаётся");');
  });
  it("сверка стоит в кроне после контрагентов и на кнопке очереди", () => {
    expect(sync).toContain('if (c.syncPayments) await step("bank", () => this.reconcileBankReceipts(c.tenantId, now));');
    expect(sync.indexOf('step("counterparties"')).toBeLessThan(sync.indexOf('step("bank"'));
    expect(read("api/onec-router.ts")).toContain("oneCSync.reconcileBankReceipts(ctx.tenant.id)");
    expect(read("src/components/settings/OneCSettings.tsx")).toContain("r.bank.matched");
  });
  it("использованное поступление помечается связью — второй перевод им не закроется", () => {
    expect(sync).toContain('OneCMapper.upsert(db, tenantId, "bank_receipt", h.key, h.paymentId)');
    expect(sync).toMatch(/eq\(idMappings\.entityType, "bank_receipt"\)/);
  });
});

describe("поступление на счёт в пресетах", () => {
  it("оба пресета знают документ; проверка структуры сверяет его поля; эмулятор его заводит", () => {
    for (const [name, n] of Object.entries(PRESETS)) {
      expect(n.bankIn, name).not.toBeNull();
      const req = requiredFields(n);
      expect(req.some(f => f.set === n.bankIn!.set && f.field === n.bankIn!.fields.sum), name).toBe(true);
      const fake = new FakeOneC("http://x/base", name as "bp_uz" | "ut");
      expect(fake.sets.has(n.bankIn!.set), name).toBe(true);
      expect(fake.sets.get(n.bankIn!.set)!.fields.has(n.bankIn!.fields.counterparty), name).toBe(true);
    }
    expect(PRESETS.bp_uz.bankIn!.set).toBe("Document_ПоступлениеНаРасчетныйСчет");
    expect(PRESETS.ut.bankIn!.set).toBe("Document_ПоступлениеБезналичныхДенежныхСредств");
  });
  it("документ только читается: create/post на него нет", () => {
    const sync = read("api/services/onec-sync.ts");
    expect(sync).not.toMatch(/bridge\.(create|post)\(b\.set/);
    expect(sync).toMatch(/bridge\.queryAll<Record<string, unknown>>\(b\.set/);
  });
});

describe("вебхук из 1С", () => {
  const hook = read("api/webhooks/onec.ts");
  it("без способа — перевод; безнал подтверждён учётом; наличные — в сейф без подтверждения", () => {
    expect(hook).toContain('const method = methodRaw == null ? "transfer" : String(methodRaw);');
    expect(hook).toContain('if (!["cash", "card", "transfer"].includes(method))');
    expect(hook).toContain('...(method !== "cash" ? { bankConfirmedAt: new Date(), bankRef: `1С ${reference ?? ""}`.trim().slice(0, 64) } : {})');
  });
});

describe("инструкция админу 1С", () => {
  const doc = readFileSync(join(ROOT, "docs/onec.md"), "utf8");
  it("говорит про поступление на счёт, чтение без записи и ПКО только на наличные — на двух языках", () => {
    expect(doc).toContain("ПоступлениеНаРасчетныйСчет");
    expect(doc).toMatch(/Warehouse Pro → 1С \| Оплата магазина \*\*наличными\*\*/);
    expect(doc).toMatch(/1С → Warehouse Pro \| \*\*Поступления на расчётный счёт\*\*/);
    expect(doc).toMatch(/Warehouse Pro → 1C \| Do'kon \*\*naqd\*\* to'lovi/);
    expect(doc).toMatch(/1C → Warehouse Pro \| \*\*Hisob-raqamga tushumlar\*\*/);
  });
});
