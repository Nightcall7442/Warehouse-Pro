import { both, type ArticleText } from "../types";

/*
  Статья о работе торговых агентов. Каждое утверждение сверено с кодом
  (октябрь 2026): план визитов — components/plans (MonthPlanner, «Как прошёл
  день» — geo.day), телефон агента — Warehouse-Pro-Mobile (вкладка «План»,
  причины визита без заказа, очередь заказов без сети), заказ —
  api/services/order-create (резерв, кредитный лимит под замком строки
  магазина), GPS — «Авто-слежение» и «Карта» супервайзера.

  Чего здесь нет намеренно: агент НЕ ставит себе визиты (createPlan — только
  директор и супервайзер); приложение — для Android, на iPhone — веб-версия,
  пока приложение на проверке App Store («iOS и Android» не писать).
*/
export const AGENTS_ARTICLE: ArticleText = {
  key: "agents",
  h1: both(
    "Программа для торговых агентов: заказы, план визитов, GPS и работа без сети",
    "Savdo agentlari uchun dastur: buyurtmalar, tashrif rejasi, GPS va tarmoqsiz ish",
  ),
  lead: [
    both(
      "Агент говорит, что объехал двадцать магазинов, а заказов привёз шесть. Где он был и почему в остальных пусто — проверить нечем. Заказы приходят звонком или фотографией тетради, цены в них прошлого месяца, а товара, который агент пообещал, на складе уже нет. На рынке пропала связь — и заказ «потом перезвоню» не дошёл вовсе.",
      "Agent yigirmata do'konni aylanib chiqdim deydi, buyurtma esa oltita. U qayerda bo'lgani va qolganlarida nega bo'sh ekanini tekshirishning iloji yo'q. Buyurtmalar qo'ng'iroq yoki daftar surati bilan keladi, narxlar o'tgan oyniki, agent va'da qilgan tovar esa omborda allaqachon qolmagan. Bozorda aloqa uzildi — va «keyin qo'ng'iroq qilaman» degan buyurtma umuman yetib kelmadi.",
    ),
    both(
      "Ниже — как это устроено в Warehouse Pro: кто ставит план визитов, что агент делает в телефоне, как заказ уходит без сети и как вечером проверить, где агент был на самом деле. Каждый шаг — на настоящих экранах программы.",
      "Quyida bu Warehouse Pro'da qanday ishlashi: tashrif rejasini kim tuzadi, agent telefonda nima qiladi, buyurtma tarmoqsiz qanday yuboriladi va kechqurun agent aslida qayerda bo'lganini qanday tekshirish mumkin. Har bir qadam — dasturning haqiqiy ekranlarida.",
    ),
  ],
  sections: [
    {
      id: "plan",
      h2: both("План визитов: кого и когда объехать", "Tashrif rejasi: qaysi do'konga qachon borish"),
      blocks: [
        {
          p: both(
            "План составляет не агент, а супервайзер или директор — в разделе «План визитов». Агент сам себе визиты не добавляет: план, который исполнитель пишет себе сам, ничего не проверяет.",
            "Rejani agent emas, supervayzer yoki direktor «Tashrif rejasi» bo'limida tuzadi. Agent o'ziga tashrif qo'sha olmaydi: ijrochi o'zi uchun yozgan reja hech narsani tekshirmaydi.",
          ),
        },
        {
          steps: [
            both(
              "Откройте «План визитов» → вкладку «Месяц» и нажмите «Расставить визиты на месяц».",
              "«Tashrif rejasi» → «Oy» yorlig'ini oching va «Oyga tashriflarni joylashtirish» tugmasini bosing.",
            ),
            both(
              "Выберите сотрудника и что ставим: «По расписанию сотрудника» или магазины одной территории.",
              "Xodimni va nima qo'yishni tanlang: «Xodim jadvali bo'yicha» yoki bitta hududning do'konlari.",
            ),
            both(
              "Отметьте дни недели. Галочка «Не заполнять прошедшие дни» не даст задним числом наставить визиты, которых уже не будет.",
              "Hafta kunlarini belgilang. «O'tgan kunlarni to'ldirmaslik» belgisi endi bo'lmaydigan tashriflarni orqa sana bilan qo'yishga yo'l qo'ymaydi.",
            ),
            both(
              "Включите «Запомнить расписанием» — и следующий месяц расставляется одной кнопкой.",
              "«Jadval sifatida eslab qolish»ni yoqing — keyingi oy bitta tugma bilan joylashtiriladi.",
            ),
          ],
        },
        {
          p: both(
            "На вкладке «День» — визиты на выбранный день по каждому сотруднику и кнопка «Как прошёл день». О ней — ниже, в разделе про GPS.",
            "«Kun» yorlig'ida — tanlangan kun uchun har bir xodimning tashriflari va «Kun qanday o'tdi» tugmasi. U haqida pastda, GPS bo'limida.",
          ),
        },
      ],
    },
    {
      id: "phone",
      h2: both("Что агент видит в телефоне", "Agent telefonda nimani ko'radi"),
      blocks: [
        {
          p: both(
            "На вкладке «План» — «ПЛАН МЕСЯЦА» (выручка, заказы, визиты) и «ВИЗИТЫ НА СЕГОДНЯ»: магазин, адрес и долг, если он есть. У каждого визита две кнопки — «Готово» и «Отложить».",
            "«Reja» yorlig'ida — «OYLIK REJA» (tushum, buyurtmalar, tashriflar) va «BUGUNGI TASHRIFLAR»: do'kon, manzil va qarz, agar bo'lsa. Har bir tashrifda ikkita tugma bor — «Tayyor» va «Keyinga».",
          ),
        },
        {
          shot: {
            phone: "plan",
            alt: both(
              "Экран «План» в телефоне агента: визиты на сегодня с адресом и долгом магазина",
              "Agent telefonidagi «Reja» ekrani: manzil va do'kon qarzi bilan bugungi tashriflar",
            ),
            caption: both(
              "Вкладка «План» в телефоне агента: визиты на сегодня с адресом и долгом магазина, кнопки «Готово» и «Отложить».",
              "Agent telefonidagi «Reja» yorlig'i: manzil va do'kon qarzi bilan bugungi tashriflar, «Tayyor» va «Keyinga» tugmalari.",
            ),
          },
        },
        {
          p: both(
            "Если магазин ничего не взял, визит закрывается с причиной: «Закрыто», «Нет денег», «Есть остаток», «Берёт у конкурента», «Нет хозяина / ответственного» или «Другое». Причины собираются в отчёт «Без заказа» в «Отчётах» — видно, где агент работает плохо, а где магазин просто затоварен.",
            "Do'kon hech narsa olmasa, tashrif sabab bilan yopiladi: «Yopiq», «Pul yo'q», «Qoldiq bor», «Raqobatchidan oladi», «Egasi yoki mas'ul yo'q» yoki «Boshqa». Sabablar «Hisobotlar»dagi «Buyurtmasiz» hisobotiga yig'iladi — agent qayerda yomon ishlayotgani va qayerda do'konda shunchaki tovar ko'pligi ko'rinadi.",
          ),
        },
      ],
    },
    {
      id: "order",
      h2: both("Заказ с телефона: цены магазина и живой остаток", "Telefondan buyurtma: do'kon narxlari va jonli qoldiq"),
      blocks: [
        {
          steps: [
            both(
              "Агент выбирает магазин и открывает каталог. Цены — те, что назначены этому магазину, рядом с ценой — остаток на складе, и кнопка «+» дальше остатка не пускает.",
              "Agent do'konni tanlaydi va katalogni ochadi. Narxlar — aynan shu do'konga belgilanganlari, narx yonida — ombordagi qoldiq, «+» tugmasi esa qoldiqdan oshirishga yo'l qo'ymaydi.",
            ),
            both(
              "Указывает оплату — «Наличные», «Карта», «Перевод» или «Долг», — дату доставки, которую обещал магазину, и примечание.",
              "To'lov turini — naqd, karta, o'tkazma yoki qarzga — do'konga va'da qilingan yetkazish sanasini va izohni ko'rsatadi.",
            ),
            both(
              "Отправляет. Заказ сразу резервирует товар, и второй агент уже не продаст тот же последний ящик. Если товара не хватило, программа назовёт позицию и сколько осталось свободно.",
              "Yuboradi. Buyurtma tovarni darhol zahiraga oladi va ikkinchi agent o'sha oxirgi qutini endi sota olmaydi. Tovar yetmasa, dastur qaysi mahsulot ekanini va qanchasi bo'sh qolganini aytadi.",
            ),
          ],
        },
        {
          p: both(
            "У магазина может быть кредитный лимит. Тогда заказ «в долг» проверяется по нему: долг вместе с новым заказом не может быть больше лимита. Агент видит, на сколько он превышен, и что делать: принять оплату или попросить офис поднять лимит.",
            "Do'konda kredit limiti bo'lishi mumkin. Unda qarzga buyurtma shu limit bo'yicha tekshiriladi: qarz yangi buyurtma bilan birga limitdan oshmasligi kerak. Agent qanchaga oshganini va nima qilish kerakligini ko'radi: to'lovni olish yoki ofisdan limitni oshirishni so'rash.",
          ),
        },
        { see: "debts", text: both("Как считается долг магазина и как работает лимит", "Do'kon qarzi qanday hisoblanadi va limit qanday ishlaydi") },
        {
          p: both(
            "Себестоимость и наценку агент не видит: сервер их в телефон не отправляет.",
            "Agent tannarx va ustamani ko'rmaydi: server ularni telefonga yubormaydi.",
          ),
        },
      ],
    },
    {
      id: "offline",
      h2: both("Нет связи — работа не стоит", "Aloqa yo'q — ish to'xtamaydi"),
      blocks: [
        {
          list: [
            both(
              "Заказ без связи сохраняется в телефоне и уходит сам, когда сеть вернулась. Повторная отправка не создаёт второй заказ: у каждого своя метка.",
              "Aloqasiz buyurtma telefonda saqlanadi va tarmoq qaytganda o'zi yuboriladi. Qayta yuborish ikkinchi buyurtmani yaratmaydi: har birining o'z belgisi bor.",
            ),
            both(
              "Новый магазин тоже можно завести без связи.",
              "Yangi do'konni ham aloqasiz qo'shish mumkin.",
            ),
            both(
              "Каталог хранится в телефоне. Когда сети нет, агент видит предупреждение, что остатки и цены могли измениться, и знает, что обещает по вчерашним данным.",
              "Katalog telefonda saqlanadi. Tarmoq bo'lmaganda agent qoldiq va narxlar o'zgargan bo'lishi mumkinligi haqida ogohlantirishni ko'radi va kechagi ma'lumot bo'yicha va'da berayotganini biladi.",
            ),
            both(
              "Отметка визита без связи тоже не теряется: «Нет связи — отметка сохранена и уйдёт сама».",
              "Tashrif belgisi ham aloqasiz yo'qolmaydi: «Aloqa yo'q — belgi saqlandi, o'zi yuboriladi».",
            ),
          ],
        },
        {
          p: both(
            "Приложение — для Android. На iPhone агент работает в веб-версии, пока приложение проходит проверку App Store.",
            "Ilova — Android uchun. iPhone'da agent ilova App Store tekshiruvidan o'tguncha veb-versiyada ishlaydi.",
          ),
        },
      ],
    },
    {
      id: "gps",
      h2: both("GPS: где агент был на самом деле", "GPS: agent aslida qayerda bo'lgan"),
      blocks: [
        {
          p: both(
            "В телефоне агента есть экран «Геолокация» с переключателем «Авто-слежение». Пока он включён, телефон отправляет точку при перемещении, но не чаще раза в две минуты; ещё одна точка уходит в момент отметки визита. Без связи точки копятся в телефоне со временем снятия и уходят потом — день не теряется из-за подвала или трассы.",
            "Agent telefonida «Avto-kuzatuv» tugmasi bor «Geolokatsiya» ekrani mavjud. U yoqilgan paytda telefon harakatlanganda nuqta yuboradi, lekin ikki daqiqada bir martadan ko'p emas; yana bitta nuqta tashrif belgilangan paytda yuboriladi. Aloqa bo'lmasa, nuqtalar olingan vaqti bilan telefonda yig'iladi va keyin yuboriladi — yerto'la yoki trassa tufayli kun yo'qolmaydi.",
          ),
        },
        {
          p: both(
            "Супервайзер и директор видят «Карту»: где сейчас каждый сотрудник (положение обновляется раз в 30 секунд) и его путь за день с километражем.",
            "Supervayzer va direktor «Xarita»ni ko'radi: har bir xodim hozir qayerda (joylashuv har 30 soniyada yangilanadi) va uning kunlik yo'li kilometrlari bilan.",
          ),
        },
        {
          p: both(
            "Вечером — кнопка «Как прошёл день» в «Плане визитов». Она собирает день одного сотрудника:",
            "Kechqurun — «Tashrif rejasi»dagi «Kun qanday o'tdi» tugmasi. U bitta xodimning kunini yig'ib beradi:",
          ),
        },
        {
          list: [
            both(
              "первая и последняя точка, пройденные километры, сколько минут — в магазинах и сколько — в дороге;",
              "birinchi va oxirgi nuqta, bosib o'tilgan kilometrlar, necha daqiqa do'konlarda va necha daqiqa yo'lda o'tgani;",
            ),
            both(
              "по каждому визиту — когда пришёл и ушёл (по точкам в радиусе 500 метров от магазина), сколько пробыл и что отметил;",
              "har bir tashrif bo'yicha — qachon kelgani va ketgani (do'kondan 500 metr radiusdagi nuqtalar bo'yicha), qancha turgani va nima belgilagani;",
            ),
            both(
              "флажки: визит отмечен, а рядом с магазином телефона не было; пробыл меньше пяти минут; за день ни одной точки; подменённое местоположение; у магазина нет координат.",
              "belgilar: tashrif belgilangan, lekin telefon do'kon yonida bo'lmagan; besh daqiqadan kam turgan; kun davomida bitta ham nuqta yo'q; soxta joylashuv; do'konning koordinatalari yo'q.",
            ),
          ],
        },
        {
          p: both(
            "Километраж считается по очищенным точкам: неточные (погрешность больше 200 метров) и прыжки быстрее 150 км/ч отбрасываются, иначе один сбой GPS прибавил бы к дню десятки километров.",
            "Kilometrlar tozalangan nuqtalar bo'yicha hisoblanadi: noaniq nuqtalar (xatoligi 200 metrdan katta) va soatiga 150 km dan tez sakrashlar tashlab yuboriladi, aks holda bitta GPS nosozligi kunga o'nlab kilometr qo'shib yuborardi.",
          ),
        },
        {
          note: {
            title: both("Слежение не тайное", "Kuzatuv yashirin emas"),
            text: both(
              "Переключатель «Авто-слежение» агент видит у себя в телефоне. Что собирается и кто это видит, описано в политике конфиденциальности.",
              "«Avto-kuzatuv» tugmasini agent o'z telefonida ko'radi. Nima yig'ilishi va buni kim ko'rishi maxfiylik siyosatida yozilgan.",
            ),
          },
        },
      ],
    },
  ],
  faq: [
    {
      q: both("Может ли агент сам добавить себе визит?", "Agent o'ziga tashrifni o'zi qo'sha oladimi?"),
      a: both(
        "Нет. План ставят супервайзер или директор в «Плане визитов». Агент отмечает визиты кнопками «Готово» и «Отложить», а визит без заказа закрывает с причиной.",
        "Yo'q. Rejani supervayzer yoki direktor «Tashrif rejasi»da qo'yadi. Agent tashriflarni «Tayyor» va «Keyinga» tugmalari bilan belgilaydi, buyurtmasiz tashrifni esa sabab bilan yopadi.",
      ),
    },
    {
      q: both("Что будет с заказом, если пропала связь?", "Aloqa uzilsa, buyurtma nima bo'ladi?"),
      a: both(
        "Заказ сохранится в телефоне и уйдёт сам, когда сеть вернётся. Если отправка повторится, второго заказа не будет.",
        "Buyurtma telefonda saqlanadi va tarmoq qaytganda o'zi yuboriladi. Yuborish takrorlansa ham, ikkinchi buyurtma paydo bo'lmaydi.",
      ),
    },
    {
      q: both("Видит ли агент себестоимость и наценку?", "Agent tannarx va ustamani ko'radimi?"),
      a: both(
        "Нет. Агент видит цены своего магазина и остаток на складе; себестоимость и наценка в его телефон не отправляются.",
        "Yo'q. Agent o'z do'konining narxlarini va ombordagi qoldiqni ko'radi; tannarx va ustama uning telefoniga yuborilmaydi.",
      ),
    },
    {
      q: both("Работает ли приложение на iPhone?", "Ilova iPhone'da ishlaydimi?"),
      a: both(
        "Приложение сейчас для Android. На iPhone агент работает в веб-версии, пока приложение проходит проверку App Store.",
        "Ilova hozircha Android uchun. iPhone'da agent ilova App Store tekshiruvidan o'tguncha veb-versiyada ishlaydi.",
      ),
    },
    {
      q: both("Как часто приходят точки GPS?", "GPS nuqtalari qanchalik tez-tez keladi?"),
      a: both(
        "Пока включено «Авто-слежение» — при перемещении, но не чаще раза в две минуты, и ещё одна точка при отметке визита. «Карта» у супервайзера обновляется раз в 30 секунд.",
        "«Avto-kuzatuv» yoqilganda — harakatlanganda, lekin ikki daqiqada bir martadan ko'p emas, va yana bittasi tashrif belgilanganda. Supervayzerdagi «Xarita» har 30 soniyada yangilanadi.",
      ),
    },
  ],
};
