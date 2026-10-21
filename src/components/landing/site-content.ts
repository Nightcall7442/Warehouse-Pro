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
import { FIELD_PRICE_UZS, MIN_FIELD_USERS, formatSum } from "@contracts/pricing";
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

/* ── Как начать ───────────────────────────────────────────────────────────── */

const PRICE = formatSum(FIELD_PRICE_UZS);

/**
 * От регистрации до решения — по шагам и со временем на каждый.
 *
 * Время — то, что занимает сам шаг в программе, а не обещание срока:
 * регистрация — одна форма; «склад и команда» — мастер первого входа из трёх
 * шагов (Onboarding: склад, первый товар, приглашения); товары и магазины —
 * загрузка Excel по шаблону (import-router), перенос из 1С — услуга по
 * запросу (SERVICE_FEATURES), поэтому «несколько дней», а не часы.
 *
 * Тот же список показывает сравнение (/compare, глава «Как перейти»).
 */
export const START_STEPS: Array<{ t: L; time: L; d: L }> = [
  {
    t: { ru: "Регистрация", uz: "Ro'yxatdan o'tish" },
    time: { ru: "5 минут", uz: "5 daqiqa" },
    d: {
      ru: "Компания, имя, почта, телефон и пароль. Без карты и без звонка; вход откроется по ссылке из письма.",
      uz: "Kompaniya, ism, pochta, telefon va parol. Kartasiz va qo'ng'iroqsiz; kirish xatdagi havola orqali ochiladi.",
    },
  },
  {
    t: { ru: "Склад и команда", uz: "Ombor va jamoa" },
    time: { ru: "10 минут", uz: "10 daqiqa" },
    d: {
      ru: "Мастер первого входа: склад, первый товар и приглашения агентам и курьерам.",
      uz: "Birinchi kirish ustasi: ombor, birinchi tovar va agent hamda kuryerlarga taklifnomalar.",
    },
  },
  {
    t: { ru: "Товары и магазины", uz: "Tovarlar va do'konlar" },
    time: { ru: "в тот же день", uz: "o'sha kuni" },
    d: {
      ru: "Из Excel по нашему шаблону — сами, вместе с начальными остатками. Перенос из 1С или ваших файлов сделаем мы — это несколько дней.",
      uz: "Excel'dan bizning shablon bo'yicha — o'zingiz, boshlang'ich qoldiqlar bilan. 1C yoki fayllaringizdan ko'chirishni biz qilamiz — bu bir necha kun.",
    },
  },
  {
    t: { ru: "Первые рейсы", uz: "Birinchi reyslar" },
    time: { ru: "1–2 недели", uz: "1–2 hafta" },
    d: {
      ru: "Агенты берут заказы с телефона, склад собирает, курьеры везут и отмечают оплату. Вечером видно, что доставлено, что оплачено и кто должен.",
      uz: "Agentlar telefondan buyurtma oladi, ombor yig'adi, kuryerlar yetkazadi va to'lovni belgilaydi. Kechqurun nima yetkazilgani, nima to'langani va kim qarzdorligi ko'rinadi.",
    },
  },
  {
    t: { ru: "Решение", uz: "Qaror" },
    time: { ru: "к 14-му дню", uz: "14-kungacha" },
    d: {
      ru: `Остаётесь — ${PRICE} сум в месяц за каждого человека в поле, офис бесплатно. Нет — ничего не спишется: вход закроется, данные останутся.`,
      uz: `Qolsangiz — daladagi har bir kishi uchun oyiga ${PRICE} so'm, ofis bepul. Yo'q bo'lsa — hech narsa yechilmaydi: kirish yopiladi, ma'lumotlar qoladi.`,
    },
  },
];

/** С какого числа агентов предлагаем начать с пилота, а не со всех сразу. */
export const PILOT_MIN_AGENTS = 10;

/**
 * Пилот для крупного дистрибьютора: одна команда, две недели внутри
 * бесплатного периода, и три мерила — из самой программы, а не из
 * впечатлений: план визитов против сделанных (дневные планы, KPI), долги
 * в срок (условия оплаты, просрочка), наличные (недостачи при расчёте и
 * деньги на руках — «Контроль»).
 */
export const PILOT: { title: L; lead: L; criteria: Array<{ t: L; d: L }> } = {
  title: {
    ru: `Пилот — для дистрибьюторов от ${PILOT_MIN_AGENTS} агентов`,
    uz: `Sinov — ${PILOT_MIN_AGENTS} va undan ko'p agentli distribyutorlar uchun`,
  },
  lead: {
    ru: "Всех сразу не переводим. Одна команда — супервайзер и его агенты — две недели работает в программе внутри бесплатного периода, остальные пока по-старому. В конце смотрим три цифры из самой программы:",
    uz: "Hammani birdaniga o'tkazmaymiz. Bitta jamoa — supervayzer va uning agentlari — bepul davr ichida ikki hafta dasturda ishlaydi, qolganlar hozircha eskicha. Oxirida dasturning o'zidan uchta raqamni ko'ramiz:",
  },
  criteria: [
    {
      t: { ru: "Визиты", uz: "Tashriflar" },
      d: { ru: "сколько точек из плана агенты действительно посетили", uz: "agentlar rejadagi nuqtalardan qanchasiga haqiqatan borgani" },
    },
    {
      t: { ru: "Долги", uz: "Qarzlar" },
      d: { ru: "сколько магазинов заплатили в срок", uz: "qancha do'kon o'z vaqtida to'lagani" },
    },
    {
      t: { ru: "Наличные", uz: "Naqd pul" },
      d: { ru: "недостачи при расчёте заказов и деньги, которые дольше суток на руках", uz: "buyurtmalar hisob-kitobidagi kamomadlar va bir kundan ortiq qo'lda turgan pul" },
    },
  ],
};

