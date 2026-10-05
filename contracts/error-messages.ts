/**
 * Отказы сервера на языке интерфейса.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Сервер отказывал только по-русски: «Недостаточно товара», «Заказ уже
 * закрыт». Человек с узбекским интерфейсом читал русский текст под
 * узбекскими кнопками — на экране 1С это было «Внутренняя ошибка сервера…».
 *
 * ── Как устроено ────────────────────────────────────────────────────────────
 *
 * Клиент шлёт язык заголовком `x-lang` (ru | uz). Сервер бросает отказы
 * по-прежнему по-русски — в коде, в журнале и в тестах текст один, — а
 * форматтер ошибок (api/middleware.ts) в одном месте подставляет перевод из
 * этого словаря и помечает ответ `data.lang`. Без заголовка — русский, как
 * раньше: старое мобильное приложение получает ровно то же, что получало.
 *
 * Ключ — текст из кода сервера. Вставки шаблона (`${…}` в исходнике)
 * записываются как `{0}`, `{1}` по порядку; перевод может переставить их или
 * опустить, если вставка сама по-русски (название статуса, перечень).
 * `ru` пишется только там, где исходник английский.
 *
 * Полноту словаря стережёт api/__tests__/error-messages-catalog.test.ts: он
 * читает исходники сервера и падает на любом отказе, которого здесь нет.
 */
import { ErrorMessages, SUBSCRIPTION_REQUIRED } from "./constants";
import { PHONE_ERROR } from "./signup";

export type UiLang = "ru" | "uz";

/** Язык из заголовка: всё, кроме узбекского, — русский. */
export function parseUiLang(value: unknown): UiLang {
  return typeof value === "string" && value.trim().toLowerCase().startsWith("uz") ? "uz" : "ru";
}

export interface ErrorText { uz: string; ru?: string }

/** Внутренняя ошибка: что сломалось, человеку знать незачем. */
export const INTERNAL_ERROR_TEXT: Record<UiLang, string> = {
  ru: "Внутренняя ошибка сервера. Попробуйте позже.",
  uz: "Serverda ichki xatolik. Keyinroq urinib ko'ring.",
};

