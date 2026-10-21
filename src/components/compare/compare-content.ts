/* ═══════════════════════════════════════════════════════════════════════════
   /compare — «Выбираете систему для дистрибуции?» Содержание страницы.

   10.10.2026 владелец: «страницу сравнения» — с Sales Doctor и Smartup, и
   раздел за разделом: погрузочные листы, редактор заказа, частичная
   доставка, акт сверки, товары и магазины, склад, отчёты — «все сравни».

   ── Правило, по которому написано ──────────────────────────────────────────

   О своих возможностях — только то, что работает в коде. О чужих — только
   то, что сами компании или пресса сказали публично, со ссылкой и датой.
   В таблице у чужой системы два ответа: «заявлено: …» — дословно по смыслу
   публичного описания, или «уточняйте у компании» — когда публично про этот
   раздел не сказано НИЧЕГО. Это не «у них нет»: их систем изнутри мы не
   видели, а закон о рекламе не прощает недобросовестного сравнения. Где
   публично есть у них и нет у нас (маркировка, счёт-фактура напрямую,
   производство), — так и написано, в нашей же колонке.

   Цена — из модуля цен (contracts/pricing), а не числом в тексте: страж
   plans-have-one-source.
   ═══════════════════════════════════════════════════════════════════════════ */
import { FIELD_PRICE_UZS, MIN_FIELD_USERS, formatSum } from "@contracts/pricing";
import type { L } from "@/components/pitch/pitch-content";
import { START_STEPS } from "@/components/landing/site-content";

/** Когда сверены сведения о других системах. */
export const CHECKED_AT = "10.10.2026";

const PRICE = formatSum(FIELD_PRICE_UZS);

/** Ключи источников — по ним подпись «заявлено» ведёт к ссылке внизу. */
export type SourceKey = "sd-interview" | "sd-ad" | "smartup";

export const SOURCES: Record<SourceKey, { label: string; href: string; note?: L }> = {
  "sd-interview": {
    label: "digitalbusiness.kz, 18.09.2026",
    href: "https://digitalbusiness.kz/2026-09-18/uzbekistanets-zapustil-servis-po-avtomatizatsii-distributsii-i-vishel-na-viruchku-4-mln-v-god/",
  },
  "sd-ad": {
    label: "spot.uz, 31.07.2026",
    href: "https://www.spot.uz/ru/2026/07/31/sales-doctor-dena/",
    note: { ru: "на правах рекламы", uz: "reklama huquqida" },
  },
  smartup: { label: "the-tech.kz, 19.02.2026", href: "https://the-tech.kz/?p=36908" },
};

/** Публичное о чужой системе по разделу: что заявлено и где. null — публично не сказано. */
type Claim = { text: L; source: SourceKey } | null;

export interface Area {
  area: L;
  ours: L;
  /** У нас этого нет или нет полностью — колонка честно говорит об этом. */
  oursGap?: boolean;
  salesDoctor: Claim;
  smartup: Claim;
}

