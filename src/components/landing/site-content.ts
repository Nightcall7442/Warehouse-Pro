/* ═══════════════════════════════════════════════════════════════════════════
   Слова сайта, которые стоят больше чем в одном месте: лендинг (/ и /uz),
   сравнение (/compare), позже — служебные страницы.

   ── Зачем один файл ─────────────────────────────────────────────────────────

   «Как начать» стояло на сравнении четырьмя шагами, на лендинге шагов не
   было вовсе, а FAQ жил внутри страницы. Когда одна и та же мысль написана в
   двух местах, однажды её поправят в одном — и сайт начнёт спорить сам с
   собой: на одной странице «пилот с двумя-тремя агентами», на другой — с
   одной командой. Здесь каждая такая мысль записана один раз, на двух
   языках, а страницы её только показывают.

   ── Правило, по которому написано ──────────────────────────────────────────

   Только то, что делает код или что можно проверить за 14 бесплатных дней.
   Ни выдуманных клиентов, ни отзывов, ни сроков ответа поддержки. Цена и
   минимум людей — из contracts/pricing, а не числом в тексте.
   ═══════════════════════════════════════════════════════════════════════════ */
import { MIN_FIELD_USERS } from "@contracts/pricing";
import type { L } from "@/components/pitch/pitch-content";

/* ── Для кого ─────────────────────────────────────────────────────────────── */

/**
 * Кому подойдём: четыре признака дистрибьютора, под которого программа
 * сделана. key — то, что человек сверяет с собой за секунду (число или
 * короткое слово), t — что это, d — почему это про нас.
 */
export const AUDIENCE_FIT: Array<{ key: L; t: L; d: L }> = [
  {
    key: { ru: `${MIN_FIELD_USERS}–50`, uz: `${MIN_FIELD_USERS}–50` },
    t: { ru: "агентов и курьеров в поле", uz: "dalada agent va kuryerlar" },
    d: {
      ru: "Агенты берут заказы в магазинах с телефона, курьеры развозят и принимают оплату. Больше пятидесяти — запускаем по командам, начиная с пилота.",
      uz: "Agentlar do'konlarda telefondan buyurtma oladi, kuryerlar yetkazadi va to'lov oladi. Ellikdan ko'p bo'lsa — jamoalab, sinovdan boshlab ishga tushiramiz.",
    },
  },
  {
    key: { ru: "100+", uz: "100+" },
    t: { ru: "магазинов в базе", uz: "bazada do'konlar" },
    d: {
      ru: "Сотни точек, у каждой свои цены, свой день визита и свой долг. Это первое, что расходится в тетради и в Excel.",
      uz: "Yuzlab nuqta, har birining o'z narxi, o'z tashrif kuni va o'z qarzi bor. Daftar va Excelda birinchi bo'lib chalkashadigan narsa shu.",
    },
  },
  {
    key: { ru: "в долг", uz: "nasiya" },
    t: { ru: "продаёте с отсрочкой", uz: "kechiktirib sotasiz" },
    d: {
      ru: "Магазины платят позже, частями, иногда не всё. Долг каждой точки считается по каждому заказу и по тому, что магазин принял на самом деле.",
      uz: "Do'konlar keyinroq, qismlarga bo'lib, ba'zan to'liq bo'lmagan holda to'laydi. Har bir nuqtaning qarzi har bir buyurtma va do'kon aslida qabul qilgan narsa bo'yicha hisoblanadi.",
    },
  },
  {
    key: { ru: "1–3", uz: "1–3" },
    t: { ru: "склада", uz: "ombor" },
    d: {
      ru: "Остатки, резерв под заказы, партии со сроками годности и перемещения между складами.",
      uz: "Qoldiqlar, buyurtmalar uchun zaxira, yaroqlilik muddatli partiyalar va omborlar orasida ko'chirish.",
    },
  },
];

/**
 * Кому не подойдём — честно и до покупки. Каждая строка — то, чего в коде
 * нет: адресов ячеек и работы с ТСД, учёта чужого товара за плату, кодов
 * маркировки, кассы с фискальным чеком.
 */
export const AUDIENCE_NOT_FIT: Array<{ t: L; d: L }> = [
  {
    t: { ru: "Адресное хранение со сканерами ТСД", uz: "TSD skanerlari bilan manzilli saqlash" },
    d: {
      ru: "Ячейки, стеллажи и сборка по терминалу сбора данных — это WMS. У нас склад — остатки, партии и резерв, без адресов ячеек.",
      uz: "Yacheykalar, stellajlar va ma'lumot yig'ish terminali bo'yicha yig'ish — bu WMS. Bizda ombor — qoldiqlar, partiyalar va zaxira, yacheyka manzillarisiz.",
    },
  },
  {
    t: { ru: "Склад для чужого товара (3PL)", uz: "Begona tovar uchun ombor (3PL)" },
    d: {
      ru: "Хранение и доставка за плату для нескольких владельцев товара, счета клиентам склада. Мы считаем ваш товар и ваши деньги.",
      uz: "Bir nechta tovar egasi uchun pullik saqlash va yetkazish, ombor mijozlariga hisoblar. Biz sizning tovaringiz va pulingizni hisoblaymiz.",
    },
  },
  {
    t: { ru: "Фармацевтика и маркировка «Asl Belgisi»", uz: "Farmatsevtika va «Asl Belgisi» markirovkasi" },
    d: {
      ru: "Проверки и выбытия кодов маркировки в программе пока нет — это в планах, а не в продукте.",
      uz: "Markirovka kodlarini tekshirish va chiqarish dasturda hozircha yo'q — bu rejada, mahsulotda emas.",
    },
  },
  {
    t: { ru: "Розница с кассой", uz: "Kassali chakana savdo" },
    d: {
      ru: "Продажа покупателю через кассу, фискальный чек, смены кассира — это кассовая программа. Мы работаем между дистрибьютором и магазином.",
      uz: "Xaridorga kassa orqali sotish, fiskal chek, kassir smenalari — bu kassa dasturi. Biz distribyutor va do'kon o'rtasida ishlaymiz.",
    },
  },
];
