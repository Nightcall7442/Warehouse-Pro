import { describe, it, expect } from "vitest";
import {
  normalizeUzPhone, formatUzPhone, maskUzPhoneNational,
  composeSignupSource, describeSignupSource, cleanSignupTag,
} from "@contracts/signup";
import { tgMessages } from "../lib/telegram";

/**
 * Телефон с формы регистрации и «откуда узнали» — правило (contracts/signup.ts).
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * С формы приходили только название и почта; телефона не было ни у экрана, ни
 * у сервера, и позвонить новой организации было не по чему. Источник не
 * записывался вовсе.
 *
 * ── Что проверяется ─────────────────────────────────────────────────────────
 *
 * Дополнение к настоящему пути (real-db/signup-phone.test.ts): одно правило
 * на экран и сервер — какие записи номера принимаются и во что превращаются,
 * какие отвергаются; маска поля; сборка и чтение источника; шаблон
 * уведомления экранирует подставленное и даёт ссылку tel:.
 *
 * Нарочная поломка: убрать проверку первой цифры (/^[2-9]/) — падает «ноль
 * после кода»; убрать срезание 998 в маске — «вставка целиком»; пропустить
 * метку без чистки — «метка из адреса»; убрать tgEscape у названия —
 * «экранирование».
 */
describe("номер Узбекистана", () => {
  it.each([
    ["+998 90 123 45 67", "+998901234567"],
    ["+998 (90) 123-45-67", "+998901234567"],
    ["998901234567", "+998901234567"],
    ["00998901234567", "+998901234567"],
    ["90 123 45 67", "+998901234567"],
    ["901234567", "+998901234567"],
    ["+998 71 200 00 00", "+998712000000"],
    ["+998 33 555 44 33", "+998335554433"],
  ])("«%s» → %s", (raw, want) => {
    expect(normalizeUzPhone(raw)).toBe(want);
  });

  it.each([
    ["", "пусто"],
    [null, "нет значения"],
    ["12345", "мало цифр"],
    ["+7 912 345 67 89", "чужая страна"],
    ["+998 01 234 56 78", "ноль после кода"],
    ["+998 11 234 56 78", "единица после кода"],
    ["+998 90 123 45 678", "лишняя цифра"],
    ["tel 90 123 45 67", "буквы"],
  ])("«%s» — отказ (%s)", (raw: string | null, _why: string) => {
    expect(normalizeUzPhone(raw)).toBeNull();
  });

  it("для глаз — группами, чужое — как есть", () => {
    expect(formatUzPhone("+998901234567")).toBe("+998 90 123 45 67");
    expect(formatUzPhone("dir@sok.uz")).toBe("dir@sok.uz");
  });
});

describe("маска поля", () => {
  it("девять цифр группами, лишнее отрезается", () => {
    expect(maskUzPhoneNational("9")).toBe("9");
    expect(maskUzPhoneNational("901")).toBe("90 1");
    expect(maskUzPhoneNational("9012345")).toBe("90 123 45");
    expect(maskUzPhoneNational("90123456789")).toBe("90 123 45 67");
  });

  it("вставка целиком — код страны срезается, а не удваивается", () => {
    expect(maskUzPhoneNational("+998 90 123 45 67")).toBe("90 123 45 67");
    expect(maskUzPhoneNational("998901234567")).toBe("90 123 45 67");
    // Девять цифр, начинающихся на 99 8…, — это номер, а не код страны.
    expect(maskUzPhoneNational("998123456")).toBe("99 812 34 56");
  });
});

describe("откуда узнали", () => {
  it("ответ и метки — одной строкой ключ=значение; ничего — null", () => {
    expect(composeSignupSource({ answer: "telegram", utmSource: "ig_sept", ref: "bekzod" }))
      .toBe("answer=telegram; utm_source=ig_sept; ref=bekzod");
    expect(composeSignupSource({ answer: "onec" })).toBe("answer=onec");
    expect(composeSignupSource({ utmSource: "fb" })).toBe("utm_source=fb");
    expect(composeSignupSource({})).toBeNull();
    expect(composeSignupSource(undefined)).toBeNull();
    // Неизвестный ответ не записывается: список вариантов закрыт.
    expect(composeSignupSource({ answer: "hacker" })).toBeNull();
  });

  it("метка из адреса — только буквы, цифры и _.-, до 60 знаков", () => {
    expect(cleanSignupTag("ig_sept<script>alert(1)</script>")).toBe("ig_septscriptalert1script");
    expect(cleanSignupTag("  ")).toBeNull();
    expect(cleanSignupTag("x".repeat(90))).toHaveLength(60);
    expect(cleanSignupTag("реклама-2026")).toBe("реклама-2026");
  });

  it("строка из столбца — словами на двух языках", () => {
    const stored = "answer=referral; utm_source=ig_sept; ref=bekzod";
    expect(describeSignupSource(stored)).toBe("Знакомые, рекомендация · utm_source: ig_sept · ref: bekzod");
    expect(describeSignupSource(stored, "uz")).toBe("Tanishlar, tavsiya · utm_source: ig_sept · ref: bekzod");
    expect(describeSignupSource(null)).toBeNull();
  });
});

describe("уведомление о регистрации", () => {
  it("телефон ссылкой tel:, почта и источник; подставленное экранируется", () => {
    const msg = tgMessages.newRegistration({
      org: "ООО <Рога & Копыта>", email: "a@b.uz", phone: "+998901234567", source: "Telegram · ref: x",
    });
    expect(msg).toContain(`<a href="tel:+998901234567">+998 90 123 45 67</a>`);
    expect(msg).toContain("📧 a@b.uz");
    expect(msg).toContain("Откуда: Telegram · ref: x");
    expect(msg).toContain("&lt;Рога &amp; Копыта&gt;");
    expect(msg).not.toContain("<Рога");
  });

  it("запасной вид — номер текстом, без ссылки; источника нет — так и сказано", () => {
    const msg = tgMessages.newRegistration({ org: "Сок", email: "a@b.uz", phone: "+998901234567", phoneAsText: true });
    expect(msg).not.toContain("href");
    expect(msg).toContain("📞 +998901234567");
    expect(msg).toContain("Откуда: не указано");
  });
});