/** Раздел за разделом — то, что владелец перечислил, и главное вокруг. */
export const AREAS: Area[] = [
  {
    area: { ru: "Заказ агента", uz: "Agent buyurtmasi" },
    ours: {
      ru: "Каталог с фото, остатки и цена этого магазина; без связи заказ сохраняется и уходит сам; «как в прошлый раз» одним касанием.",
      uz: "Rasmli katalog, shu do'kon qoldig'i va narxi; aloqasiz buyurtma saqlanadi va o'zi yuboriladi; «o'tgan safargidek» bir bosishda.",
    },
    salesDoctor: { text: { ru: "Заявлено: заказ с поля сразу попадает в систему.", uz: "E'lon qilingan: daladan buyurtma darhol tizimga tushadi." }, source: "sd-ad" },
    smartup: { text: { ru: "Заявлено: продажи и обработка заказов, полевые команды.", uz: "E'lon qilingan: savdo va buyurtmalarni qayta ishlash, dala jamoalari." }, source: "smartup" },
  },
  {
    area: { ru: "Редактор заказа", uz: "Buyurtma muharriri" },
    ours: {
      ru: "Изменить состав и количество — по праву роли, каждое изменение в журнале действий.",
      uz: "Tarkib va miqdorni o'zgartirish — rol huquqi bo'yicha, har bir o'zgarish harakatlar jurnalida.",
    },
    salesDoctor: null,
    smartup: null,
  },
  {
    area: { ru: "Погрузочные листы", uz: "Yuklash varaqalari" },
    ours: {
      ru: "Лист на машину и сборка по строкам: кладовщик подтверждает каждую строку, недостача сразу уходит офису, партии подсказаны в порядке списания.",
      uz: "Mashina uchun varaq va qatorma-qator yig'ish: omborchi har bir qatorni tasdiqlaydi, kamomad darhol ofisga boradi, partiyalar chiqim tartibida ko'rsatiladi.",
    },
    salesDoctor: { text: { ru: "Заявлено: сборка со сканером, коды маркировки проверяются.", uz: "E'lon qilingan: skaner bilan yig'ish, markirovka kodlari tekshiriladi." }, source: "sd-ad" },
    smartup: { text: { ru: "Заявлена логистика; погрузочные листы — уточняйте.", uz: "Logistika e'lon qilingan; yuklash varaqalari — aniqlang." }, source: "smartup" },
  },
  {
    area: { ru: "Доставка и «частично доставлен»", uz: "Yetkazish va «qisman yetkazildi»" },
    ours: {
      ru: "Порядок объезда на доске развоза и курьер на карте; частичная доставка и возврат; «не доставлено» с причиной из списка и перенос на другой день; фото и подпись при вручении; ссылка «где мой заказ» для магазина; наличные и недостача, расчёт по заказу закрывает офис.",
      uz: "Yetkazish doskasida aylanish tartibi va xaritada kuryer; qisman yetkazish va qaytarish; ro'yxatdan sabab bilan «yetkazilmadi» va boshqa kunga ko'chirish; topshirishda rasm va imzo; do'kon uchun «buyurtmam qayerda» havolasi; naqd pul va kamomad, buyurtma hisob-kitobini ofis yopadi.",
    },
    salesDoctor: null,
    smartup: { text: { ru: "Заявлена логистика; частичная доставка — уточняйте.", uz: "Logistika e'lon qilingan; qisman yetkazish — aniqlang." }, source: "smartup" },
  },
  {
    area: { ru: "Долги и стоп отгрузки", uz: "Qarzlar va yuklashni to'xtatish" },
    ours: {
      ru: "Долг по каждому заказу со сроком; при просрочке или превышении лимита отгрузка останавливается сама, причина записана в заказе.",
      uz: "Har bir buyurtma bo'yicha muddatli qarz; muddat o'tsa yoki limit oshsa yuklash o'zi to'xtaydi, sababi buyurtmada yoziladi.",
    },
    salesDoctor: { text: { ru: "Заявлены оплаты и финансовый учёт.", uz: "To'lovlar va moliyaviy hisob e'lon qilingan." }, source: "sd-interview" },
    smartup: { text: { ru: "Заявлены финансы и дебиторская задолженность.", uz: "Moliya va debitorlik qarzi e'lon qilingan." }, source: "smartup" },
  },
  {
    area: { ru: "Акт сверки", uz: "Solishtirma dalolatnoma" },
    ours: {
      ru: "Отдельной страницей: любой период, периоды как у бухгалтера, бланк по форме 1С, сумма прописью, печать.",
      uz: "Alohida sahifada: istalgan davr, buxgalterdagidek davrlar, 1C shaklidagi blank, summa so'z bilan, chop etish.",
    },
    salesDoctor: null,
    smartup: null,
  },
  {
    area: { ru: "Товары и магазины", uz: "Tovarlar va do'konlar" },
    ours: {
      ru: "Загрузка из Excel; агент добавляет магазин с телефона с геоточкой; прайс-листы для групп магазинов и ступени «от N штук».",
      uz: "Excel'dan yuklash; agent do'konni telefondan geonuqta bilan qo'shadi; do'kon guruhlari uchun narx varaqlari va «N donadan» pog'onalari.",
    },
    salesDoctor: null,
    smartup: null,
  },
  {
    area: { ru: "Склад", uz: "Ombor" },
    ours: {
      ru: "Партии и сроки годности, списание по FEFO, несколько складов и точки продаж, перемещения с партиями (по желанию — в два шага, «в пути»), инвентаризация всего склада, категории или выбранных товаров (по желанию — с утверждением директора), дополнительные штрих-коды.",
      uz: "Partiyalar va yaroqlilik muddati, FEFO bo'yicha chiqim, bir nechta ombor va savdo nuqtalari, partiyalari bilan ko'chirish (xohishga ko'ra — ikki bosqichda, «yo'lda»), butun ombor, turkum yoki tanlangan tovarlar inventarizatsiyasi (xohishga ko'ra — direktor tasdig'i bilan), qo'shimcha shtrix-kodlar.",
    },
    salesDoctor: { text: { ru: "Заявлено: склад и остатки в реальном времени.", uz: "E'lon qilingan: ombor va qoldiqlar real vaqtda." }, source: "sd-interview" },
    smartup: { text: { ru: "Заявлен складской учёт.", uz: "Ombor hisobi e'lon qilingan." }, source: "smartup" },
  },
  {
    area: { ru: "Закупки у поставщиков", uz: "Yetkazib beruvchilardan xarid" },
    ours: {
      ru: "«Дозаказ» по продажам, сгруппированный по поставщикам; заказы поставщикам с согласованием директора и отсрочкой оплаты; приход по заказу частями, долг поставщику — при проведении прихода.",
      uz: "Sotuvga qarab «Qayta buyurtma», yetkazib beruvchilar bo'yicha guruhlangan; direktor kelishuvi va to'lov kechiktirishi bilan yetkazib beruvchiga buyurtmalar; buyurtma bo'yicha qismlab kirim, yetkazib beruvchiga qarz — kirim o'tkazilganda.",
    },
    salesDoctor: null,
    smartup: null,
  },
  {
    area: { ru: "Отчёты", uz: "Hisobotlar" },
    ours: {
      ru: "P&L, ABC, «Агент × Товар» в тех же деньгах, что P&L, долги, карта продаж, визиты без заказа, недоставленные заказы по причинам; выгрузки в Excel.",
      uz: "P&L, ABC, P&L bilan bir xil puldagi «Agent × Tovar», qarzlar, savdo xaritasi, buyurtmasiz tashriflar, sabablari bilan yetkazilmagan buyurtmalar; Excel'ga eksport.",
    },
    salesDoctor: { text: { ru: "Заявлены аналитика и готовые PIVOT-отчёты.", uz: "Tahlil va tayyor PIVOT-hisobotlar e'lon qilingan." }, source: "sd-ad" },
    smartup: null,
  },
  {
    area: { ru: "Планы, KPI и зарплата", uz: "Rejalar, KPI va ish haqi" },
    ours: {
      ru: "План, прогноз «кто не дотянет к концу месяца», KPI и зарплата агентов и курьеров.",
      uz: "Reja, «oy oxirigacha kim yetmaydi» prognozi, agentlar va kuryerlarning KPI va ish haqi.",
    },
    salesDoctor: { text: { ru: "Заявлены KPI и выполнение плана.", uz: "KPI va reja bajarilishi e'lon qilingan." }, source: "sd-interview" },
    smartup: null,
  },
  {
    area: { ru: "1С и интеграции", uz: "1C va integratsiyalar" },
    ours: {
      ru: "Обмен с 1С по OData, открытый API, уведомления в Telegram.",
      uz: "1C bilan OData orqali almashinuv, ochiq API, Telegram xabarnomalari.",
    },
    salesDoctor: { text: { ru: "Заявлены 1С, CRM и ERP.", uz: "1C, CRM va ERP e'lon qilingan." }, source: "sd-ad" },
    smartup: null,
  },
  {
    area: { ru: "Маркировка и счёт-фактура", uz: "Markirovka va hisob-faktura" },
    ours: {
      ru: "Пока нет. Счёт-фактура — через 1С (ИНН, ИКПУ и НДС готовим мы), маркировка «Asl Belgisi» — в планах.",
      uz: "Hozircha yo'q. Hisob-faktura — 1C orqali (STIR, IKPU va QQS ni biz tayyorlaymiz), «Asl Belgisi» markirovkasi — rejada.",
    },
    oursGap: true,
    salesDoctor: { text: { ru: "Заявлены «Asl Belgisi» и автоматическая счёт-фактура.", uz: "«Asl Belgisi» va avtomatik hisob-faktura e'lon qilingan." }, source: "sd-ad" },
    smartup: { text: { ru: "Заявлена маркировка товаров.", uz: "Tovar markirovkasi e'lon qilingan." }, source: "smartup" },
  },
  {
    area: { ru: "Производство", uz: "Ishlab chiqarish" },
    ours: { ru: "Не делаем: мы для дистрибуции.", uz: "Qilmaymiz: biz distribyutsiya uchun." },
    oursGap: true,
    salesDoctor: null,
    smartup: { text: { ru: "Заявлено производство.", uz: "Ishlab chiqarish e'lon qilingan." }, source: "smartup" },
  },
];

