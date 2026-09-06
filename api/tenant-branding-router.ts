import { z } from "zod";
import { createRouter, authedQuery, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { tenantBranding } from "@db/schema";
import { eq } from "drizzle-orm";
import { cache, withCache, CacheKeys, CacheTTL } from "./lib/cache";
import { sanitizeString } from "./lib/sanitize";
import { isSafePhotoValue, PHOTO_VALUE_ERROR } from "./lib/photo-value";
// Пределы длины — там же, где объяснено, откуда они взялись: это ёмкость
// столбца, а не пожелание к качеству. Клиент жмёт под те же числа.
import { LOGO_MAX_CHARS, FAVICON_MAX_CHARS } from "@contracts/image-limits";

/*
  Брендинг — то, КАК приложение выглядит: знак, цвета, название, тексты входа.

  Реквизиты организации — имя на накладной, ИНН, адрес, банк, директор —
  живут в таблице settings и правятся в разделе «Компания». Здесь их нет
  намеренно: одно и то же имя в двух местах расходится в тот же день, когда
  его заполнили дважды. Столбцы company_name, inn и legal_address остались в
  таблице от прежнего замысла и не читаются и не пишутся — трогать боевую
  базу ради их удаления не стоит.

  Столбец custom_domain тоже не заполняется: разбора домена в запрос нет
  нигде (арендатор определяется по токену), и предлагать поле, которое ни на
  что не влияет, — обман. Появится разбор домена — появится и поле.
*/

/** Пустое поле формы означает «не задано», а не строку нулевой длины. */
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const optionalText = (max: number, what: string) =>
  z.preprocess(blank, z.string().max(max, `${what}: слишком длинно, максимум ${max} символов`).nullable().optional());

const optionalColor = z.preprocess(
  blank,
  z.string().regex(/^#[0-9a-fA-F]{6}$/, "Цвет задаётся в виде #rrggbb").nullable().optional(),
);


const optionalImage = (max: number, what: string) =>
  z.preprocess(
    blank,
    z.string()
      .max(max, `${what}: изображение слишком большое, выберите файл поменьше`)
      // Тот же разбор, что у всех остальных картинок проекта: только
      // настоящие типы изображений и только https для ссылок. isSafeUrl
      // мягче — он пропускает любой data:image/…, включая svg со скриптом.
      .refine(isSafePhotoValue, `${what}: ${PHOTO_VALUE_ERROR}`)
      .nullable()
      .optional(),
  );

/**
 * Что арендатор вправе задать.
 *
 * Список один и тот же для проверки и для записи: раньше схема принимала
 * четырнадцать полей, а запись собиралась руками из восьми — шесть значений
 * (значок, заголовок и подзаголовок входа, текст подвала, домен, тема
 * мобильного) молча пропадали, и арендатор получал зелёное «Брендинг
 * сохранён» на пустоту. Теперь запись строится по ключам этой схемы, и
 * забыть новое поле нельзя.
 */
const brandingInput = z.object({
  logoUrl:        optionalImage(LOGO_MAX_CHARS, "Логотип"),
  faviconUrl:     optionalImage(FAVICON_MAX_CHARS, "Значок вкладки"),
  primaryColor:   optionalColor,
  secondaryColor: optionalColor,
  appName:        optionalText(255, "Название приложения"),
  supportEmail:   z.preprocess(blank, z.string().email("Почта поддержки указана неверно").max(320).nullable().optional()),
  supportPhone:   optionalText(50, "Телефон поддержки"),
  loginTitle:     optionalText(100, "Заголовок на входе"),
  loginSubtitle:  optionalText(255, "Подзаголовок на входе"),
  footerText:     optionalText(500, "Текст в подвале"),
  mobileTheme:    z.enum(["light", "dark", "auto"]).optional(),
});

/**
 * Имена полей — одним списком, из схемы.
 *
 * И запись, и проверка берут его отсюда: разойтись им негде.
 */
export const brandingInputShape = Object.keys(brandingInput.shape);

/** Поля, набранные человеком: у них снимается разметка и лишние пробелы. */
const TYPED_FIELDS = new Set([
  "appName", "supportPhone", "loginTitle", "loginSubtitle", "footerText",
]);

/** То, что видит клиент, когда арендатор ничего не настраивал. */
const NOTHING_SET = {
  primaryColor:   null,
  secondaryColor: null,
  logoUrl:        null,
  faviconUrl:     null,
  appName:        null,
  supportEmail:   null,
  supportPhone:   null,
  loginTitle:     null,
  loginSubtitle:  null,
  footerText:     null,
  mobileTheme:    "auto" as const,
};

export const tenantBrandingRouter = createRouter({
  /** Бренд текущего арендатора (с кэшом). */
  get: authedQuery.query(async ({ ctx }) => {
    return withCache(CacheKeys.tenantBranding(ctx.tenant.id), CacheTTL.branding, async () => {
      const db = getDb();
      const [row] = await db.select().from(tenantBranding)
        .where(eq(tenantBranding.tenantId, ctx.tenant.id)).limit(1);

      if (!row) return NOTHING_SET;

      /*
        Не выбрал цвет — значит, цвета нет. Не подставляем.

        Здесь возвращались «#5b6d8a» и «#4a5c78» — цвета СВЕТЛОЙ темы. Клиент
        (useBranding) принимал их за выбор арендатора и вписывал прямо в
        <html>, а inline-стиль перебивает любое правило таблицы, включая блок
        .dark. Латунный акцент тёмной темы не видел никто, кроме тех, кто
        задал свой цвет вручную.

        Пустое значение клиент понимает правильно: снимает переменные и
        отдаёт выбор таблице, а у неё цвет объявлен и для светлой темы, и для
        тёмной. Экран настроек показывает свои DEFAULTS, так что выбирать
        по-прежнему есть из чего.
      */
      return {
        primaryColor:   row.primaryColor,
        secondaryColor: row.secondaryColor,
        logoUrl:        row.logoUrl,
        faviconUrl:     row.faviconUrl,
        appName:        row.appName,
        supportEmail:   row.supportEmail,
        supportPhone:   row.supportPhone,
        loginTitle:     row.loginTitle,
        loginSubtitle:  row.loginSubtitle,
        footerText:     row.footerText,
        mobileTheme:    row.mobileTheme ?? "auto",
      };
    });
  }),

  /** Правка бренда — право владельца. */
  update: adminQuery
    .input(brandingInput)
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const tenantId = ctx.tenant.id;

      // Запись идёт по ключам схемы, а не по переписанному от руки списку.
      const data: Record<string, unknown> = {};
      for (const key of brandingInputShape as (keyof typeof input)[]) {
        const value = input[key];
        if (value === undefined) continue;
        data[key] = typeof value === "string" && TYPED_FIELDS.has(key)
          ? sanitizeString(value)
          : value;
      }

      const [existing] = await db.select({ id: tenantBranding.id }).from(tenantBranding)
        .where(eq(tenantBranding.tenantId, tenantId)).limit(1);

      if (existing) {
        await db.update(tenantBranding).set({ ...data, updatedAt: new Date() })
          .where(eq(tenantBranding.tenantId, tenantId));
      } else {
        await db.insert(tenantBranding).values({ tenantId, ...data });
      }

      cache.invalidate(CacheKeys.tenantBranding(tenantId));

      return { success: true };
    }),
});
