/**
 * Тексты и данные страниц конкурса Pitch Day 3.0 — /pitch и /demo.
 *
 * Правило страницы то же, что у лендинга: НИ ОДНОГО ВЫДУМАННОГО ЧИСЛА.
 * Каждое число здесь проверяемо — откуда оно, написано рядом. До 09.10.2026
 * числа клиентов не было (решение владельца 05.10); 09.10 он решил показать
 * их — главный вопрос жюри «сколько у вас клиентов и что они платят» иначе
 * оставался без ответа. См. TRACTION.
 *
 * Язык — парой { uz, ru }: узбекский первым, его читает жюри.
 */
export type L = { uz: string; ru: string };
export const pick = (lang: "uz" | "ru", l: L) => (lang === "uz" ? l.uz : l.ru);

/* ── Команда ────────────────────────────────────────────────────────────────
   Ответ владельца 05.10.2026: команда — один человек. Возраст, а не дата
   рождения. Ни почты, ни телефона. Telegram — пустой слот: ссылка не
   рисуется, пока его не впишут.
   TODO(владелец): фото — положить в public/pitch/team-bobur.webp и вписать
   photo; Telegram — вписать адрес t.me/… в links. */
export interface TeamMember {
  name: L;
  age: L;
  role: L;
  scope: L;
  background: L;
  skills: string[];
  photo?: string;
  links: Array<{ label: string; href: string | null }>;
}

export const TEAM: TeamMember[] = [
  {
    name: { uz: "Bobur Yusupov", ru: "Бобур Юсупов" },
    age: { uz: "27 yosh", ru: "27 лет" },
    role: { uz: "Asoschi, full-stack muhandis", ru: "Основатель, full-stack инженер" },
    scope: { uz: "Mahsulot, veb, mobil ilova, backend, DevOps", ru: "Продукт, веб, мобильное приложение, бэкенд, DevOps" },
    background: {
      uz: "1 yildan beri distribyutsiya sohasi muammolari ustida ishlaydi.",
      ru: "Год работает над задачами дистрибуции.",
    },
    skills: [
      "React", "TypeScript", "tRPC / Hono", "MySQL / drizzle", "Expo / React Native",
      "Railway", "Sentry", "Vitest / Playwright", "1C OData",
    ],
    photo: undefined,
    links: [
      { label: "github.com/Nightcall7442", href: "https://github.com/Nightcall7442" },
      { label: "Warehouse-Pro", href: "https://github.com/Nightcall7442/Warehouse-Pro" },
      { label: "Warehouse-Pro-Mobile", href: "https://github.com/Nightcall7442/Warehouse-Pro-Mobile" },
      { label: "warehouse-pro.uz", href: "https://www.warehouse-pro.uz" },
      // Telegram: пусто — не рисуется. Вписать "https://t.me/…".
      { label: "Telegram", href: null },
    ],
  },
];

/* ── План найма ─────────────────────────────────────────────────────────────
   Вопрос жюри к команде из одного человека: «кто продаёт и внедряет?».
   Порядок — по тому, что сейчас упирается: каждый новый дистрибьютор — это
   перенос справочников и обучение агентов, и это делает основатель. */
export const HIRING: Array<{ role: L; why: L }> = [
  {
    role: { uz: "Joriy etish va qo'llab-quvvatlash mutaxassisi", ru: "Специалист по внедрению и поддержке" },
    why: {
      uz: "Birinchi: yangi distribyutorning ma'lumotlarini ko'chiradi, agentlar va ofisni o'qitadi, savollarga javob beradi — asoschi mahsulotga qaytadi.",
      ru: "Первым: переносит данные нового дистрибьютора, обучает агентов и офис, отвечает на вопросы — основатель возвращается к продукту.",
    },
  },
  {
    role: { uz: "Savdo menejeri", ru: "Менеджер по продажам" },
    why: {
      uz: "Ikkinchi: distribyutorlar bilan uchrashuvlar, demo va sinov muddatidan pullik tarifga o'tkazish.",
      ru: "Вторым: встречи с дистрибьюторами, показы и перевод с пробного периода на платный.",
    },
  },
];

/* ── Рынок и конкуренты ─────────────────────────────────────────────────────
   Только проверяемое и со ссылкой. Про чужие продукты — что они такое, без
   оценок «у них нет»: их возможностей изнутри мы не видели. */
export const MARKET_PROOF: { text: L; source: { label: string; href: string } } = {
  text: {
    uz: "Bozor isbotlangan: distribyutsiyani avtomatlashtiruvchi o'zbek servisi Sales Doctor asoschisi oylik tushum $320 ming ekanini aytadi. Distribyutorlar bunday tizim uchun pul to'laydi.",
    ru: "Рынок доказан: основатель узбекского сервиса автоматизации дистрибуции Sales Doctor называет выручку $320 тысяч в месяц. Дистрибьюторы платят за такие системы.",
  },
  source: {
    label: "digitalbusiness.kz, 18.09.2026",
    href: "https://digitalbusiness.kz/2026-09-18/uzbekistanets-zapustil-servis-po-avtomatizatsii-distributsii-i-vishel-na-viruchku-4-mln-v-god/",
  },
};

