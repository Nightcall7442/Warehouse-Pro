import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EXTRA_PRICES_UZS } from "../../contracts/constants";

/**
 * Докупить сверх тарифа можно попросить с экрана.
 *
 * ── Чего не хватало ─────────────────────────────────────────────────────────
 *
 * Возможность была со всех сторон, кроме той, где стоит человек:
 *
 *   • лендинг называл цену надбавки;
 *   • отказ при упоре в предел советовал «или докупите позиции»;
 *   • подписка показывала уже докупленное и брала за него деньги;
 *   • суперадмин умел надбавку выставить (tenant.setExtraLimits).
 *
 * И только сам директор попросить не мог ничем: упирался в предел, читал
 * «докупите», открывал «Подписку» — и не находил там ничего. Дальше он либо
 * звонил, если догадался, либо переходил на старший тариф, который ему не
 * нужен, либо уходил.
 *
 * Это тот же род дефекта, что и «написано, но не зовётся ниоткуда», только с
 * другой стороны: зовётся, но попросить нечем.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

/** Комментарий — не код: упоминание слова не значит, что оно исполняется. */
const strip = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ROUTER = strip(read("api/billing-router.ts"));
const CARD = strip(read("src/components/billing/ExtraLimitsCard.tsx"));
const PAGE = strip(read("src/pages/Billing.tsx"));
const LEADS = strip(read("api/services/leads.ts"));

/** Тело процедуры — до следующей процедуры того же уровня. */
function procBody(src: string, name: string): string {
  const at = src.indexOf(`\n  ${name}: `);
  expect(at, `процедура ${name} не найдена`).toBeGreaterThan(-1);
  const rest = src.slice(at + 3);
  const next = rest.search(/\n {2}[A-Za-z_$][\w$]*:\s/);
  expect(next, `не видно конца процедуры ${name} — окно захватит соседние`).toBeGreaterThan(-1);
  return rest.slice(0, next);
}

describe("попросить надбавку можно", () => {
  const body = procBody(ROUTER, "requestExtra");

  it("ручка открыта директору организации", () => {
    // Не оператору и не агенту: деньги организации — дело её владельца.
    expect(body).toContain("adminQuery");
  });

  it("экран подписки её зовёт", () => {
    /*
      Главная проверка: до этого возможность существовала на сервере и не
      имела ни одной кнопки.
    */
    expect(CARD).toContain("trpc.billing.requestExtra.useMutation");
    const tag = PAGE.match(/<ExtraLimitsCard(?![A-Za-z0-9_])/);
    expect(tag, "карточки надбавки нет на экране подписки").not.toBeNull();
  });

  it("она стоит выше выбора тарифа", () => {
    /*
      Человек приходит сюда, упершись в предел. Ответ «добавьте столько,
      сколько не хватает» обязан стоять раньше списка тарифов: иначе решение
      принимается раньше, чем читается.
    */
    const card = PAGE.indexOf("<ExtraLimitsCard");
    const plans = PAGE.indexOf("billing.plans.map");
    expect(card, "карточки надбавки нет").toBeGreaterThan(-1);
    expect(plans, "списка тарифов нет").toBeGreaterThan(-1);
    expect(card, "надбавка стоит ниже выбора тарифа").toBeLessThan(plans);
  });
});

describe("цену считает сервер", () => {
  const body = procBody(ROUTER, "requestExtra");

  it("из общего источника, а не из присланного", () => {
    /*
      Прислать цену с экрана нельзя: тогда в заявке стояла бы сумма, которую
      назвал браузер, а не та, по которой выставят счёт.
    */
    expect(body).toContain("EXTRA_PRICES_UZS.user");
    expect(body).toContain("EXTRA_PRICES_UZS.product");
    expect(body, "цена принимается на входе").not.toMatch(/price\w*:\s*z\./);
  });

  it("экран показывает цену из того же источника", () => {
    // Показать её обязательно — иначе человек нажимает, не зная суммы. Но
    // считаться она должна тем же числом, иначе экран и счёт разойдутся.
    expect(CARD).toContain("EXTRA_PRICES_UZS.user");
    expect(CARD).toContain("EXTRA_PRICES_UZS.product");
    expect(CARD, "цена зашита числом").not.toMatch(/\b35000\b|\b5000\b/);
  });

  it("надбавки вообще названы числами, а не нулями", () => {
    // Иначе проверки выше сравнивали бы пустое с пустым.
    expect(EXTRA_PRICES_UZS.user).toBeGreaterThan(0);
    expect(EXTRA_PRICES_UZS.product).toBeGreaterThan(0);
  });
});

