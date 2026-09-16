/**
 * Касса: двойная запись, сдача с расхождением, цепочка хэшей, права.
 *
 * ── Что стережётся ──────────────────────────────────────────────────────────
 *
 *   · сумма всех счетов после любых проводок — ноль: деньги не исчезают;
 *   · сдача: недостача становится долгом сотрудника, излишек — «до
 *     выяснения», ровная сдача — одной проводкой;
 *   · цепочка хэшей находит подменённую строку;
 *   · наличные кассира — сейф, наличные курьера — «на руках»;
 *   · кассовые документы нигде не правятся и не удаляются;
 *   · списание, выемка, открытие дня и правила — только директор;
 *   · недостача уходит в удержание из зарплаты;
 *   · раздел есть в меню, маршруте и заголовках.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  balancesOf, ledgerSum, handoverPostings, documentHash, verifyChain, holderAccount, ACCOUNT, tashkentDay, wholeSecond,
} from "../services/cash";

const ROOT = join(__dirname, "..", "..");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\r\n]*\/\/.*$/gm, "");
const read = (p: string) => strip(readFileSync(join(ROOT, p), "utf8"));

describe("двойная запись", () => {
  it("сумма всех счетов — ноль после любого набора проводок", () => {
    const postings = [];
    let seed = 7;
    for (let i = 0; i < 200; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      const amount = Math.round((seed / 233280) * 1_000_000) / 100;
      postings.push({ debit: `acc.${seed % 7}`, credit: `acc.${(seed + 3) % 7}`, amount });
    }
    expect(ledgerSum(balancesOf(postings))).toBe(0);
  });

  it("наличный платёж курьера — «на руках», платёж кассира — сразу сейф", () => {
    expect(holderAccount(7, "courier")).toBe(ACCOUNT.employee(7));
    expect(holderAccount(7, "agent")).toBe(ACCOUNT.employee(7));
    expect(holderAccount(3, "operator")).toBe(ACCOUNT.office);
    expect(holderAccount(3, "ceo")).toBe(ACCOUNT.office);
  });
});

describe("сдача в кассу", () => {
  it("ровно — одна проводка на руки → сейф", () => {
    const p = handoverPostings(7, 600_000, 600_000);
    expect(p.discrepancy).toBe(0);
    expect(p.extra).toBeNull();
    expect(p.main).toEqual({ debit: ACCOUNT.office, credit: ACCOUNT.employee(7), amount: 600_000 });
  });

  it("недостача остаётся долгом сотрудника, а не исчезает", () => {
    const p = handoverPostings(7, 600_000, 580_000);
    expect(p.discrepancy).toBe(-20_000);
    expect(p.main.amount).toBe(580_000);
    expect(p.extra).toEqual({ debit: ACCOUNT.employeeDebt(7), credit: ACCOUNT.employee(7), amount: 20_000 });
    // После обеих проводок «на руках» ноль, долг 20 000, сейф +580 000; всё сходится в ноль.
    const b = balancesOf([{ debit: ACCOUNT.employee(7), credit: ACCOUNT.shop(1), amount: 600_000 }, p.main, p.extra!]);
    expect(b.get(ACCOUNT.employee(7))).toBe(0);
    expect(b.get(ACCOUNT.employeeDebt(7))).toBe(20_000);
    expect(b.get(ACCOUNT.office)).toBe(580_000);
    expect(ledgerSum(b)).toBe(0);
  });

  it("излишек — в сейф, но «до выяснения», не молча", () => {
    const p = handoverPostings(7, 600_000, 610_000);
    expect(p.discrepancy).toBe(10_000);
    expect(p.extra).toEqual({ debit: ACCOUNT.office, credit: ACCOUNT.unexplained, amount: 10_000 });
  });

  it("отрицательная сдача — отказ", () => {
    expect(() => handoverPostings(7, 100, -1)).toThrow();
  });
});

describe("цепочка хэшей", () => {
  const base = { tenantId: 1, kind: "pko", year: 2026, debit: ACCOUNT.office, credit: ACCOUNT.employee(7), fromUserId: 7, toUserId: 3, createdBy: 3 };
  const chain = () => {
    const rows = [];
    let prev: string | null = null;
    for (let n = 1; n <= 3; n++) {
      const d = { ...base, number: n, amount: `${n}000.00`, createdAt: new Date(Date.UTC(2026, 8, 16, 10, n)) };
      const hash = documentHash(prev, d);
      rows.push({ id: n, ...d, prevHash: prev, hash });
      prev = hash;
    }
    return rows;
  };

  it("целая цепочка проходит", () => {
    expect(verifyChain(chain())).toEqual({ ok: true });
  });

  it("подменённая сумма находится по номеру документа", () => {
    const rows = chain();
    rows[1].amount = "9000.00";
    expect(verifyChain(rows)).toEqual({ ok: false, brokenAt: 2 });
  });

  it("вырезанный документ рвёт цепочку у следующего", () => {
    const rows = chain();
    rows.splice(1, 1);
    expect(verifyChain(rows)).toEqual({ ok: false, brokenAt: 3 });
  });

  it("доли секунды в хэш не входят: TIMESTAMP в базе их не хранит, а округляет вверх", () => {
    const d = { ...base, number: 1, amount: "1000.00" };
    const t = Date.UTC(2026, 8, 16, 10, 0, 0);
    expect(documentHash(null, { ...d, createdAt: new Date(t + 999) })).toBe(documentHash(null, { ...d, createdAt: new Date(t) }));
    expect(wholeSecond(new Date(t + 999)).toISOString()).toBe("2026-09-16T10:00:00.000Z");
    // Пишем в базу то же срезанное время — иначе округление MySQL уведёт строку на секунду вперёд.
    const svc = read("api/services/cash.ts");
    expect(svc).toMatch(/const now = wholeSecond\(at\);/);
  });

  it("день считается по Ташкенту", () => {
    expect(tashkentDay(new Date(Date.UTC(2026, 8, 15, 22, 30)))).toBe("2026-09-16");
  });
});

describe("документы не правятся и не удаляются", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== "__tests__") walk(p); }
      else if (/\.ts$/.test(name)) files.push(p);
    }
  };
  walk(join(ROOT, "api"));

  it("ни одного update/delete по cash_documents в api", () => {
    const offenders = files.filter(f => /\.(update|delete)\(\s*cashDocuments\s*\)/.test(read(f.slice(ROOT.length + 1)))).map(f => f.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
    // Встречная проверка: правило вообще что-то ловит.
    expect(/\.(update|delete)\(\s*cashDocuments\s*\)/.test("db.update(cashDocuments).set({})")).toBe(true);
  });

  it("сторно — единственный путь исправить документ", () => {
    const svc = read("api/services/cash.ts");
    expect(svc).toContain("stornoOfId: orig.id");
    expect(svc).toContain("Это уже сторно");
    expect(svc).toContain("Документ уже сторнирован");
  });
});

describe("права и правила", () => {
  const router = read("api/cash-router.ts");
  const svc = read("api/services/cash.ts");

  it("списание, выемка, открытие дня, правила — только директор", () => {
    for (const p of ["ownerMove", "writeOff", "reopenDay", "saveSettings", "saveCategory", "verify"]) {
      expect(router, `${p} не adminQuery`).toMatch(new RegExp(`${p}:\\s*adminQuery`));
    }
  });

  it("сдача, расход, закрытие дня, сторно — кассир с правом «Принимать оплату»", () => {
    expect(router).toContain('const cashierQuery = operatorQuery.use(can("payments.accept"))');
    for (const p of ["handover", "expense", "closeDay", "storno", "overview", "journal"]) {
      expect(router, `${p} не cashierQuery`).toMatch(new RegExp(`${p}:\\s*cashierQuery`));
    }
  });

  it("сдачу у самого себя принять нельзя; без PIN — только подпись на бумаге", () => {
    expect(svc).toContain("Принять сдачу у самого себя нельзя");
    expect(svc).toContain("отметьте «подписал ПКО на бумаге»");
    expect(svc).toContain("PIN не подошёл");
  });

  it("расход не уводит сейф в минус; закрытый день не принимает документов", () => {
    expect(svc).toContain("расход больше остатка не проводится");
    expect(svc).toContain("День уже закрыт — новые документы не проводятся");
  });

  it("недостача удерживается из зарплаты — у агента и у курьера", () => {
    const kpi = read("api/services/kpi.ts");
    expect(kpi).toContain("CashService.employeeDebtIn(");
    expect((kpi.match(/- cashShortage\)/g) ?? []).length).toBe(2);
    expect(kpi).toContain("cashShortage: -cashShortage");
  });

  it("касса ведётся с дня начала: старые платежи в проводки не входят, день после первого документа не двигается", () => {
    expect(svc).toContain("const start = await cashStart(db, tenantId);");
    expect(svc).toMatch(/eq\(payments\.paymentMethod, "cash"\),\s*gte\(payments\.createdAt, start\)/);
    expect(router).toContain("день начала менять нельзя");
    expect(read("db/schema.ts")).toContain('cashStartDay:        date("cash_start_day", { mode: "string" }).default("2026-09-16").notNull()');
  });

  it("хэш PIN не уходит наружу с пользователем", () => {
    expect(read("api/auth/index.ts")).toContain('"cashPinHash"');
  });
});

describe("раздел на месте", () => {
  it("маршрут, меню директора и оператора, заголовок, словарь", () => {
    expect(read("src/App.tsx")).toMatch(/path="\/cash"/);
    const nav = read("src/const.ts");
    expect((nav.match(/path: "\/cash"/g) ?? []).length).toBe(2);
    expect(read("src/components/Layout.tsx")).toContain('"/cash"');
    expect(read("src/i18n/ru.ts")).toMatch(/cash:\s*"Касса"/);
    expect(read("src/i18n/uz.ts")).toMatch(/cash:\s*"Kassa"/);
  });

  it("свой кошелёк — у агента и курьера, PIN — в профиле", () => {
    expect(read("src/pages/AgentDashboard.tsx")).toContain("<MyCashCard />");
    expect(read("src/pages/CourierDeliveries.tsx")).toContain("<MyCashCard />");
    expect(read("src/components/settings/ProfileSettings.tsx")).toContain("trpc.cash.setPin.useMutation");
  });

  it("вечерний крон и проверка цепочки стоят в расписании", () => {
    const sched = read("api/cron/scheduler.ts");
    expect(sched).toContain('name: "cash-evening"');
    expect(sched).toContain('name: "cash-chain-check"');
  });
});