export const ALTERNATIVES: Array<{ name: L; what: L }> = [
  {
    name: { uz: "Qog'oz, Excel, Telegram", ru: "Бумага, Excel, Telegram" },
    what: {
      uz: "Asosiy raqobatchi: bepul va tanish, lekin qarz, qoldiq va pul bir-biriga bog'lanmaydi.",
      ru: "Главный конкурент: бесплатно и привычно, но долг, остаток и деньги друг с другом не связаны.",
    },
  },
  {
    name: { uz: "1C", ru: "1С" },
    what: {
      uz: "Buxgalteriya hisobi. Biz uni almashtirmaymiz — OData orqali ma'lumot almashamiz.",
      ru: "Бухгалтерский учёт. Мы его не заменяем — обмениваемся данными по OData.",
    },
  },
  {
    name: { uz: "Sales Doctor", ru: "Sales Doctor" },
    what: {
      uz: "Distribyutsiya va chakana savdo uchun avtomatlashtirish; yirik ishlab chiqaruvchilar bilan ishlaydi.",
      ru: "Автоматизация дистрибуции и розницы; работает с крупными производителями.",
    },
  },
  {
    name: { uz: "Smartup", ru: "Smartup" },
    what: {
      uz: "Ishlab chiqarish va distribyutsiya uchun bulutli ERP: moliya, ombor, savdo, kadrlar.",
      ru: "Облачная ERP для производства и дистрибуции: финансы, склад, продажи, кадры.",
    },
  },
];

/** Чем отличаемся — только то, что можно проверить на нашей стороне. */
export const DIFFERENTIATORS: L[] = [
  { uz: "Narx saytda ochiq, ro'yxatdan o'zi o'tadi: 14 kun bepul, karta kerak emas.", ru: "Цена открыта на сайте, регистрация без звонка: 14 дней бесплатно, карта не нужна." },
  { uz: "Faqat dala xodimi uchun to'lov: ofis, ombor, supervayzer va direktor — bepul; buyurtma va tovarlar cheklanmagan.", ru: "Платят только за людей в поле: офис, склад, супервайзеры и директор — бесплатно; заказы и товары без ограничений." },
  { uz: "Qarz har bir buyurtma bo'yicha, muddati o'tsa yuklash to'xtaydi — qoidalar pul bilan ishlaydi.", ru: "Долг по каждому заказу и стоп отгрузки при просрочке — правила, которые работают с деньгами." },
  { uz: "Oflayn agent ilovasi, o'zbek va rus tillari, ochiq API va 1C bilan almashinuv.", ru: "Офлайн-приложение агента, узбекский и русский, открытый API и обмен с 1С." },
];

/* ── Функции: наравне с рынком, свои находки, честные пробелы ───────────────
   09.10.2026 владелец: «объяснить, что мы не отстаём от Smartup и Sales
   Doctor по функционалу и по задумке». Сравнение — по основным процессам
   дистрибьютора, и каждый пункт PARITY стоит на работающей функции в коде.
   То, что конкуренты показывают публично, а у нас нет, названо в GAPS:
   жюри, знающее Sales Doctor, спросит про маркировку — ответ уже на странице.
   (Sales Doctor и «Asl Belgisi» — spot.uz, 31.07.2026; Smartup и учёт
   торгового оборудования — описание приложения в App Store.) */
export const PARITY: L[] = [
  { uz: "Oflayn buyurtma, katalog, qoldiq va do'kon narxi", ru: "Офлайн-заказ, каталог, остаток и цена магазина" },
  { uz: "Narx varaqlari, miqdor pog'onalari, chegirma chegarasi", ru: "Прайс-листы, ступени по количеству, порог скидки" },
  { uz: "Buyurtma bo'yicha qarz, kredit limiti, yuklashni to'xtatish", ru: "Долг по заказу, кредитный лимит, стоп отгрузки" },
  { uz: "Ombor: partiyalar, muddatlar, FEFO, bir nechta ombor", ru: "Склад: партии, сроки, FEFO, несколько складов" },
  { uz: "Kirim, ta'minotchi qarzi va unga qaytarish", ru: "Приход, долг поставщику и возврат ему" },
  { uz: "Kuryer yetkazishi, naqd pul va kamomad", ru: "Доставка курьером, наличные и недостача" },
  { uz: "Qaytarishlar sababi bilan", ru: "Возвраты с причиной" },
  { uz: "Tashriflar rejasi, GPS, buyurtmasiz tashrif sababi", ru: "План визитов, GPS, причина визита без заказа" },
  { uz: "Merchandayzer fotohisoboti", ru: "Фотоотчёт мерчендайзера" },
  { uz: "Reja, prognoz, KPI va ish haqi", ru: "План, прогноз, KPI и зарплата" },
  { uz: "P&L, ABC, foyda tahlili, savdo xaritasi", ru: "P&L, ABC, разбор прибыли, карта продаж" },
  { uz: "1C (OData), ochiq API, Excel, Telegram xabarnomalari", ru: "1С (OData), открытый API, Excel, уведомления в Telegram" },
  { uz: "Rollar, huquqlar va harakatlar jurnali", ru: "Роли, права и журнал действий" },
  { uz: "iOS, Android va veb; o'zbek va rus tillari", ru: "iOS, Android и веб; узбекский и русский" },
];

