/**
 * Телеграм-бот: три правила, которые дороже всего стоят.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Бот не работал ни дня. Вебхук объявлялся в api/cron/telegram-ai-bot.ts и
 * никуда не подключался — в бою POST /api/webhooks/telegram отвечал 404.
 * Вместе с ним молча не работала кнопка «связать Telegram одним нажатием», а
 * notifyUserById и notifyTenantRole не вызывались ниоткуда: человек привязывал
 * чат, видел «успешно подключено» и не получал ни одного сообщения.
 *
 * ── Почему проверки именно эти ──────────────────────────────────────────────
 *
 * 1. Привязка. В ссылке ехал СЫРОЙ номер пользователя. Подключи кто-нибудь тот
 *    вебхук как есть — и любой человек написал бы боту «/start 5», привязав
 *    свой телефон к пятому пользователю системы: чужие уведомления, а на
 *    подходящем тарифе и остатки с выручкой.
 * 2. Тихие часы. Ошибка на час превращает «копится до утра» в «будит в три
 *    ночи», и заметить это можно только ночью.
 * 3. Умолчания. Если считать источником правил только таблицу, у новой
 *    организации не будет ни одной строки — и уведомления окажутся выключены
 *    там, где их никто не выключал. Ровно так в этом проекте уже умирали
 *    возможности.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../lib/env", () => ({ env: { appSecret: "тест-секрет", appUrl: "https://x", telegramBotToken: "", telegramWebhookSecret: "" } }));
vi.mock("drizzle-orm", async () => {
  const { drizzleMock } = await import("./helpers/drizzle-mock");
  return drizzleMock();
});
vi.mock("../queries/connection", () => ({ getDb: vi.fn() }));
vi.mock("../telegram-router", () => ({ sendTelegram: vi.fn(async () => true), tgEscape: (v: unknown) => String(v ?? "") }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { createLinkToken, readLinkToken, LINK_TTL_MS } = await import("../telegram/link-token");
const { isQuiet, nextQuietEnd, tashkentHour, DEFAULT_RULES, recipientRoles } =
  await import("../services/telegram-notify");

const { getDb } = await import("../queries/connection");

/*
  Комментарии снимаются перед сверкой. Иначе проверка «сырого номера в ссылке
  больше нет» спотыкается о пояснение рядом с исправлением: там эта строка
  процитирована как раз затем, чтобы объяснить, чем она была опасна.
*/
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\r\n]*\/\/.*$/gm, "");
const ROUTER = strip(readFileSync(join(__dirname, "..", "telegram-router.ts"), "utf8"));
const BOT = strip(readFileSync(join(__dirname, "..", "telegram", "bot.ts"), "utf8"));
const BOOT = strip(readFileSync(join(__dirname, "..", "boot.ts"), "utf8"));

beforeEach(() => vi.clearAllMocks());

describe("привязка чата", () => {
  it("свой токен принимается", () => {
    const token = createLinkToken(42);
    expect(readLinkToken(token)).toEqual({ ok: true, userId: 42 });
  });

  it("голый номер пользователя не принимается", () => {
    // Ровно то, что стояло в ссылке раньше.
    expect(readLinkToken("5")).toEqual({ ok: false, reason: "invalid" });
    expect(readLinkToken("5.9999999999999.")).toMatchObject({ ok: false });
  });

  it("подделать подпись нельзя", () => {
    const token = createLinkToken(7);
    const [id, exp] = token.split(".");
    expect(readLinkToken(`${id}.${exp}.подделка`)).toEqual({ ok: false, reason: "invalid" });
    // Подменить номер, оставив чужую подпись, тоже нельзя.
    const [, , sig] = token.split(".");
    expect(readLinkToken(`8.${exp}.${sig}`)).toEqual({ ok: false, reason: "invalid" });
  });

  it("ссылка живёт недолго", () => {
    const now = 1_700_000_000_000;
    const token = createLinkToken(3, now);
    expect(readLinkToken(token, now + LINK_TTL_MS - 1000)).toEqual({ ok: true, userId: 3 });
    // Пересланная другу ссылка к моменту нажатия уже мертва.
    expect(readLinkToken(token, now + LINK_TTL_MS + 1000)).toEqual({ ok: false, reason: "expired" });
  });

  it("в ссылку кладётся подпись, а не номер", () => {
    /*
      Проверка по исходнику: поведением её не поймать — код собирает строку,
      и вернуть в неё ctx.user.id можно, не сломав ни одного теста.
    */
    expect(ROUTER).toContain("createLinkToken(ctx.user.id)");
    expect(ROUTER, "в ссылку вернулся сырой номер").not.toMatch(/\?start=\$\{ctx\.user\.id\}/);
  });
});

