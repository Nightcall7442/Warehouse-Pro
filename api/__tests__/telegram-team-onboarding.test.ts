import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Подключение сотрудников к Telegram.
 *
 * ── Задача, которую это решает ──────────────────────────────────────────────
 *
 * Подключиться к боту человек может только САМ: ссылка подписана его
 * идентификатором. Это правильно — иначе пересланная ссылка стала бы способом
 * читать чужие уведомления, — но из этого следовало, что подключить смену из
 * двадцати человек можно только уговорив каждого.
 *
 * Отсюда два ответа: общая группа (одно действие директора на всю смену) и
 * список, кто подключён лично.
 *
 * ── Что здесь стережётся в первую очередь ───────────────────────────────────
 *
 * Не удобство, а РАЗГЛАШЕНИЕ. В общий чат попадают рабочие события, и ровно
 * поэтому туда не должно попасть ничего личного: зарплата, своя задача, свои
 * показатели. Ошибка здесь выглядит как удобство ровно до того дня, когда вся
 * смена прочитает, кто сколько получил.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

/** Комментарий — не код: разборы ниже сами называют и группу, и зарплату. */
const strip = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/*
  Тело одной процедуры роутера.

  Резать «до `\n  }),`» нельзя: так заканчивается процедура без `.input(...)`,
  а с ним закрывающая скобка стоит на четырёх пробелах — поиск не находил
  ничего, `slice(at, -1)` отдавал весь остаток файла, и страж молчал о чём
  угодно, что нашлось ниже по тексту. Поймано нарочной поломкой.

  Поэтому границей служит начало СЛЕДУЮЩЕГО поля роутера.
*/
const procBody = (proc: string): string => {
  const at = ROUTER.indexOf(`\n  ${proc}: `);
  if (at < 0) return "";
  const rest = ROUTER.slice(at + 1);
  const next = rest.search(/\n {2}[A-Za-z_$][\w$]*:\s/);
  return next < 0 ? rest : rest.slice(0, next);
};

const NOTIFY = strip(read("api/services/telegram-notify.ts"));
const ROUTER = strip(read("api/telegram-router.ts"));
const BOT = strip(read("api/telegram/bot.ts"));
const TEAM_UI = strip(read("src/components/settings/TelegramTeam.tsx"));
const SETTINGS_UI = strip(read("src/components/settings/TelegramSettings.tsx"));

describe("в общий чат не уходит личное", () => {
  it("адресное уведомление в группу не идёт", () => {
    /*
      Главная проверка файла. `onlyUserId` стоит там, где сообщение
      предназначено ОДНОМУ человеку. Убери это условие — и зарплата, названная
      по имени, уйдёт в чат, где сидит вся смена.
    */
    /*
      Ищем ЧТЕНИЕ группы, а не слово «telegramGroups»: первым в файле стоит
      импорт, и окно перед ним — начало файла, где условия быть не может.
      Поймано нарочной поломкой.
    */
    const at = NOTIFY.indexOf(".from(telegramGroups)");
    expect(at, "группа не подключена к рассылке").toBeGreaterThan(-1);

    const before = NOTIFY.slice(Math.max(0, at - 400), at);
    expect(before, "группа получает и адресные уведомления").toContain("if (!input.onlyUserId)");
  });

  it("группа берётся по организации отправителя", () => {
    // Иначе событие одной организации уехало бы в чат другой — и заметить это
    // можно было бы только по жалобе.
    const at = NOTIFY.indexOf(".from(telegramGroups)");
    expect(at, "чтения группы нет").toBeGreaterThan(-1);
    const stmt = NOTIFY.slice(at, NOTIFY.indexOf(";", at));
    expect(stmt).toContain("eq(telegramGroups.tenantId, input.tenantId)");
  });

  it("тихие часы действуют и на группу", () => {
    /*
      Ночью сообщение ложится в очередь, а не будит. Если бы группа
      добавлялась ПОСЛЕ проверки тихого часа, чат смены звенел бы в три ночи,
      когда личные телефоны молчат.
    */
    const groupAt = NOTIFY.indexOf("chats.push(group.chatId)");
    const quietAt = NOTIFY.indexOf("if (isQuiet(now))");
    expect(groupAt, "группа не добавляется в список чатов").toBeGreaterThan(-1);
    expect(quietAt, "тихий час пропал").toBeGreaterThan(-1);
    expect(groupAt, "группа добавляется после проверки тихого часа").toBeLessThan(quietAt);
  });
});

