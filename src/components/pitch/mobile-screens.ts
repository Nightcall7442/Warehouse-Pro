/**
 * Экраны мобильного приложения агента — те же кадры, что сняты для App Store
 * (настоящий интерфейс приложения, демо-данные). Подписи — на языке страницы;
 * интерфейс на кадрах русский, так они сняты.
 */
export const MOBILE_SCREENS: Array<{ src: string; uz: string; ru: string; noteUz: string; noteRu: string }> = [
  { src: "/pitch/app/01-catalog.webp", uz: "Buyurtma bir daqiqada", ru: "Заказ за минуту", noteUz: "Rasmli katalog, qoldiq va do'kon narxlari", noteRu: "Каталог с фото, остатками и ценами магазина" },
  { src: "/pitch/app/02-offline.webp", uz: "Aloqa bo'lmasa ham", ru: "Даже без связи", noteUz: "Buyurtma telefonda saqlanadi va o'zi jo'natiladi", noteRu: "Заказ сохранится и уйдёт сам, когда появится сеть" },
  { src: "/pitch/app/03-repeat.webp", uz: "O'tgan safargidek", ru: "Как в прошлый раз", noteUz: "Do'konning oldingi buyurtmasi — bir bosishda", noteRu: "Прошлый заказ магазина — одним касанием" },
  { src: "/pitch/app/04-reason.webp", uz: "Nega sotilmadi", ru: "Почему не продали", noteUz: "Buyurtmasiz tashrif sabab bilan yopiladi", noteRu: "Визит без заказа закрывается с причиной" },
  { src: "/pitch/app/05-home.webp", uz: "Kunlik reja", ru: "План дня", noteUz: "Bugungi tashriflar va marshrut", noteRu: "Визиты и маршрут на сегодня" },
  { src: "/pitch/app/06-debts.webp", uz: "Buyurtmalar bo'yicha qarz", ru: "Долги по заказам", noteUz: "Kim, qancha va qaysi kundan beri qarzdor", noteRu: "Кто, сколько и с какого дня должен" },
  { src: "/pitch/app/07-tracking.webp", uz: "Jamoa xaritada", ru: "Команда на карте", noteUz: "Supervayzer: agentlar ish kunida qayerda — roziligi bilan", noteRu: "Супервайзер: где агенты в рабочий день — с их согласия" },
];