describe("тихие часы", () => {
  const at = (hourUtc: number) => new Date(Date.UTC(2026, 8, 8, hourUtc, 0, 0));

  it("считаются по Ташкенту, а не по серверу", () => {
    // 18:00 UTC — это 23:00 в Ташкенте, то есть уже ночь.
    expect(tashkentHour(at(18))).toBe(23);
    expect(isQuiet(at(18))).toBe(true);
    // 04:00 UTC — 09:00 в Ташкенте, рабочее утро.
    expect(tashkentHour(at(4))).toBe(9);
    expect(isQuiet(at(4))).toBe(false);
  });

  it("ночью молчат, днём нет", () => {
    expect(isQuiet(at(19))).toBe(true);   // 00:00 Ташкент
    expect(isQuiet(at(2))).toBe(true);    // 07:00 Ташкент
    expect(isQuiet(at(3))).toBe(false);   // 08:00 Ташкент — тишина кончилась
    expect(isQuiet(at(10))).toBe(false);  // 15:00 Ташкент
  });

  it("отложенное уходит ровно в восемь утра", () => {
    /*
      Именно к восьми, а не «через N часов»: иначе сообщения, пришедшие в
      разное время ночи, растянулись бы очередью по всему утру.
    */
    const sendAt = nextQuietEnd(at(19));           // пришло в 00:00 Ташкент
    expect(tashkentHour(sendAt)).toBe(8);
    expect(sendAt.getTime()).toBeGreaterThan(at(19).getTime());

    const late = nextQuietEnd(at(18));             // пришло в 23:00 Ташкент
    expect(tashkentHour(late)).toBe(8);
    // Это уже следующее утро, а не сегодняшнее.
    expect(late.getTime()).toBeGreaterThan(at(18).getTime());
  });
});

describe("кому уходит", () => {
  /** Поддельная база: правил в таблице нет либо ровно те, что передали. */
  function fakeDb(overrides: Array<{ role: string; enabled: boolean }>) {
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      from: vi.fn(() => chain),
      where: vi.fn(async () => overrides),
    };
    return chain;
  }

  it("без единой строки в таблице уведомления работают", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([]) as never);
    /*
      Самое важное правило. Пустая таблица — это «как задумано», а не
      «выключено»: иначе новая организация не получала бы ничего и решила бы,
      что интеграция сломана.
    */
    expect(await recipientRoles(1, "order.created")).toEqual(DEFAULT_RULES["order.created"]);
    expect(await recipientRoles(1, "delivery.assigned")).toEqual(["courier"]);
  });

  it("директор может добавить роль", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([{ role: "supervisor", enabled: true }]) as never);
    const roles = await recipientRoles(1, "order.created");
    expect(roles).toContain("supervisor");
    expect(roles).toContain("ceo");
  });

  it("директор может убрать роль из умолчаний", async () => {
    vi.mocked(getDb).mockReturnValue(fakeDb([{ role: "operator", enabled: false }]) as never);
    const roles = await recipientRoles(1, "order.created");
    expect(roles).not.toContain("operator");
    expect(roles).toContain("ceo");
  });
});