describe("связать группу может только тот, кому дали код", () => {
  it("код подписан и недолог", () => {
    const TOKEN = strip(read("api/telegram/link-token.ts"));
    expect(TOKEN).toContain("export function createGroupToken");
    expect(TOKEN).toContain("export function readGroupToken");
    // Тот же срок, что и у личной ссылки: дольше — значит код полежит в
    // переписке, а он даёт право слить события организации в любой чат.
    const at = TOKEN.indexOf("export function createGroupToken");
    expect(TOKEN.slice(at, TOKEN.indexOf("\n}", at))).toContain("LINK_TTL_MS");
  });

  it("подпись сверяется постоянным временем", () => {
    // Обычное сравнение строк отвечает тем быстрее, чем раньше расходятся
    // байты, и по времени ответа подпись подбирается.
    const TOKEN = strip(read("api/telegram/link-token.ts"));
    const at = TOKEN.indexOf("export function readGroupToken");
    expect(TOKEN.slice(at, TOKEN.indexOf("\n}\n", at))).toContain("timingSafeEqual");
  });

  it("код выдаётся только директору", () => {
    for (const proc of ["groupCode", "groupStatus", "unlinkGroup", "teamStatus", "remindToConnect"]) {
      const at = ROUTER.indexOf(`\n  ${proc}: `);
      expect(at, `процедура ${proc} не найдена`).toBeGreaterThan(-1);
      expect(
        ROUTER.slice(at, at + 60),
        `${proc} открыта шире, чем директору организации`,
      ).toContain("adminQuery");
    }
  });

  it("идентификатор чата наружу не отдаётся", () => {
    /*
      Серверу он нужен, человеку не говорит ничего, а в журнале браузера ему
      делать нечего. Отдаём название и факт связи.
    */
    const at = ROUTER.indexOf("\n  groupStatus: ");
    const body = ROUTER.slice(at, ROUTER.indexOf("\n  }),", at));
    expect(body).toContain("linked:");
    expect(body, "идентификатор чата уезжает на экран").not.toMatch(/return\s*{[\s\S]*chatId[\s\S]*}/);
  });
});

describe("группа — это получатель, а не собеседник", () => {
  it("в групповом чате бот не отвечает на вопросы", () => {
    /*
      Ответы бота — остатки, выручка и долги. В личной переписке их читает
      человек, чья роль это позволяет; в группе — все, кого туда добавили.
    */
    const cut = BOT.indexOf('if (chatType === "group"');
    const answers = BOT.indexOf("await answer(user");
    expect(cut, "группа не отделена").toBeGreaterThan(-1);
    expect(cut, "группа доходит до ответов").toBeLessThan(answers);
  });

  it("связывание работает только в группе", () => {
    const at = BOT.indexOf("async function linkGroup(");
    const body = BOT.slice(at, BOT.indexOf("\n}", at));
    expect(body).toContain('chatType !== "group" && chatType !== "supergroup"');
  });

  it("новая группа заменяет прежнюю, а не добавляется к ней", () => {
    // Иначе рабочие события ушли бы и в чат, про который все забыли.
    const SCHEMA = read("db/schema.ts");
    const at = SCHEMA.indexOf("export const telegramGroups");
    expect(SCHEMA.slice(at, SCHEMA.indexOf("export type TelegramGroup", at)))
      .toContain("uniqueIndex(\"uq_tg_group_tenant\")");
  });
});

