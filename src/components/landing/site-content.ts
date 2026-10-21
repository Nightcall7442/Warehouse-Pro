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

/* ── Обещания, которые можно проверить ────────────────────────────────────── */

/**
 * Что программа делает всегда — и как убедиться в этом за пробные 14 дней.
 *
 * Каждое обещание держится кодом, а не словом; рядом — где именно, чтобы при
 * правке было видно, что ломается вместе с ним:
 *
 *   offline  — заказ с ключом идемпотентности (uq_orders_idempotency,
 *              services/order-create): повтор той же отправки возвращает
 *              уже созданный заказ, а не второй;
 *   accepted — частичная доставка: долг и остаток считаются по принятому
 *              (services/order-close, stock-ledger.shipStock);
 *   reserve  — заказ берёт строки остатка под замок (FOR UPDATE) и
 *              резервирует; не хватает свободного — отказ с названием товара
 *              и числом на складе (services/order-create);
 *   journal  — цена, лимит, оплата, корректировка остатка пишутся в журнал
 *              с прежним и новым значением (audit-covers-money-paths.test);
 *   cost     — закупочная цена и маржа агенту не отдаются сервером
 *              (cost-price-exposure.test).
 */
export const PROMISES: Array<{ key: string; t: L; d: L; check: L }> = [
  {
    key: "offline",
    t: { ru: "Заказ без интернета не потеряется и не задвоится", uz: "Internetsiz buyurtma yo'qolmaydi va ikkilanmaydi" },
    d: {
      ru: "Заказ, оформленный без сети, ждёт в телефоне и уходит, когда сеть появится. Повторная отправка того же заказа второго не создаёт.",
      uz: "Tarmoqsiz rasmiylashtirilgan buyurtma telefonda kutadi va tarmoq paydo bo'lganda jo'naydi. Shu buyurtmani qayta yuborish ikkinchisini yaratmaydi.",
    },
    check: {
      ru: "Включите на телефоне агента режим полёта, оформите заказ, выключите режим — в офисе появится один заказ, а не два.",
      uz: "Agent telefonida parvoz rejimini yoqing, buyurtma bering, rejimni o'chiring — ofisda ikkita emas, bitta buyurtma paydo bo'ladi.",
    },
  },
  {
    key: "accepted",
    t: { ru: "Долг — по тому, что магазин принял", uz: "Qarz — do'kon qabul qilgan narsa bo'yicha" },
    d: {
      ru: "Курьер отмечает, сколько принято. Долг магазина и остаток на складе пересчитываются по факту, а не по заказу.",
      uz: "Kuryer qancha qabul qilinganini belgilaydi. Do'kon qarzi va ombordagi qoldiq buyurtma bo'yicha emas, fakt bo'yicha qayta hisoblanadi.",
    },
    check: {
      ru: "Оформите заказ на 10 штук, при доставке отметьте 8 — долг магазина будет за 8, две штуки останутся на складе.",
      uz: "10 donaga buyurtma bering, yetkazishda 8 tasini belgilang — do'kon qarzi 8 ta uchun bo'ladi, ikki dona omborda qoladi.",
    },
  },
  {
    key: "reserve",
    t: { ru: "Последний ящик не продать дважды", uz: "Oxirgi qutini ikki marta sotib bo'lmaydi" },
    d: {
      ru: "Заказ резервирует товар. Два агента не продадут один и тот же остаток: второй увидит, сколько осталось на складе.",
      uz: "Buyurtma tovarni zaxiraga oladi. Ikki agent bitta qoldiqni sota olmaydi: ikkinchisi omborda qancha qolganini ko'radi.",
    },
    check: {
      ru: "Заведите товар с остатком 5 и оформите два заказа по 4 — второй не пройдёт, и программа назовёт товар и свободный остаток.",
      uz: "Qoldig'i 5 ta tovar kiriting va 4 tadan ikkita buyurtma bering — ikkinchisi o'tmaydi, dastur tovar va bo'sh qoldiqni aytadi.",
    },
  },
  {
    key: "journal",
    t: { ru: "Цена, оплата и лимит не меняются бесследно", uz: "Narx, to'lov va limit izsiz o'zgarmaydi" },
    d: {
      ru: "Правка цены товара, кредитного лимита магазина, приём и отмена оплаты, корректировка остатка — в журнале: кто, когда, что было и что стало.",
      uz: "Tovar narxini, do'kon kredit limitini o'zgartirish, to'lovni qabul qilish va bekor qilish, qoldiqni tuzatish — jurnalda: kim, qachon, nima edi va nima bo'ldi.",
    },
    check: {
      ru: "Поменяйте цену любого товара и откройте «Журнал действий» — там ваша правка и прежняя цена.",
      uz: "Istalgan tovar narxini o'zgartiring va «Harakatlar jurnali»ni oching — u yerda sizning tuzatishingiz va oldingi narx.",
    },
  },
  {
    key: "cost",
    t: { ru: "Агент не видит закупочную цену и маржу", uz: "Agent xarid narxi va marjani ko'rmaydi" },
    d: {
      ru: "Сервер не отдаёт их агенту вовсе, а не прячет на экране: ни в каталоге, ни в отчётах, ни через приложение.",
      uz: "Server ularni agentga umuman bermaydi, ekranda yashirmaydi: katalogda ham, hisobotlarda ham, ilova orqali ham.",
    },
    check: {
      ru: "Пригласите сотрудника агентом и зайдите под ним — в каталоге нет закупочной цены, а отчёта о прибыли нет в меню.",
      uz: "Xodimni agent sifatida taklif qiling va uning nomidan kiring — katalogda xarid narxi yo'q, foyda hisoboti esa menyuda yo'q.",
    },
  },
];
