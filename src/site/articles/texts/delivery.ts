import { both, type ArticleText } from "../types";

/*
  Статья о доставке и деньгах курьера. Описано только то, что есть в
  основной ветке (октябрь 2026): назначение курьера («Заказы» → «Назначить
  курьера», погрузочный лист), экран доставки в телефоне курьера
  (Warehouse-Pro-Mobile: результат, оплата, «ЖДУТ ОТПРАВКИ» без сети,
  «Итоги месяца»), расчёт в офисе (api/services/order-close*: «Ждут
  расчёта», недостача курьера в зарплату, «Принять по заявленному» только
  при точном совпадении), «Контроль» (api/services/control.ts) и чек с QR
  (api/services/receipt.ts: ссылка подписана HMAC, слово магазина — только
  на странице по ссылке).

  Слежения за курьером и подтверждения вручения снимком здесь нет и не
  будет, пока этого нет в основной ветке: проверка site-articles стережёт
  эти слова в тексте статьи.
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
      "Ниже — как это устроено в Warehouse Pro: как заказ попадает к курьеру, как он закрывает доставку, как офис принимает деньги и где видно, у кого наличные на руках.",
      "Quyida bu Warehouse Pro'da qanday ishlashi: buyurtma kuryerga qanday yetib boradi, u yetkazishni qanday yopadi, ofis pulni qanday qabul qiladi va kimning qo'lida naqd pul borligi qayerda ko'rinadi.",
    ),
  ],
  sections: [
    {
      id: "assign",
      h2: both("Назначение: кто что везёт", "Tayinlash: kim nimani olib boradi"),
      blocks: [
        {
          steps: [
            both(
              "В «Заказах» отметьте заказы и нажмите «Назначить курьера» — сразу на всю пачку. Можно назначить и целый погрузочный лист.",
              "«Buyurtmalar» bo'limida buyurtmalarni belgilang va «Kuryer tayinlash» tugmasini bosing — butun to'plamga birdaniga. Butun yuklash varag'ini ham tayinlash mumkin.",
            ),
            both(
              "Курьер получает уведомление в телефон, а если подключён Telegram — ещё и сообщение там.",
              "Kuryer telefoniga bildirishnoma oladi, Telegram ulangan bo'lsa — u yerda ham xabar.",
            ),
            both(
              "Склад собирает погрузочный лист: по каждой строке видно, сколько нужно и сколько собрано, партии подбираются по сроку годности. Если чего-то не хватило, недостача записывается в лист, а не теряется на словах.",
              "Ombor yuklash varag'ini yig'adi: har bir qatorda qancha kerakligi va qanchasi yig'ilgani ko'rinadi, partiyalar yaroqlilik muddati bo'yicha tanlanadi. Biror narsa yetmasa, kamomad og'zaki yo'qolib ketmaydi, varaqqa yoziladi.",
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
            "В разделе «Доставки» в телефоне курьера заказы разложены по разделам «ОЖИДАЮТ ДОСТАВКИ» и «В ПУТИ». Кнопка «Выехал» отмечает выезд по одному заказу, «Выехал по всем» — по всем сразу; адрес магазина открывается на карте.",
            "Kuryer telefonidagi «Yetkazishlar» bo'limida buyurtmalar «YETKAZISHNI KUTMOQDA» va «YO'LDA» bo'limlariga ajratilgan. «Yo'lga chiqdim» tugmasi bitta buyurtma bo'yicha chiqishni belgilaydi, «Hammasiga yo'lga chiqdim» — barchasi bo'yicha birdaniga; do'kon manzili xaritada ochiladi.",
          ),
        },
        {
          steps: [
            both(
              "На экране доставки курьер выбирает «РЕЗУЛЬТАТ ДОСТАВКИ»: «100% оплачен», «Частично оплачен», «Возврат» или «Частичный возврат».",
              "Yetkazish ekranida kuryer «YETKAZISH NATIJASI»ni tanlaydi: «100% to'langan», «Qisman to'langan», «Qaytarish» yoki «Qisman qaytarish».",
            ),
            both(
              "При частичной оплате он вводит сумму и записывает, когда магазин обещал доплатить. При частичном возврате — сколько вернулось по каждой строке и почему. При полном возврате товар возвращается на склад.",
              "Qisman to'lovda u summani kiritadi va do'kon qolganini qachon to'lashga va'da qilganini yozadi. Qisman qaytarishda — har bir qator bo'yicha qanchasi qaytgani va nima sababdan. To'liq qaytarishda tovar omborga qaytadi.",
            ),
            both(
              "Отмечает, как платили, — «Наличные», «Карта» или «Перевод», — при необходимости пишет комментарий и нажимает «ЗАВЕРШИТЬ ДОСТАВКУ».",
              "Qanday to'langanini belgilaydi — «Naqd», «Plastik» yoki «O'tkazma» — kerak bo'lsa izoh yozadi va «YETKAZISHNI YAKUNLASH» tugmasini bosadi.",
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
            "Если доставка не состоялась, курьер нажимает «Не доставлено» и указывает причину. В «Итогах месяца» он видит, сколько довёз, сколько сорвалось и сколько денег привёз.",
            "Yetkazish amalga oshmasa, kuryer «Yetkazilmadi» tugmasini bosadi va sababini ko'rsatadi. «Oy yakuni»da u qanchasini yetkazgani, qanchasi bajarilmagani va qancha pul olib kelganini ko'radi.",
          ),
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
              "остаток по заказу должен стать нулём или явно остаться долгом магазина — с датой, когда тот обещал заплатить. Пропасть без следа он не может.",
              "buyurtma bo'yicha qoldiq nolga teng bo'lishi yoki aniq do'kon qarzi bo'lib qolishi kerak — u to'lashni va'da qilgan sana bilan. U izsiz yo'qolib keta olmaydi.",
            ),
          ],
        },
        {
          p: both(
            "Вечернюю сдачу курьера можно закрыть пачкой — «Принять по заявленному». Пачкой закрываются только заказы, где заявленное курьером точно равно остатку; каждый заказ с расхождением оператор разбирает отдельно в его карточке.",
            "Kuryerning kechki topshirishini to'plam bilan yopish mumkin — «E'lon qilingani bo'yicha qabul qilish». To'plam bilan faqat kuryer aytgani qoldiqqa aniq teng bo'lgan buyurtmalar yopiladi; farqi bor har bir buyurtmani operator uning kartasida alohida ko'rib chiqadi.",
          ),
        },
      ],
    },
    {
      id: "control",
      h2: both("«Контроль»: у кого деньги на руках", "«Nazorat»: pul kimning qo'lida"),
      blocks: [
        {
          p: both(
            "Для директора есть раздел «Контроль» — его включают в настройках. Там собрано всё, что касается денег в поле:",
            "Direktor uchun «Nazorat» bo'limi bor — u sozlamalarda yoqiladi. U yerda daladagi pulga oid hamma narsa jamlangan:",
          ),
        },
        {
          list: [
            both(
              "плитки «Ждут расчёта», «На руках» — она краснеет, если наличные у кого-то дольше суток, — и «Недостач за период»;",
              "«Hisob-kitob kutmoqda», «Qo'lda» — kimdadir naqd pul bir kundan ko'p tursa, u qizaradi — va «Davr kamomadlari» plitkalari;",
            ),
            both(
              "таблица «Наличные на руках»: сотрудник, сумма, сколько заказов и с какого часа деньги у него;",
              "«Qo'ldagi naqd pul» jadvali: xodim, summa, nechta buyurtma va pul unda soat nechadan beri turgani;",
            ),
            both(
              "«Недостачи при расчёте» — кто, когда и на сколько не досдал;",
              "«Hisob-kitobdagi kamomadlar» — kim, qachon va qancha kam topshirgani;",
            ),
            both(
              "«Спорные доставки» — где магазин ответил, что не сходится;",
              "«Nizoli yetkazishlar» — do'kon mos kelmadi deb javob bergan joylar;",
            ),
            both(
              "«Без слова магазина» — доставлено больше двух суток назад, а магазин так и не ответил.",
              "«Do'kon so'zisiz» — ikki kundan ko'proq oldin yetkazilgan, lekin do'kon hali javob bermagan.",
            ),
          ],
        },
      ],
    },
    {
      id: "qr",
      h2: both("Чек с QR: магазин отвечает сам", "QR chek: do'kon o'zi javob beradi"),
      blocks: [
        {
          steps: [
            both(
              "У доставленного заказа есть чек: в карточке заказа «Печать» → «Чек 58 мм (QR)». Его печатают на 58-миллиметровой ленте или отправляют магазину файлом или ссылкой.",
              "Yetkazilgan buyurtmaning cheki bor: buyurtma kartasida «Chop etish» → «Chek 58 mm (QR)». U 58 millimetrli lentada chop etiladi yoki do'konga fayl yoki havola sifatida yuboriladi.",
            ),
            both(
              "Магазин сканирует QR и видит свою покупку: те же строки и сумму, что записаны в программе. Ссылка защищена, поэтому чек на продажу, которой в программе нет, подделать нельзя.",
              "Do'kon QR'ni skanerlaydi va o'z xaridini ko'radi: dasturda yozilgan o'sha qatorlar va summa. Havola himoyalangan, shuning uchun dasturda yo'q savdo uchun chekni soxtalashtirib bo'lmaydi.",
            ),
            both(
              "Если включён «Контроль», на странице чека у магазина две кнопки: «Да, всё верно — получил» и «Не сходится — сообщить поставщику» с комментарием. Ответить можно один раз.",
              "«Nazorat» yoqilgan bo'lsa, chek sahifasida do'kon uchun ikkita tugma bo'ladi: «hammasi to'g'ri — oldim» va izoh bilan «mos kelmaydi — yetkazib beruvchiga xabar berish». Faqat bir marta javob berish mumkin. Chek sahifasi, boshqa hujjatlar kabi, rus tilida.",
            ),
            both(
              "Ответ «не сходится» уходит директору в Telegram, если он подключён, а доставка попадает в «Спорные доставки».",
              "«Mos kelmaydi» javobi, Telegram ulangan bo'lsa, direktorga Telegramda boradi, yetkazish esa «Nizoli yetkazishlar»ga tushadi.",
            ),
          ],
        },
        {
          note: {
            title: both("Почему кнопки — только у магазина", "Nega tugmalar faqat do'konda"),
            text: both(
              "Кнопок «получил» и «не сходится» нет ни в приложении курьера, ни в напечатанном чеке — только на странице, которую магазин открывает по QR. Ответить за магазин курьер не может.",
              "«Oldim» va «mos kelmaydi» tugmalari kuryer ilovasida ham, chop etilgan chekda ham yo'q — faqat do'kon QR orqali ochadigan sahifada bor. Kuryer do'kon nomidan javob bera olmaydi.",
            ),
          },
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
      q: both("Как увидеть недостачу курьера?", "Kuryer kamomadini qanday ko'rish mumkin?"),
      a: both(
        "При расчёте в офисе: если в кассу сдано меньше, чем курьер заявил, разница записывается ему недостачей и вычитается из зарплаты. Все недостачи за период — в «Контроле».",
        "Ofisdagi hisob-kitobda: kassaga kuryer aytganidan kam topshirilsa, farq unga kamomad sifatida yoziladi va maoshidan ushlanadi. Davrdagi barcha kamomadlar — «Nazorat»da.",
      ),
    },
    {
      q: both("Можно ли вернуть только часть товара?", "Tovarning faqat bir qismini qaytarish mumkinmi?"),
      a: both(
        "Да, «Частичный возврат»: курьер указывает, сколько вернулось по каждой строке и почему. Сумма заказа уменьшается до того, что магазин оставил себе, а невзятый товар снова свободен на складе.",
        "Ha, «Qisman qaytarish»: kuryer har bir qator bo'yicha qanchasi qaytgani va nima sababdan ekanini ko'rsatadi. Buyurtma summasi do'kon olib qolgan qismgacha kamayadi, olinmagan tovar esa omborda yana bo'sh bo'ladi.",
      ),
    },
    {
      q: both("Подтверждает ли магазин получение товара?", "Do'kon tovarni olganini tasdiqlaydimi?"),
      a: both(
        "Если включён «Контроль» — да: по QR на чеке магазин нажимает «получил» или «не сходится». Кнопки есть только на странице по ссылке, курьер нажать их за магазин не может.",
        "«Nazorat» yoqilgan bo'lsa — ha: chekdagi QR orqali do'kon «oldim» yoki «mos kelmaydi» tugmasini bosadi. Tugmalar faqat havola orqali ochiladigan sahifada bor, kuryer ularni do'kon o'rniga bosa olmaydi.",
      ),
    },
    {
      q: both("Что если у курьера нет связи?", "Kuryerda aloqa bo'lmasa-chi?"),
      a: both(
        "Доставка записывается в телефоне и уходит сама, когда сеть вернётся. Пока она ждёт, заказ виден в разделе «ЖДУТ ОТПРАВКИ».",
        "Yetkazish telefonda yoziladi va tarmoq qaytganda o'zi yuboriladi. U kutayotganda buyurtma «YUBORISHNI KUTMOQDA» bo'limida ko'rinadi.",
      ),
    },
  ],
};