/** Вопросы о деньгах и запуске — задайте их любой системе. */
export const QUESTIONS: Array<{ q: L; a: L }> = [
  {
    q: { ru: "Сколько стоит и за кого платим?", uz: "Qancha turadi va kim uchun to'laymiz?" },
    a: {
      ru: `${PRICE} сум в месяц за полевого сотрудника — агента, курьера, мерчендайзера; от ${MIN_FIELD_USERS} человек. Офис, склад, супервайзеры и директор — бесплатно. Цена открыта на сайте.`,
      uz: `Dala xodimi — agent, kuryer, merchandayzer uchun oyiga ${PRICE} so'm; ${MIN_FIELD_USERS} kishidan. Ofis, ombor, supervayzerlar va direktor — bepul. Narx saytda ochiq.`,
    },
  },
  {
    q: { ru: "Есть ли лимиты на заказы, товары, магазины?", uz: "Buyurtma, tovar va do'konlarga cheklov bormi?" },
    a: { ru: "Нет. Ни на заказы, ни на товары, ни на магазины.", uz: "Yo'q. Buyurtma, tovar va do'konlar soni cheklanmagan." },
  },
  {
    q: { ru: "Сколько ждать запуска и нужен ли внедренец?", uz: "Ishga tushirish qancha vaqt oladi, joriy qiluvchi kerakmi?" },
    a: {
      ru: "Регистрация без звонка, 14 дней бесплатно, карта не нужна. Товары и магазины загружаются из Excel.",
      uz: "Qo'ng'iroqsiz ro'yxatdan o'tish, 14 kun bepul, karta kerak emas. Tovarlar va do'konlar Excel'dan yuklanadi.",
    },
  },
  {
    q: { ru: "На каких телефонах и языках?", uz: "Qaysi telefonlarda va tillarda?" },
    a: {
      ru: "Узбекский и русский. Приложение для Android, веб на любом телефоне; приложение для iPhone готовится к выходу в App Store. Один телефон можно отдать нескольким агентам — заказ каждого остаётся его.",
      uz: "O'zbek va rus tillari. Android ilovasi, istalgan telefonda veb; iPhone ilovasi App Store'ga chiqishga tayyorlanmoqda. Bitta telefonni bir nechta agent ishlatishi mumkin — har kimning buyurtmasi o'ziniki bo'lib qoladi.",
    },
  },
];

