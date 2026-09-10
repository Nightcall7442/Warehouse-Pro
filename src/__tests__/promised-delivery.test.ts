import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { toLocalInput, promiseState } from "@/lib/promised-delivery";

/**
 * Обещанный срок доставки.
 *
 * ── Что здесь на самом деле проверяется ─────────────────────────────────────
 *
 * Две вещи, каждая из которых ломается молча и видна только у клиента:
 *
 *   1. Часовой пояс. Поле datetime-local не знает пояса вовсе. Стоит показать
 *      в нём UTC — и «привезём к шести» превращается в «к часу дня» при
 *      каждом открытии карточки (Ташкент — UTC+5).
 *
 *   2. Вывод о срыве. «Просрочен», «доставлен позже обещанного» и «срок не
 *      называли» — три разных ответа. Третий обязан оставаться третьим:
 *      выдать по нему «в срок» значит соврать в пользу компании, а «просрочен»
 *      — соврать против неё.
 */

describe("поле ввода показывает местное время", () => {
  it("туда и обратно — то же самое мгновение", () => {
    /*
      Главная проверка. Через toISOString().slice(0,16) она бы не прошла: там
      UTC, и на пять часов раньше введённого. Проверяем не буквой, а смыслом —
      разбор строки обратно даёт исходное время.
    */
    const d = new Date(2026, 8, 11, 18, 30); // 11.09.2026, 18:30 местного
    const back = new Date(toLocalInput(d));
    expect(back.getFullYear()).toBe(2026);
    expect(back.getMonth()).toBe(8);
    expect(back.getDate()).toBe(11);
    expect(back.getHours()).toBe(18);
    expect(back.getMinutes()).toBe(30);
  });

  it("формат ровно тот, что принимает datetime-local", () => {
    expect(toLocalInput(new Date(2026, 0, 5, 9, 5))).toBe("2026-01-05T09:05");
  });

  it("пусто остаётся пустым", () => {
    // Пустое поле означает «срок не называли» — подставлять сюда сегодняшнюю
    // дату нельзя ни в каком виде.
    expect(toLocalInput(null)).toBe("");
    expect(toLocalInput(undefined)).toBe("");
    expect(toLocalInput("не дата")).toBe("");
  });
});

describe("вывод о сроке", () => {
  const due = new Date("2026-09-11T13:00:00Z");
  const before = new Date("2026-09-11T12:00:00Z");
  const after = new Date("2026-09-11T15:00:00Z");

  it("без обещания вывода нет", () => {
    /*
      Самое важное правило целиком: не называли срок — сказать про него нечего.
      Ни «в срок», ни «просрочен». По этому полю считают срывы, и придуманный
      ответ станет придуманным срывом.
    */
    expect(promiseState(null, "new", null, after).kind).toBe("none");
    expect(promiseState(null, "delivered", after, after).kind).toBe("none");
    expect(promiseState(undefined, "shipped", null, after).kind).toBe("none");
  });

  it("заказ в работе: до срока — ждём, после — просрочен", () => {
    expect(promiseState(due, "shipped", null, before).kind).toBe("due");
    expect(promiseState(due, "shipped", null, after).kind).toBe("late");
  });

  it("ровно в назначенное время ещё не просрочен", () => {
    // Граница принадлежит обещанию: «к 13:00» в 13:00 — выполнено.
    expect(promiseState(due, "new", null, due).kind).toBe("due");
  });

  it("доставленный сравнивается с ФАКТОМ доставки, а не с «сейчас»", () => {
    /*
      Иначе заказ, довезённый вовремя, становился бы просроченным на
      следующий день сам по себе — просто оттого, что часы идут.
    */
    expect(promiseState(due, "delivered", before, new Date("2026-12-31T00:00:00Z")).kind).toBe("on_time");
    expect(promiseState(due, "delivered", after, new Date("2026-12-31T00:00:00Z")).kind).toBe("late_delivered");
  });

  it("отменённый и возвращённый закрыты, а не просрочены", () => {
    // Товар из игры вышел: считать по нему опоздание не за что.
    expect(promiseState(due, "cancelled", null, after).kind).toBe("closed");
    expect(promiseState(due, "returned", null, after).kind).toBe("closed");
  });

  it("насколько опоздали — числом, а не на глаз", () => {
    const s = promiseState(due, "shipped", null, after);
    expect(s.kind).toBe("late");
    expect(s.kind === "late" && s.lateMs).toBe(2 * 60 * 60 * 1000);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Правила, которые числами не проверить: они про то, откуда берётся значение.
   ═══════════════════════════════════════════════════════════════════════════ */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const BLOCK = read("src/components/orders/PromisedDelivery.tsx");
const REVIEW = read("src/components/orders/OrderReview.tsx");

describe("срок ставит человек", () => {
  it("оформление не подставляет срок по умолчанию", () => {
    /*
      Проверяем состояние в NewOrder: пустая строка и ничего больше. Любой
      new Date() или прибавление дней здесь — это обещание магазину от лица
      агента, которого он не давал.
    */
    const NEW_ORDER = read("src/pages/NewOrder.tsx");
    const at = NEW_ORDER.indexOf("const [promisedAt, setPromisedAt] = useState(");
    expect(at, "поле срока пропало из оформления").toBeGreaterThan(-1);
    const line = NEW_ORDER.slice(at, NEW_ORDER.indexOf("\n", at));
    expect(line, "срок подставляется по умолчанию").toBe('const [promisedAt, setPromisedAt] = useState("");');
  });

  it("поле ввода — родное, а не самодельный календарь", () => {
    // Родное поле умеет клавиатуру, локаль и мобильный выбор даты; своё
    // пришлось бы чинить по каждому из этих поводов отдельно.
    expect(REVIEW).toContain('type="datetime-local"');
    expect(BLOCK).toContain('type="datetime-local"');
  });

  it("пустое поле снимает обещание, а не оставляет прежнее", () => {
    /*
      Разница между null и «не трогали» — единственный способ убрать
      ошибочно поставленный срок. Свёрнутые в одно, они оставили бы его
      навсегда.
    */
    expect(BLOCK).toContain("raw ? new Date(raw).toISOString() : null");
  });

  it("блок зовёт свою ручку, а не правит заказ целиком", () => {
    // order.update — офисная и заодно меняет скидку с оплатой; агенту нужна
    // ровно одна возможность, и сервер её ровно и даёт.
    expect(BLOCK).toContain("trpc.order.setPromisedDelivery.useMutation");
    expect(BLOCK, "срок правится через общую правку заказа").not.toContain("order.update.useMutation");
  });

  it("по закрытому заказу перенести нельзя", () => {
    // Иначе задним числом стирался бы срыв: заказ доставлен позже
    // обещанного — и обещание переписывают на дату доставки.
    expect(BLOCK).toContain("OPEN_ORDER_STATUSES");
    expect(BLOCK).toContain("canEdit && open");
  });
});