/** Свои находки — то, что в продукте придумано, а не повторено. */
export const IDEAS: Array<{ t: L; d: L }> = [
  {
    t: { uz: "Qarz o'zi yukni to'xtatadi", ru: "Долг сам останавливает отгрузку" },
    d: { uz: "Muddati o'tgan qarzi bor do'kon buyurtmasi «Kutishda» to'xtaydi, sababi buyurtmaning o'zida yoziladi.", ru: "Заказ магазина с просроченным долгом встаёт в «Ожидает», причина записана в самом заказе." },
  },
  {
    t: { uz: "Muddat → chegirma → agent", ru: "Срок → уценка → агент" },
    d: { uz: "Muddatigacha sotilmaydigan partiyaga chegirma maslahat beriladi; direktor tasdiqlaydi — agent katalogida darhol «Birinchi sotish».", ru: "Партии, которая не успеет продаться, предлагается уценка; директор подтверждает — у агента в каталоге сразу «Продать первым»." },
  },
  {
    t: { uz: "«Agentni qayerga yuborish»", ru: "«Куда отправить агента»" },
    d: { uz: "Savdo xaritasi bo'sh hududlarni ko'rsatadi, tashrif rejaga bir bosishda qo'yiladi.", ru: "Карта продаж показывает пустые районы, визит ставится в план одним нажатием." },
  },
  {
    t: { uz: "Reja oyning o'rtasida ko'rinadi", ru: "План виден в середине месяца" },
    d: { uz: "Prognoz oy oxirida kim rejadan orqada qolishini hozir aytadi — kechikmasdan.", ru: "Прогноз говорит сейчас, кто к концу месяца не дотянет до плана, — не задним числом." },
  },
  {
    t: { uz: "Bitta telefon — bir nechta agent", ru: "Один телефон — несколько агентов" },
    d: { uz: "Aloqa bo'lmasa ham har kimning buyurtmasi o'ziniki bo'lib qoladi va boshqa birovning nomidan ketmaydi.", ru: "Даже без связи заказ каждого остаётся его и не уходит от чужого имени." },
  },
  {
    t: { uz: "To'lov — faqat daladagilar uchun", ru: "Платят только за поле" },
    d: { uz: "Ofis, ombor va rahbariyat bepul: tizimga butun jamoani qo'shish qimmatlashmaydi.", ru: "Офис, склад и руководство бесплатно: подключать всю команду не дороже." },
  },
];

/** Чего пока нет, а у конкурентов публично есть, — в планах, названо прямо. */
export const GAPS: L[] = [
  { uz: "«Asl Belgisi» markirovkasi", ru: "Маркировка «Asl Belgisi»" },
  { uz: "Elektron hisob-faktura operator bilan to'g'ridan-to'g'ri (hozir — 1C orqali: STIR, IKPU va QQS tayyorlab beramiz)", ru: "Электронная счёт-фактура напрямую через оператора (сейчас — через 1С: ИНН, ИКПУ и НДС готовим мы)" },
  { uz: "Savdo uskunalari hisobi", ru: "Учёт торгового оборудования" },
];

/* ── Проверяемые числа о разработке ─────────────────────────────────────────
   Пересчитано 09.10.2026: commits — `git rev-list --count origin/main`
   (358a2a6a); первый коммит — 03.07.2026 (`git log --reverse`). PR — слитые
   в main: `gh pr list --state merged` веба и мобилки. tests — `npx vitest
   run` веба на этой ветке, всего вместе с пропущенными (пропущены наборы на
   настоящей MySQL — они идут в CI). Пересчитать перед подачей, если набор
   вырос. */
export const ENGINEERING = {
  since: "03.07.2026",
  commits: 1469,
  prsWeb: 165,
  prsMobile: 46,
  tests: 5508,
} as const;

/* ── Результаты (traction) ─────────────────────────────────────────────────
   Откуда числа (09.10.2026):
   · paying и mrrUzs — ответ владельца: платят три дистрибьютора, двое по
     $100 в месяц и один 300 000 сум; доллары — по курсу ЦБ на 09.10.2026
     (11 846,57): 2 × 100 × 11 846,57 + 300 000 = 2 669 314 сум;
   · organizations, fieldStaff, shops, deliveredOrders30d — из ночной копии
     базы 09.10.2026 по организациям без системной и без песочницы жюри:
     действующие учётные записи агентов, курьеров и мерчендайзеров;
     действующие магазины; заказы, доставленные за 30 дней 09.09–08.10 (не
     удалённые и не отменённые).
   Имён клиентов здесь нет: репозиторий открытый. */
export const TRACTION = {
  asOf: "09.10.2026",
  organizations: 5,
  paying: 3,
  mrrUzs: 2_669_314,
  fieldStaff: 26,
  shops: 2385,
  deliveredOrders30d: 654,
} as const;

