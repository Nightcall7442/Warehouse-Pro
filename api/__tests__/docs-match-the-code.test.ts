import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../public/order-export";
import { ORDER_STATUS_LABELS } from "../lib/order-status";

/* ═══════════════════════════════════════════════════════════════════════════
   Документация не расходится с кодом.

   ── Зачем ───────────────────────────────────────────────────────────────────

   Документ, живущий отдельно от кода, устаревает МОЛЧА. Это правило в продукте
   уже записано — им объясняется, почему словарь статусов отдаёт машина, а не
   письмо, — но на сами документы оно до сих пор не распространялось.

   И тут же сработало: в справке было написано «частота по умолчанию 60», а в
   схеме стоит 100. Число маленькое и на вид безобидное, но по нему чужая
   сторона рассчитывает свой цикл опроса — и упирается в отказ там, где не
   ждала, либо не упирается там, где собиралась испытать 429.

   ── Что проверяется ─────────────────────────────────────────────────────────

   Только то, что можно сверить буквально: числа, имена полей, коды статусов.
   Смысл текста проверить нечем, и делать вид, что можно, не будем.
   ═══════════════════════════════════════════════════════════════════════════ */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

const REF = read("docs/public-api-orders.md");     // контракт для разработчиков
const ANSWER = read("docs/bekdrinks-otvet.md");    // ответ заказчику
const CONTRACT = read("api/public/order-export.ts");
const SCHEMA = read("db/schema.ts");

const DOCS: Array<[string, string]> = [
  ["справка", REF],
  ["ответ заказчику", ANSWER],
];

describe("числа в документации — те же, что в коде", () => {
  it("размер страницы", () => {
    for (const [name, doc] of DOCS) {
      expect(doc, `${name}: умолчание страницы разошлось с кодом`)
        .toMatch(new RegExp(String(DEFAULT_PAGE_SIZE)));
      expect(doc, `${name}: потолок страницы разошёлся с кодом`)
        .toMatch(new RegExp(String(MAX_PAGE_SIZE)));
    }
    // И названо ровно как в коде, а не «около сотни».
    expect(REF).toContain(`default ${DEFAULT_PAGE_SIZE}, maximum ${MAX_PAGE_SIZE}`);
    expect(ANSWER).toContain(`по умолчанию ${DEFAULT_PAGE_SIZE}, потолок ${MAX_PAGE_SIZE}`);
  });

  it("частота по умолчанию", () => {
    /*
      Ровно то расхождение, ради которого этот файл и появился: в справке
      стояло 60, в схеме 100. По этому числу чужая сторона рассчитывает свой
      цикл опроса.
    */
    const m = SCHEMA.match(/rateLimit:\s+int\("rate_limit"\)\.default\((\d+)\)/);
    expect(m, "умолчание частоты пропало из схемы").not.toBeNull();
    const dflt = m![1];

    expect(REF, `справка: частота по умолчанию разошлась со схемой (${dflt})`)
      .toContain(`default ${dflt}`);
    expect(ANSWER, `ответ: частота по умолчанию разошлась со схемой (${dflt})`)
      .toContain(`по умолчанию ${dflt}`);
  });

  it("частота ключа песочницы", () => {
    const m = read("api/tenant-router.ts").match(/rateLimit:\s*(\d+),/);
    expect(m, "у ключа песочницы не задана частота").not.toBeNull();
    for (const [name, doc] of DOCS) {
      expect(doc, `${name}: частота песочницы разошлась с кодом (${m![1]})`)
        .toMatch(new RegExp(`\\b${m![1]}\\b`));
    }
  });

  it("число заказов песочницы", () => {
    const m = read("api/services/sandbox.ts").match(/SANDBOX_ORDER_COUNT = (\d+)/);
    expect(m).not.toBeNull();
    expect(ANSWER, `ответ: число заказов песочницы разошлось с кодом (${m![1]})`)
      .toContain(m![1]);
  });

  it("срок хранения журнала обмена", () => {
    const m = read("api/public/export-log.ts").match(/purgeOldExports\(days = (\d+)\)/);
    expect(m, "срок хранения журнала не назван в коде").not.toBeNull();
    expect(REF).toContain(`for ${m![1]} days`);
    expect(ANSWER).toContain(`хранится ${m![1]} дней`);
  });
});

