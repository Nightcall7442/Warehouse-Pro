import type { ArticleKey } from "@contracts/site-pages";
import type { ArticleMeta } from "./types";

/* ═══════════════════════════════════════════════════════════════════════════
   Статьи сайта: имя, заголовок, описание и карточка ссылки каждой.

   Маленький список без самих текстов: его читают подвал лендинга и блок
   «Ещё по теме» у каждой статьи, а тексты едут только со своей страницей.
   Его же читает scripts/og-images.mjs — прямо из Node, без сборки, поэтому
   импорты здесь только типов (Node их просто отбрасывает).

   Правило слов то же, что у всего сайта: только то, что делает код. Ни
   названий конкурентов, ни выдуманных чисел, ни клиентов.
   ═══════════════════════════════════════════════════════════════════════════ */

export const ARTICLES: Record<ArticleKey, ArticleMeta> = {
  agents: {
    key: "agents",
    nav: { ru: "Программа для торговых агентов", uz: "Savdo agentlari uchun dastur" },
    title: {
      ru: "Программа для торговых агентов: заказы, визиты и GPS | Warehouse Pro",
      uz: "Savdo agentlari uchun dastur: buyurtma, tashrif va GPS | Warehouse Pro",
    },
    description: {
      ru: "Агент принимает заказ с телефона даже без сети и идёт по плану визитов, а супервайзер вечером видит по GPS, где тот был на самом деле. Пошагово, с экранами программы.",
      uz: "Agent tarmoq bo'lmasa ham telefondan buyurtma oladi va tashrif rejasi bo'yicha yuradi, supervayzer esa kechqurun GPS orqali u qayerda bo'lganini ko'radi. Dastur ekranlari bilan, bosqichma-bosqich.",
    },
    card: {
      kicker: { ru: "Статья · торговые агенты", uz: "Maqola · savdo agentlari" },
      title: { ru: "Заказ с телефона, план визитов и GPS — и без сети тоже", uz: "Telefondan buyurtma, tashrif rejasi va GPS — tarmoqsiz ham" },
      line: { ru: "Что агент делает в поле и что супервайзер видит вечером", uz: "Agent dalada nima qiladi, supervayzer kechqurun nimani ko'radi" },
    },
    published: "2026-10-21",
  },
  debts: {
    key: "debts",
    nav: { ru: "Учёт долгов магазинов", uz: "Do'kon qarzlari hisobi" },
    title: {
      ru: "Учёт долгов магазинов: лимит, стоп отгрузки, напоминания | Warehouse Pro",
      uz: "Do'kon qarzlari hisobi: limit, yuklashni to'xtatish, eslatmalar | Warehouse Pro",
    },
    description: {
      ru: "Как долг магазина складывается из заказов, оплат и возвратов, как работают кредитный лимит, остановка отгрузки при просрочке, светофор магазина и напоминания о сроке оплаты.",
      uz: "Do'kon qarzi buyurtma, to'lov va qaytarishlardan qanday yig'iladi, kredit limiti, muddati o'tganda yuklashni to'xtatish, do'kon svetofori va to'lov muddati eslatmalari qanday ishlaydi.",
    },
    card: {
      kicker: { ru: "Статья · долги магазинов", uz: "Maqola · do'kon qarzlari" },
      title: { ru: "Долг каждого магазина — из заказов, оплат и возвратов", uz: "Har bir do'kon qarzi — buyurtma, to'lov va qaytarishlardan" },
      line: { ru: "Кредитный лимит · стоп отгрузки при просрочке · светофор · напоминания", uz: "Kredit limiti · muddat o'tsa yuklash to'xtaydi · svetofor · eslatmalar" },
    },
    published: "2026-10-21",
  },
  reconciliation: {
    key: "reconciliation",
    nav: { ru: "Акт сверки с магазином", uz: "Do'kon bilan solishtirma dalolatnoma" },
    title: {
      ru: "Акт сверки с магазином: как он строится и печатается | Warehouse Pro",
      uz: "Do'kon bilan solishtirma dalolatnoma: tuzish va chop etish | Warehouse Pro",
    },
    description: {
      ru: "Акт сверки взаиморасчётов с магазином за любой период: откуда берутся строки, как читать сальдо и обороты, как напечатать акт на подпись или выгрузить его в Excel.",
      uz: "Do'kon bilan istalgan davr uchun o'zaro hisob-kitob solishtirma dalolatnomasi: qatorlar qayerdan olinadi, saldo va aylanma qanday o'qiladi, imzoga chop etish va Excelga yuklash.",
    },
    card: {
      kicker: { ru: "Статья · акт сверки", uz: "Maqola · solishtirma dalolatnoma" },
      title: { ru: "Акт сверки с магазином — за любой период, на печать и в Excel", uz: "Do'kon bilan solishtirma dalolatnoma — istalgan davr, chop etish va Excel" },
      line: { ru: "Сальдо, обороты и каждая отгрузка, оплата и возврат — строкой", uz: "Saldo, aylanma va har bir jo'natish, to'lov va qaytarish — qatorma-qator" },
    },
    published: "2026-10-21",
  },
  delivery: {
    key: "delivery",
    nav: { ru: "Доставка и деньги курьера", uz: "Yetkazish va kuryer puli" },
    title: {
      ru: "Доставка и деньги курьера: частичная оплата, возврат, недостача | Warehouse Pro",
      uz: "Yetkazish va kuryer puli: qisman to'lov, qaytarish, kamomad | Warehouse Pro",
    },
    description: {
      ru: "Как назначить курьера, закрыть доставку с частичной оплатой или возвратом, принять наличные в офисе, увидеть недостачу и деньги на руках и дать магазину подтвердить заказ по QR.",
      uz: "Kuryerni tayinlash, yetkazishni qisman to'lov yoki qaytarish bilan yopish, ofisda naqd pulni qabul qilish, kamomad va qo'ldagi pulni ko'rish hamda buyurtmani do'konga QR orqali tasdiqlatish.",
    },
    card: {
      kicker: { ru: "Статья · доставка", uz: "Maqola · yetkazish" },
      title: { ru: "Доставка и деньги курьера — до последнего сума", uz: "Yetkazish va kuryer puli — oxirgi so'mgacha" },
      line: { ru: "Частичная оплата и возврат · расчёт в офисе · недостача · QR для магазина", uz: "Qisman to'lov va qaytarish · ofisda hisob-kitob · kamomad · do'kon uchun QR" },
    },
    published: "2026-10-21",
  },
  warehouse: {
    key: "warehouse",
    nav: { ru: "Склад дистрибьютора без сложной WMS", uz: "Murakkab WMS tizimisiz distribyutor ombori" },
    title: {
      ru: "Склад дистрибьютора без сложной WMS: остатки, сроки, дозаказ | Warehouse Pro",
      uz: "Murakkab WMS tizimisiz distribyutor ombori: qoldiq, muddat, qayta buyurtma | Warehouse Pro",
    },
    description: {
      ru: "Остатки и резерв под заказы, партии со сроком годности и отгрузка по FEFO, дозаказ по продажам, инвентаризация и перемещения между складами — без адресного хранения и сканеров.",
      uz: "Buyurtmalar uchun qoldiq va zahira, yaroqlilik muddatli partiyalar va FEFO bo'yicha jo'natish, sotuvga qarab qayta buyurtma, inventarizatsiya va omborlar orasida ko'chirish — manzilli saqlashsiz.",
    },
    card: {
      kicker: { ru: "Статья · склад", uz: "Maqola · ombor" },
      title: { ru: "Склад дистрибьютора без сложной WMS", uz: "Murakkab WMS tizimisiz distribyutor ombori" },
      line: { ru: "Остаток и резерв · сроки и FEFO · дозаказ · инвентаризация · перемещения", uz: "Qoldiq va zahira · muddat va FEFO · qayta buyurtma · inventarizatsiya · ko'chirish" },
    },
    published: "2026-10-21",
  },
};