/* ── Вопросы до покупки ───────────────────────────────────────────────────── */

/**
 * FAQ — реальные возражения, а не декоративные вопросы. Жил внутри
 * Landing.tsx; здесь — чтобы его могли показать и другие страницы сайта и
 * чтобы ответы сверялись с остальными словами одного файла.
 *
 * Ответы держатся кода: обмен с 1С — как в services/onec-sync (из 1С —
 * товары, единицы и цены; в 1С — доставленные заказы и, если включено,
 * оплаты; остатки — только если 1С присылает их сама, webhooks/onec);
 * журнал — ключевые денежные и складские правки (audit-covers-money-paths),
 * а не «все действия»; копия базы — каждую ночь (cron/scheduler, backup).
 */
export const FAQ_ITEMS: Array<{ q: L; a: L }> = [
  {
    q: { ru: "Работает ли обмен с 1С:Предприятие?", uz: "1C:Predpriyatiye bilan almashinuv ishlaydimi?" },
    a: {
      ru: "Да, по расписанию через OData: из 1С приходят товары, единицы и цены, в 1С уходят доставленные заказы — реализацией по довезённому — и, если включить, оплаты. Остатки приходят, если 1С сама присылает их нам. При подключении помогаем настроить обмен.",
      uz: "Ha, jadval bo'yicha OData orqali: 1C'dan tovarlar, birliklar va narxlar keladi, 1C'ga yetkazilgan buyurtmalar — yetkazilgani bo'yicha realizatsiya — va, yoqilsa, to'lovlar ketadi. Qoldiqlar 1C ning o'zi bizga yuborsa keladi. Ulanishda almashinuvni sozlashga yordam beramiz.",
    },
  },
  {
    q: { ru: "Агенты не дружат с программами — справятся?", uz: "Agentlar dastur bilan chiqisha olmaydi — uddalay oladimi?" },
    a: {
      // Без обещания переноса данных всем: это услуга по запросу
      // (SERVICE_FEATURES), и FAQ противоречил бы прайсу двумя экранами выше.
      ru: "У агента три экрана: план визитов, заказ, долги точки. На освоение уходит один день. Обучение команды и разбор первых заказов входят в подключение.",
      uz: "Agentda uchta ekran bor: tashriflar rejasi, buyurtma, nuqta qarzlari. O'rganishga bir kun ketadi. Jamoani o'qitish va birinchi buyurtmalarni birga ko'rib chiqish ulanishga kiradi.",
    },
  },
  {
    q: { ru: "Что будет в точках, где нет интернета?", uz: "Internet yo'q nuqtalarda nima bo'ladi?" },
    a: {
      ru: "Мобильное приложение работает офлайн: заказы, визиты и фото сохраняются на телефоне и уходят на сервер, как только появляется сеть.",
      uz: "Mobil ilova oflayn ishlaydi: buyurtmalar, tashriflar va suratlar telefonda saqlanadi va tarmoq paydo bo'lishi bilan serverga jo'naydi.",
    },
  },
  {
    q: { ru: "Сколько времени занимает запуск?", uz: "Ishga tushirish qancha vaqt oladi?" },
    a: {
      ru: "Регистрация — 5 минут, склад и команда — ещё 10. Товары и магазины из Excel по нашему шаблону — сами, в тот же день. Перенос остатков и справочников из 1С или ваших файлов — услуга по запросу, занимает несколько дней.",
      uz: "Ro'yxatdan o'tish — 5 daqiqa, ombor va jamoa — yana 10. Tovarlar va do'konlar Excel'dan bizning shablon bo'yicha — o'zingiz, o'sha kuni. Qoldiq va ma'lumotnomalarni 1C yoki fayllaringizdan ko'chirish — so'rov bo'yicha xizmat, bir necha kun oladi.",
    },
  },
  {
    q: { ru: "Что случится после 14 бесплатных дней?", uz: "14 kunlik bepul sinovdan keyin nima bo'ladi?" },
    a: {
      ru: "Ничего не спишется — карта не привязана. Оставляете заявку и платите только за полевых сотрудников; все данные, введённые за пробный период, сохраняются. Не оплатили — вход закроется, данные останутся.",
      uz: "Hech narsa yechilmaydi — karta bog'lanmagan. Ariza qoldirasiz va faqat dala xodimlari uchun to'laysiz; sinov davrida kiritilgan barcha ma'lumotlar saqlanadi. To'lamasangiz — kirish yopiladi, ma'lumotlar qoladi.",
    },
  },
  {
    q: { ru: "Насколько защищены мои данные?", uz: "Ma'lumotlarim qanchalik himoyalangan?" },
    a: {
      ru: "Каждая компания изолирована от других, доступ — по ролям, правки цен, оплат, кредитных лимитов и остатков пишутся в журнал, копия базы делается каждую ночь.",
      uz: "Har bir kompaniya boshqalardan izolyatsiyalangan, kirish rollar bo'yicha, narx, to'lov, kredit limiti va qoldiq o'zgarishlari jurnalga yoziladi, bazaning nusxasi har kecha olinadi.",
    },
  },
];