describe("поля в примере ответа — те же, что отдаёт код", () => {
  /** Имена полей из договора ExportedOrder, по порядку объявления. */
  function contractFields(): { required: string[]; optional: string[] } {
    const at = CONTRACT.indexOf("export interface ExportedOrder {");
    expect(at, "договора ExportedOrder нет").toBeGreaterThan(-1);
    const body = CONTRACT.slice(at, CONTRACT.indexOf("\n}", at));
    const required: string[] = [];
    const optional: string[] = [];
    for (const m of body.matchAll(/^\s{2}(\w+)(\??):/gm)) {
      (m[2] === "?" ? optional : required).push(m[1]);
    }
    return { required, optional };
  }

  /** Ключи первой строки массива data из примера в документе. */
  function sampleFields(doc: string, label: string): string[] {
    const at = doc.indexOf('"data": [');
    expect(at, `${label}: в документе нет примера ответа`).toBeGreaterThan(-1);
    const open = doc.indexOf("{", at);
    // До первой закрывающей скобки того же уровня: строка примера плоская.
    const close = doc.indexOf("\n    }", open);
    const row = doc.slice(open, close);
    return [...row.matchAll(/"(\w+)":/g)].map(m => m[1]);
  }

  const { required, optional } = contractFields();

  it("договор вообще разобрался", () => {
    // Иначе проверки ниже сравнивали бы пустое с пустым и молчали.
    expect(required.length).toBeGreaterThan(10);
    expect(required).toContain("order_id");
    expect(optional).toContain("deleted_at");
  });

  for (const [name] of DOCS) {
    it(`${name}: пример показывает все обязательные поля`, () => {
      const doc = name === "справка" ? REF : ANSWER;
      const shown = sampleFields(doc, name);
      const missing = required.filter(f => !shown.includes(f));
      expect(missing, `${name}: в примере не показаны поля: ${missing.join(", ")}`).toEqual([]);
    });

    it(`${name}: в примере нет выдуманных полей`, () => {
      /*
        Лишнее поле в примере хуже недостающего: получатель напишет разбор
        под него, а в ответе его не окажется — и виноватой будет выглядеть
        выгрузка.
      */
      const doc = name === "справка" ? REF : ANSWER;
      const shown = sampleFields(doc, name);
      const known = new Set([...required, ...optional]);
      const invented = shown.filter(f => !known.has(f));
      expect(invented, `${name}: в примере поля, которых код не отдаёт: ${invented.join(", ")}`).toEqual([]);
    });
  }
});

describe("статусы в документации — те же, что в коде", () => {
  const CODES = Object.keys(ORDER_STATUS_LABELS);

  it("словарь в справке перечисляет ровно их", () => {
    const at = REF.indexOf('"statuses": [');
    expect(at, "в справке нет словаря статусов").toBeGreaterThan(-1);
    const block = REF.slice(at, REF.indexOf("],", at));
    const listed = [...block.matchAll(/"code": "(\w+)"/g)].map(m => m[1]);
    expect(listed.sort(), "словарь статусов в справке разошёлся с кодом").toEqual([...CODES].sort());
  });

  it("разбивка в примере ответа перечисляет ровно их", () => {
    for (const [name, doc] of DOCS) {
      const at = doc.indexOf('"status_counts": {');
      expect(at, `${name}: в примере нет разбивки по статусам`).toBeGreaterThan(-1);
      // Окно — от открывающей скобки, а не от имени поля: иначе в список
      // статусов попадает само «status_counts».
      const block = doc.slice(doc.indexOf("{", at), doc.indexOf("}", at));
      const listed = [...block.matchAll(/"(\w+)":/g)].map(m => m[1]);
      expect(listed.sort(), `${name}: разбивка по статусам разошлась с кодом`)
        .toEqual([...CODES].sort());
    }
  });
});

describe("документация не обещает того, что перестало быть правдой", () => {
  it("обещанный срок больше не описан как «всегда пусто»", () => {
    /*
      Поле завели в продукте 11.09.2026. Старое описание («ERP не хранит срок,
      всегда null») теперь враньё в опасную сторону: получатель, прочитавший
      его, вообще не станет считать просрочки.
    */
    expect(REF, "справка всё ещё обещает вечный null").not.toMatch(/promised_delivery_at.{0,40}always .{0,10}null/i);
    expect(REF).toContain("promised_delivery_at` is set by a person");
    expect(ANSWER).toContain("Это поле теперь есть в продукте");
  });

  it("склад описан как фильтрующий, а не как «просто проверяется»", () => {
    // До 11.09.2026 он проверялся и не фильтровал: по второму складу
    // отдавался весь оборот компании.
    expect(REF).toContain("zero rows");
    expect(ANSWER).toContain("честно возвращает ноль строк");
  });

  it("названные точки входа существуют", () => {
    const ROUTE = read("api/public/orders-v1.ts");
    const PUBLIC = read("api/public-api.ts");
    expect(ROUTE, "маршрут выгрузки заказов пропал").toContain('ordersV1.get("/"');
    expect(ROUTE, "словарь статусов пропал").toContain('ordersV1.get("/statuses"');
    expect(PUBLIC, "проверка связи пропала").toContain('app.get("/health"');
    for (const [name, doc] of DOCS) {
      expect(doc, `${name}: не названа проверка связи`).toContain("GET /health");
    }
  });
});
