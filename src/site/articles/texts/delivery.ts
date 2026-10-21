import { both, type ArticleText } from "../types";

/*
  Статья о доставке и деньгах курьера. Описано то, что есть после слияния
  ветки доставки (октябрь 2026), и каждое утверждение сверено с кодом:

   • назначение и погрузочный лист — «Заказы» → «Назначить курьера»;
   • доска развоза «Развоз сегодня» (src/components/delivery/DispatchBoard,
     api/services/dispatch-board): карта курьера, остановки по номерам, путь
     за день, «Предложить порядок» — от точки курьера не старше двух часов,
     иначе от первого адреса; день — сегодня или вперёд;
   • курьер на карте: включает сам в мобилке после раскрытия
     (Warehouse-Pro-Mobile: LocationDisclosure — при движении, не чаще раза в
     две минуты); видят директор и оператор (доска), директор и супервайзер
     (карта GPS); браузерный курьер шлёт точку, только пока программа открыта;
   • «Подтверждение вручения» — по желанию: до PROOF_MAX_PHOTOS фото, подпись,
     кто принял (contracts/delivery-proof.ts); в карточке заказа — «Попытки
     доставки» с местом отметки;
   • «Не доставлено» — только с причиной из DELIVERY_FAIL_REASONS
     (contracts/delivery-fail-reason.ts), «Другое» — с пояснением; «Перенести»
     оставляет заказ за курьером и не считается срывом; без дня заказ уходит
     в офис (снят с курьера, резерв остаётся); «Отчёты» → «Недоставленные»;
   • «Ссылка для магазина» (api/services/tracking.ts): шаги заказа, «перед
     вами адресов» и «примерно через» — только при свежей точке курьера; ни
     координат, ни имени курьера, ни сумм; после доставки — ссылка на чек; через
     TRACK_VISIBLE_DAYS дня ссылка гаснет;
   • расчёт в офисе (api/services/order-close*), «Контроль»
     (api/services/control.ts) и чек с QR (api/services/receipt.ts).

  Числа в тексте (причины, фото, дни ссылки) проверка site-articles сверяет
  с кодом: поменялось в коде — падает проверка, а не врёт статья.
*/
export const DELIVERY_ARTICLE: ArticleText = {
  key: "delivery",
  h1: both(
    "Доставка и деньги курьера: от назначения до расчёта в офисе",
    "Yetkazish va kuryer puli: tayinlashdan ofisdagi hisob-kitobgacha",
  ),
  lead: [
    both(
      "Курьер вернулся вечером: «магазин взял половину, остальное завтра», «вот деньги, считайте». Сколько он получил на самом деле, сколько осталось у него в кармане и сколько магазин ещё должен, выясняется к концу недели — если выясняется. А потом магазин говорит, что ящика не хватило, а курьер — что всё отдал.",
      "Kuryer kechqurun qaytdi: «do'kon yarmini oldi, qolganini ertaga», «mana pul, sanang». U aslida qancha olgani, cho'ntagida qanchasi qolgani va do'kon yana qancha qarzdorligi hafta oxirida aniqlanadi — agar aniqlansa. Keyin esa do'kon bir quti yetmadi deydi, kuryer esa hammasini berdim deydi.",
    ),
    both(
      "Ниже — как это устроено в Warehouse Pro: как заказ попадает к курьеру и в каком порядке тот едет, как закрывает доставку и что делает, если довезти не вышло, что магазин видит по своей ссылке и как офис принимает деньги.",
      "Quyida bu Warehouse Pro'da qanday ishlashi: buyurtma kuryerga qanday yetib boradi va u qaysi tartibda yuradi, yetkazishni qanday yopadi va olib borolmasa nima qiladi, do'kon o'z havolasi orqali nimani ko'radi va ofis pulni qanday qabul qiladi.",
    ),
  ],
  sections: [
    {
      id: "assign",
      h2: both("Назначение и порядок объезда", "Tayinlash va aylanish tartibi"),
      blocks: [
        {
          steps: [
            both(
              "В «Заказах» отметьте заказы и нажмите «Назначить курьера» — сразу на всю пачку или на целый погрузочный лист. Курьер получает уведомление в телефон, а если подключён Telegram — ещё и сообщение там.",
              "«Buyurtmalar» bo'limida buyurtmalarni belgilang va «Kuryer tayinlash» tugmasini bosing — butun to'plamga yoki butun yuklash varag'iga birdaniga. Kuryer telefoniga bildirishnoma oladi, Telegram ulangan bo'lsa — u yerda ham xabar.",
            ),
            both(
              "Склад собирает погрузочный лист: по каждой строке видно, сколько нужно и сколько собрано, партии подбираются по сроку годности. Если чего-то не хватило, недостача записывается в лист, а не теряется на словах.",
              "Ombor yuklash varag'ini yig'adi: har bir qatorda qancha kerakligi va qanchasi yig'ilgani ko'rinadi, partiyalar yaroqlilik muddati bo'yicha tanlanadi. Biror narsa yetmasa, kamomad og'zaki yo'qolib ketmaydi, varaqqa yoziladi.",
            ),
            both(
              "Офис открывает доску развоза «Развоз сегодня»: слева курьеры, справа карта выбранного — где он сейчас, его остановки по номерам и путь за день. Остановки можно перетащить или нажать «Предложить порядок»: программа ведёт от ближайшего адреса к ближайшему, начиная с последней точки курьера, если она свежая.",
              "Ofis «Bugungi yetkazish» doskasini ochadi: chapda kuryerlar, o'ngda tanlangan kuryer xaritasi — u hozir qayerda, raqamlangan to'xtashlari va kun davomidagi yo'li. To'xtashlarni surish yoki «Tartib taklif qilish»ni bosish mumkin: dastur eng yaqin manzildan keyingi eng yaqiniga olib boradi, kuryerning oxirgi nuqtasi yangi bo'lsa, o'shandan boshlab.",
            ),
            both(
              "После «Сохранить» курьер видит у каждого заказа его номер в маршруте. Порядок на завтра можно собрать с вечера — день выбирается на доске.",
              "«Saqlash»dan keyin kuryer har bir buyurtmada uning marshrutdagi raqamini ko'radi. Ertangi tartibni kechqurundan tuzish mumkin — kun doskada tanlanadi.",
            ),
          ],
        },
        { see: "warehouse", text: both("Как склад подбирает партии по сроку годности", "Ombor partiyalarni yaroqlilik muddati bo'yicha qanday tanlaydi") },
      ],
    },
    {
      id: "courier",
      h2: both("Что делает курьер", "Kuryer nima qiladi"),
      blocks: [
        {
          p: both(
            "В разделе «Доставки» в телефоне курьера заказы разложены по разделам «ОЖИДАЮТ ДОСТАВКИ» и «В ПУТИ» — в порядке маршрута, если офис его задал. «Выехал» отмечает выезд по одному заказу, «Выехал по всем» — по всем сразу; адрес магазина открывается на карте.",
            "Kuryer telefonidagi «Yetkazishlar» bo'limida buyurtmalar «YETKAZISHNI KUTMOQDA» va «YO'LDA» bo'limlariga ajratilgan — ofis marshrut bergan bo'lsa, o'sha tartibda. «Yo'lga chiqdim» bitta buyurtma bo'yicha chiqishni belgilaydi, «Hammasiga yo'lga chiqdim» — barchasi bo'yicha birdaniga; do'kon manzili xaritada ochiladi.",
          ),
        },
        {
          steps: [
            both(
              "На экране доставки курьер выбирает «РЕЗУЛЬТАТ ДОСТАВКИ»: «100% оплачен», «Частично оплачен», «Возврат» или «Частичный возврат».",
              "Yetkazish ekranida kuryer «YETKAZISH NATIJASI»ni tanlaydi: «100% to'langan», «Qisman to'langan», «Qaytarish» yoki «Qisman qaytarish».",
            ),
            both(
              "При частичной оплате он вводит сумму и записывает, когда магазин обещал доплатить. При частичном возврате — сколько вернулось по каждой строке и почему.",
              "Qisman to'lovda u summani kiritadi va do'kon qolganini qachon to'lashga va'da qilganini yozadi. Qisman qaytarishda — har bir qator bo'yicha qanchasi qaytgani va nima sababdan.",
            ),
            both(
              "Отмечает, как платили, — «Наличные», «Карта» или «Перевод» — и нажимает «ЗАВЕРШИТЬ ДОСТАВКУ».",
              "Qanday to'langanini belgilaydi — «Naqd», «Plastik» yoki «O'tkazma» — va «YETKAZISHNI YAKUNLASH» tugmasini bosadi.",
            ),
            both(
              "Нет связи — доставка записывается в телефоне и уходит сама. Пока она ждёт сети, заказ виден в разделе «ЖДУТ ОТПРАВКИ».",
              "Aloqa yo'q — yetkazish telefonda yoziladi va o'zi yuboriladi. U tarmoqni kutayotganda buyurtma «YUBORISHNI KUTMOQDA» bo'limida ko'rinadi.",
            ),
          ],
        },
        {
          shot: {
            phone: "deliver",
            alt: both(
              "Экран доставки в телефоне курьера: выбор результата доставки и способа оплаты",
              "Kuryer telefonidagi yetkazish ekrani: yetkazish natijasi va to'lov usulini tanlash",
            ),
            caption: both(
              "Экран доставки в телефоне курьера: состав заказа, результат доставки, сумма и способ оплаты, комментарий.",
              "Kuryer telefonidagi yetkazish ekrani: buyurtma tarkibi, yetkazish natijasi, summa va to'lov usuli, izoh.",
            ),
          },
        },
        {
          p: both(
            "Следом телефон предлагает «Подтверждение вручения»: до 3 фото, подпись получателя пальцем на экране и имя того, кто принял. Шаг можно пропустить, но если магазин потом скажет, что товар не получал, в карточке заказа у офиса будут снимки, подпись, имя и место, где курьер отметил доставку.",
            "Keyin telefon «Topshirish tasdig'i»ni taklif qiladi: 3 tagacha rasm, qabul qiluvchining ekranda barmoq bilan qo'ygan imzosi va kim qabul qilgani. Qadamni o'tkazib yuborish mumkin, lekin do'kon keyinroq tovarni olmadim desa, ofisda buyurtma kartasida rasmlar, imzo, ism va kuryer yetkazishni qayerda belgilagani bo'ladi.",
          ),
        },
      ],
    },
    {
      id: "fail",
      h2: both("Не довёз: причина или другой день", "Olib borolmadi: sabab yoki boshqa kun"),
      blocks: [
        {
          p: both(
            "Если доставить не вышло, курьер нажимает «Не доставлено» и выбирает одну из 13 причин: «Магазин закрыт», «Нечем платить», «Не дозвонился», «Не хватило товара в машине» и другие. Для «Другое» нужно коротко написать, что случилось. Без причины отметка не ставится.",
            "Yetkazib bo'lmasa, kuryer «Yetkazilmadi» tugmasini bosadi va 13 ta sababdan birini tanlaydi: «Do'kon yopiq», «To'lashga puli yo'q», «Telefonga javob yo'q», «Mashinada tovar yetmadi» va boshqalar. «Boshqa» uchun nima bo'lganini qisqa yozish kerak. Sababsiz belgi qo'yilmaydi.",
          ),
        },
        {
          list: [
            both(
              "Магазин просит привезти в другой день — курьер выбирает день и нажимает «Перенести». Заказ остаётся за ним и вернётся в его список в этот день; срывом перенос не считается. Перенести можно и до выезда, когда магазин звонит утром;",
              "Do'kon boshqa kuni olib kelishni so'rasa — kuryer kunni tanlaydi va «Ko'chirish»ni bosadi. Buyurtma unda qoladi va o'sha kuni uning ro'yxatiga qaytadi; ko'chirish bajarilmagan yetkazish hisoblanmaydi. Yo'lga chiqishdan oldin ham, do'kon ertalab qo'ng'iroq qilganda, ko'chirish mumkin;",
            ),
            both(
              "без нового дня заказ возвращается в офис: курьер с него снимается, товар остаётся в резерве, и офис решает, кому и когда везти. Офис и сам переносит заказ — в карточке заказа или на доске развоза;",
              "yangi kunsiz buyurtma ofisga qaytadi: kuryer undan olinadi, tovar zahirada qoladi, kim va qachon olib borishini ofis hal qiladi. Ofis o'zi ham buyurtmani ko'chiradi — buyurtma kartasida yoki yetkazish doskasida;",
            ),
            both(
              "в «Отчётах» на вкладке «Недоставленные» видно, какая доля попыток срывается, по каким причинам, у каких курьеров и в каких магазинах.",
              "«Hisobotlar»dagi «Yetkazilmagan» bo'limida urinishlarning qancha qismi bajarilmagani, qaysi sabablar bilan, qaysi kuryerlarda va qaysi do'konlarda ekani ko'rinadi.",
            ),
          ],
        },
      ],
    },
    {
      id: "map",
      h2: both("Курьер на карте", "Kuryer xaritada"),
      blocks: [
        {
          p: both(
            "Отправку места курьер включает в мобильном приложении сам, и до системного запроса приложение говорит, что записывается и кто это увидит: точка — при движении, не чаще раза в две минуты, в том числе когда приложение свёрнуто. Выключить можно в любой момент.",
            "Joylashuvni yuborishni kuryer mobil ilovada o'zi yoqadi, tizim so'rovidan oldin esa ilova nima yozilishini va buni kim ko'rishini aytadi: nuqta harakatlanganda olinadi, ikki daqiqada bir martadan ko'p emas, ilova yig'ilgan paytda ham. Istalgan vaqtda o'chirish mumkin.",
          ),
        },
        {
          list: [
            both(
              "директор и оператор видят курьера на доске развоза — вместе с остановками и путём за день;",
              "direktor va operator kuryerni yetkazish doskasida ko'radi — to'xtashlari va kun davomidagi yo'li bilan birga;",
            ),
            both(
              "директор и супервайзер — на карте GPS рядом с агентами, с пометкой «курьер»;",
              "direktor va supervayzer — GPS xaritasida agentlar yonida, «kuryer» belgisi bilan;",
            ),
            both(
              "магазин карты не видит: по своей ссылке — только примерное время приезда.",
              "do'kon xaritani ko'rmaydi: o'z havolasi orqali faqat taxminiy yetib kelish vaqtini ko'radi.",
            ),
          ],
        },
        {
          p: both(
            "Курьер, который работает в браузере, а не в приложении, отправляет точку, только пока программа открыта.",
            "Ilovada emas, brauzerda ishlaydigan kuryer nuqtani faqat dastur ochiq turganda yuboradi.",
          ),
        },
        { see: "agents", text: both("Как устроен GPS у торговых агентов", "Savdo agentlarida GPS qanday ishlaydi") },
      ],
    },
    {
      id: "track",
      h2: both("Ссылка для магазина: где мой заказ", "Do'kon uchun havola: buyurtmam qayerda"),
      blocks: [
        {
          steps: [
            both(
              "В карточке заказа есть кнопка «Ссылка для магазина»: ссылку копируют или сразу отправляют в Telegram. У курьера в телефоне та же ссылка — кнопка «Магазину».",
              "Buyurtma kartasida «Do'kon uchun havola» tugmasi bor: havola nusxalanadi yoki darhol Telegramda yuboriladi. Kuryer telefonida ham xuddi shu havola — «Do'konga» tugmasi.",
            ),
            both(
              "Магазин открывает страницу на русском или узбекском и видит, где заказ: принят, у курьера, в пути, доставлен, — а если доставку перенесли, то на какой день.",
              "Do'kon sahifani rus yoki o'zbek tilida ochadi va buyurtma qayerdaligini ko'radi: qabul qilindi, kuryerda, yo'lda, yetkazildi, — yetkazish ko'chirilgan bo'lsa, qaysi kunga ekanini ham.",
            ),
            both(
              "Когда курьер в пути и его телефон недавно передал место, страница пишет, сколько адресов перед магазином и примерно через сколько минут курьер приедет. Свежей точки нет — минут страница не обещает.",
              "Kuryer yo'lda bo'lsa va telefoni yaqinda joylashuvini yuborgan bo'lsa, sahifa do'kondan oldin nechta manzil borligini va kuryer taxminan necha daqiqadan keyin kelishini yozadi. Yangi nuqta bo'lmasa, sahifa daqiqa va'da qilmaydi.",
            ),
            both(
              "После доставки на странице появляется ссылка на чек с QR. Через 3 дня после доставки ссылка перестаёт открываться.",
              "Yetkazilgandan keyin sahifada QR chekka havola paydo bo'ladi. Yetkazilgandan 3 kun o'tgach, havola ochilmay qoladi.",
            ),
          ],
        },
        {
          note: {
            title: both("Чего на странице нет", "Sahifada nima yo'q"),
            text: both(
              "Карты и пути курьера, его имени и телефона, товаров и сумм. Ссылку может открыть любой, кому её переслали, поэтому там только шаги заказа.",
              "Kuryerning xaritasi va yo'li, ismi va telefoni, tovarlar va summalar. Havolani u yuborilgan har kim ochishi mumkin, shuning uchun u yerda faqat buyurtma bosqichlari bor.",
            ),
          },
        },
      ],
    },
    {
      id: "office",
      h2: both("Расчёт в офисе: сколько денег пришло на самом деле", "Ofisdagi hisob-kitob: aslida qancha pul keldi"),
      blocks: [
        {
          p: both(
            "Доставленный заказ попадает в очередь «Ждут расчёта» в «Заказах». Здесь офис сводит то, что курьер заявил, с тем, что он сдал:",
            "Yetkazilgan buyurtma «Buyurtmalar»dagi «Hisob-kitob kutmoqda» navbatiga tushadi. Bu yerda ofis kuryer aytganini u topshirgani bilan solishtiradi:",
          ),
        },
        {
          list: [
            both(
              "наличные: оператор вводит, сколько получил в кассу. Если меньше заявленного, разница записывается курьеру как недостача и вычитается из его зарплаты автоматически. Если больше — лишнее проводится как оплата магазина;",
              "naqd pul: operator kassaga qancha olganini kiritadi. Aytilganidan kam bo'lsa, farq kuryerga kamomad sifatida yoziladi va uning maoshidan avtomatik ushlanadi. Ko'p bo'lsa — ortig'i do'kon to'lovi sifatida o'tkaziladi;",
            ),
            both(
              "карта и перевод ждут подтверждения банка — этих денег у курьера на руках нет;",
              "karta va o'tkazma bank tasdig'ini kutadi — bu pul kuryerning qo'lida yo'q;",
            ),
            both(
              "остаток по заказу должен стать нулём или явно остаться долгом магазина — с датой, когда тот обещал заплатить.",
              "buyurtma bo'yicha qoldiq nolga teng bo'lishi yoki aniq do'kon qarzi bo'lib qolishi kerak — u to'lashni va'da qilgan sana bilan.",
            ),
          ],
        },
        {
          p: both(
            "Вечернюю сдачу можно закрыть пачкой — «Принять по заявленному»: так закрываются только заказы без расхождений, остальные оператор разбирает по одному.",
            "Kechki topshirishni to'plam bilan yopish mumkin — «E'lon qilingani bo'yicha qabul qilish»: shunday faqat farqsiz buyurtmalar yopiladi, qolganlarini operator birma-bir ko'rib chiqadi.",
          ),
        },
      ],
    },
    {
      id: "control",
      h2: both("«Контроль» и чек с QR: у кого деньги и что сказал магазин", "«Nazorat» va QR chek: pul kimda va do'kon nima dedi"),
      blocks: [
        {
          p: both(
            "Раздел «Контроль» для директора включают в настройках. Там видно, у кого наличные на руках и с какого часа — плитка «На руках» краснеет, если дольше суток, — «Недостачи при расчёте», «Спорные доставки» и «Без слова магазина»: доставки, на которые магазин за двое суток не ответил.",
            "Direktor uchun «Nazorat» bo'limi sozlamalarda yoqiladi. U yerda naqd pul kimning qo'lida va soat nechadan beri turgani ko'rinadi — bir kundan oshsa, «Qo'lda» plitkasi qizaradi, — «Hisob-kitobdagi kamomadlar», «Nizoli yetkazishlar» va «Do'kon so'zisiz»: do'kon ikki kun ichida javob bermagan yetkazishlar.",
          ),
        },
        {
          steps: [
            both(
              "У доставленного заказа есть чек: в карточке заказа «Печать» → «Чек 58 мм (QR)». Его печатают на ленте или отправляют магазину файлом или ссылкой.",
              "Yetkazilgan buyurtmaning cheki bor: buyurtma kartasida «Chop etish» → «Chek 58 mm (QR)». U lentada chop etiladi yoki do'konga fayl yoki havola sifatida yuboriladi.",
            ),
            both(
              "Магазин сканирует QR и видит те же строки и сумму, что в программе. Ссылка подписана: чек на продажу, которой нет в программе, подделать нельзя.",
              "Do'kon QR'ni skanerlaydi va dasturdagi o'sha qatorlar va summani ko'radi. Havola imzolangan: dasturda yo'q savdo uchun chekni soxtalashtirib bo'lmaydi.",
            ),
            both(
              "Если включён «Контроль», на странице чека две кнопки: «Да, всё верно — получил» и «Не сходится — сообщить поставщику» с комментарием. Ответить можно один раз. Курьер нажать их за магазин не может: кнопок нет ни в его приложении, ни на бумаге. «Не сходится» уходит директору в Telegram, если он подключён, а доставка попадает в «Спорные доставки».",
              "«Nazorat» yoqilgan bo'lsa, chek sahifasida ikkita tugma bor: «hammasi to'g'ri — oldim» va izoh bilan «mos kelmaydi — yetkazib beruvchiga xabar berish». Faqat bir marta javob berish mumkin. Kuryer ularni do'kon o'rniga bosa olmaydi: tugmalar uning ilovasida ham, qog'ozda ham yo'q. «Mos kelmaydi», Telegram ulangan bo'lsa, direktorga Telegramda boradi, yetkazish esa «Nizoli yetkazishlar»ga tushadi. Chek sahifasi, boshqa hujjatlar kabi, rus tilida.",
            ),
          ],
        },
      ],
    },
  ],
  faq: [
    {
      q: both("Что если магазин заплатил только часть?", "Do'kon faqat bir qismini to'lasa-chi?"),
      a: both(
        "Курьер выбирает «Частично оплачен», вводит сумму и дату, когда магазин обещал доплатить. Остаток становится долгом магазина, а за день до срока директор и операторы получают напоминание.",
        "Kuryer «Qisman to'langan»ni tanlaydi, summani va do'kon qolganini to'lashga va'da qilgan sanani kiritadi. Qoldiq do'kon qarziga aylanadi, muddatdan bir kun oldin esa direktor va operatorlar eslatma oladi.",
      ),
    },
    {
      q: both("Что если магазин просит привезти завтра?", "Do'kon ertaga olib kelishni so'rasa-chi?"),
      a: both(
        "Курьер выбирает причину «Просили привезти в другой день» — «Завтра» подставляется само, день можно сменить — и нажимает «Перенести». Заказ остаётся за ним и в долю сорванных доставок не идёт.",
        "Kuryer «Boshqa kuni olib kelishni so'rashdi» sababini tanlaydi — «Ertaga» o'zi qo'yiladi, kunni o'zgartirish mumkin — va «Ko'chirish»ni bosadi. Buyurtma unda qoladi va bajarilmagan yetkazishlar ulushiga kirmaydi.",
      ),
    },
    {
      q: both("Подтверждает ли магазин получение товара?", "Do'kon tovarni olganini tasdiqlaydimi?"),
      a: both(
        "Двумя способами. Курьер может снять фото, взять подпись получателя и записать, кто принял. А если включён «Контроль», магазин сам нажимает «получил» или «не сходится» по QR на чеке — курьер за него этого сделать не может.",
        "Ikki yo'l bilan. Kuryer rasmga olishi, qabul qiluvchining imzosini olishi va kim qabul qilganini yozishi mumkin. «Nazorat» yoqilgan bo'lsa esa, do'kon chekdagi QR orqali o'zi «oldim» yoki «mos kelmaydi»ni bosadi — kuryer buni uning o'rniga qila olmaydi.",
      ),
    },
    {
      q: both("Видит ли магазин, где сейчас курьер?", "Do'kon kuryer hozir qayerdaligini ko'radimi?"),
      a: both(
        "Нет: карты и пути курьера на его странице нет. Магазин видит шаги заказа, а когда курьер в пути и его место свежее, — сколько адресов впереди и примерно через сколько минут приезд.",
        "Yo'q: uning sahifasida kuryerning xaritasi va yo'li yo'q. Do'kon buyurtma bosqichlarini ko'radi, kuryer yo'lda bo'lib, joylashuvi yangi bo'lsa, — oldinda nechta manzil borligini va taxminan necha daqiqadan keyin yetib kelishini.",
      ),
    },
  ],
};
