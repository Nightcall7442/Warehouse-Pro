import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Два правила вместо двух заплаток.
 *
 * Обе беды, найденные в разборе заказов, чинились точечно — и обе вернулись бы
 * со следующей написанной процедурой:
 *
 *   1. Подчинённые данные заказа (оплаты, правки, переписка) читались по
 *      одному номеру заказа кем угодно из полевых. Четыре места закрыли; пятое
 *      напишут завтра.
 *   2. Отказ печатал номер товара из базы вместо названия. Пять сообщений
 *      исправили; шестое напишут завтра.
 *
 * Поэтому здесь не перечень исправленных мест, а правила, под которые
 * попадает и то, чего ещё нет.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

const walk = (dir: string, out: string[] = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "__tests__") walk(p, out); continue; }
    if (/\.ts$/.test(e.name)) out.push(p);
  }
  return out;
};

describe("правило 1: заказ отдаётся только тому, чей он", () => {
  /*
    Роли ceo и operator видят все заказы по определению (canSeeAnyOrder), у них
    процедура и объявлена соответствующим видом. Всем остальным — полевым —
    выборку обязан сузить кто-то: либо сама процедура через assertOrderVisible,
    либо сервис, которому передали, кто спрашивает.
  */
  const ROUTER = read("api/order-router.ts");
  const procedures = [...ROUTER.matchAll(/\n {2}(\w+): (\w+Query)/g)];

  it("исходник разобран — иначе проверка ниже пуста", () => {
    expect(procedures.length).toBeGreaterThan(15);
  });

  const touchingOrder = procedures.filter((m, i) => {
    const start = m.index!;
    const end = i + 1 < procedures.length ? procedures[i + 1].index! : ROUTER.length;
    return /\borderIds?\b/.test(ROUTER.slice(start, end));
  });

  it("процедуры вокруг заказа вообще нашлись", () => {
    expect(touchingOrder.length).toBeGreaterThan(5);
  });

  for (const [i, m] of touchingOrder.entries()) {
    const name = m[1];
    const kind = m[2];
    it(`${name} не отдаёт чужой заказ`, () => {
      const all = procedures.findIndex(p => p.index === m.index);
      const start = m.index!;
      const end = all + 1 < procedures.length ? procedures[all + 1].index! : ROUTER.length;
      const body = ROUTER.slice(start, end);

      const officeOnly = kind === "operatorQuery" || kind === "adminQuery";
      const guards = /assertOrderVisible\(/.test(body);
      // Актор доходит до сервиса — под любым из двух принятых имён поля.
      const passesViewer = /userRole: ctx\.user\.role|role: ctx\.user\.role/.test(body);

      expect(
        officeOnly || guards || passesViewer,
        `${name} (${kind}) работает с заказом по номеру, но не сужает доступ: ` +
        "либо объявите её operatorQuery, либо вызовите assertOrderVisible, либо передайте роль в сервис",
      ).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
    });
  }

  it("сама выборка «своих» живёт в одном месте", () => {
    // Два правила рядом разъезжаются; здесь оно одно — viewerScope/ownerScope
    // в сервисе, и все пути зовут его.
    const SRC = read("api/services/order.ts");
    expect(SRC).toContain("function viewerScope(viewer: OrderViewer)");
    expect(SRC, "внутренний вызов должен называть себя, а не молчать").toContain("SYSTEM_VIEW");
    /*
      Правило видимости спрашивается ровно в одном месте.

      Отмена — отдельное правило со своим списком (canCancelAnyOrder) и
      своей проверкой; речь здесь только о том, кому какие заказы ВИДНЫ.
    */
    const asks = [...SRC.matchAll(/canSeeAnyOrder\(/g)].length;
    expect(asks, "правило видимости спрашивают в нескольких местах — они разъедутся")
      .toBe(2); // объявление функции и единственный её вызов в viewerScope
  });
});

describe("правило 2: отказ называет вещь, а не её номер в базе", () => {
  /*
    Номера товара нет ни на коробке, ни в накладной: «Недостаточно товара:
    417» кладовщику не говорит ничего. Правило простое — если сообщение
    называет сущность, оно должно называть её именем.

    Исключение ровно одно и названо поимённо: когда сущность НЕ НАЙДЕНА,
    имени взять неоткуда, и номер — единственное, что есть.
  */
  const ALLOWED = [
    /не найден/i,
    /не существует/i,
    /не привязана к товару/i, // строка прихода без товара: имени нет по условию беды
    // «эта же строка прислана дважды» — речь о самом запросе, а не о товаре:
    // номер позиции тут и есть предмет разговора.
    /передана в запросе дважды/i,
  ];

  /*
    Файлы, чьи ошибки не видит человек за прилавком: сообщения обмена с 1С
    уходят в журнал синхронизации, и номер сущности там — то, по чему
    сверяют выгрузку.
  */
  const NOT_FOR_PEOPLE = ["api/services/onec-sync.ts", "api/lib/onec-bridge.ts"];

  it("ни одно сообщение не печатает номер вместо названия", () => {
    const offenders: string[] = [];
    for (const file of walk(path.resolve(process.cwd(), "api"))) {
      const src = read(file);
      for (const m of src.matchAll(/(?:throw new Error|badRequest|conflict|notFound)\(\s*`([^`]*)`/g)) {
        const text = m[1];
        /*
          Ищется ИДЕНТИФИКАТОР, а не всякое слово, кончающееся на «id».

          Стояло `\w*[Ii]d\b`, и под него подпадали обычные величины:
          priorPaid, paid, valid, said. Правило начинало требовать «назови
          имя» там, где никакого номера в сообщении нет вовсе, — то есть
          мешало писать понятные отказы про деньги.

          Настоящий идентификатор в этом коде выглядит одним из трёх способов:
          `id`, `orderId` (верблюжий горб) или `order_id`.
        */
        if (!/\$\{[^}]*\b(?:id|\w+_id|\w+Id)\b[^}]*\}/.test(text)) continue;
        if (/productLabel\(|names\.get\(/.test(text)) continue;   // имя всё-таки спрашивается
        if (ALLOWED.some(rx => rx.test(text))) continue;
        if (NOT_FOR_PEOPLE.some(f => file.replace(/\\/g, "/").endsWith(f))) continue;
        offenders.push(`${path.relative(process.cwd(), file)}: ${text.slice(0, 100)}`);
      }
    }
    expect(offenders, `отказы печатают номер вместо названия:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("имя берётся общим помощником", () => {
    const SRC = read("api/services/order.ts");
    expect(SRC).toContain("export async function productLabel(");
    // Помощник не должен ронять отказ, если имя не прочиталось: сообщение —
    // украшение, а отказ — суть.
    const at = SRC.indexOf("async function productNames(");
    expect(at).toBeGreaterThan(0);
    expect(SRC.slice(at, SRC.indexOf("\n}", at))).toContain("catch");
  });
});
