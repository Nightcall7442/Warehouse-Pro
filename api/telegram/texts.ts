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
  unknownChat: {
    ru: "Это бот Warehouse Pro.\n\nЧтобы получать уведомления, откройте настройки в приложении и нажмите «Подключить Telegram».",
    uz: "Bu Warehouse Pro boti.\n\nBildirishnomalarni olish uchun ilovada sozlamalarni ochib, «Telegramni ulash» tugmasini bosing.",
  },
  /** Роль есть, но спрашивать боту нельзя. */
  notAllowed: {
    ru: "Уведомления вы получаете, а запросы к боту доступны руководителям: директору, оператору и супервайзеру.",
    uz: "Bildirishnomalarni olasiz, lekin botga so'rov yuborish rahbarlar uchun: direktor, operator va supervayzer.",
  },
  planRequired: {
    ru: "Ответы бота входят в тарифы Pro и Exclusive. Уведомления работают на любом тарифе.",
    uz: "Bot javoblari Pro va Exclusive tariflariga kiradi. Bildirishnomalar har qanday tarifda ishlaydi.",
  },
  tooFast: {
    ru: "Слишком часто. Подождите минуту.",
    uz: "Juda tez. Bir daqiqa kuting.",
  },
  stopped: {
    ru: "Уведомления отключены. Чтобы включить снова — /start",
    uz: "Bildirishnomalar o'chirildi. Qayta yoqish uchun — /start",
  },
  help: {
    ru: [
      "Что умею:",
      "",
      "• <b>Остатки</b> — что заканчивается на складе",
      "• <b>Заказы</b> — последние заказы",
      "• <b>Сводка</b> — итоги за сегодня",
      "• <b>Топ</b> — что лучше продаётся",
      "• <b>Долги</b> — кто должен и сколько",
      "",
      "Название товара тоже понимаю: напишите «кока-кола» — покажу остаток и цену.",
      "",
      "/lang — сменить язык",
      "/stop — отключить уведомления",
    ].join("\n"),
    uz: [
      "Nimalarni bilaman:",
      "",
      "• <b>Qoldiq</b> — omborda nima tugayapti",
      "• <b>Buyurtmalar</b> — oxirgi buyurtmalar",
      "• <b>Hisobot</b> — bugungi yakun",
      "• <b>Top</b> — nima yaxshi sotilyapti",
      "• <b>Qarzlar</b> — kim qancha qarz",
      "",
      "Mahsulot nomini ham tushunaman: «coca-cola» deb yozing — qoldiq va narxni ko'rsataman.",
      "",
      "/lang — tilni almashtirish",
      "/stop — bildirishnomalarni o'chirish",
    ].join("\n"),
  },
  notUnderstood: {
    ru: "Не понял. Нажмите кнопку внизу или напишите «помощь».",
    uz: "Tushunmadim. Pastdagi tugmani bosing yoki «yordam» deb yozing.",
  },
  nothing: {
    ru: "Ничего не нашлось.",
    uz: "Hech narsa topilmadi.",
  },
  // ── Заголовки ответов ────────────────────────────────────────────────────
  hStock:   { ru: "Заканчивается на складе",  uz: "Omborda tugayapti" },
  hOrders:  { ru: "Последние заказы",         uz: "Oxirgi buyurtmalar" },
  hSummary: { ru: "Итоги за сегодня",         uz: "Bugungi yakun" },
  hTop:     { ru: "Топ товаров за 30 дней",   uz: "30 kunlik top mahsulotlar" },
  hDebts:   { ru: "Долги магазинов",          uz: "Do'konlar qarzi" },
  hProduct: { ru: "Товар",                    uz: "Mahsulot" },
  // ── Слова в строках ──────────────────────────────────────────────────────
  wOrders:  { ru: "заказов",   uz: "buyurtma" },
  wRevenue: { ru: "выручка",   uz: "tushum" },
  wDebt:    { ru: "долг",      uz: "qarz" },
  wLeft:    { ru: "осталось",  uz: "qoldi" },
  wPrice:   { ru: "цена",      uz: "narx" },
  wAll:     { ru: "всего",     uz: "jami" },
  wStockOk: { ru: "Всё в порядке, ничего не заканчивается.", uz: "Hammasi joyida, hech narsa tugamayapti." },
  wNoDebts: { ru: "Долгов нет.", uz: "Qarzlar yo'q." },
} satisfies Record<string, Pair>;

export function say(key: keyof typeof T, lang: Lang): string {
  return T[key][lang];
}

/** Подписи кнопок постоянного меню. */
export const MENU: Record<Lang, string[][]> = {
  ru: [["Остатки", "Заказы"], ["Сводка", "Топ"], ["Долги", "Помощь"]],
  uz: [["Qoldiq", "Buyurtmalar"], ["Hisobot", "Top"], ["Qarzlar", "Yordam"]],
};

/**
 * Что имел в виду человек.
 *
 * Кнопки шлют ровно те же слова, что и клавиатура, поэтому отдельной ветки для
 * них не нужно: нажатие и набранное вручную слово приходят одинаково.
 */
export type Intent = "stock" | "orders" | "summary" | "top" | "debts" | "help" | "lang" | "stop" | "search";

export function detectIntent(raw: string): Intent {
  const t = raw.trim().toLowerCase();
  if (t === "/lang" || t === "/til") return "lang";
  if (t === "/stop") return "stop";
  if (/^\/?(help|start|помощь|команд|yordam|buyruq)/.test(t)) return "help";
  if (/^\/?(stock|остатк|склад|qoldiq|ombor)/.test(t)) return "stock";
  if (/^\/?(orders|заказ|buyurtma)/.test(t)) return "orders";
  if (/^\/?(summary|сводк|итог|отчёт|отчет|hisobot|yakun)/.test(t)) return "summary";
  if (/^\/?(top|топ|лучш|популярн)/.test(t)) return "top";
  if (/^\/?(debts?|долг|qarz)/.test(t)) return "debts";
  return "search";
}