describe("вебхук", () => {
  it("подключён к приложению", () => {
    /*
      Прежний бот объявлял этот маршрут и не был смонтирован никуда: в бою он
      отвечал 404. Проверка по исходнику — единственная, которая это ловит:
      сам файл с маршрутом при этом выглядел совершенно рабочим.
    */
    expect(BOOT).toContain("telegramBot");
    expect(BOOT).toMatch(/app\.route\("\/", telegramBot\)/);
  });

  it("секрет отдельный от токена бота", () => {
    // Токен даёт право писать от имени бота кому угодно; в заголовке каждого
    // входящего запроса ему не место.
    expect(BOT).toContain("telegramWebhookSecret");
    expect(BOT, "секретом снова служит токен").not.toMatch(/secret[^\n]*telegramBotToken/);
  });

  it("Telegram всегда получает 200", () => {
    /*
      На любой другой код Telegram повторяет доставку, а через сутки неудач
      отключает вебхук совсем — то есть одна наша ошибка выключила бы бота у
      всех сразу.
    */
    const tail = BOT.slice(BOT.indexOf("} catch (err)"));
    expect(tail).toContain("{ ok: true }");
  });

  it("бот не трогает данные организации", () => {
    /*
      Потерянный телефон стоит утечки сводки, а не поддельных отгрузок. Ни
      заказов, ни остатков, ни платежей бот не меняет никогда.

      Но своё СОБСТВЕННОЕ состояние связи он вести обязан: язык собеседника,
      привязку чата к человеку и привязку группы к организации. Это не данные
      организации, а то, кому и куда бот пишет.

      Поэтому список таблиц перечислен поимённо, а не «никаких записей вообще»:
      запрет без исключений пришлось бы обойти при первой же такой нужде, и
      обошли бы его целиком.
    */
    const OWN = new Set(["users", "telegramGroups"]);

    const touched = [
      ...(BOT.match(/\.(?:insert|update|delete)\((\w+)\)/g) ?? []),
    ].map(m => m.replace(/^\.\w+\(/, "").replace(/\)$/, ""));

    const foreign = [...new Set(touched)].filter(t => !OWN.has(t));
    expect(
      foreign,
      `бот пишет в данные организации: ${foreign.join(", ")}`,
    ).toEqual([]);
  });

  it("в группе бот не отвечает на вопросы", () => {
    /*
      Ответы бота — остатки, выручка и долги. В личной переписке их читает
      человек, чья роль это позволяет; в группе — все, кого туда добавили,
      включая тех, кому такие числа не показывают.

      Поэтому групповой чат только ПОЛУЧАЕТ события, а спрашивать в нём
      нельзя: разбор входящего обрывается сразу после команд группы.
    */
    const at = BOT.indexOf('if (chatType === "group"');
    expect(at, "группа не отделена от личной переписки").toBeGreaterThan(-1);

    // И обрыв стоит ДО ворот, за которыми идут ответы.
    const answersAt = BOT.indexOf("await answer(user");
    expect(answersAt, "ответы не найдены").toBeGreaterThan(-1);
    expect(at, "группа доходит до ответов бота").toBeLessThan(answersAt);
  });

  it("связать группу можно только групповым чатом", () => {
    // В личной переписке связывать нечего: там уже есть личная привязка, и
    // подмена одного другим сделала бы уведомления человека общими.
    const at = BOT.indexOf("async function linkGroup(");
    expect(at, "связывания группы нет").toBeGreaterThan(-1);
    const body = BOT.slice(at, BOT.indexOf("\n}", at));
    expect(body).toContain('chatType !== "group" && chatType !== "supergroup"');
  });
});


/* ═══════════════════════════════════════════════════════════════════════════
   Подписка на вебхук: сверяется не только адрес.

   ── Как это выстрелило ──────────────────────────────────────────────────────

   Вебхук оказался подписан ТОЛЬКО на `callback_query`: текстовые сообщения
   Telegram не присылал вовсе. Бот молчал на каждое слово живого человека, а
   по всем признакам был исправен — адрес совпадал, ошибок ноль, очередь
   пустая, и в журнале ни одного входящего запроса.

   Проверка при старте сравнивала только адрес и говорила «вебхук уже на
   месте». Это худший вид поломки: ни отказа, ни записи — только тишина.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("подписка бота на вебхук", () => {
  const REG = strip(readFileSync(join(__dirname, "..", "telegram", "register.ts"), "utf8"));

  it("набор типов назван один раз", () => {
    // Две копии списка разъехались бы, и сверка перестала бы ловить ровно то,
    // ради чего заведена.
    expect(REG).toContain("const ALLOWED_UPDATES");
    const literals = [...REG.matchAll(/\["message", "callback_query"\]/g)];
    expect(literals.length, "список типов записан дважды").toBe(1);
  });

  it("сообщения в наборе есть", () => {
    // Ровно то, чего не хватало: без "message" бот не видит ни одного слова.
    const at = REG.indexOf("const ALLOWED_UPDATES");
    expect(REG.slice(at, REG.indexOf(";", at))).toContain('"message"');
  });

  it("сверяются и адрес, и типы", () => {
    expect(REG).toContain("sameUrl");
    expect(REG).toContain("sameUpdates");
    const at = REG.indexOf("вебхук уже на месте");
    const before = REG.slice(Math.max(0, at - 200), at);
    expect(before, "«уже на месте» решается по одному адресу").toContain("sameUrl && sameUpdates");
  });

  it("расхождение типов попадает в журнал", () => {
    /*
      Молчаливая переустановка оставила бы вопрос «почему бот вчера не
      отвечал» без ответа. Строка в журнале — единственный след того, что
      подписка была не та.
    */
    expect(REG).toContain("подписка на типы обновлений не та");
  });
});