describe("границы", () => {
  const body = procBody(ROUTER, "requestExtra");

  it("пустая заявка отвергается", () => {
    // «Ноль мест и ноль позиций» — это не заявка, а промах по кнопке.
    expect(body).toContain("input.users === 0 && input.products === 0");
    expect(body).toContain('code: "BAD_REQUEST"');
  });

  it("потолок тот же, что у выставления надбавки суперадмином", () => {
    /*
      Он не про щедрость, а про промах по клавиатуре: «5000» вместо «500» —
      это двадцать пять миллионов сум в месяц, и заметят это не сразу.
    */
    const admin = procBody(strip(read("api/tenant-router.ts")), "setExtraLimits");
    const cap = admin.match(/\.max\((\d+)\)/);
    expect(cap, "у суперадмина пропал потолок").not.toBeNull();

    /*
      Проверяются ВСЕ потолки заявки, а не «есть ли хоть один такой».

      Первая попытка искала подстроку — и молчала, когда потолок подняли
      только у мест: у позиций он остался прежним, подстрока нашлась, страж
      успокоился. Поймано нарочной поломкой.
    */
    const caps = [...body.matchAll(/\.max\((\d+)\)/g)].map(m => m[1]);
    expect(caps.length, "у заявки пропали потолки").toBe(2);
    for (const c of caps) {
      expect(c, `потолок заявки разошёлся с потолком выставления (${cap![1]})`).toBe(cap![1]);
    }

    /*
      На экране проверяется само ОГРАНИЧЕНИЕ, а не наличие числа: «1000»
      встречается там и в атрибуте max, и в кнопке, поэтому снятие зажима
      проходило мимо.
    */
    expect(CARD, "ввод на экране больше не зажимается потолком")
      .toContain(`Math.min(${cap![1]}, Math.max(0, n))`);
  });
});

describe("заявка не теряется", () => {
  const body = procBody(ROUTER, "requestExtra");

  it("ложится в общий разбор заявок, а не только в телеграм", () => {
    /*
      Форма, которая только шлёт сообщение в телеграм, теряет обращения молча:
      бота отключили, токен просрочили — человек видит «спасибо», а к
      владельцу ничего не приходит.
    */
    expect(body).toContain("recordLead(");
    expect(body, "заявка уходит мимо разбора, прямо в телеграм").not.toContain("notifyAdmin(");
  });

  it("сначала запись, потом уведомление", () => {
    const at = LEADS.indexOf("export async function recordLead");
    const fn = LEADS.slice(at, LEADS.indexOf("\n}", LEADS.indexOf("return { id, notified }", at)));
    const insert = fn.indexOf(".insert(leads)");
    const notify = fn.indexOf("sendTelegram(");
    expect(insert, "заявка не записывается").toBeGreaterThan(-1);
    expect(notify, "уведомление не отправляется").toBeGreaterThan(-1);
    expect(insert, "уведомление уходит раньше записи").toBeLessThan(notify);
  });

  it("не ушедшее уведомление видно — и в ответе не выдаётся за ушедшее", () => {
    // Обещать «оператор свяжется», когда сообщение никуда не ушло, — худший
    // из возможных ответов: человек ждёт звонка, которого не будет.
    expect(LEADS).toContain("notified: true");
    expect(LEADS).toContain("заявка сохранена, уведомление не ушло");
    /*
      Именно САМ ответ, а не просто слово в теле: «notified» встречается уже в
      строке, которая его получает, и проверка на подстроку молчала, когда
      сообщение перестало от него зависеть. Поймано нарочной поломкой.
    */
    expect(body, "ответ не различает, ушло уведомление или нет").toMatch(/message: notified\s+\?/);
  });

  it("приём заявки живёт в одном месте", () => {
    /*
      Заявок стало две — с лендинга и из подписки. Вторая копия порядка
      «запись → уведомление → отметка» однажды разъехалась бы с первой,
      обычно в сторону «уведомили, но не записали».
    */
    const lead = strip(read("api/lead-router.ts"));
    expect(lead).toContain("recordLead(");
    expect(lead, "в приёме заявок с сайта снова своя копия").not.toContain("sendTelegram(");
  });
});