export const SERVER_ERROR_TEXT: Record<string, ErrorText> = {
  // ── Вход, роль, подписка, частота ─────────────────────────────────────────
  [ErrorMessages.unauthenticated]: { ru: "Сессия закончилась. Войдите снова.", uz: "Sessiya tugadi. Qaytadan kiring." },
  [ErrorMessages.insufficientRole]: { ru: "Нет доступа: у вашей роли нет прав на это.", uz: "Ruxsat yo'q: rolingizda bunga huquq yo'q." },
  [ErrorMessages.subscriptionRequired]: { uz: SUBSCRIPTION_REQUIRED.uz },
  [ErrorMessages.demoBlocked]: { uz: "Demo rejim: bu amal o'chirilgan. Bu yerdagi ma'lumotlar namunaviy." },
  "Это не песочница. Досевать демо можно только песочницу.": { uz: "Bu sandbox emas. Demo ma'lumotlarini faqat sandboxga qo'shish mumkin." },
  "В песочнице нет основного склада.": { uz: "Sandboxda asosiy ombor yo'q." },
  "Организация не найдена. Пожалуйста, войдите заново.": { uz: "Tashkilot topilmadi. Iltimos, qaytadan kiring." },
  "Слишком много запросов. Подождите минуту.": { uz: "So'rovlar juda ko'p. Bir daqiqa kuting." },
  "Слишком много запросов. Попробуйте позже.": { uz: "So'rovlar juda ko'p. Keyinroq urinib ko'ring." },
  "Слишком много запросов.": { uz: "So'rovlar juda ko'p." },
  "Слишком часто. Подождите минуту.": { uz: "Juda tez-tez. Bir daqiqa kuting." },
  "Это действие закрыто оператору в вашей организации. Обратитесь к руководителю.": { uz: "Tashkilotingizda bu amal operator uchun yopilgan. Rahbarga murojaat qiling." },
  "Only CEO or SuperAdmin can manage API keys.": { ru: "Ключами API управляет только директор.", uz: "API kalitlarini faqat direktor boshqaradi." },
  "Действие доступно только со вторым фактором — включите его в профиле": { uz: "Bu amal faqat ikkinchi omil bilan mumkin — uni profilda yoqing" },
  "Введите код из приложения-аутентификатора": { uz: "Autentifikator ilovasidagi kodni kiriting" },
  "Неверный код подтверждения": { uz: "Tasdiqlash kodi noto'g'ri" },

  // ── Вход (REST /api/login, api/http/auth.ts) ──────────────────────────────
  "Email and password required": { ru: "Введите почту и пароль.", uz: "Pochta va parolni kiriting." },
  "Too many login attempts. Please try again in 15 minutes.": { ru: "Слишком много попыток входа. Попробуйте через 15 минут.", uz: "Kirish urinishlari juda ko'p. 15 daqiqadan so'ng urinib ko'ring." },
  "Неверный email или пароль": { uz: "Email yoki parol noto'g'ri" },
  "Этот адрес используется в нескольких организациях. Выберите нужную.": { uz: "Bu manzil bir nechta tashkilotda ishlatiladi. Keraklisini tanlang." },
  "Подтвердите адрес почты: откройте ссылку из письма, отправленного при регистрации.": { uz: "Pochta manzilini tasdiqlang: ro'yxatdan o'tishda yuborilgan xatdagi havolani oching." },
  "Login failed": { ru: "Не получилось войти. Попробуйте ещё раз.", uz: "Kirib bo'lmadi. Qayta urinib ko'ring." },

  // ── Профиль, логин, пароль, второй фактор ─────────────────────────────────
  "Too many attempts. Try again in 15 minutes.": { ru: "Слишком много попыток. Попробуйте через 15 минут.", uz: "Urinishlar juda ko'p. 15 daqiqadan so'ng urinib ko'ring." },
  "Слишком много попыток. Попробуйте через 15 минут.": { uz: "Urinishlar juda ko'p. 15 daqiqadan so'ng urinib ko'ring." },
  "User not found.": { ru: "Пользователь не найден.", uz: "Foydalanuvchi topilmadi." },
  "Пользователь не найден": { uz: "Foydalanuvchi topilmadi" },
  "Current password is incorrect.": { ru: "Текущий пароль не подошёл.", uz: "Joriy parol mos kelmadi." },
  "Неверный текущий пароль": { uz: "Joriy parol noto'g'ri" },
  "Введите текущий пароль": { uz: "Joriy parolni kiriting" },
  "Пароль должен быть не менее 8 символов": { uz: "Parol kamida 8 belgidan iborat bo'lishi kerak" },
  "Это и есть ваш текущий логин": { uz: "Bu sizning hozirgi loginingiz" },
  "Этот логин уже занят — выберите другой": { uz: "Bu login band — boshqasini tanlang" },
  "Логин — адрес почты, например owner@example.com": { uz: "Login — pochta manzili, masalan owner@example.com" },
  "Аватар не больше 1 МБ": { uz: "Avatar 1 MB dan oshmasin" },
  "Email already in use in this organization.": { ru: "Такая почта уже есть в этой организации.", uz: "Bu pochta tashkilotda allaqachon bor." },
  "Нельзя деактивировать или сменить роль последнего активного CEO.": { uz: "Oxirgi faol direktorni o'chirib yoki rolini o'zgartirib bo'lmaydi." },
  "Нельзя деактивировать последнего активного CEO.": { uz: "Oxirgi faol direktorni o'chirib bo'lmaydi." },
  "Cannot deactivate the last active CEO. Transfer credentials without deactivation instead.": { ru: "Нельзя отключить последнего директора. Передайте доступ, не отключая его.", uz: "Oxirgi direktorni o'chirib bo'lmaydi. Kirish ma'lumotlarini uni o'chirmasdan bering." },
  "Второй фактор уже включён. Чтобы перевыпустить, сначала выключите его кодом из приложения.": { uz: "Ikkinchi omil allaqachon yoqilgan. Qayta chiqarish uchun avval uni ilovadagi kod bilan o'chiring." },
  "Сначала получите секрет (totpSetup)": { uz: "Avval maxfiy kalitni oling" },
  "Неверный код — проверьте время на телефоне": { uz: "Kod noto'g'ri — telefondagi vaqtni tekshiring" },
  "Неверный код": { uz: "Kod noto'g'ri" },
  "Ссылка устарела. Запросите новое письмо на странице входа.": { uz: "Havola eskirgan. Kirish sahifasida yangi xat so'rang." },
  "Ссылка недействительна.": { uz: "Havola yaroqsiz." },
  "Ссылка недействительна или уже использована.": { uz: "Havola yaroqsiz yoki allaqachon ishlatilgan." },

  // ── Организация, регистрация, приглашения, сотрудники ─────────────────────
  "Организация не найдена": { uz: "Tashkilot topilmadi" },
  "Tenant not found.": { ru: "Организация не найдена.", uz: "Tashkilot topilmadi." },
  "Too many registration attempts.": { ru: "Слишком много попыток регистрации. Попробуйте позже.", uz: "Ro'yxatdan o'tish urinishlari juda ko'p. Keyinroq urinib ko'ring." },
  "Unable to generate unique slug.": { ru: "Не удалось подобрать адрес организации. Попробуйте другое название.", uz: "Tashkilot manzilini tanlab bo'lmadi. Boshqa nom bilan urinib ko'ring." },
  "Email already registered.": { ru: "Эта почта уже зарегистрирована.", uz: "Bu pochta allaqachon ro'yxatdan o'tgan." },
  [PHONE_ERROR.ru]: { uz: PHONE_ERROR.uz },
  "Не удалось подобрать адрес песочницы.": { uz: "Sinov muhiti manzilini tanlab bo'lmadi." },
  "Этот адрес уже занят.": { uz: "Bu manzil band." },
  "Для подтверждения наберите точно: {0}": { uz: "Tasdiqlash uchun aynan shuni yozing: {0}" },
  "Сначала приостановите организацию — удалить можно только приостановленную": { uz: "Avval tashkilotni to'xtating — faqat to'xtatilganini o'chirish mumkin" },
  "Организация не удалилась — откат": { uz: "Tashkilot o'chirilmadi — o'zgarishlar bekor qilindi" },
  "Это не песочница. Заполнять выдуманными данными можно только песочницу.": { uz: "Bu sinov muhiti emas. To'qima ma'lumotlarni faqat sinov muhitiga kiritish mumkin." },
  "В этой организации уже есть заказы — заполнять её нечем и незачем.": { uz: "Bu tashkilotda buyurtmalar allaqachon bor — uni to'ldirish kerak emas." },
  "Сотрудник не найден в этой организации": { uz: "Xodim bu tashkilotda topilmadi" },
  "Такая почта уже есть у другого сотрудника этой организации": { uz: "Bu pochta tashkilotning boshqa xodimida bor" },
  "Достигнут лимит пользователей ({0}/{1})": { uz: "Foydalanuvchilar limiti tugadi ({0}/{1})" },
  "Достигнут лимит пользователей тарифа ({0}). Обновите тариф для добавления новых пользователей.": { uz: "Tarif bo'yicha foydalanuvchilar limiti tugadi ({0}). Yangi foydalanuvchi qo'shish uchun tarifni yangilang." },
  "Этот адрес уже есть среди сотрудников вашей организации.": { uz: "Bu manzil tashkilotingiz xodimlari orasida bor." },
  "Приглашение недействительно или истекло.": { uz: "Taklif yaroqsiz yoki muddati o'tgan." },
  "Приглашение уже принято.": { uz: "Taklif allaqachon qabul qilingan." },
  "Приглашение уже использовано.": { uz: "Taklif allaqachon ishlatilgan." },
  "Сотрудник не найден в вашей организации": { uz: "Xodim tashkilotingizda topilmadi" },
  "Сотрудник не найден": { uz: "Xodim topilmadi" },
  "У сотрудника нет расписания. Выберите территорию или магазины и дни недели.": { uz: "Xodimning jadvali yo'q. Hudud yoki do'konlarni va hafta kunlarini tanlang." },
  "Этот Telegram уже привязан к другому сотруднику.": { uz: "Bu Telegram boshqa xodimga bog'langan." },
  "chat_id должен быть числом": { uz: "chat_id son bo'lishi kerak" },
  "Telegram ID — только цифры (это не номер телефона)": { uz: "Telegram ID — faqat raqamlar (bu telefon raqami emas)" },

  // ── Тариф, оплата подписки, объявления ────────────────────────────────────
  "Укажите, сколько мест или позиций докупить.": { uz: "Qancha o'rin yoki pozitsiya sotib olishni ko'rsating." },
  "Plan not configured.": { ru: "Тариф не настроен.", uz: "Tarif sozlanmagan." },
  "No billing account found. Please subscribe first.": { ru: "Нет платёжного аккаунта. Сначала оформите подписку.", uz: "To'lov hisobi yo'q. Avval obunani rasmiylashtiring." },
  "Достигнут предел тарифа по заказам за месяц ({0} из {1}). Перейдите на старший тариф.": { uz: "Tarif bo'yicha oylik buyurtmalar chegarasi tugadi ({0} / {1}). Yuqoriroq tarifga o'ting." },
  "Достигнут предел тарифа по товарам ({0} из {1}). Перейдите на старший тариф или докупите позиции.": { uz: "Tarif bo'yicha mahsulotlar chegarasi tugadi ({0} / {1}). Yuqoriroq tarifga o'ting yoki pozitsiya sotib oling." },
  "Дата оплаты в будущем": { uz: "To'lov sanasi kelajakda" },
  "Дата в виде ГГГГ-ММ-ДД": { uz: "Sana YYYY-OO-KK ko'rinishida" },
  "Сумма — целыми сумами": { uz: "Summa — butun so'mlarda" },
  "Сумма больше нуля": { uz: "Summa noldan katta bo'lsin" },
  "Выберите хотя бы один тариф": { uz: "Kamida bitta tarifni tanlang" },
  "Выберите хотя бы одну организацию": { uz: "Kamida bitta tashkilotni tanlang" },
  "По-узбекски нужны и заголовок, и текст — или ни того, ни другого": { uz: "O'zbekcha sarlavha ham, matn ham kerak — yoki ikkalasi ham bo'lmasin" },
  "Конец показа раньше начала": { uz: "Ko'rsatish oxiri boshidan oldin" },
  "Объявление не найдено": { uz: "E'lon topilmadi" },
  "Заголовок — хотя бы три буквы": { uz: "Sarlavha — kamida uchta harf" },
  "Напишите текст": { uz: "Matnni yozing" },
  "Заявка уже отправлена. Мы свяжемся с вами в ближайшее время.": { uz: "Ariza allaqachon yuborilgan. Tez orada siz bilan bog'lanamiz." },
  "Слишком много заявок. Попробуйте позже.": { uz: "Arizalar juda ko'p. Keyinroq urinib ko'ring." },
  "Укажите имя": { uz: "Ismingizni kiriting" },
  "Проверьте номер телефона": { uz: "Telefon raqamini tekshiring" },
  "Сообщение пустое.": { uz: "Xabar bo'sh." },
  "Сообщение длиннее {0} символов.": { uz: "Xabar {0} belgidan uzun." },

  // ── Магазины, территории, агенты, визиты ──────────────────────────────────
  "Магазин не найден": { uz: "Do'kon topilmadi" },
  "Магазин не найден в вашей организации": { uz: "Do'kon tashkilotingizda topilmadi" },
  "Магазин не найден в вашем тенанте": { uz: "Do'kon tashkilotingizda topilmadi" },
  "Магазин не найден или уже в работе": { uz: "Do'kon topilmadi yoki allaqachon ishda" },
  "Ни один из выбранных магазинов не найден в вашей организации": { uz: "Tanlangan do'konlarning birortasi ham tashkilotingizda topilmadi" },
  "Магазин «{0}» в архиве. Верните его в работу, чтобы оформить заказ.": { uz: "«{0}» do'koni arxivda. Buyurtma berish uchun uni ishga qaytaring." },
  "Точку нельзя удалить: за ней числятся {0}. Её можно убрать в архив — история сохранится, и точку можно будет вернуть.": { uz: "Do'konni o'chirib bo'lmaydi: unda tarix bor. Uni arxivga olish mumkin — tarix saqlanadi va do'konni qaytarish mumkin bo'ladi." },
  "Лимит — неотрицательное число": { uz: "Limit — manfiy bo'lmagan son" },
  "Отсрочка — от 0 до 365 дней": { uz: "Kechiktirish — 0 dan 365 kungacha" },
  "Отсрочка — целое число дней": { uz: "Kechiktirish — butun kunlar soni" },
  "Территория не найдена в вашей организации": { uz: "Hudud tashkilotingizda topilmadi" },
  "Часть территорий не найдена в вашей организации": { uz: "Hududlarning bir qismi tashkilotingizda topilmadi" },
  "Невозможно удалить территорию: за ней ещё закреплены агенты или планы продаж": { uz: "Hududni o'chirib bo'lmaydi: unga hali agentlar yoki savdo rejalari biriktirilgan" },
  "Ни у одного магазина не заполнен город — группировать нечего": { uz: "Birorta do'konda shahar to'ldirilmagan — guruhlash uchun hech narsa yo'q" },
  "Ни у одного магазина не заполнен район — группировать нечего": { uz: "Birorta do'konda tuman to'ldirilmagan — guruhlash uchun hech narsa yo'q" },
  "Получилось бы {0} новых территорий при пределе {1}. Похоже, поле «{2}» заполнено разнобоем — проверьте справочник магазинов, иначе разнобой переедет в территории.": { uz: "{0} ta yangi hudud chiqardi, chegara esa {1}. Do'konlardagi maydon turlicha to'ldirilganga o'xshaydi — do'konlar ro'yxatini tekshiring, aks holda chalkashlik hududlarga o'tadi." },
  "Агент не найден": { uz: "Agent topilmadi" },
  "Агент не найден в вашей организации": { uz: "Agent tashkilotingizda topilmadi" },
  "Агент не найден в вашем тенанте": { uz: "Agent tashkilotingizda topilmadi" },
  "Можно смотреть только свои планы визитов.": { uz: "Faqat o'z tashrif rejalaringizni ko'rish mumkin." },
  "План не найден или назначен другому сотруднику": { uz: "Reja topilmadi yoki boshqa xodimga biriktirilgan" },
  "План для этого агента и магазина на эту дату уже существует": { uz: "Bu agent va do'kon uchun shu sanaga reja allaqachon bor" },
  "Некорректная дата плана": { uz: "Reja sanasi noto'g'ri" },
  "План визита не найден": { uz: "Tashrif rejasi topilmadi" },
  "Этот план назначен другому сотруднику": { uz: "Bu reja boshqa xodimga biriktirilgan" },
  "Визит заблокирован системой фрод-мониторинга: {0}": { uz: "Tashrif firibgarlikni kuzatish tizimi tomonidan bloklandi: {0}" },
  "Широта должна быть от -90 до 90": { uz: "Kenglik -90 dan 90 gacha bo'lishi kerak" },
  "Долгота должна быть от -180 до 180": { uz: "Uzunlik -180 dan 180 gacha bo'lishi kerak" },
  "Для причины «Другое» напишите коротко, что случилось.": { uz: "«Boshqa» sababi uchun nima bo'lganini qisqacha yozing." },
  "Пояснение к причине слишком длинное (до 200 знаков).": { uz: "Sabab izohi juda uzun (200 belgigacha)." },
  "День задаётся как ГГГГ-ММ-ДД": { uz: "Kun YYYY-OO-KK ko'rinishida beriladi" },
  "Месяц задаётся как ГГГГ-ММ": { uz: "Oy YYYY-OO ko'rinishida beriladi" },
  "Месяц бывает от 01 до 12": { uz: "Oy 01 dan 12 gacha bo'ladi" },
  "Слишком много визитов за раз: {0}. Больше {1} за одну расстановку не ставим — уменьшите число магазинов или дней.": { uz: "Bir vaqtda tashriflar juda ko'p: {0}. Bir taqsimlashda {1} tadan ko'p qo'yilmaydi — do'konlar yoki kunlar sonini kamaytiring." },
  "Пустой промежуток: конец раньше начала": { uz: "Bo'sh oraliq: oxiri boshidan oldin" },
  "Максимальный промежуток — 90 дней": { uz: "Eng uzun oraliq — 90 kun" },
  "В месяце не осталось дней после выбранного числа": { uz: "Tanlangan sanadan keyin oyda kun qolmadi" },
  "На этой территории нет действующих магазинов": { uz: "Bu hududda faol do'konlar yo'q" },
  "Выберите хотя бы один день недели": { uz: "Kamida bitta hafta kunini tanlang" },
  "В этом месяце таких дней нет": { uz: "Bu oyda bunday kunlar yo'q" },
  "Файл слишком большой (макс. 5 МБ)": { uz: "Fayl juda katta (ko'pi bilan 5 MB)" },
  "Файл слишком большой (макс. 4 МБ)": { uz: "Fayl juda katta (ko'pi bilan 4 MB)" },
  "Файл слишком большой (макс. 2 МБ)": { uz: "Fayl juda katta (ko'pi bilan 2 MB)" },
  "Макс. 4 МБ": { uz: "Ko'pi bilan 4 MB" },
  "Фотография должна быть изображением (png, jpeg, webp, gif, avif) или ссылкой по https": { uz: "Foto rasm (png, jpeg, webp, gif, avif) yoki https havola bo'lishi kerak" },
  "Расширение {0} не разрешено. Допустимые: {1}": { uz: "{0} kengaytmasiga ruxsat yo'q. Ruxsat etilganlar: {1}" },

  // ── Товары, категории, цены, прайс-листы, партии ──────────────────────────
  "Товар не найден": { uz: "Mahsulot topilmadi" },
  "Товар не найден в вашей организации": { uz: "Mahsulot tashkilotingizda topilmadi" },
  "Товар #{0} не найден в вашей организации": { uz: "#{0} mahsulot tashkilotingizda topilmadi" },
  "Не найдены товары вашей организации: {0}": { uz: "Tashkilotingiz mahsulotlari topilmadi: {0}" },
  "Товар с кодом «{0}» уже заведён. Откройте его карточку или укажите другой код.": { uz: "«{0}» kodli mahsulot allaqachon bor. Uning kartochkasini oching yoki boshqa kod kiriting." },
  "Товар с таким кодом уже заведён. Укажите другой код.": { uz: "Bunday kodli mahsulot allaqachon bor. Boshqa kod kiriting." },
  "Неверный формат изображения": { uz: "Rasm formati noto'g'ri" },
  "Ошибка загрузки фото: {0}": { uz: "Fotoni yuklashda xatolik: {0}" },
  "Название категории не может быть пустым": { uz: "Kategoriya nomi bo'sh bo'lishi mumkin emas" },
  "Невозможно удалить товар: связан с {0} позицией(ями) заказов": { uz: "Mahsulotni o'chirib bo'lmaydi: u buyurtmalardagi {0} ta pozitsiyaga bog'langan" },
  "Невозможно удалить товар: на складе есть остаток": { uz: "Mahsulotni o'chirib bo'lmaydi: omborda qoldiq bor" },
  "Цена должна быть положительной": { uz: "Narx musbat bo'lishi kerak" },
  "Цена должна быть больше нуля": { uz: "Narx noldan katta bo'lishi kerak" },
  "Цена не может быть отрицательной": { uz: "Narx manfiy bo'lishi mumkin emas" },
  "Упаковка — больше нуля": { uz: "Qadoq — noldan katta" },
  "Упаковка — число": { uz: "Qadoq — son" },
  "Прайс-лист не найден": { uz: "Narxlar ro'yxati topilmadi" },
  "Товар встречается дважды": { uz: "Mahsulot ikki marta uchraydi" },
  "Позиция не найдена": { uz: "Pozitsiya topilmadi" },
  "Партия не найдена или уже продана": { uz: "Partiya topilmadi yoki allaqachon sotilgan" },
  "У партии нет срока — уценять её незачем": { uz: "Partiyaning muddati yo'q — narxini tushirish shart emas" },
  "Срок партии вышел — её не продают, а списывают": { uz: "Partiyaning muddati o'tgan — u sotilmaydi, hisobdan chiqariladi" },
  "Партия не на основном складе — с него не продают. Сначала переместите её": { uz: "Partiya asosiy omborda emas — faqat asosiy ombordan sotiladi. Avval uni ko'chiring" },
  "Уценка — это цена ниже цены карточки": { uz: "Narx tushirish — bu kartochkadagidan past narx" },
  "Цена ниже закупки — такую уценку ставит директор": { uz: "Narx tannarxdan past — bunday narxni direktor qo'yadi" },
  "Порог — процент от 0 до 100": { uz: "Chegara — 0 dan 100 gacha foiz" },
  "Логотип: изображение слишком большое, выберите файл поменьше": { uz: "Logotip: rasm juda katta, kichikroq fayl tanlang" },
  "{0}: слишком длинно, максимум {1} символов": { uz: "{0}: juda uzun, ko'pi bilan {1} belgi" },
  "{0}: изображение слишком большое, выберите файл поменьше": { uz: "{0}: rasm juda katta, kichikroq fayl tanlang" },
  "Цвет задаётся в виде #rrggbb": { uz: "Rang #rrggbb ko'rinishida beriladi" },
  "Почта поддержки указана неверно": { uz: "Yordam pochtasi noto'g'ri ko'rsatilgan" },

  // ── Реквизиты и импорт из Excel ───────────────────────────────────────────
  "ИНН — 9 цифр, ПИНФЛ — 14 цифр": { uz: "STIR — 9 raqam, JShShIR — 14 raqam" },
  "ИКПУ (МХИК) — 17 цифр": { uz: "MXIK — 17 raqam" },
  "Код упаковки — не длиннее {0} знаков": { uz: "Qadoq kodi {0} belgidan uzun bo'lmasin" },
  "Код упаковки длиннее {0} знаков": { uz: "Qadoq kodi {0} belgidan uzun" },
  "ИНН/ПИНФЛ «{0}»: {1}": { uz: "STIR/JShShIR «{0}»: {1}" },
  "ИКПУ «{0}»: {1}": { uz: "MXIK «{0}»: {1}" },
  "ИКПУ записан числом — Excel теряет в нём последние цифры и ноль в начале; задайте столбцу формат «Текстовый» и впишите код заново": { uz: "MXIK son sifatida yozilgan — Excel oxirgi raqamlarni va boshidagi nolni yo'qotadi; ustunga «Matn» formatini bering va kodni qayta yozing" },
  "Ставка НДС «{0}»: допустимо 12, 0 или «без НДС»": { uz: "QQS stavkasi «{0}»: 12, 0 yoki «QQSsiz» bo'lishi mumkin" },
  "Плательщик НДС «{0}»: напишите «да» или «нет»": { uz: "QQS to'lovchisi «{0}»: «ha» yoki «yo'q» deb yozing" },
  "Файл не похож на xlsx": { uz: "Fayl xlsx ga o'xshamaydi" },
  "Файл слишком большой для импорта: разбейте его на части": { uz: "Fayl import uchun juda katta: uni qismlarga bo'ling" },
  "Файл пуст": { uz: "Fayl bo'sh" },
  "Слишком много строк: {0}, предел {1}. Разбейте файл на части": { uz: "Qatorlar juda ko'p: {0}, chegara {1}. Faylni qismlarga bo'ling" },

  // ── Заказы ────────────────────────────────────────────────────────────────
  "Заказ не найден": { uz: "Buyurtma topilmadi" },
  "Заказ #{0} не найден": { uz: "#{0} buyurtma topilmadi" },
  "Заказ не найден или уже удалён": { uz: "Buyurtma topilmadi yoki allaqachon o'chirilgan" },
  "Заказ не найден или не назначен на вас": { uz: "Buyurtma topilmadi yoki sizga biriktirilmagan" },
  "Заказы не найдены": { uz: "Buyurtmalar topilmadi" },
  "Выберите хотя бы один заказ": { uz: "Kamida bitta buyurtmani tanlang" },
  "Максимум 50 заказов за раз": { uz: "Bir vaqtda ko'pi bilan 50 ta buyurtma" },
  "Максимум 100 заказов за раз": { uz: "Bir vaqtda ko'pi bilan 100 ta buyurtma" },
  "Укажите заказ или магазин": { uz: "Buyurtma yoki do'konni ko'rsating" },
  "Укажите заказ или магазин — одно из двух": { uz: "Buyurtma yoki do'konni ko'rsating — ikkalasidan bittasini" },
  "Заказ можно оформить только со склада по умолчанию": { uz: "Buyurtmani faqat asosiy ombordan berish mumkin" },
  "Скидка должна быть числом": { uz: "Chegirma son bo'lishi kerak" },
  "Скидка не может быть отрицательной": { uz: "Chegirma manfiy bo'lishi mumkin emas" },
  "Скидка не может превышать 100%": { uz: "Chegirma 100% dan oshmasligi kerak" },
  "Скидка — это процент от 0 до 100": { uz: "Chegirma — 0 dan 100 gacha foiz" },
  "Количество должно быть положительным": { uz: "Miqdor musbat bo'lishi kerak" },
  "Количество должно быть положительным числом": { uz: "Miqdor musbat son bo'lishi kerak" },
  "Количество не может быть отрицательным": { uz: "Miqdor manfiy bo'lishi mumkin emas" },
  "Количество — число с двумя знаками после точки": { uz: "Miqdor — nuqtadan keyin ikki xonali son" },
  "Нужен itemId или productId": { uz: "itemId yoki productId kerak" },
  "Товар #{0} не найден или неактивен": { uz: "#{0} mahsulot topilmadi yoki faol emas" },
  "Некорректный остаток на складе: «{0}» (доступно: {1}). Обратитесь к администратору.": { uz: "Ombordagi qoldiq noto'g'ri: «{0}» (mavjud: {1}). Administratorga murojaat qiling." },
  "«{0}»: на складе {1}, из них {2} просрочено — годных {3}, а в заказе {4}": { uz: "«{0}»: omborda {1}, shundan {2} muddati o'tgan — yaroqlisi {3}, buyurtmada esa {4}" },
  "«{0}»: на складе {1}, а в заказе {2}": { uz: "«{0}»: omborda {1}, buyurtmada esa {2}" },
  "Кредитный лимит магазина «{0}» {1} превышен: долг {2} + заказ {3}. Примите оплату или попросите офис поднять лимит.": { uz: "«{0}» do'konining kredit limiti {1} oshib ketdi: qarz {2} + buyurtma {3}. To'lovni qabul qiling yoki ofisdan limitni oshirishni so'rang." },
  "Заказ уже частично доставлен — состав менять нельзя. Оформите возврат или переотметьте доставку: там учитывается доставленное количество.": { uz: "Buyurtma qisman yetkazilgan — tarkibini o'zgartirib bo'lmaydi. Qaytarishni rasmiylashtiring yoki yetkazishni qayta belgilang: u yerda yetkazilgan miqdor hisobga olinadi." },
  "Для новой позиции нужно указать товар": { uz: "Yangi pozitsiya uchun mahsulotni ko'rsating" },
  "Позиция заказа #{0} не найдена": { uz: "Buyurtmaning #{0} pozitsiyasi topilmadi" },
  "«{0}» уже есть в заказе — измените количество существующей позиции, а не добавляйте вторую": { uz: "«{0}» buyurtmada allaqachon bor — ikkinchisini qo'shmang, mavjud pozitsiya miqdorini o'zgartiring" },
  "В заказе должна остаться хотя бы одна позиция": { uz: "Buyurtmada kamida bitta pozitsiya qolishi kerak" },
  "Товар «{0}» ещё не заводился на этом складе": { uz: "«{0}» mahsuloti bu omborga hali kiritilmagan" },
  "Недостаточно товара: «{0}» — доступно {1}, нужно ещё {2}": { uz: "Mahsulot yetarli emas: «{0}» — mavjud {1}, yana {2} kerak" },
  "Недостаточно товара: «{0}» — остаток {1}, нужно ещё {2}": { uz: "Mahsulot yetarli emas: «{0}» — qoldiq {1}, yana {2} kerak" },
  "Недостаточно товара на складе: {0}": { uz: "Omborda mahsulot yetarli emas: {0}" },
  "Нет карточки остатка на складе: {0}. Заведите остаток по этому товару — иначе движение по заказу учесть негде.": { uz: "Omborda qoldiq kartochkasi yo'q: {0}. Bu mahsulot uchun qoldiq kiriting — aks holda buyurtma harakatini hisobga olib bo'lmaydi." },
  "Заказ уже у курьера — состав менять нельзя. Позвоните оператору: он поправит или оформит возврат.": { uz: "Buyurtma kuryerda — tarkibini o'zgartirib bo'lmaydi. Operatorga qo'ng'iroq qiling: u tuzatadi yoki qaytarishni rasmiylashtiradi." },
  "Заказ уже закрыт — состав менять нельзя. Изменения по нему оформляются возвратом.": { uz: "Buyurtma yopilgan — tarkibini o'zgartirib bo'lmaydi. O'zgarishlar qaytarish orqali rasmiylashtiriladi." },
  "Этот заказ оформил другой сотрудник. {0} его может автор заказа, оператор или руководитель.": { uz: "Bu buyurtmani boshqa xodim rasmiylashtirgan. Buni faqat buyurtma muallifi, operator yoki rahbar qila oladi." },
  "Заказ уже закрыт — обещанный срок по нему не меняют.": { uz: "Buyurtma yopilgan — va'da qilingan muddat o'zgartirilmaydi." },
  "Можно отменить только новые заказы": { uz: "Faqat yangi buyurtmalarni bekor qilish mumkin" },
  "Статус заказа уже был изменён другим действием": { uz: "Buyurtma holati boshqa amal bilan allaqachon o'zgartirilgan" },
  "Заказ не удалён": { uz: "Buyurtma o'chirilmagan" },
  "Заказ уже восстановлен": { uz: "Buyurtma allaqachon tiklangan" },
  "Не восстановить заказ: «{0}» — доступно {1}, нужно {2}": { uz: "Buyurtmani tiklab bo'lmaydi: «{0}» — mavjud {1}, kerak {2}" },

  // ── Оплаты по заказу и долги ──────────────────────────────────────────────
  "Сумма оплаты должна быть положительной": { uz: "To'lov summasi musbat bo'lishi kerak" },
  "Нельзя принять оплату по заказу в статусе «{0}»": { uz: "Bu holatdagi buyurtma bo'yicha to'lov qabul qilib bo'lmaydi" },
  "Сумма оплаты не может превышать сумму заказа": { uz: "To'lov summasi buyurtma summasidan oshmasligi kerak" },
  "Заказ отменён или возвращён — оплатить нельзя": { uz: "Buyurtma bekor qilingan yoki qaytarilgan — to'lab bo'lmaydi" },
  "Сумма заказа равна нулю": { uz: "Buyurtma summasi nolga teng" },
  "Неверная сумма оплаты": { uz: "To'lov summasi noto'g'ri" },
  "Неверный формат суммы": { uz: "Summa formati noto'g'ri" },
  "Сумма должна быть числом": { uz: "Summa son bo'lishi kerak" },
  "Сумма должна быть положительной": { uz: "Summa musbat bo'lishi kerak" },
  "Сумма не может быть отрицательной": { uz: "Summa manfiy bo'lishi mumkin emas" },
  "Ожидается число": { uz: "Son kutilmoqda" },
  "Сумма платежа должна быть положительным числом": { uz: "To'lov summasi musbat son bo'lishi kerak" },
  "Укажите причину сторно": { uz: "Storno sababini ko'rsating" },
  "Платёж не найден": { uz: "To'lov topilmadi" },
  "Это уже сторно — сторнировать его нельзя": { uz: "Bu allaqachon storno — uni storno qilib bo'lmaydi" },
  "Платёж уже сторнирован": { uz: "To'lov allaqachon storno qilingan" },
  "По заказу уже принято {0} из {1} — принимать больше нечего. Если деньги действительно получены, проведите их как оплату магазину, а не по этому заказу.": { uz: "Buyurtma bo'yicha {1} dan {0} qabul qilingan — boshqa qabul qiladigan narsa yo'q. Agar pul haqiqatan olingan bo'lsa, uni shu buyurtmaga emas, do'kon to'lovi sifatida o'tkazing." },
  "Сумма {0} больше остатка по заказу ({1}{2}).": { uz: "{0} summasi buyurtma bo'yicha qoldiqdan katta ({1}{2})." },

  // ── Курьер ────────────────────────────────────────────────────────────────
  "Курьер не найден": { uz: "Kuryer topilmadi" },
  "Курьер не найден в вашей организации": { uz: "Kuryer tashkilotingizda topilmadi" },
  "Заказ уже закрыт — курьера назначают, пока он в работе": { uz: "Buyurtma yopilgan — kuryer buyurtma ishda bo'lganda biriktiriladi" },
  "Заказ уже завершён, отменён или возвращён — повторное списание невозможно": { uz: "Buyurtma yakunlangan, bekor qilingan yoki qaytarilgan — qayta hisobdan chiqarib bo'lmaydi" },
  "Заказ уже завершён — повторное выполнение невозможно": { uz: "Buyurtma yakunlangan — qayta bajarib bo'lmaydi" },
  "Заказ уже завершён (статус «{0}») — повторное списание невозможно": { uz: "Buyurtma yakunlangan — qayta hisobdan chiqarib bo'lmaydi" },
  "Заказ уже завершён, отменён или возвращён — повторное действие невозможно": { uz: "Buyurtma yakunlangan, bekor qilingan yoki qaytarilgan — amalni takrorlab bo'lmaydi" },
  "Такой даты не существует: {0}. Укажите дату в формате ГГГГ-ММ-ДД": { uz: "Bunday sana yo'q: {0}. Sanani YYYY-OO-KK formatida kiriting" },
  "Дата в формате ГГГГ-ММ-ДД": { uz: "Sana YYYY-OO-KK formatida" },
  "Для частичного возврата укажите, что именно вернулось": { uz: "Qisman qaytarish uchun aynan nima qaytganini ko'rsating" },
  "Возвращено больше, чем в заказе: «{0}» — {1} из {2}": { uz: "Buyurtmadagidan ko'p qaytarilgan: «{0}» — {2} dan {1}" },
  "Возвращённое количество не может быть отрицательным": { uz: "Qaytarilgan miqdor manfiy bo'lishi mumkin emas" },
  "Некорректная сумма оплаты: «{0}». Введите число, разделитель — точка": { uz: "To'lov summasi noto'g'ri: «{0}». Son kiriting, ajratuvchi — nuqta" },

  // ── Возвраты ──────────────────────────────────────────────────────────────
  "Возврат не найден": { uz: "Qaytarish topilmadi" },
  "Заказ {0} другого магазина — возврат по нему оформляют на его магазин": { uz: "{0} buyurtmasi boshqa do'konniki — qaytarish o'sha do'konga rasmiylashtiriladi" },
  "«{0}» нет в этом заказе — вернуть его по нему нельзя": { uz: "«{0}» bu buyurtmada yo'q — uni shu buyurtma bo'yicha qaytarib bo'lmaydi" },
  "«{0}»: возвращают больше, чем доставили — уже возвращено {1} из {2}": { uz: "«{0}»: yetkazilganidan ko'p qaytarilmoqda — {2} dan {1} allaqachon qaytarilgan" },
  "«{0}»: у товара нет цены — возврат без заказа оформить нельзя": { uz: "«{0}»: mahsulot narxi yo'q — buyurtmasiz qaytarishni rasmiylashtirib bo'lmaydi" },
  "Заказ {0} уже {1} — товар по нему возвращён на склад целиком. Проведение этого возврата зачислило бы тот же товар второй раз.": { uz: "{0} buyurtmasi bekor qilingan yoki qaytarilgan — mahsulot omborga to'liq qaytgan. Bu qaytarishni o'tkazish o'sha mahsulotni ikkinchi marta kiritadi." },
  "Заказ {0} ещё не доставлен (статус «{1}») — возвращать с него нечего. Если заказ не нужен, его отменяют, а не возвращают.": { uz: "{0} buyurtmasi hali yetkazilmagan — undan qaytaradigan narsa yo'q. Buyurtma kerak bo'lmasa, u qaytarilmaydi, bekor qilinadi." },
  "Невозможно перевести из «{0}» в «{1}»": { uz: "Bu holatga o'tkazib bo'lmaydi" },
  "Склад по умолчанию не найден": { uz: "Asosiy ombor topilmadi" },
  "Возврат уже проведён — повторное зачисление на склад отменено": { uz: "Qaytarish allaqachon o'tkazilgan — omborga qayta kiritish bekor qilindi" },
  "Статус возврата изменился — повторите операцию": { uz: "Qaytarish holati o'zgardi — amalni takrorlang" },

  // ── Склад, приход, поставщики, инвентаризация, перемещения ────────────────
  "Склад не найден": { uz: "Ombor topilmadi" },
  "Склад не найден в вашей организации": { uz: "Ombor tashkilotingizda topilmadi" },
  "Указанный склад не найден": { uz: "Ko'rsatilgan ombor topilmadi" },
  "Склад не найден — создайте склад в настройках": { uz: "Ombor topilmadi — sozlamalarda ombor yarating" },
  "Недостаточно свободного товара на складе (на складе: {0}, из них {1} зарезервировано под заказы; свободно: {2}, запрошено: {3})": { uz: "Omborda bo'sh mahsulot yetarli emas (omborda: {0}, shundan {1} buyurtmalar uchun zahirada; bo'sh: {2}, so'ralgan: {3})" },
  "Новое количество ({0}) меньше зарезервированного под заказы ({1}). Сначала проведите или отмените заказы, занявшие резерв.": { uz: "Yangi miqdor ({0}) buyurtmalar uchun zahiradan ({1}) kam. Avval zahirani band qilgan buyurtmalarni o'tkazing yoki bekor qiling." },
  "Остаток {0} меньше зарезервированного под заказы ({1}) у товара {2}": { uz: "Qoldiq {0} buyurtmalar uchun zahiradan ({1}) kam, mahsulot {2}" },
  "Срок годности {0} раньше даты прихода {1}": { uz: "Yaroqlilik muddati {0} kirim sanasi {1} dan oldin" },
  "Срок годности задаётся как ГГГГ-ММ-ДД": { uz: "Yaroqlilik muddati YYYY-OO-KK ko'rinishida beriladi" },
  "Товар #{0} встречается в приходе дважды — объедините строки": { uz: "#{0} mahsulot kirimda ikki marta uchraydi — qatorlarni birlashtiring" },
  "В строке нет ни количества, ни «по накладной»": { uz: "Qatorda na miqdor, na «yuk xati bo'yicha» bor" },
  "Количество — неотрицательное число": { uz: "Miqdor — manfiy bo'lmagan son" },
  "Ожидалось — число": { uz: "Kutilgan — son" },
  "Выберите поставщика из списка либо укажите название нового — не оба сразу и не ни одного": { uz: "Ro'yxatdan yetkazib beruvchini tanlang yoki yangisining nomini kiriting — ikkalasini birga emas va hech birini qoldirmasdan" },
  "Сумма поставки должна быть положительной": { uz: "Yetkazib berish summasi musbat bo'lishi kerak" },
  "Для поставки в долларах укажите курс на день сделки": { uz: "Dollardagi yetkazib berish uchun bitim kunidagi kursni kiriting" },
  "Поставщик не найден": { uz: "Yetkazib beruvchi topilmadi" },
  "Поставщик с таким названием уже заведён — выберите его из списка": { uz: "Bunday nomli yetkazib beruvchi allaqachon bor — uni ro'yxatdan tanlang" },
  "Приход не найден": { uz: "Kirim topilmadi" },
  "Приход уже проведён — остаток по нему принят, строки не правятся": { uz: "Kirim o'tkazilgan — qoldiq qabul qilingan, qatorlar tahrirlanmaydi" },
  "Документ изменили, пока вы правили — обновите страницу": { uz: "Siz tahrirlayotganda hujjat o'zgardi — sahifani yangilang" },
  "Приход уже завершён": { uz: "Kirim allaqachon yakunlangan" },
  "Позиция прихода #{0} не привязана к товару": { uz: "Kirimning #{0} pozitsiyasi mahsulotga bog'lanmagan" },
  "Ничего не посчитано: впишите «Пришло» хотя бы в одну строку": { uz: "Hech narsa sanalmadi: kamida bitta qatorga «Keldi» ni yozing" },
  "Нельзя изменить статус завершённого прихода": { uz: "Yakunlangan kirim holatini o'zgartirib bo'lmaydi" },
  "Приход уже проведён — шапка не правится": { uz: "Kirim o'tkazilgan — sarlavha tahrirlanmaydi" },
  "Нельзя удалить завершённый приход": { uz: "Yakunlangan kirimni o'chirib bo'lmaydi" },
  "По поставке {0} уже проходили оплаты — сначала разберитесь с ней в разделе поставщиков": { uz: "{0} yetkazib berish bo'yicha to'lovlar o'tgan — avval uni yetkazib beruvchilar bo'limida hal qiling" },
  "Контрагент не найден": { uz: "Kontragent topilmadi" },
  "Контрагент с таким названием уже заведён": { uz: "Bunday nomli kontragent allaqachon bor" },
  "Поставка не найдена": { uz: "Yetkazib berish topilmadi" },
  "Сумма платежа должна быть положительной": { uz: "To'lov summasi musbat bo'lishi kerak" },
  "По этой поставке осталось {0} — платёж больше остатка": { uz: "Bu yetkazib berish bo'yicha {0} qoldi — to'lov qoldiqdan katta" },
  "«{0}»: свободно {1}, вернуть {2} нельзя": { uz: "«{0}»: bo'sh {1}, {2} ni qaytarib bo'lmaydi" },
  "У поставки в USD не задан курс — сумму возврата пересчитать не во что": { uz: "USD dagi yetkazib berishda kurs berilmagan — qaytarish summasini hisoblab bo'lmaydi" },
  "Инвентаризация не найдена": { uz: "Inventarizatsiya topilmadi" },
  "Документ уже применён или отменён": { uz: "Hujjat allaqachon qo'llangan yoki bekor qilingan" },
  "Ни одна строка не посчитана — применять нечего": { uz: "Birorta qator sanalmagan — qo'llaydigan narsa yo'q" },
  "«{0}»: на полке {1}, а под заказы отложено {2}. Сначала проведите или отмените заказы, занявшие резерв, — потом примените акт.": { uz: "«{0}»: tokchada {1}, buyurtmalar uchun esa {2} ajratilgan. Avval zahirani band qilgan buyurtmalarni o'tkazing yoki bekor qiling — keyin dalolatnomani qo'llang." },
  "Отменить можно только черновик": { uz: "Faqat qoralamani bekor qilish mumkin" },
  "Сменить склад по умолчанию нельзя: открытых заказов {0}, позиций с резервом {1}. Довезите или отмените открытые заказы и повторите.": { uz: "Asosiy omborni almashtirib bo'lmaydi: ochiq buyurtmalar {0}, zahiradagi pozitsiyalar {1}. Ochiq buyurtmalarni yetkazing yoki bekor qiling va qayta urinib ko'ring." },
  "Перемещение не найдено или уже выполнено": { uz: "Ko'chirish topilmadi yoki allaqachon bajarilgan" },
  "Недостаточно товара на складе отправителе": { uz: "Jo'natuvchi omborda mahsulot yetarli emas" },
  "Перемещение уже было выполнено": { uz: "Ko'chirish allaqachon bajarilgan" },

  // ── Погрузочные листы ─────────────────────────────────────────────────────
  "Погрузочный лист не найден": { uz: "Yuklash varaqasi topilmadi" },
  "Загрузочный лист не найден": { uz: "Yuklash varaqasi topilmadi" },
  "Лист {0} уже отгружен — он ничего не держит и остаётся записью о факте.": { uz: "{0} varaqasi jo'natilgan — u hech narsani ushlab turmaydi va fakt yozuvi bo'lib qoladi." },

  // ── Зарплата, KPI, отчёты, планы продаж ───────────────────────────────────
  "Период уже закрыт — по нему заплатили": { uz: "Davr yopilgan — u bo'yicha to'langan" },
  "Период — от одного дня до года.": { uz: "Davr — bir kundan bir yilgacha." },
  "ABC по прибыли открыт тем, кому открыт P&L.": { uz: "Foyda bo'yicha ABC P&L ochiq bo'lganlarga ochiq." },

  // ── 1С ────────────────────────────────────────────────────────────────────
  "1С не подключена: заполните подключение в настройках": { uz: "1C ulanmagan: sozlamalarda ulanishni to'ldiring" },
  "В настройках 1С не выбраны организация и склад": { uz: "1C sozlamalarida tashkilot va ombor tanlanmagan" },
  "1С не вернула Ref_Key созданного документа": { uz: "1C yaratilgan hujjatning Ref_Key qiymatini qaytarmadi" },
  "В этой конфигурации приходный ордер не настроен": { uz: "Bu konfiguratsiyada kirim orderi sozlanmagan" },
  "1С: неверный логин или пароль": { uz: "1C: login yoki parol noto'g'ri" },
  "1С: у пользователя нет прав": { uz: "1C: foydalanuvchida huquq yo'q" },
  "1С: нет такого объекта или OData не включён для него ({0})": { uz: "1C: bunday obyekt yo'q yoki unga OData yoqilmagan ({0})" },
  "1С: HTTP {0}": { uz: "1C: HTTP {0}" },
  // Текст самой 1С — её словами: это ответ чужой программы, как строка из базы.
  "1С: {0}": { uz: "1C: {0}" },
  "Некорректный адрес.": { uz: "Manzil noto'g'ri." },
  "Разрешены только адреса http и https, получено «{0}».": { uz: "Faqat http va https manzillarga ruxsat bor, «{0}» berildi." },
  "Адрес указывает во внутреннюю сеть.": { uz: "Manzil ichki tarmoqqa ishora qiladi." },
  "Не удалось определить адрес хоста.": { uz: "Xost manzilini aniqlab bo'lmadi." },
  "Слишком много перенаправлений.": { uz: "Qayta yo'naltirishlar juda ko'p." },
  "Введите пароль": { uz: "Parolni kiriting" },
  "Введите пароль пользователя 1С": { uz: "1C foydalanuvchisi parolini kiriting" },
  "Сначала сохраните настройки подключения к 1С.": { uz: "Avval 1C ga ulanish sozlamalarini saqlang." },
  "Записи журнала нет": { uz: "Jurnal yozuvi yo'q" },
  "Номенклатура {0}: пустое название или код": { uz: "Nomenklatura {0}: nomi yoki kodi bo'sh" },
  "Номенклатура {0}: цена не число": { uz: "Nomenklatura {0}: narx son emas" },
  "Заказ {0} возвращали в работу после выгрузки в 1С. В 1С лежит документ первого круга — с прежним составом и суммой, и он проведён. Перепровести его заново значит отдать в учёт не то, что повезли. Разберите прежний документ в 1С, затем выгрузите заказ заново отдельным документом.": { uz: "{0} buyurtmasi 1C ga yuklangandan keyin ishga qaytarilgan. 1C da avvalgi tarkib va summali birinchi hujjat o'tkazilgan holda turibdi. Uni qayta o'tkazish hisobga olib ketilmagan narsani beradi. Avvalgi hujjatni 1C da hal qiling, keyin buyurtmani alohida hujjat sifatida qayta yuklang." },
  "Заказ {0} не содержит позиций — выгружать в 1С нечего": { uz: "{0} buyurtmasida pozitsiyalar yo'q — 1C ga yuklaydigan narsa yo'q" },
  "Товар {0} не сопоставлен с 1С": { uz: "{0} mahsulot 1C bilan moslashtirilmagan" },
  "Заказ {0}: ничего не довезено — выгружать в 1С нечего": { uz: "{0} buyurtma: hech narsa yetkazilmagan — 1C ga yuklaydigan narsa yo'q" },
};

