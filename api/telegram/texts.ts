/**
 * Что бот говорит — по-русски и по-узбекски.
 *
 * Язык выбирается кнопками при первом обращении и хранится у пользователя
 * отдельно от языка приложения: отчёты человек может читать по-русски, а
 * короткие сводки в телефоне — на родном.
 *
 * Тексты собраны в одном месте намеренно. Разложенные по обработчикам, они
 * расходятся: половина фраз остаётся на одном языке, и заметить это можно
 * только с телефона узбекоязычного агента.
 *
 * ── Меню по ролям ───────────────────────────────────────────────────────────
 *
 * Было одно меню на всех и отказ «запросы доступны руководителям» для агента.
 * Агенту в бот было незачем заходить — а он единственный, у кого телефон в
 * руке весь день. Теперь у каждого своё: руководитель видит организацию,
 * агент — свой план, свои заказы и долги своих магазинов, курьер — свои
 * доставки и кассу. Слова в кнопках одни и те же («Заказы», «Долги»), а что
 * за ними — решает роль: answers.ts фильтрует по scope.
 */
export type Lang = "ru" | "uz";

type Pair = { ru: string; uz: string };

export const T = {
  chooseLang: {
    ru: "Выберите язык / Tilni tanlang",
    uz: "Выберите язык / Tilni tanlang",
  },
  linked: {
    ru: "Готово. Телефон привязан к аккаунту.",
    uz: "Tayyor. Telefon hisobingizga bog'landi.",
  },
  linkExpired: {
    ru: "Ссылка устарела. Откройте настройки в приложении и нажмите «Подключить Telegram» ещё раз.",
    uz: "Havola eskirgan. Ilovada sozlamalarni ochib, «Telegramni ulash» tugmasini qayta bosing.",
  },
  linkInvalid: {
    ru: "Ссылка не подходит. Откройте настройки в приложении и нажмите «Подключить Telegram».",
    uz: "Havola to'g'ri kelmadi. Ilovada sozlamalarni ochib, «Telegramni ulash» tugmasini bosing.",
  },
  alreadyLinked: {
    ru: "Этот телефон уже привязан к другому аккаунту. Сначала отвяжите его в настройках.",
    uz: "Bu telefon boshqa hisobga bog'langan. Avval sozlamalarda uni uzing.",
  },
  /*
    Чужой чат — но человек, скорее всего, свой и просто не привязан.

    Раньше здесь стояло «откройте настройки в приложении» — ровно то, чего
    агент не делает никогда: он работает с телефона и в настройки веба не
    заходит. Дорога упиралась в тупик, и организации жили с «подключены 0 из 8».

    Поэтому бот называет НОМЕР самого человека. Своего номера в Telegram не
    видит никто — ни сам человек, ни директор в списке участников группы, — а
    без него подключить сотрудника со стороны директора нельзя. Один пересыл
    этого сообщения, и директор вписывает номер у себя.

    `{id}` подставляет отправитель. Отдельной функцией эту строку сделать
    нельзя: весь словарь объявлен парой строк (`satisfies Record<string,
    Pair>`), и на этом держится `say()`.
  */
  unknownChat: {
    ru: "Это бот Warehouse Pro.\n\nВаш Telegram ID: <code>{id}</code>\n\nОтправьте его руководителю — он подключит вас в настройках, и сюда начнут приходить рабочие уведомления.",
    uz: "Bu Warehouse Pro boti.\n\nSizning Telegram ID'ingiz: <code>{id}</code>\n\nUni rahbaringizga yuboring — u sizni sozlamalarda ulaydi va bu yerga ish bildirishnomalari kela boshlaydi.",
  },
  planRequired: {
    ru: "Ответы бота входят в тарифы Pro и Exclusive (и в пробный период). Уведомления работают на любом тарифе.",
    uz: "Bot javoblari Pro va Exclusive tariflariga (va sinov davriga) kiradi. Bildirishnomalar har qanday tarifda ishlaydi.",
  },
  stopped: {
    ru: "Уведомления отключены. Чтобы включить снова — /start",
    uz: "Bildirishnomalar o'chirildi. Qayta yoqish uchun — /start",
  },
  notUnderstood: {
    ru: "Не понял. Нажмите кнопку внизу или напишите название товара или магазина.",
    uz: "Tushunmadim. Pastdagi tugmani bosing yoki mahsulot yoki do'kon nomini yozing.",
  },
  nothing: { ru: "Ничего не нашлось.", uz: "Hech narsa topilmadi." },

  /* ── Группа сотрудников ──────────────────────────────────────────────── */
  groupLinked: {
    ru: "Готово: этот чат связан с вашей организацией.\n\nСюда будут приходить рабочие события — новые заказы, низкие остатки, просроченные долги. Личное (зарплата, свои задачи) в общий чат не уходит никогда.",
    uz: "Tayyor: bu chat tashkilotingizga bog'landi.\n\nBu yerga ish hodisalari keladi — yangi buyurtmalar, kam qoldiq, muddati o'tgan qarzlar. Shaxsiy narsalar (oylik, shaxsiy vazifalar) umumiy chatga hech qachon yuborilmaydi.",
  },
  groupReplaced: {
    ru: "Готово: теперь события приходят в этот чат. Прежняя группа отключена — в неё больше ничего не придёт.",
    uz: "Tayyor: endi hodisalar shu chatga keladi. Oldingi guruh o'chirildi.",
  },
  groupNeedsCode: {
    ru: "Чтобы связать этот чат с организацией, отправьте сюда команду с кодом:\n<code>/link КОД</code>\n\nКод берётся в приложении: Настройки → Telegram → «Группа сотрудников». Он живёт 15 минут.",
    uz: "Bu chatni tashkilot bilan bog'lash uchun kod bilan buyruq yuboring:\n<code>/link KOD</code>\n\nKodni ilovada oling: Sozlamalar → Telegram → «Xodimlar guruhi». U 15 daqiqa yashaydi.",
  },
  groupBadCode: {
    ru: "Код не подошёл. Возможно, он устарел — возьмите новый в приложении: Настройки → Telegram.",
    uz: "Kod to'g'ri kelmadi. Ehtimol eskirgan — ilovadan yangisini oling: Sozlamalar → Telegram.",
  },
  groupUnlinked: {
    ru: "Чат отключён от организации. События сюда больше не приходят.",
    uz: "Chat tashkilotdan uzildi. Hodisalar bu yerga kelmaydi.",
  },
  groupOnlyInGroup: {
    ru: "Эта команда работает в групповом чате: создайте группу, добавьте туда бота и отправьте команду там.",
    uz: "Bu buyruq guruh chatida ishlaydi: guruh yarating, botni qo'shing va buyruqni o'sha yerda yuboring.",
  },

  /* ── Помощь — своя на каждую роль ───────────────────────────────────── */
  helpManage: {
    ru: [
      "Спрашивайте кнопками внизу или словами:",
      "",
      "📊 <b>Сводка</b> — заказы, деньги, долги, визиты; за сегодня, вчера, неделю, месяц",
      "🛒 <b>Заказы</b> — последние заказы и кто их выписал",
      "⏳ <b>Ожидают</b> — заказы, которые ждут вашего подтверждения",
      "👥 <b>Агенты</b> — кто сколько продал сегодня и кто на связи",
      "💰 <b>Долги</b> — кто должен и сколько",
      "📦 <b>Остатки</b> — что заканчивается на складе",
      "🚚 <b>Доставки</b> — как идёт развоз сегодня",
      "🏆 <b>Топ</b> — что лучше продаётся за 30 дней",
      "📍 <b>Визиты</b> — план на сегодня и сколько выполнено",
      "",
      "Название товара или магазина — покажу остаток, цену, долг.",
      "",
      "/staff — кто из сотрудников подключён к боту",
      "/lang — сменить язык · /stop — отключить уведомления",
    ].join("\n"),
    uz: [
      "Pastdagi tugmalar yoki so'zlar bilan so'rang:",
      "",
      "📊 <b>Hisobot</b> — buyurtmalar, pul, qarzlar, tashriflar; bugun, kecha, hafta, oy",
      "🛒 <b>Buyurtmalar</b> — oxirgi buyurtmalar va kim yozgani",
      "⏳ <b>Kutmoqda</b> — tasdiqlashingizni kutayotgan buyurtmalar",
      "👥 <b>Agentlar</b> — bugun kim qancha sotdi va kim aloqada",
      "💰 <b>Qarzlar</b> — kim qancha qarz",
      "📦 <b>Qoldiq</b> — omborda nima tugayapti",
      "🚚 <b>Yetkazish</b> — bugungi tarqatish qanday ketyapti",
      "🏆 <b>Top</b> — 30 kunda nima yaxshi sotilyapti",
      "📍 <b>Tashriflar</b> — bugungi reja va qanchasi bajarildi",
      "",
      "Mahsulot yoki do'kon nomini yozing — qoldiq, narx, qarzni ko'rsataman.",
      "",
      "/staff — xodimlardan kim botga ulangan",
      "/lang — tilni almashtirish · /stop — bildirishnomalarni o'chirish",
    ].join("\n"),
  },
  helpAgent: {
    ru: [
      "Ваш помощник в поле. Кнопки внизу:",
      "",
      "📍 <b>Мой план</b> — визиты на сегодня, что уже сделано",
      "🛒 <b>Мои заказы</b> — последние заказы и их состояние",
      "💰 <b>Долги</b> — кто из ваших магазинов должен",
      "📈 <b>Мой результат</b> — сколько продали сегодня, за неделю, за месяц",
      "📦 <b>Остатки</b> — что заканчивается на складе",
      "💵 <b>Касса</b> — наличные на руках и до какого часа сдать",
      "",
      "Название товара — покажу остаток и цену; название магазина — долг и последний заказ.",
      "",
      "/lang — сменить язык · /stop — отключить уведомления",
    ].join("\n"),
    uz: [
      "Daladagi yordamchingiz. Pastdagi tugmalar:",
      "",
      "📍 <b>Mening rejam</b> — bugungi tashriflar, nima bajarildi",
      "🛒 <b>Mening buyurtmalarim</b> — oxirgi buyurtmalar va holati",
      "💰 <b>Qarzlar</b> — do'konlaringizdan kim qarz",
      "📈 <b>Mening natijam</b> — bugun, hafta, oy qancha sotdingiz",
      "📦 <b>Qoldiq</b> — omborda nima tugayapti",
      "💵 <b>Kassa</b> — qo'ldagi naqd pul va qachongacha topshirish",
      "",
      "Mahsulot nomi — qoldiq va narx; do'kon nomi — qarz va oxirgi buyurtma.",
      "",
      "/lang — tilni almashtirish · /stop — bildirishnomalarni o'chirish",
    ].join("\n"),
  },
  helpCourier: {
    ru: [
      "Ваш помощник на маршруте. Кнопки внизу:",
      "",
      "🚚 <b>Мои доставки</b> — что везти сегодня: адреса, суммы, как платят",
      "💵 <b>Касса</b> — наличные на руках, принято сегодня, до какого часа сдать",
      "",
      "/lang — сменить язык · /stop — отключить уведомления",
    ].join("\n"),
    uz: [
      "Marshrutdagi yordamchingiz. Pastdagi tugmalar:",
      "",
      "🚚 <b>Mening yetkazishlarim</b> — bugun nima olib borish: manzil, summa, to'lov",
      "💵 <b>Kassa</b> — qo'ldagi naqd pul, bugun qabul qilingan, qachongacha topshirish",
      "",
      "/lang — tilni almashtirish · /stop — bildirishnomalarni o'chirish",
    ].join("\n"),
  },

  /* ── Заголовки и слова ответов ───────────────────────────────────────── */
  hSummary:    { ru: "Сводка",                   uz: "Hisobot" },
  hMyResult:   { ru: "Мой результат",            uz: "Mening natijam" },
  hOrders:     { ru: "Последние заказы",         uz: "Oxirgi buyurtmalar" },
  hMyOrders:   { ru: "Мои заказы",               uz: "Mening buyurtmalarim" },
  hPending:    { ru: "Ждут подтверждения",       uz: "Tasdiqlashni kutmoqda" },
  hAgents:     { ru: "Агенты сегодня",           uz: "Bugun agentlar" },
  hDebts:      { ru: "Долги магазинов",          uz: "Do'konlar qarzi" },
  hStock:      { ru: "Заканчивается на складе",  uz: "Omborda tugayapti" },
  hDeliveries: { ru: "Доставки сегодня",         uz: "Bugungi yetkazishlar" },
  hMyDeliveries: { ru: "Мои доставки сегодня",   uz: "Bugungi yetkazishlarim" },
  hCash:       { ru: "Наличные на руках",        uz: "Qo'ldagi naqd pul" },
  hTop:        { ru: "Топ товаров за 30 дней",   uz: "30 kunlik top mahsulotlar" },
  hPlans:      { ru: "Визиты сегодня",           uz: "Bugungi tashriflar" },
  hMyPlan:     { ru: "Мой план на сегодня",      uz: "Bugungi rejam" },
  hStaff:      { ru: "Сотрудники",               uz: "Xodimlar" },
  hProduct:    { ru: "Товары",                   uz: "Mahsulotlar" },
  hShops:      { ru: "Магазины",                 uz: "Do'konlar" },

  pToday:     { ru: "сегодня",   uz: "bugun" },
  pYesterday: { ru: "вчера",     uz: "kecha" },
  pWeek:      { ru: "7 дней",    uz: "7 kun" },
  pMonth:     { ru: "30 дней",   uz: "30 kun" },

  wOrders:    { ru: "Заказы",           uz: "Buyurtmalar" },
  wDelivered: { ru: "Доставлено",       uz: "Yetkazildi" },
  wInWork:    { ru: "В работе",         uz: "Jarayonda" },
  wPending:   { ru: "Ждут подтверждения", uz: "Tasdiqlashni kutmoqda" },
  wCash:      { ru: "Деньги приняты",   uz: "Pul qabul qilindi" },
  wDebt:      { ru: "Долг магазинов",   uz: "Do'konlar qarzi" },
  wVisits:    { ru: "Визиты",           uz: "Tashriflar" },
  wLow:       { ru: "Заканчивается",    uz: "Tugayapti" },
  wBest:      { ru: "Лучший агент",     uz: "Eng yaxshi agent" },
  wPrev:      { ru: "до этого",         uz: "undan oldin" },
  wLeft:      { ru: "остаток",          uz: "qoldiq" },
  wPrice:     { ru: "цена",             uz: "narx" },
  wThreshold: { ru: "порог",            uz: "chegara" },
  wOf:        { ru: "из",               uz: "dan" },
  wNoSignal:  { ru: "нет сигнала",      uz: "signal yo'q" },
  wLastSeen:  { ru: "на связи",         uz: "aloqada" },
  wTotal:     { ru: "Итого",            uz: "Jami" },
  wReason:    { ru: "причина",          uz: "sabab" },
  wDiscount:  { ru: "скидка",           uz: "chegirma" },
  wLastOrder: { ru: "последний заказ",  uz: "oxirgi buyurtma" },
  wAgent:     { ru: "агент",            uz: "agent" },
  wCourier:   { ru: "курьер",           uz: "kuryer" },
  wOpen:      { ru: "Открыть в приложении", uz: "Ilovada ochish" },
  wConfirmHint: { ru: "Подтвердить: Заказы → «Ожидает»", uz: "Tasdiqlash: Buyurtmalar → «Kutishda»" },

  wStockOk:   { ru: "Всё в порядке, ничего не заканчивается.", uz: "Hammasi joyida, hech narsa tugamayapti." },
  wNoDebts:   { ru: "Долгов нет.", uz: "Qarzlar yo'q." },
  wNoPending: { ru: "Всё подтверждено — ожидающих заказов нет.", uz: "Hammasi tasdiqlangan — kutayotgan buyurtma yo'q." },
  wNoPlans:   { ru: "На сегодня визитов не запланировано.", uz: "Bugunga tashrif rejalashtirilmagan." },
  wNoDeliveries: { ru: "На сегодня доставок нет.", uz: "Bugunga yetkazish yo'q." },
  wNoAgents:  { ru: "Сегодня заказов и визитов ещё не было.", uz: "Bugun hali buyurtma va tashrif bo'lmadi." },
  wNoCash:    { ru: "Наличных на руках нет — всё принято.", uz: "Qo'lda naqd pul yo'q — hammasi qabul qilingan." },
  wNoStaff:   { ru: "Сотрудников нет.", uz: "Xodimlar yo'q." },
  staffHint: {
    ru: "Не подключённые к боту уведомлений не получают. Настройки → Telegram в приложении.",
    uz: "Botga ulanmaganlar bildirishnoma olmaydi. Ilovada Sozlamalar → Telegram.",
  },

  /* ── Утро ────────────────────────────────────────────────────────────── */
  hMorning:     { ru: "Доброе утро", uz: "Xayrli tong" },
  morningTeam:  { ru: "План на сегодня", uz: "Bugungi reja" },
  wDebtsToCollect: { ru: "Долги к сбору у ваших магазинов", uz: "Do'konlaringizdan yig'iladigan qarz" },

  /* ── Касса ───────────────────────────────────────────────────────────── */
  wOnHand:        { ru: "На руках",             uz: "Qo'lda" },
  wSince:         { ru: "Самая старая запись",  uz: "Eng eski yozuv" },
  wDeliveriesPlanned: { ru: "Доставок назначено", uz: "Yetkazish tayinlandi" },
} satisfies Record<string, Pair>;