describe("директор видит, кого не хватает", () => {
  it("список сотрудников с признаком подключения", () => {
    const at = ROUTER.indexOf("\n  teamStatus: ");
    const body = ROUTER.slice(at, ROUTER.indexOf("\n  }),", at));
    expect(body).toContain("telegramChatId");
    expect(body, "список не сужен организацией").toContain("eq(users.tenantId, ctx.tenant.id)");
    expect(body, "в списке уволенные").toContain('eq(users.status, "active")');
  });

  it("напоминание идёт ТОЛЬКО неподключённым", () => {
    /*
      Подключившийся не должен получать напоминание сделать то, что он уже
      сделал: от таких сообщений люди перестают читать все остальные.
    */
    const at = ROUTER.indexOf("\n  remindToConnect: ");
    const body = ROUTER.slice(at, ROUTER.indexOf("\n  }),", at));
    expect(body).toContain("isNull(users.telegramChatId)");
  });

  it("напоминание идёт не в Telegram", () => {
    // В Telegram написать этим людям нельзя по определению — именно его у них
    // и нет. Уведомление идёт внутрь приложения.
    const at = ROUTER.indexOf("\n  remindToConnect: ");
    const body = ROUTER.slice(at, ROUTER.indexOf("\n  }),", at));
    expect(body).toContain("NotificationService.create");
    expect(body, "напоминание шлётся туда, чего у человека нет").not.toContain("sendTelegram");
  });
});

describe("до всего этого можно дойти", () => {
  it("блок подключения стоит на экране настроек", () => {
    const tag = SETTINGS_UI.match(/<TelegramTeam(?![A-Za-z0-9_])/);
    expect(tag, "блока подключения нет в настройках Telegram").not.toBeNull();
  });

  it("и стоит выше правил рассылки", () => {
    /*
      Правила отвечают на «кому что приходит», но пока человек не подключён,
      ему не приходит ничего. Сперва подключить, потом настраивать.
    */
    const team = SETTINGS_UI.indexOf("<TelegramTeam");
    const rules = SETTINGS_UI.indexOf("<TelegramRules");
    expect(team).toBeGreaterThan(-1);
    expect(rules).toBeGreaterThan(-1);
    expect(team, "правила рассылки стоят раньше подключения").toBeLessThan(rules);
  });

  it("экран зовёт все заведённые ручки", () => {
    for (const proc of ["teamStatus", "groupStatus", "groupCode", "remindToConnect", "unlinkGroup"]) {
      expect(TEAM_UI, `ручка ${proc} не вызывается ниоткуда`).toContain(`telegram.${proc}`);
    }
  });

  it("инструкция называет все три шага", () => {
    // «Добавьте бота» без «создайте группу» — это тупик: человек не понимает,
    // куда добавлять.
    expect(TEAM_UI).toMatch(/Создайте группу/);
    expect(TEAM_UI).toMatch(/Добавьте туда бота/);
    expect(TEAM_UI).toMatch(/\/link/);
  });
});

describe("бот объясняет себя", () => {
  let TEXTS = "";
  beforeAll(() => { TEXTS = read("api/telegram/texts.ts"); });

  it("на команду без кода отвечает, где его взять", () => {
    // Иначе человек получает «код не подошёл» на пустую команду и не знает,
    // что делать дальше.
    /*
      Имя целиком, с двоеточием: «groupNeedsCodeGone» тоже содержит
      «groupNeedsCode», и переименование прошло бы мимо стража. Поймано
      нарочной поломкой.
    */
    expect(TEXTS).toMatch(/groupNeedsCode:/);
    expect(TEXTS).toMatch(/Настройки → Telegram/);
  });

  it("говорит, что личное в группу не уходит", () => {
    // Это первое, о чём спрашивает директор, и первое, чего боится сотрудник.
    expect(TEXTS).toMatch(/Личное[^"]*не уходит|зарплата[^"]*не уходит/i);
  });

  it("новые ответы названы в помощи", () => {
    expect(TEXTS).toMatch(/Сотрудники<\/b>/);
    expect(TEXTS).toMatch(/Планы<\/b>/);
  });
});


/* ═══════════════════════════════════════════════════════════════════════════
   Директор подключает сотрудника сам — и узнаёт, дошло ли.
   ═══════════════════════════════════════════════════════════════════════════ */