/** Перевод шаблона: `{0}` — значение, вырезанное из русского текста. */
interface Pattern { re: RegExp; entry: ErrorText; literal: number }

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PATTERNS: Pattern[] = Object.entries(SERVER_ERROR_TEXT)
  .filter(([key]) => /\{\d+\}/.test(key))
  .map(([key, entry]) => {
    const parts = key.split(/\{\d+\}/);
    return {
      re: new RegExp("^" + parts.map(escapeRe).join("([\\s\\S]*?)") + "$"),
      entry,
      literal: parts.join("").length,
    };
  })
  // Длинный шаблон раньше короткого: «на складе {1}, а в заказе {2}» иначе
  // проглотил бы «на складе {1}, из них {2} просрочено — … а в заказе {4}».
  .sort((a, b) => b.literal - a.literal);

function fill(template: string, values: string[]): string {
  return template.replace(/\{(\d+)\}/g, (_, i: string) => values[Number(i)] ?? "");
}

/**
 * Текст отказа на языке интерфейса, или null — если сервер такого не знает.
 *
 * Сначала точное совпадение, потом шаблоны. Незнакомый текст не трогается:
 * решать, показывать ли его, будет клиент (у него на это `data.lang`).
 */
export function localizeServerMessage(message: string, lang: UiLang): string | null {
  const exact = SERVER_ERROR_TEXT[message];
  if (exact) return lang === "uz" ? exact.uz : exact.ru ?? message;
  for (const p of PATTERNS) {
    const m = p.re.exec(message);
    if (!m) continue;
    const values = m.slice(1);
    // Для русского — исходный текст, если сам ключ русский.
    return lang === "uz" ? fill(p.entry.uz, values) : p.entry.ru ? fill(p.entry.ru, values) : message;
  }
  return null;
}

/** Все написания одного отказа — для клиента, который узнаёт его по тексту. */
export function spellingsOf(source: string): string[] {
  const e = SERVER_ERROR_TEXT[source];
  return e ? [source, e.ru ?? source, e.uz] : [source];
}