/* ── Муаммо → Ечим ─────────────────────────────────────────────────────── */
export const PROBLEMS: Array<{ topic: L; problem: L; solution: L }> = [
  {
    topic: { uz: "Buyurtma", ru: "Заказ" },
    problem: {
      uz: "Agent buyurtmani qog'ozga yoki Telegramga yozadi, ofis uni qaytadan teradi. Internet yo'q do'konda buyurtma kechikadi yoki yo'qoladi.",
      ru: "Агент пишет заказ на бумаге или в Telegram, офис перебивает его заново. В магазине без интернета заказ задерживается или теряется.",
    },
    solution: {
      uz: "Agent buyurtmani telefonda oladi — aloqa bo'lmasa ham. Buyurtma telefonda saqlanadi va tarmoq paydo bo'lishi bilan serverga ketadi; ofis uni darhol ko'radi.",
      ru: "Агент оформляет заказ в телефоне — даже без связи. Заказ хранится на телефоне и уходит на сервер, как только появляется сеть; офис видит его сразу.",
    },
  },
  {
    topic: { uz: "Qarz", ru: "Долг" },
    problem: {
      uz: "Do'kon qarzi daftarda yoki umumiy summada: qaysi buyurtma uchun va qachondan beri — noma'lum.",
      ru: "Долг магазина — в тетради или одной суммой: за какой заказ и с какого дня, неизвестно.",
    },
    solution: {
      uz: "Qarz har bir buyurtma bo'yicha yuritiladi: qisman to'lov, qoldiq va muddat. Muddati o'tgan qarzi bor do'konga yuk jo'natish to'xtatiladi — bu sozlanadi.",
      ru: "Долг ведётся по каждому заказу: частичная оплата, остаток и срок. Магазину с просроченным долгом отгрузка останавливается — это настраивается.",
    },
  },
  {
    topic: { uz: "Narx", ru: "Цена" },
    problem: {
      uz: "Narxlar Excelda, har agentda o'z nusxasi; chegirmani kim va nega berganini topib bo'lmaydi.",
      ru: "Цены в Excel, у каждого агента своя копия; кто и почему дал скидку — не найти.",
    },
    solution: {
      uz: "Narx varaqlari va miqdor pog'onalari tizimda: narxni buyurtmaning o'zi qo'yadi, agent chegirmasi chegara bilan cheklanadi.",
      ru: "Прайс-листы и ступени по количеству — в системе: цену ставит сам заказ, скидка агента ограничена порогом.",
    },
  },
  {
    topic: { uz: "Ombor", ru: "Склад" },
    problem: {
      uz: "Muddati tugayotgan tovar omborda ko'rinmaydi — zarar faqat hisobdan chiqarishda bilinadi.",
      ru: "Товар с истекающим сроком на складе не виден — убыток узнают только при списании.",
    },
    solution: {
      uz: "Partiyalar va yaroqlilik muddati: birinchi bo'lib muddati yaqin partiya ketadi (FEFO), muddatlar ish joyida arzonlashtirish taklif qilinadi.",
      ru: "Партии и сроки годности: первой уходит партия с ближайшим сроком (FEFO), на рабочем месте сроков предлагается уценка.",
    },
  },
  {
    topic: { uz: "Hisobot", ru: "Отчёт" },
    problem: {
      uz: "Direktor hisobotni agentlar va buxgalteriyadan yig'adi; 1C dagi raqamlar savdo raqamlariga mos kelmaydi.",
      ru: "Директор собирает отчёт у агентов и бухгалтерии; цифры в 1С не сходятся с продажами.",
    },
    solution: {
      uz: "Direktor hisobotlari tayyor: P&L, tovar, do'kon va agent bo'yicha foyda, ABC, reja prognozi, savdo xaritasi. 1C bilan OData orqali almashinuv.",
      ru: "Отчёты директора готовы: P&L, прибыль по товару, магазину и агенту, ABC, прогноз плана, карта продаж. Обмен с 1С по OData.",
    },
  },
  {
    topic: { uz: "Pul", ru: "Деньги" },
    problem: {
      uz: "Kuryer naqd pulni yig'adi, ofis kun oxirigacha kim qancha to'laganini bilmaydi; kamomad keyin chiqadi va hech kimniki bo'lmaydi.",
      ru: "Курьер собирает наличные, а офис до вечера не знает, кто сколько заплатил; недостача всплывает потом и оказывается ничьей.",
    },
    solution: {
      uz: "Har bir yetkazishda olingan pul buyurtmaga yoziladi; kamomad aniq xodim nomiga qayd etiladi, buyurtmani ofis to'lov va qoldiq bilan yopadi.",
      ru: "При каждой доставке полученные деньги пишутся в заказ; недостача фиксируется на конкретного сотрудника, заказ закрывает офис с оплатой и остатком.",
    },
  },
  {
    topic: { uz: "Qaytarish", ru: "Возврат" },
    problem: {
      uz: "Qaytarilgan tovar qog'ozda: qarzdan ayirildimi, omborga qaytdimi — hech kim aniq bilmaydi.",
      ru: "Возврат — на бумаге: списан ли он с долга, вернулся ли на склад — точно не знает никто.",
    },
    solution: {
      uz: "Agent qaytarishni sababi bilan telefondan kiritadi, ofis o'tkazadi — ombor qoldig'i va do'kon qarzi o'zi o'zgaradi; sabablar bo'yicha tahlil.",
      ru: "Агент заводит возврат с причиной из телефона, офис проводит — остаток на складе и долг магазина меняются сами; разбор по причинам.",
    },
  },
  {
    topic: { uz: "Tashrif", ru: "Визиты" },
    problem: {
      uz: "Agent do'konga borganmi — faqat uning so'zi bilan; buyurtmasiz tashrif sababsiz qoladi.",
      ru: "Был ли агент в магазине — известно только с его слов; визит без заказа остаётся без причины.",
    },
    solution: {
      uz: "Oylik tashriflar rejasi, roziligi bilan GPS va supervayzer xaritasi; buyurtmasiz tashrif faqat sabab bilan yopiladi.",
      ru: "План визитов на месяц, GPS с согласия и карта супервайзера; визит без заказа закрывается только с причиной.",
    },
  },
  {
    topic: { uz: "Ish haqi", ru: "Зарплата" },
    problem: {
      uz: "Agent va kuryer ish haqi oy oxirida Excelda qo'lda hisoblanadi — har oy bahs.",
      ru: "Зарплату агентов и курьеров считают в конце месяца в Excel вручную — каждый месяц спор.",
    },
    solution: {
      uz: "Reja va bajarilishi hammaga ko'rinadi; ish haqi tizimda hisoblanadi: dona uchun yoki yetkazilganidan foiz, har bir xodimga alohida.",
      ru: "План и выполнение видны всем; зарплата считается в системе: за штуку или процентом от доставленного, отдельно по каждому.",
    },
  },
  {
    topic: { uz: "Ta'minot", ru: "Поставщики" },
    problem: {
      uz: "Ta'minotchidan kelgan tovar qo'lda kiritiladi, ta'minotchiga qarz alohida daftarda.",
      ru: "Приход от поставщика вбивают руками, долг поставщику — в отдельной тетради.",
    },
    solution: {
      uz: "Kirim Excelga o'xshash jadvalda; ta'minotchiga qarz, solishtirma dalolatnoma va ta'minotchiga qaytarish — bitta joyda.",
      ru: "Приход — в таблице как в Excel; долг поставщику, акт сверки и возврат поставщику — в одном месте.",
    },
  },
  {
    topic: { uz: "Solishtirma", ru: "Сверка" },
    problem: {
      uz: "Do'kon qarzga rozi emas — tasdiqlovchi hujjat yo'q, bahs og'zaki.",
      ru: "Магазин не согласен с долгом — подтверждающей бумаги нет, спор на словах.",
    },
    solution: {
      uz: "Istalgan mijoz va davr uchun solishtirma dalolatnoma 1C shaklida: har bir yuklash va to'lov, saldo, summa yozuvda; Excelga yuklash.",
      ru: "Акт сверки по любому клиенту и периоду в форме 1С: каждая отгрузка и оплата, сальдо, сумма прописью; выгрузка в Excel.",
    },
  },
  {
    topic: { uz: "Peshtaxta", ru: "Полка" },
    problem: {
      uz: "Peshtaxta suratlari Telegram chatlarida yo'qoladi; qaysi do'kon tekshirilgani noma'lum.",
      ru: "Фото полок теряются в чатах Telegram; какой магазин проверили — неизвестно.",
    },
    solution: {
      uz: "Merchandayzer tashrifi rejaga bog'langan, fotohisobot do'kon kartasida saqlanadi.",
      ru: "Визит мерчендайзера привязан к плану, фотоотчёт хранится в карточке магазина.",
    },
  },
  {
    topic: { uz: "Nazorat", ru: "Контроль" },
    problem: {
      uz: "Narxni kim o'zgartirdi, buyurtmani kim o'chirdi — topib bo'lmaydi; har bir xodim hamma narsani ko'radi.",
      ru: "Кто поменял цену, кто удалил заказ — не найти; каждый сотрудник видит всё.",
    },
    solution: {
      uz: "Harakatlar jurnali: kim, qachon, nima qildi; rollar va har bir tashkilot uchun sozlanadigan huquqlar.",
      ru: "Журнал действий: кто, когда и что сделал; роли и права, настраиваемые под каждую организацию.",
    },
  },
];