describe("подключение по номеру Telegram", () => {
  const body = procBody("setUserChatId");

  it("процедура вообще есть", () => {
    expect(body, "подключения по номеру нет").not.toBe("");
  });

  it("открыта только директору", () => {
    expect(body).toContain("adminQuery");
  });

  it("сотрудник берётся из СВОЕЙ организации", () => {
    /*
      Без этого директор одной организации привязал бы Telegram к сотруднику
      другой — и тот начал бы получать чужие рабочие уведомления.
    */
    expect(body).toContain("eq(users.tenantId, ctx.tenant.id)");
  });

  it("один чат — один человек", () => {
    // Иначе уведомления директора начали бы приходить агенту, чей номер
    // вписали дважды.
    expect(body).toContain("ne(users.id, input.userId)");
    expect(body).toContain('code: "CONFLICT"');
  });

  it("номер — только цифры и только человеческий", () => {
    /*
      У групп номера отрицательные. Вписать сюда номер группы значило бы
      слать личные уведомления в общий чат — ровно то, чего вся эта работа и
      избегает.
    */
    expect(body).toContain(String.raw`regex(/^\d{5,20}$/`);
  });

  it("сразу проверяет доставку и возвращает исход", () => {
    /*
      Telegram запрещает боту писать первым: пока человек не нажал
      «Запустить», доставка отклоняется. Молчать об этом нельзя — директор
      решит, что подключил, а человек не получит ничего.
    */
    expect(body).toContain("await sendTelegram(");
    expect(body).toContain("delivered");
    expect(body).toContain('"not_started"');
  });

  it("экран говорит, что делать при недоставке", () => {
    expect(TEAM_UI, "экран молчит про «Запустить»").toMatch(/Запустить/);
  });

  it("бот сам называет номер тому, кто не привязан", () => {
    /*
      Круг должен замыкаться, иначе поле ввода бесполезно: своего номера в
      Telegram не видит НИКТО — ни сам человек, ни директор в списке
      участников группы. Telegram его нигде не показывает.

      Значит, единственный, кто может его назвать, — сам бот, тому, кто ему
      написал. Без этого директору неоткуда взять то, что он вписывает.
    */
    const TEXTS_RAW = strip(read("api/telegram/texts.ts"));
    const at = TEXTS_RAW.indexOf("unknownChat:");
    expect(at, "ответа незнакомому чату нет").toBeGreaterThan(-1);
    const answer = TEXTS_RAW.slice(at, TEXTS_RAW.indexOf("\n  ", TEXTS_RAW.indexOf("},", at)));
    expect(answer, "бот не называет номер — директору его взять неоткуда")
      .toContain("{id}");
    expect(answer, "старый тупик: отправляет в настройки веба, куда агент не заходит")
      .not.toMatch(/настройки в приложении/);

    expect(BOT, "номер не подставляется в ответ")
      .toContain('T.unknownChat.ru.replace("{id}", chatId)');
  });
});

describe("проверка связи не врёт", () => {
  const body = procBody("testBroadcast");

  it("проверка связи вообще есть", () => {
    expect(body, "проверки связи нет").not.toBe("");
  });

  it("идёт тому, кто нажал, и в общий чат", () => {
    /*
      Слала роли «агент»: директор, который на кнопку и нажимает, не получал
      ничего в принципе — он не агент. То есть проверка связи не проверяла
      связь того, кто её запустил.
    */
    expect(body).toContain("eq(users.id, ctx.user.id)");
    expect(body).toContain("telegramGroups");
    expect(body, "проверка снова шлётся роли").not.toContain("notifyTenantRole");
  });

  it("возвращает, что вышло на самом деле", () => {
    // «Никуда не ушло» — это ответ, а не успех.
    for (const field of ["toSelf", "toGroup", "selfLinked", "groupLinked"]) {
      expect(body, `в ответе нет ${field}`).toContain(field);
    }
    expect(body, "вернулся безусловный успех").not.toMatch(/return\s*{\s*success:\s*true\s*}/);
  });

  it("экран разбирает исход, а не пишет «отправлено»", () => {
    const UI = strip(read("src/components/settings/TelegramSettings.tsx"));
    expect(UI).toContain("r.toSelf");
    expect(UI).toContain("r.groupLinked");
    expect(UI, "экран снова рапортует успехом всегда")
      .not.toMatch(/onSuccess:\s*\(\)\s*=>\s*notify\.success/);
  });
});