export function say(key: keyof typeof T, lang: Lang): string {
  return T[key][lang];
}

/** Кому какое меню: руководители, агенты (и мерчандайзеры), курьеры. */
export type MenuGroup = "manage" | "agent" | "courier";

export function menuGroup(role: string): MenuGroup {
  if (role === "courier") return "courier";
  if (role === "agent" || role === "merchandiser") return "agent";
  return "manage";
}

/** Подписи кнопок постоянного меню — по группе и языку. Слова те же, что понимает разбор. */
export const MENUS: Record<MenuGroup, Record<Lang, string[][]>> = {
  manage: {
    ru: [["📊 Сводка", "🛒 Заказы"], ["⏳ Ожидают", "👥 Агенты"], ["💰 Долги", "📦 Остатки"], ["🚚 Доставки", "🏆 Топ"], ["📍 Визиты", "❓ Помощь"]],
    uz: [["📊 Hisobot", "🛒 Buyurtmalar"], ["⏳ Kutmoqda", "👥 Agentlar"], ["💰 Qarzlar", "📦 Qoldiq"], ["🚚 Yetkazish", "🏆 Top"], ["📍 Tashriflar", "❓ Yordam"]],
  },
  agent: {
    ru: [["📍 Мой план", "🛒 Мои заказы"], ["💰 Долги", "📈 Мой результат"], ["📦 Остатки", "💵 Касса"], ["❓ Помощь"]],
    uz: [["📍 Mening rejam", "🛒 Mening buyurtmalarim"], ["💰 Qarzlar", "📈 Mening natijam"], ["📦 Qoldiq", "💵 Kassa"], ["❓ Yordam"]],
  },
  courier: {
    ru: [["🚚 Мои доставки", "💵 Касса"], ["❓ Помощь"]],
    uz: [["🚚 Mening yetkazishlarim", "💵 Kassa"], ["❓ Yordam"]],
  },
};