export const ROLES: L = {
  uz: "Savdo agenti · kuryer · merchandayzer · ombor va ofis operatori · supervayzer · direktor",
  ru: "Торговый агент · курьер · мерчендайзер · складской и офисный оператор · супервайзер · директор",
};

/* ── Почему мы ─────────────────────────────────────────────────────────── */
export const WHY_US: Array<{ t: L; d: L }> = [
  {
    t: { uz: "Mahsulot ishlab turibdi", ru: "Продукт работает" },
    d: {
      uz: "warehouse-pro.uz da distribyutorlar har kuni buyurtma, qarz, ombor va hisobotlar bilan ishlaydi. Bu taqdimot emas — ishlayotgan tizim.",
      ru: "На warehouse-pro.uz дистрибьюторы каждый день ведут заказы, долги, склад и отчёты. Это не макет — работающая система.",
    },
  },
  {
    t: { uz: "Soha chuqur ishlangan", ru: "Отрасль проработана вглубь" },
    d: {
      uz: "Buyurtma bo'yicha qarz, muddati o'tgan qarzda yuklashni to'xtatish, partiyalar va FEFO, o'zbek buxgalteriyasi uchun 1C (OData) — bular shablon emas, distribyutorlarning haqiqiy so'rovlaridan chiqqan.",
      ru: "Долг по заказу, стоп отгрузки при просрочке, партии и FEFO, 1С по OData для узбекской бухгалтерии — это не шаблон, а ответы на настоящие запросы дистрибьюторов.",
    },
  },
  {
    t: { uz: "Oflayn va ikki tilda", ru: "Офлайн и на двух языках" },
    d: {
      uz: "Agent ilovasi internet yo'q joyda ishlaydi; interfeys o'zbek va rus tillarida. Veb, PWA, iOS va Android.",
      ru: "Приложение агента работает без интернета; интерфейс на узбекском и русском. Веб, PWA, iOS и Android.",
    },
  },
  {
    t: { uz: "AI agentlar va qat'iy testlar", ru: "ИИ-агенты и строгие тесты" },
    d: {
      uz: "Odatda jamoa bajaradigan ishni bitta muhandis Claude Code agentlari bilan bajaradi. Xavfsizlik to'ri — testlar: har bir yangi funksiyaga qat'iy test va ataylab buzish mashqi — test xatoni haqiqatan ushlashini tekshirish uchun.",
      ru: "Работу, которую обычно делает команда, один инженер делает с агентами Claude Code. Страховка — тесты: строгий тест на каждую новую функцию и нарочная поломка, чтобы убедиться, что тест действительно ловит ошибку.",
    },
  },
];