/** Кто ещё есть на рынке — коротко, что это, и откуда сведения. */
export const PLAYERS: Array<{ name: string; what: L; facts: L[]; sources: SourceKey[] }> = [
  {
    name: "Sales Doctor",
    what: {
      ru: "Узбекская система автоматизации дистрибуции и розницы: заказы, склад, оплаты и аналитика в одной системе.",
      uz: "Distribyutsiya va chakana savdoni avtomatlashtiruvchi o'zbek tizimi: buyurtmalar, ombor, to'lovlar va tahlil bitta tizimda.",
    },
    facts: [
      { ru: "По словам основателя — больше 3 000 клиентов; Узбекистан, Казахстан, Кыргызстан.", uz: "Asoschi so'ziga ko'ra — 3 000 dan ortiq mijoz; O'zbekiston, Qozog'iston, Qirg'iziston." },
      { ru: "Подписка — от $15 в месяц; за что именно — уточняйте у компании.", uz: "Obuna — oyiga $15 dan; aynan nima uchun ekanini kompaniyadan aniqlang." },
    ],
    sources: ["sd-interview", "sd-ad"],
  },
  {
    name: "Smartup",
    what: {
      ru: "Облачная платформа для дистрибуции, производства, склада, финансов и трейд-маркетинга; есть маркировка товаров и B2B-заказы.",
      uz: "Distribyutsiya, ishlab chiqarish, ombor, moliya va trade-marketing uchun bulutli platforma; tovar markirovkasi va B2B buyurtmalar bor.",
    },
    facts: [
      { ru: "Больше 700 компаний в Центральной Азии и больше 24 000 активных пользователей.", uz: "Markaziy Osiyoda 700 dan ortiq kompaniya va 24 000 dan ortiq faol foydalanuvchi." },
      { ru: "Цена публично не указана.", uz: "Narx ochiq e'lon qilinmagan." },
    ],
    sources: ["smartup"],
  },
  {
    name: "1С + Excel + Telegram",
    what: {
      ru: "Главный «конкурент» на деле: бесплатно и привычно, но долг, остаток и деньги друг с другом не связаны, а заказы агентов теряются в переписке.",
      uz: "Amalda asosiy «raqobatchi»: bepul va tanish, lekin qarz, qoldiq va pul bir-biriga bog'lanmagan, agentlar buyurtmalari yozishmalarda yo'qoladi.",
    },
    facts: [
      { ru: "1С мы не заменяем — обмениваемся с ней данными.", uz: "1C ni almashtirmaymiz — u bilan ma'lumot almashamiz." },
    ],
    sources: [],
  },
];

/**
 * Как перейти — по шагам. Те же шаги, что «Как начать» на лендинге: один
 * список в site-content, чтобы две страницы не обещали разное (здесь стояли
 * свои четыре шага с «пилотом на двух-трёх агентах»).
 */
export const STEPS = START_STEPS;
