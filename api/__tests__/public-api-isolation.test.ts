import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bootSource } from "./helpers/boot-source";

/* ═══════════════════════════════════════════════════════════════════════════
   Выгрузка наружу: изоляция организаций и безопасность ключей.

   ── Почему это отдельный файл и почему проверок так много ───────────────────

   Потому что цена ошибки здесь — чужие заказы у третьей компании, и заметить
   такую ошибку по ответу невозможно: числа выглядят настоящими, потому что
   они и есть настоящие, только не той организации.

   Приёмка требует этого прямым текстом (17-F): в испытательной среде запись и
   доступ к данным другой фирмы должны отвергаться.
   ═══════════════════════════════════════════════════════════════════════════ */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

/** Комментарий — не код. Упоминание слова не значит, что оно исполняется. */
const strip = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const GATE = strip(read("api/public-api.ts"));
const ROUTE = strip(read("api/public/orders-v1.ts"));
const LOG = strip(read("api/public/export-log.ts"));

describe("организация берётся из ключа, и никак иначе", () => {
  it("параметра company_id нет и быть не может", () => {
    /*
      Главное свойство. Прислать чужой идентификатор организации нельзя не
      потому, что мы отказываем, а потому, что выразить это нечем: организация
      выводится из ключа. Появись такой параметр — отказ пришлось бы писать
      руками, и однажды его забыли бы в одном из маршрутов.
    */
    for (const [name, src] of [["ворота", GATE], ["выгрузка", ROUTE]] as const) {
      expect(src, `${name}: появился параметр организации`).not.toMatch(/query\(["']company_id["']\)/);
      expect(src, `${name}: появился параметр организации`).not.toMatch(/query\(["']tenant_id["']\)/);
    }
  });

  it("организация ставится один раз — в воротах", () => {
    expect(GATE).toContain('c.set("tenantId", key.tenantId)');
    // Ни один маршрут не вправе назначить её сам: это единственное место.
    expect(ROUTE, "выгрузка переставляет организацию").not.toContain('c.set("tenantId"');
  });

  it("каждый запрос выгрузки сужен организацией", () => {
    /*
      Проверяется буквально: у КАЖДОГО обращения к базе в этом файле должно
      стоять условие по организации. Забыть его в одном месте — значит отдать
      наружу чужие заказы, и по ответу это неотличимо от своих.
    */
    const froms = [...ROUTE.matchAll(/\.from\((\w+)\)/g)];
    expect(froms.length, "запросов не нашлось — проверка пуста").toBeGreaterThan(2);

    for (const m of froms) {
      // Окно — от .from(...) до конца выражения (первая точка с запятой).
      const end = ROUTE.indexOf(";", m.index!);
      const stmt = ROUTE.slice(m.index!, end === -1 ? undefined : end);
      const scoped =
        stmt.includes("tenantId") ||
        /*
          Либо общий набор условий — он сужен организацией сам, и это
          проверяется отдельно ниже. Итоги и строки обязаны считаться по
          ОДНОМУ набору: разойдись они хоть в одном условии, сверка сумм не
          сойдётся, а причину будут искать в ERP.
        */
        stmt.includes("...conditions");
      expect(scoped, `запрос .from(${m[1]}) не сужен организацией`).toBe(true);
    }
  });

  it("общий набор условий сужен организацией безусловно", () => {
    /*
      Через него идут все три запроса страницы — строки, счёт и сумма. Стоит
      условию организации попасть под «если», и выгрузка отдаст чужие заказы
      в том случае, о котором никто не подумал.
    */
    const at = ROUTE.indexOf("function baseConditions(");
    expect(at, "общего набора условий нет").toBeGreaterThan(-1);
    /*
      Окно начинается с ТЕЛА, а не с объявления: у функции многострочный тип
      довода, и он тоже кончается строкой со скобкой — граница «первая скобка
      в начале строки» обрезала бы окно до самого тела и страж молчал бы.
    */
    const bodyAt = ROUTE.indexOf("const c = [", at);
    expect(bodyAt, "тела набора условий не видно").toBeGreaterThan(at);
    const body = ROUTE.slice(bodyAt, ROUTE.indexOf("\n}", bodyAt));
    const first = body;
    expect(first.slice(0, 60), "организация перестала быть первым и безусловным условием")
      .toContain("eq(orders.tenantId, opts.tenantId)");
    // Именно безусловно: не внутри if, не с тернарником.
    expect(body).not.toMatch(/if\s*\([^)]*\)\s*c\.push\(eq\(orders\.tenantId/);
  });

  it("имена приходят из своей организации, а не из соседней", () => {
    /*
      Условие организации стоит ВНУТРИ соединения, а не в WHERE. В WHERE оно
      выкинуло бы строку целиком (заказ пропал бы из выгрузки), а без него имя
      магазина или сотрудника пришло бы из чужой организации.
    */
    const joins = [...ROUTE.matchAll(/\.leftJoin\(([\s\S]*?)\)\)/g)];
    expect(joins.length, "соединений не нашлось").toBeGreaterThanOrEqual(4);
    for (const j of joins) {
      expect(j[0], `в соединении нет условия организации: ${j[1].slice(0, 40)}`).toContain("tenantId");
    }
  });

  it("склад проверяется по своей организации", () => {
    expect(ROUTE).toContain("eq(warehouses.tenantId, tenantId)");
    expect(ROUTE).toContain("Unknown warehouse_id for this company");
  });

  it("чужой склад не отдаёт чужие заказы — и не отдаёт вообще ничего", () => {
    /*
      Заказы в этом продукте не привязаны к складу: продают только с основного.
      Значит по любому ДРУГОМУ складу заказов нет, и честный ответ пустой.

      Раньше склад проверялся и не фильтровал: спросив второй склад, получатель
      получал весь оборот компании и складывал его в отчёт по этому складу. Ни
      одно число при этом не выглядело подозрительным.
    */
    expect(ROUTE).toContain("warehouseHasNoOrders = asked !== meta.warehouseId");
    expect(ROUTE).toContain("if (opts.warehouseHasNoOrders)");
  });

  it("журнал обращений тоже сужен организацией", () => {
    const froms = [...LOG.matchAll(/\.from\(apiExportLog\)/g)];
    expect(froms.length).toBeGreaterThan(2);
    for (const m of froms) {
      const end = LOG.indexOf(";", m.index!);
      expect(LOG.slice(m.index!, end), "чтение журнала не сужено организацией")
        .toContain("apiExportLog.tenantId");
    }
  });
});

describe("ключ", () => {
  it("принимается только заголовком", () => {
    /*
      Ключ в адресе попадает в журнал доступа сервера, в историю браузера и в
      отчёты — то есть утекает туда, где его никто не ищет. ТЗ (пункт 13)
      запрещает это прямо.
    */
    expect(GATE).toContain('c.req.header("Authorization")');
    expect(GATE, "ключ читается из адреса").not.toMatch(/query\(["'](api_?key|token|key)["']\)/i);
  });

  it("хранится только отпечаток", () => {
    expect(GATE).toContain('createHash("sha256")');
    expect(GATE).toContain("eq(apiKeys.keyHash, keyHash)");
  });

  it("сам ключ в журнал выгрузок не попадает", () => {
    // В журнале есть номер ключа и нет ни ключа, ни его отпечатка: журнал
    // читают люди и выгружают в поддержку.
    expect(ROUTE).toContain('apiKeyId: c.get("apiKeyId")');
    expect(LOG, "отпечаток ключа попал в журнал").not.toContain("keyHash");
    expect(LOG, "ключ попал в журнал").not.toContain("rawKey");
  });

  it("проверяются состояние, срок и частота", () => {
    expect(GATE).toContain('key.status !== "active"');
    expect(GATE).toContain("key.expiresAt");

    /*
      Ограничение частоты проверяется не по НАЗВАНИЮ, а по тому, что отказ
      429 стоит именно за ним.

      Раньше здесь было toContain("sharedCheckRateLimit") — и страж молчал,
      когда проверку отключили условием `if (false)`: имя осталось в строке
      импорта наверху файла. Поймано нарочной поломкой.
    */
    const at = GATE.indexOf("Rate limit exceeded");
    expect(at, "отказа по частоте нет").toBeGreaterThan(-1);
    const guard = GATE.slice(GATE.lastIndexOf("if (", at), at);
    expect(guard, "отказ по частоте больше ничем не вызывается").toContain("sharedCheckRateLimit(");
  });
});

describe("отказы называют себя правильным кодом", () => {
  /*
    Получатель различает их без разбора текста, и от этого зависит, что он
    сделает: 401 и 403 — звать оператора, 402 — платить, 429 — подождать, 5xx —
    повторить позже. Перепутанный код превращает «заплатите» в «вам сюда
    нельзя» и наоборот.
  */
  const CASES: Array<[number, string]> = [
    [401, "Missing or invalid Authorization header"],
    [401, "Invalid API key"],
    [403, "API key is suspended"],
    [403, "Organisation is suspended"],
    [402, "Subscription expired"],
    [429, "Rate limit exceeded"],
  ];

  for (const [code, text] of CASES) {
    it(`${code}: ${text}`, () => {
      const at = GATE.indexOf(text);
      expect(at, `отказ «${text}» пропал`).toBeGreaterThan(-1);
      // Код стоит в том же выражении, что и текст.
      const stmt = GATE.slice(at, GATE.indexOf(";", at));
      expect(stmt, `у отказа «${text}» другой код`).toContain(String(code));
    });
  }

  it("429 несёт Retry-After заголовком, а не только в теле", () => {
    // Тело читает человек, а паузу выдерживает машина: добросовестный клиент
    // берёт её из заголовка. Без него он либо бьётся в стену, либо придумывает
    // паузу сам.
    const at = GATE.indexOf("Rate limit exceeded");
    expect(GATE.slice(at, GATE.indexOf(";", at))).toContain('"Retry-After"');
  });

  it("5xx отвечает разбираемым JSON, а не страницей", () => {
    /*
      Получатель разбирает ответ машиной. HTML на месте JSON он прочитать не
      сможет и в лучшем случае запишет «непонятная ошибка», а в худшем —
      посчитает ответ пустым и опубликует неполный отчёт.
    */
    const BOOT = strip(bootSource());
    const at = BOOT.indexOf("app.onError(");
    expect(at, "общего обработчика ошибок нет").toBeGreaterThan(-1);
    const body = BOOT.slice(at, BOOT.indexOf("\n});", at));
    expect(body).toContain('c.json({ error: "Internal server error" }, 500)');
  });

  it("неполный ответ не может уйти с кодом 200", () => {
    /*
      Ответ собирается ОДНИМ c.json в самом конце: частями он не отдаётся
      нигде. Значит, оборвись запрос к базе посередине — исключение уйдёт в
      onError и станет 500, а не двумястами с половиной страницы.
    */
    const oks = [...ROUTE.matchAll(/return c\.json\(\{[\s\S]{0,200}?server_time/g)];
    expect(oks.length, "удачный ответ собирается не одним местом").toBe(1);
    expect(ROUTE, "появилась потоковая отдача").not.toContain("stream(");
  });
});

describe("журнал выгрузок ведётся", () => {
  it("удача записывается вместе с точкой возобновления и числами сверки", () => {
    // Пункт 17-H: в суточном испытании записаны последняя успешная выгрузка и
    // ошибки. Без точки возобновления спор «мы всё потеряли» не разобрать.
    const at = ROUTE.indexOf("httpStatus: 200");
    expect(at, "удачная выгрузка не записывается").toBeGreaterThan(-1);
    const call = ROUTE.slice(ROUTE.lastIndexOf("recordExport({", at), ROUTE.indexOf("});", at));
    expect(call).toContain("cursorOut");
    expect(call).toContain("totalCount");
    expect(call).toContain("amountTotal");
  });

  it("любой отказ записывается одной калиткой", () => {
    /*
      Разбросанная по девяти местам запись однажды забывается в одном из них —
      и дыра в журнале появляется ровно там, где случилось интересное.
    */
    const gateAt = ROUTE.indexOf("const fail = (");
    expect(gateAt, "общей калитки отказа нет").toBeGreaterThan(-1);
    const gateEnd = ROUTE.indexOf("\n  };", gateAt);

    /*
      Единственный `c.json` с отказом — тот, что внутри самой калитки. Любой
      другой означает отказ мимо журнала: дыра появится ровно там, где
      случилось интересное.
    */
    const refusals = [...ROUTE.matchAll(/return c\.json\(\{ error:/g)];
    expect(refusals.length, "отказов нет вовсе — проверка пуста").toBe(1);
    const only = refusals[0].index!;
    expect(only > gateAt && only < gateEnd, "отказ пишется мимо общей калитки").toBe(true);
  });

  it("запись журнала не может уронить выгрузку", () => {
    // Журнал — подстраховка. Упади вставка (кончилось место, отвалилась база),
    // выгрузка обязана всё равно отдать заказы: средство разбора аварий не
    // должно само становиться аварией.
    const at = LOG.indexOf("export async function recordExport");
    const body = LOG.slice(at, LOG.indexOf("\n}", at));
    expect(body).toContain("try {");
    expect(body).toContain("} catch");
  });

  it("журнал не растёт без конца", () => {
    const SCHED = read("api/cron/scheduler.ts");
    /*
      Имя целиком, а не по началу: «api-export-log-cleanup-off» тоже содержит
      «api-export-log-cleanup», и переименование прошло бы мимо стража.
      Поймано нарочной поломкой.
    */
    expect(SCHED, "уборка журнала не поставлена в расписание")
      .toMatch(/name: "api-export-log-cleanup"/);
    expect(LOG).toContain("purgeOldExports");
  });
});