/* ── Дорожная карта ─────────────────────────────────────────────────────── */
export type StageKey = "idea" | "prototype" | "mvp" | "launched";
export const ROADMAP: Array<{ key: StageKey; name: L; d: L }> = [
  { key: "idea", name: { uz: "G'oya", ru: "Идея" }, d: { uz: "Distribyutorning qog'oz, Telegram va Excel ishini bitta tizimga yig'ish.", ru: "Собрать бумагу, Telegram и Excel дистрибьютора в одну систему." } },
  { key: "prototype", name: { uz: "Prototip", ru: "Прототип" }, d: { uz: "Ombor, buyurtma va agent ilovasi. Birinchi commit — 03.07.2026.", ru: "Склад, заказы и приложение агента. Первый коммит — 03.07.2026." } },
  { key: "mvp", name: { uz: "MVP", ru: "MVP" }, d: { uz: "Agent buyurtmasi, qarzlar, ombor partiyalari, direktor hisobotlari.", ru: "Заказ агента, долги, партии на складе, отчёты директора." } },
  { key: "launched", name: { uz: "Ishga tushirilgan", ru: "Запущен" }, d: { uz: "Mahsulot ishlab turibdi: warehouse-pro.uz, iOS ilovasi App Store tekshiruvida, Android APK.", ru: "Продукт работает: warehouse-pro.uz, iOS-приложение на проверке в App Store, Android APK." } },
];
export const CURRENT_STAGE: StageKey = "launched";

export const NEXT_STEPS: L[] = [
  { uz: "iOS ilovasini App Store'da nashr qilish", ru: "Публикация iOS-приложения в App Store" },
  { uz: "Android ilovasini Google Play'da nashr qilish", ru: "Публикация Android-приложения в Google Play" },
  { uz: "Yangi distribyutorlarni ulash va ularning so'rovlari bo'yicha rivojlantirish", ru: "Подключение новых дистрибьюторов и развитие по их запросам" },
  { uz: "AI funksiyalari — quyidagi rejaga ko'ra", ru: "Функции ИИ — по плану ниже" },
];

/* ── Как внедряем ───────────────────────────────────────────────────────── */
export type StepState = "done" | "now" | "planned";
export const STAGES: Array<{ name: L; d: L; state: StepState }> = [
  { state: "done", name: { uz: "Dala", ru: "Поле" }, d: { uz: "Agent ilovasi: oflayn buyurtma, tashriflar rejasi, GPS, do'kon qarzlari.", ru: "Приложение агента: офлайн-заказ, план визитов, GPS, долги магазинов." } },
  { state: "done", name: { uz: "Ofis va ombor", ru: "Офис и склад" }, d: { uz: "Buyurtmani yopish, qarzlar, partiyalar va muddatlar, kuryer yetkazishi.", ru: "Закрытие заказа, долги, партии и сроки, доставка курьером." } },
  { state: "done", name: { uz: "Direktor", ru: "Директор" }, d: { uz: "P&L, foyda tahlili, ABC, reja prognozi, savdo xaritasi, ish haqi.", ru: "P&L, разбор прибыли, ABC, прогноз плана, карта продаж, зарплаты." } },
  { state: "done", name: { uz: "Integratsiyalar", ru: "Интеграции" }, d: { uz: "1C (OData), ochiq API, Telegram xabarnomalari, 2FA.", ru: "1С (OData), открытый API, уведомления в Telegram, 2FA." } },
  { state: "now", name: { uz: "Ilova do'konlari", ru: "Магазины приложений" }, d: { uz: "App Store (tekshiruvda) va Google Play.", ru: "App Store (на проверке) и Google Play." } },
  { state: "planned", name: { uz: "AI", ru: "ИИ" }, d: { uz: "Talab prognozi modeli va hisobotlarga savol — pastdagi rejaga qarang.", ru: "Модель прогноза спроса и вопросы к отчётам — см. план ниже." } },
];

export const TECH: Array<{ area: L; items: string }> = [
  { area: { uz: "Veb", ru: "Веб" }, items: "React · TypeScript · Vite · PWA" },
  { area: { uz: "Server", ru: "Сервер" }, items: "Node.js · Hono · tRPC" },
  { area: { uz: "Ma'lumotlar", ru: "Данные" }, items: "MySQL · drizzle ORM" },
  { area: { uz: "Mobil", ru: "Мобильное" }, items: "Expo · React Native · iOS · Android" },
  { area: { uz: "Infratuzilma", ru: "Инфраструктура" }, items: "Railway · Sentry · GitHub Actions" },
  { area: { uz: "Sifat", ru: "Качество" }, items: "Vitest · Playwright · k6" },
];

