import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Вопрос в поддержку доходит до платформы.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Арендатор писал в чат, сообщение ложилось в базу — и всё. Узнать о нём можно
 * было, только открыв суперадмина и заметив самому. Человек в это время ждёт:
 * он написал в поддержку, а поддержка о нём не знает.
 *
 * Механизм уведомлений при этом был готов: notifyAdmin шлёт в телеграм
 * платформы и уже используется для регистраций и запросов на апгрейд. Не
 * хватало вызова — та же болезнь «написано, но не позвано ниоткуда», что и у
 * вебхука бота, кронов и погрузочных листов.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const SERVICE = read("api/services/support-chat.ts");

describe("письмо арендатора уведомляет платформу", () => {
  it("вызов стоит на отправке сообщения", () => {
    expect(SERVICE).toContain("notifyPlatformAboutQuestion");
    expect(SERVICE).toContain("tgMessages.supportMessage");
  });

  it("уведомляет только о письмах арендатора", () => {
    /*
      Ответ платформы уходит через тот же postMessage. Уведомлять о нём значило
      бы слать самому себе сообщение о том, что сам только что написал.
    */
    const at = SERVICE.indexOf("void notifyPlatformAboutQuestion");
    const around = SERVICE.slice(Math.max(0, at - 200), at);
    expect(around).toContain("if (!input.fromPlatform)");
  });

  it("серия реплик даёт одно уведомление", () => {
    /*
      Человек пишет вопрос в три-четыре сообщения подряд — мысль, уточнение, «а
      ещё». Уведомление о каждом превращает телеграм в ленту, которую перестают
      читать.
    */
    expect(SERVICE).toContain("NOTIFY_QUIET_MS");
    const at = SERVICE.indexOf("const previous = recent[1]");
    expect(at, "предыдущее сообщение не ищется").toBeGreaterThan(0);
    expect(SERVICE.slice(at, at + 200)).toContain("NOTIFY_QUIET_MS");
  });

  it("берётся предпоследнее, а не последнее сообщение", () => {
    /*
      Текущее письмо уже вставлено к моменту проверки. Взяв последнее, мы
      сравнили бы его с самим собой — «недавнее есть» — и уведомление не ушло бы
      никогда.
    */
    expect(SERVICE).toContain(".limit(2)");
    expect(SERVICE).toContain("recent[1]");
  });

  it("недоступный телеграм не мешает написать в поддержку", () => {
    /*
      Сообщение уже записано и человек его отправил. Отказ из-за уведомления
      означал бы, что при неполадках у нас человек не может пожаловаться —
      ровно тогда, когда это нужнее всего.
    */
    const at = SERVICE.indexOf("async function notifyPlatformAboutQuestion");
    const body = SERVICE.slice(at, SERVICE.indexOf("\n}", at));
    expect(body).toMatch(/try\s*\{/);
    expect(body).toContain("logger.warn");
    // Отправку не ждут: письмо важнее уведомления о нём.
    expect(SERVICE).toContain("void notifyPlatformAboutQuestion(");
  });

  it("в уведомление не уходит письмо целиком", () => {
    // Оно зовёт открыть переписку, а не заменяет её.
    expect(SERVICE).toContain("body.slice(0, 300)");
  });

  it("значения в шаблоне экранируются", () => {
    /*
      Название организации приходит из формы регистрации, имя — из профиля.
      Оба вводит человек, и оба уходят в HTML-разметку телеграма.
    */
    const tg = read("api/lib/telegram.ts");
    const at = tg.indexOf("supportMessage:");
    const body = tg.slice(at, tg.indexOf("newRegistration:", at));
    expect((body.match(/tgEscape\(/g) ?? []).length).toBe(3);
  });
});
