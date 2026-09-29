/**
 * Регистрация с сайта: телефон владельца и «откуда узнали» — одно правило для
 * сервера и экрана.
 *
 * ── Зачем телефон ───────────────────────────────────────────────────────────
 *
 * Здесь продают звонком и показом. С формы приходили только название и почта,
 * а вход закрыт до ссылки из письма: письмо ушло в спам — клиент потерян, и
 * позвонить ему некому. Теперь номер обязателен, и владелец платформы видит его
 * в Telegram сразу, до подтверждения почты.
 *
 * ── Почему правило здесь, а не в двух местах ────────────────────────────────
 *
 * Экран проверяет номер до отправки (чтобы ответить на языке человека), сервер
 * — при приёме (форму можно обойти). Две копии правила однажды разойдутся, и
 * экран пропустит то, что сервер отвергнет, — человек увидит чужую ошибку
 * после нажатия. Одна функция — один ответ.
 */

/** Как номер хранится и сравнивается: +998 и девять цифр, без пробелов. */
export const UZ_PHONE_PREFIX = "+998";

/**
 * Номер Узбекистана к виду +998XXXXXXXXX; не номер — null.
 *
 * Принимает то, что люди набирают на самом деле: «+998 90 123-45-67»,
 * «998901234567», «(90) 123 45 67», «00998…». Девять цифр без кода страны —
 * местная запись того же номера.
 *
 * Первая цифра после кода — 2…9: коды операторов (90, 91, 33, 77, 20…) и
 * городов (71, 66, 65…). Ноль и единица там не встречаются, и «+998 012…» —
 * это опечатка, а не номер, по которому можно дозвониться.
 *
 * Буквы — отказ, даже если среди них найдутся девять цифр: «tel 90 123 45 67
 * доб. 2» — не тот номер, который наберёт телефон.
 */
export function normalizeUzPhone(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  if (!text || !/^[\d\s()+.-]+$/.test(text)) return null;
  let digits = text.replace(/\D/g, "");
  if (digits.startsWith("00998")) digits = digits.slice(2);
  const national =
    digits.length === 12 && digits.startsWith("998") ? digits.slice(3)
    : digits.length === 9 ? digits
    : null;
  if (!national || !/^[2-9]\d{8}$/.test(national)) return null;
  return UZ_PHONE_PREFIX + national;
}

/** «+998901234567» → «+998 90 123 45 67» — для глаз, не для хранения. */
export function formatUzPhone(e164: string): string {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return m ? `${UZ_PHONE_PREFIX} ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}

/**
 * Маска поля: девять цифр после +998 группами «90 123 45 67».
 *
 * Код страны стоит в поле неподвижной приставкой, человек набирает только
 * свои девять цифр. Вставили номер целиком («+998 90 123 45 67» или
 * «998901234567») — код срезается, а не удваивается.
 */
export function maskUzPhoneNational(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.length > 9 && d.startsWith("998")) d = d.slice(3);
  d = d.slice(0, 9);
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(" ");
}

/**
 * Отказ по телефону — одним текстом на двух языках.
 *
 * Сервер отвечает по-русски, как и остальные его отказы; экран узнаёт этот
 * текст и показывает его на языке человека (src/pages/Register.tsx).
 */
export const PHONE_ERROR = {
  ru: "Укажите телефон в формате +998 XX XXX XX XX — по нему мы поможем с подключением",
  uz: "Telefonni +998 XX XXX XX XX shaklida kiriting — u orqali ulanishda yordam beramiz",
} as const;

/* ═══════════════════════════════════════════════════════════════════════════
   Откуда узнали

   Заявок с лендинга за всё время ноль, организаций тринадцать — значит люди
   приходят не с рекламы сайта, а откуда-то ещё, и откуда именно, не знает
   никто. Вопрос необязательный: каждое обязательное поле отсекает часть тех,
   кто уже решился.

   Только запись источника. Никаких партнёрских начислений: «ref» — метка из
   ссылки, чтобы видеть, чья рекомендация сработала, а не обещание денег.
   ═══════════════════════════════════════════════════════════════════════════ */

export const SIGNUP_ANSWERS = ["telegram", "instagram", "referral", "onec", "search", "other"] as const;
export type SignupAnswer = (typeof SIGNUP_ANSWERS)[number];

export const SIGNUP_ANSWER_LABEL: Record<SignupAnswer, { ru: string; uz: string }> = {
  telegram:  { ru: "Telegram",                     uz: "Telegram" },
  instagram: { ru: "Instagram",                    uz: "Instagram" },
  referral:  { ru: "Знакомые, рекомендация",       uz: "Tanishlar, tavsiya" },
  onec:      { ru: "1С-интегратор или бухгалтер",  uz: "1C integratori yoki buxgalter" },
  search:    { ru: "Поиск Google или Yandex",      uz: "Google yoki Yandex qidiruvi" },
  other:     { ru: "Другое",                       uz: "Boshqa" },
};

/**
 * Метка из адреса (utm_source, ref) — только буквы, цифры, «_ . -», до 60 знаков.
 *
 * Адрес страницы набирает кто угодно; в запись и в сообщение владельцу
 * попадает только то, что похоже на метку, а не произвольный текст.
 */
export function cleanSignupTag(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim().replace(/[^\p{L}\p{N}_.-]/gu, "").slice(0, 60);
  return v || null;
}

/**
 * Источник одной строкой для столбца tenants.signup_source:
 * «answer=telegram; utm_source=ig_sept; ref=bekzod». Ничего нет — null.
 *
 * Пары «ключ=значение», а не просто значения: строку читают и глазами в
 * базе, и там должно быть видно, что человек ответил сам, а что пришло из
 * ссылки.
 */
export function composeSignupSource(src: { answer?: string | null; utmSource?: string | null; ref?: string | null } | null | undefined): string | null {
  if (!src) return null;
  const answer = (SIGNUP_ANSWERS as readonly string[]).includes(src.answer ?? "") ? src.answer : null;
  const utm = cleanSignupTag(src.utmSource);
  const ref = cleanSignupTag(src.ref);
  const parts = [
    answer ? `answer=${answer}` : null,
    utm ? `utm_source=${utm}` : null,
    ref ? `ref=${ref}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : null;
}

/** Строка из столбца — словами: «Telegram · utm_source: ig_sept · ref: bekzod». */
export function describeSignupSource(stored: string | null | undefined, lang: "ru" | "uz" = "ru"): string | null {
  if (!stored) return null;
  const parts = stored.split(";").map(p => p.trim()).filter(Boolean).map(p => {
    const at = p.indexOf("=");
    const key = at < 0 ? "" : p.slice(0, at);
    const value = at < 0 ? p : p.slice(at + 1);
    if (key === "answer") return SIGNUP_ANSWER_LABEL[value as SignupAnswer]?.[lang] ?? value;
    return key ? `${key}: ${value}` : value;
  });
  return parts.length ? parts.join(" · ") : null;
}