export const AI_NOW: Array<{ t: L; d: L }> = [
  {
    t: { uz: "Ishlab chiqishda: Claude Code agentlari", ru: "В разработке: агенты Claude Code" },
    d: {
      uz: "Funksiyalarni yozish, testlar, kod review va audit. Har bir o'zgarish CI dan o'tadi; qarorni va qabulni inson qiladi.",
      ru: "Пишут функции, тесты, ревью и аудиты. Каждое изменение проходит CI; решение и приёмка — за человеком.",
    },
  },
  {
    t: { uz: "Marketingda: Higgsfield", ru: "В маркетинге: Higgsfield" },
    d: { uz: "Reklama vizuallari va video.", ru: "Рекламные визуалы и видео." },
  },
  {
    t: { uz: "Mahsulotda hozir — qoidalar va tahlil", ru: "В продукте сейчас — правила и аналитика" },
    d: {
      uz: "Aqlli ogohlantirishlar, reja prognozi, muddati yaqin tovarga chegirma maslahati, ABC va foyda tahlili. Bular hisob-kitob qoidalari, AI emas — shunday deb ataymiz.",
      ru: "Умные оповещения, прогноз плана, совет по уценке товара с истекающим сроком, ABC и разбор прибыли. Это правила и расчёты, а не ИИ — так их и называем.",
    },
  },
];

export const AI_PLANNED: Array<{ t: L; d: L }> = [
  {
    t: { uz: "Talab prognozi modeli", ru: "Модель прогноза спроса" },
    d: { uz: "Do'kon × tovar kesimida keyingi buyurtmani bashorat qilish — agentga «nima taklif qilish kerak» ro'yxati.", ru: "Предсказание следующего заказа по связке магазин × товар — агенту список «что предложить»." },
  },
  {
    t: { uz: "Hisobotlarga savol", ru: "Вопросы к отчётам" },
    d: { uz: "Direktor oddiy tilda so'raydi («o'tgan oy qaysi hududda foyda tushdi?») — javob mavjud hisobotlardan.", ru: "Директор спрашивает обычными словами («где упала прибыль в прошлом месяце?») — ответ из существующих отчётов." },
  },
];

/* ── Открытый API ───────────────────────────────────────────────────────────
   Каждый путь здесь обязан существовать в api/public-api.ts (или в
   api/public/orders-v1.ts, смонтированном в нём на /orders) — это проверяет
   src/__tests__/pitch-pages.test.tsx. */
export const API_BASE = "https://www.warehouse-pro.uz/api/v1";
export const API_ENDPOINTS: Array<{ path: string; d: L }> = [
  { path: "/products", d: { uz: "Tovarlar ro'yxati (limit, offset)", ru: "Список товаров (limit, offset)" } },
  { path: "/products/:id", d: { uz: "Bitta tovar", ru: "Один товар" } },
  { path: "/orders", d: { uz: "Buyurtmalar: snapshot yoki o'zgarishlar rejimi, cursor bilan", ru: "Заказы: снимок или режим изменений, курсором" } },
  { path: "/orders/:id", d: { uz: "Buyurtma va uning qatorlari", ru: "Заказ с позициями" } },
  { path: "/orders/statuses", d: { uz: "Holatlar lug'ati", ru: "Словарь статусов" } },
  { path: "/stock", d: { uz: "Ombor qoldiqlari", ru: "Остатки на складе" } },
  { path: "/shops", d: { uz: "Do'konlar", ru: "Магазины" } },
  { path: "/health", d: { uz: "Aloqa tekshiruvi va muhit (sandbox / production)", ru: "Проверка связи и среда (sandbox / production)" } },
];

export const API_ERRORS: Array<{ code: string; d: L }> = [
  { code: "401", d: { uz: "Kalit yo'q yoki noto'g'ri", ru: "Ключа нет или он неверный" } },
  { code: "402", d: { uz: "Obuna muddati tugagan", ru: "Подписка истекла" } },
  { code: "403", d: { uz: "Kalit to'xtatilgan yoki muddati o'tgan, ruxsat doirasi yo'q, tashkilot to'xtatilgan, tarifda API yo'q", ru: "Ключ приостановлен или просрочен, нет области доступа, организация приостановлена, тариф без API" } },
  { code: "405", d: { uz: "API faqat o'qish uchun: GET va HEAD", ru: "API только на чтение: GET и HEAD" } },
  { code: "429", d: { uz: "Daqiqalik chegara; Retry-After sarlavhasiga amal qiling", ru: "Минутный лимит; соблюдайте заголовок Retry-After" } },
];

/** Пример ответа — форма из docs/public-api-orders.md §2.4, данные заведомо образцовые. */
export const API_SAMPLE_RESPONSE = `{
  "server_time": "2026-10-05T09:12:44.120Z",
  "mode": "snapshot",
  "snapshot_id": "eyJtIjozMjAsInQiOiIyMDI2LTEwLTA1In0",
  "data": [
    {
      "order_id": 42,
      "order_number": "SB-00042",
      "warehouse_id": 1,
      "created_at": "2026-10-03T07:21:44.000Z",
      "status": "delivered",
      "amount": "1284000.00",
      "currency": "UZS",
      "shop_name": "Baraka market",
      "sales_agent_name": "Otabek",
      "territory_name": "Chilonzor",
      "promised_delivery_at": "2026-10-03T13:00:00.000Z",
      "delivered_at": "2026-10-03T12:40:10.000Z"
    }
  ],
  "next_cursor": "eyJpIjo0Miwicy…",
  "has_more": true,
  "total_count": 37,
  "orders_amount_total": "41260500.00"
}`;

/* ── /demo ──────────────────────────────────────────────────────────────── */
/** Ролик и обложка лежат в public/pitch/ (монтаж 05.10.2026: 2:44, 1920×1080, H.264, без звука, faststart). */
export const VIDEO_SRC = "/pitch/demo-uz.mp4";
export const VIDEO_POSTER = "/pitch/demo-poster.jpg";
/** Длина ролика в секундах — для подписи и проверки. */
export const VIDEO_SECONDS = 164;

