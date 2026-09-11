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
  /*
    Чужой чат — но человек, скорее всего, свой и просто не привязан.

    Раньше здесь стояло «откройте настройки в приложении» — ровно то, чего
    агент не делает никогда: он работает с телефона и в настройки веба не
    заходит. Дорога упиралась в тупик, и организации жили с «подключены 0 из 8».

    Поэтому бот называет НОМЕР самого человека. Своего номера в Telegram не
    видит никто — ни сам человек, ни директор в списке участников группы, — а
    без него подключить сотрудника со стороны директора нельзя. Один пересыл
    этого сообщения, и директор вписывает номер у себя.

    Заодно это снимает вторую половину задачи: чтобы бот мог написать первым,
    человек обязан один раз нажать «Запустить». Здесь он уже нажал — иначе
    этого сообщения бы не было.
  */
  /*
    `{id}` подставляет отправитель. Отдельной функцией эту строку сделать
    нельзя: весь словарь объявлен парой строк (`satisfies Record<string,
    Pair>`), и на этом держится `say()` — одна функция среди сотни строк
    развалила бы обоих.
  */
  unknownChat: {
    ru: "Это бот Warehouse Pro.\n\nВаш Telegram ID: <code>{id}</code>\n\nОтправьте его руководителю — он подключит вас в настройках, и сюда начнут приходить рабочие уведомления.",
    uz: "Bu Warehouse Pro boti.\n\nSizning Telegram ID'ingiz: <code>{id}</code>\n\nUni rahbaringizga yuboring — u sizni sozlamalarda ulaydi va bu yerga ish bildirishnomalari kela boshlaydi.",
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
  hStaff: { ru: "Сотрудники", uz: "Xodimlar" },
  wNoStaff: { ru: "Сотрудников нет.", uz: "Xodimlar yo'q." },
  staffHint: {
    ru: "Не подключённые к боту уведомлений не получают. Настройки → Telegram в приложении.",
    uz: "Botga ulanmaganlar bildirishnoma olmaydi. Ilovada Sozlamalar → Telegram.",
  },
  hPlans: { ru: "Визиты на сегодня", uz: "Bugungi tashriflar" },
  wNoPlans: { ru: "На сегодня визитов не запланировано.", uz: "Bugunga tashrif rejalashtirilmagan." },

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

  help: {
    ru: [
      "Что умею:",
      "",
      "• <b>Остатки</b> — что заканчивается на складе",
      "• <b>Заказы</b> — последние заказы",
      "• <b>Сводка</b> — итоги за сегодня",
      "• <b>Топ</b> — что лучше продаётся",
      "• <b>Долги</b> — кто должен и сколько",
      "• <b>Сотрудники</b> — кто подключён к боту, а кому напомнить",
      "• <b>Планы</b> — визиты на сегодня и сколько выполнено",
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
      "• <b>Xodimlar</b> — kim botga ulangan, kimga eslatish kerak",
      "• <b>Rejalar</b> — bugungi tashriflar va bajarilgani",
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
  ru: [["Остатки", "Заказы"], ["Сводка", "Топ"], ["Долги", "Сотрудники"], ["Планы", "Помощь"]],
  uz: [["Qoldiq", "Buyurtmalar"], ["Hisobot", "Top"], ["Qarzlar", "Xodimlar"], ["Rejalar", "Yordam"]],
};

/**
 * Что имел в виду человек.
 *
 * Кнопки шлют ровно те же слова, что и клавиатура, поэтому отдельной ветки для
 * них не нужно: нажатие и набранное вручную слово приходят одинаково.
 */
/*
  «staff» и «plans» добавлены для директора: первое отвечает на «кто из
  моих подключён к боту», второе — на «объехали ли сегодня то, что
  planировали». Оба вопроса задают из телефона и по дороге, а не за
  компьютером.
*/
export type Intent = "stock" | "orders" | "summary" | "top" | "debts" | "staff" | "plans" | "help" | "lang" | "stop" | "search";

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
  if (/^\/?(staff|сотрудник|команд[аы]|персонал|xodim)/.test(t)) return "staff";
  if (/^\/?(plans?|план|визит|reja|tashrif)/.test(t)) return "plans";
  return "search";
}