/** Меню руководителя — для стражей и старых вызовов. */
export const MENU = MENUS.manage;

/**
 * Что имел в виду человек.
 *
 * Кнопки шлют ровно те же слова, что и клавиатура, поэтому отдельной ветки для
 * них не нужно: нажатие и набранное вручную слово приходят одинаково. Значок
 * в начале кнопки отрезается до разбора.
 *
 * Намерение общее для ролей: «заказы» у директора — заказы организации, у
 * агента — его собственные; кто что видит, решает scope в answers.ts.
 */
export type Intent =
  | "stock" | "orders" | "pending" | "agents" | "summary" | "top" | "debts" | "deliveries" | "cash"
  | "staff" | "plans" | "help" | "lang" | "stop" | "search";

export type Period = "today" | "yesterday" | "week" | "month";

const clean = (raw: string) => raw.trim().toLowerCase().replace(/^[^\p{L}\p{N}/]+/u, "").trim();

export function detectIntent(raw: string): Intent {
  const t = clean(raw);
  if (t === "/lang" || t === "/til") return "lang";
  if (t === "/stop") return "stop";
  if (/^\/?(help|start|помощь|команд|yordam|buyruq)/.test(t)) return "help";
  if (/^\/?(stock|остатк|склад|qoldiq|ombor)/.test(t)) return "stock";
  if (/^\/?(pending|ожида|подтвержд|kutmoqda|kutish|tasdiq)/.test(t)) return "pending";
  if (/^\/?(orders?|заказ|мои заказ|buyurtma|mening buyurtma)/.test(t)) return "orders";
  if (/^\/?(agents?|агент|agentlar)/.test(t)) return "agents";
  if (/^\/?(summary|сводк|итог|отчёт|отчет|результат|мой результат|hisobot|yakun|natija|mening natija|вчера|kecha|недел|hafta|месяц|oy$)/.test(t)) return "summary";
  if (/^\/?(top|топ|лучш|популярн)/.test(t)) return "top";
  if (/^\/?(debts?|долг|qarz)/.test(t)) return "debts";
  if (/^\/?(deliveries|deliver|доставк|мои доставк|yetkazish|mening yetkazish)/.test(t)) return "deliveries";
  if (/^\/?(cash|касса|kassa)/.test(t)) return "cash";
  if (/^\/?(staff|сотрудник|команд[аы]|персонал|xodim)/.test(t)) return "staff";
  if (/^\/?(plans?|план|мой план|визит|reja|mening reja|tashrif)/.test(t)) return "plans";
  return "search";
}

/** За какой срок: «сводка за неделю», «вчера», «месяц». По умолчанию — сегодня. */
export function detectPeriod(raw: string): Period {
  const t = clean(raw);
  if (/вчера|kecha|yesterday/.test(t)) return "yesterday";
  if (/недел|hafta|week/.test(t)) return "week";
  if (/месяц|oy\b|month/.test(t)) return "month";
  return "today";
}