/**
 * Описание ролика по сценам — по монтажному листу (scratchpad/pitch/video/description-*.md).
 * Время — начало сцены; на странице по нему можно перейти в плеере.
 */
export const VIDEO_DESCRIPTION: { lead: L; scenes: Array<{ at: string; start: number; title: L; text: L }>; note: L } = {
  lead: {
    uz: "2 daqiqa 44 soniyalik video: ishlab turgan mahsulot — telefon ilovasi va veb-versiya, o'zbek tilida, ovozsiz, har sahna ostida qisqa izoh bilan.",
    ru: "Ролик на 2:44: работает настоящий продукт — мобильное приложение и веб-версия на узбекском, без голоса, с короткой подписью к каждому шагу.",
  },
  scenes: [
    {
      at: "0:00", start: 0,
      title: { uz: "Kirish", ru: "Заставка" },
      text: {
        uz: "Ertalab soat 6:00, daftar va qo'ng'iroqlar tartibsizligi — Warehouse Pro: «Ulgurji savdo uchun ombor, dala va pul nazorati».",
        ru: "6:00 утра, хаос тетрадей и звонков — Warehouse Pro: «Склад, поле и деньги для оптовой торговли».",
      },
    },
    {
      at: "0:12", start: 12,
      title: { uz: "Agent (telefon)", ru: "Агент (телефон)" },
      text: {
        uz: "Do'konlar ro'yxatida svetofor; qizil do'konda «Yuklash xavfli»; «O'tgan safargidek» savatni bir bosishda to'ldiradi; internet yo'qligida buyurtma telefonda saqlanadi va aloqa qaytgach o'zi ketadi; buyurtmasiz tashrif sababsiz yopilmaydi.",
        ru: "Светофор в списке магазинов; у красного магазина «Грузить рискованно»; «Как в прошлый раз» заполняет корзину одним касанием; без интернета заказ сохраняется в телефоне и уходит сам, когда связь вернулась; визит без заказа не закрыть без причины.",
      },
    },
    {
      at: "0:50", start: 50,
      title: { uz: "Ombor", ru: "Склад" },
      text: {
        uz: "«Muddatlar»: qaysi partiya muddatigacha sotilib ulgurmaydi, chegirma maslahati; direktor «Arzonlashtirish»ni tasdiqlaydi — agent katalogida darhol «Birinchi sotish» belgisi.",
        ru: "«Сроки»: какие партии не успеют продаться, совет скидки; директор подтверждает уценку — у агента в каталоге сразу метка «Продать первым».",
      },
    },
    {
      at: "1:14", start: 74,
      title: { uz: "Ofis", ru: "Офис" },
      text: {
        uz: "Muddati o'tgan qarzi bor do'kon buyurtmasi «Kutishda» to'xtaydi; sababi buyurtmaning o'zida, pul — jami, olindi, qoldiq.",
        ru: "Заказ магазина с просроченным долгом встаёт в «Ожидает»; причина — в самом заказе, деньги: итого, получено, остаток.",
      },
    },
    {
      at: "1:29", start: 89,
      title: { uz: "Kuryer (telefon)", ru: "Курьер (телефон)" },
      text: {
        uz: "Kunlik yetkazishlar, olingan naqd pul va «Yetkazildi» — kun jarayoni yangilanadi.",
        ru: "Доставки дня, полученные наличные и «Доставлено» — ход дня обновляется.",
      },
    },
    {
      at: "1:42", start: 102,
      title: { uz: "Direktor", ru: "Директор" },
      text: {
        uz: "Reja prognozi va kim ortda qolmoqda; «Foyda»da zarar va past marja «Nega» ustuni bilan; ABC; «Savdo xaritasi» va «Agentni qayerga yuborish» — tashriflar bir bosishda rejaga qo'yiladi.",
        ru: "Прогноз плана и кто отстаёт; «Прибыль» с минусом и низкой маржой и колонкой «Почему»; ABC; «Карта продаж» и «Куда отправить агента» — визиты ставятся в план одним нажатием.",
      },
    },
    {
      at: "2:19", start: 139,
      title: { uz: "Ulanishlar", ru: "Подключения" },
      text: {
        uz: "1C bilan jadval bo'yicha almashinuv, ochiq API kalitlari, Excel yuklamalari, interfeys o'zbek va rus tillarida.",
        ru: "Обмен с 1С по расписанию, ключи открытого API, выгрузки в Excel, интерфейс на узбекском и русском.",
      },
    },
    {
      at: "2:38", start: 158,
      title: { uz: "Yakun", ru: "Финал" },
      text: {
        uz: "«Ombor, dala va pul — nazorat ostida.» warehouse-pro.uz/pitch · warehouse-pro.uz/demo",
        ru: "«Склад, поле и деньги — под контролем.» warehouse-pro.uz/pitch · warehouse-pro.uz/demo",
      },
    },
  ],
  note: {
    uz: "Barcha ekranlar — sinov stendidagi haqiqiy ilova, demo ma'lumotlar bilan; videodagi raqamlar ilovaning o'zidan.",
    ru: "Все экраны — настоящее приложение на тестовом стенде, на демо-данных; числа в кадре — из самого приложения.",
  },
};
