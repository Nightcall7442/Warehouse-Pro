import { both, type ArticleText } from "../types";

/*
  Статья о складе дистрибьютора. Сверено с кодом (октябрь 2026): раздел
  «Склад» (src/pages/Warehouse.tsx: вкладки, колонки «Доступно», «Резерв»,
  «Всего», «Порог»), резерв и отказ с названием товара —
  api/services/order-create.ts, партии и FEFO — приход и отгрузка через
  stock-ledger, «Сроки» — ExpiringBatches, дозаказ и уведомление раз на
  пересечение порога — крон каждые 30 минут, инвентаризация и перемещения —
  stock-count-router и warehouse-multi-router.

  После слияния веток склада и закупок сверено ещё раз: точки продаж (ADR
  0012, склад заказа), «Дозаказ» по выбранному складу с черновиками заказов
  поставщикам (ADR 0014, ReorderPlan), утверждение инвентаризации директором
  (право warehouse.apply), перемещение в два шага («в пути», настройка
  transferTwoStep) и действие «Переместить туда, где продают» в «Сроках».

  Формулу предлагаемого количества не называем намеренно: её меняет
  соседняя работа по дозаказу, а статья не должна устареть вместе с ней.
  Адресного хранения, ТСД и маркировки в программе нет — так и сказано.
*/
export const WAREHOUSE_ARTICLE: ArticleText = {
  key: "warehouse",
  h1: both(
    "Склад дистрибьютора без сложной WMS: остатки, резерв, сроки годности и дозаказ",
    "Murakkab WMS tizimisiz distribyutor ombori: qoldiq, zahira, yaroqlilik muddati va qayta buyurtma",
  ),
  lead: [
    both(
      "Агент продал последние двадцать ящиков, которые уже обещаны другому магазину. Йогурт с коротким сроком стоит в глубине склада, а уезжает свежий. О том, что вода закончилась, узнают, когда её заказывают, а инвентаризация раз в квартал показывает минус, который никто не может объяснить.",
      "Agent boshqa do'konga allaqachon va'da qilingan oxirgi yigirma qutini sotib yubordi. Muddati qisqa yogurt omborning ichkarisida turibdi, yangisi esa jo'nab ketyapti. Suv tugaganini uni buyurtma qilishganda bilishadi, chorakda bir marta o'tkaziladigan inventarizatsiya esa hech kim tushuntira olmaydigan kamomadni ko'rsatadi.",
    ),
    both(
      "Чтобы это прекратить, не обязательно ставить большую складскую систему с адресами ячеек и терминалами. Ниже — что умеет склад в Warehouse Pro и чего он честно не умеет.",
      "Buni to'xtatish uchun yacheyka manzillari va terminallari bor katta ombor tizimini o'rnatish shart emas. Quyida Warehouse Pro'dagi ombor nimalarni qila olishi va nimalarni qila olmasligi ochiq aytilgan.",
    ),
  ],
  sections: [
    {
      id: "stock",
      h2: both("Остаток и резерв", "Qoldiq va zahira"),
      blocks: [
        {
          p: both(
            "Раздел «Склад» — для директора и оператора. На вкладке «Остатки» у каждого товара четыре числа: «Доступно» — сколько можно продать прямо сейчас, «Резерв» — сколько держат принятые заказы, «Всего» — сколько лежит физически, и «Порог» — ниже какого остатка пора заказывать.",
            "«Ombor» bo'limi — direktor va operator uchun. «Qoldiqlar» yorlig'ida har bir mahsulotda to'rtta son bor: «Mavjud» — hozir qancha sotish mumkin, «Zahira» — qabul qilingan buyurtmalar qanchasini band qilgan, «Jami» — jismonan qancha turibdi va «Chegara» — qoldiq qanchadan tushsa, buyurtma qilish vaqti keladi.",
          ),
        },
        {
          p: both(
            "Над таблицей — четыре плитки: сколько позиций на складе, во что обходятся остатки по себестоимости, сколько товаров ниже порога и сколько лежит без продаж. Плитка ведёт в свой список: «ниже порога» — в дозаказ, «без продаж» — на вкладку «Мёртвый сток», где видно, какие деньги заморожены на полке.",
            "Jadval ustida — to'rtta plitka: omborda nechta pozitsiya bor, qoldiqlar tannarx bo'yicha qanchaga tushadi, nechta mahsulot chegaradan past va nechtasi sotuvsiz yotibdi. Plitka o'z ro'yxatiga olib boradi: «chegaradan past» — qayta buyurtmaga, «sotuvsiz» — «O'lik stok» yorlig'iga, u yerda javonda qaysi pul muzlab qolgani ko'rinadi.",
          ),
        },
        {
          shot: {
            web: "warehouse",
            alt: both(
              "Раздел «Склад» в веб-версии: таблица остатков с колонками «Доступно», «Резерв», «Всего» и «Порог»",
              "Veb-versiyadagi «Ombor» bo'limi: «Mavjud», «Zahira», «Jami» va «Chegara» ustunlari bilan qoldiqlar jadvali",
            ),
            caption: both(
              "Раздел «Склад»: доступно, резерв, всего и порог по каждому товару; товары ниже порога отмечены.",
              "«Ombor» bo'limi: har bir mahsulot bo'yicha mavjud, zahira, jami va chegara; chegaradan past mahsulotlar belgilangan.",
            ),
          },
        },
        {
          p: both(
            "Заказ агента сразу резервирует товар. Второй агент видит уже уменьшенное «Доступно» и не может продать то же самое; если товара не хватает, программа называет позицию и сколько осталось свободно. Заказы резервируются и отгружаются с основного склада. Если у компании есть филиал, директор может отметить его склад точкой продаж и закрепить за ним агентов: их заказы резервируются на складе филиала, и агент видит его остаток.",
            "Agent buyurtmasi tovarni darhol zahiraga oladi. Ikkinchi agent kamaygan «Mavjud»ni ko'radi va xuddi shu tovarni sota olmaydi; tovar yetmasa, dastur qaysi mahsulot ekanini va qanchasi bo'sh qolganini aytadi. Buyurtmalar asosiy ombordan zahiraga olinadi va jo'natiladi. Kompaniyaning filiali bo'lsa, direktor uning omborini savdo nuqtasi deb belgilab, unga agentlarni biriktirishi mumkin: ularning buyurtmalari filial omborida zahiraga olinadi va agent o'sha ombor qoldig'ini ko'radi.",
          ),
        },
        {
          p: both(
            "Остаток меняется только движениями — приходом, доставкой, возвратом, списанием, инвентаризацией, перемещением или ручной корректировкой, — и каждое движение записывается в журнал. На вопрос «куда делись десять ящиков» есть ответ.",
            "Qoldiq faqat harakatlar orqali o'zgaradi — kirim, yetkazish, qaytarish, hisobdan chiqarish, inventarizatsiya, ko'chirish yoki qo'lda tuzatish — va har bir harakat jurnalga yoziladi. «O'nta quti qayerga ketdi» degan savolga javob bor.",
          ),
        },
      ],
    },
    {
      id: "fefo",
      h2: both("Партии, сроки годности и FEFO", "Partiyalar, yaroqlilik muddati va FEFO"),
      blocks: [
        {
          steps: [
            both(
              "В «Приходах» у каждой строки — номер партии и срок годности. Срок раньше даты прихода программа не примет: это почти всегда опечатка.",
              "«Kirim»da har bir qatorda — partiya raqami va yaroqlilik muddati. Kirim sanasidan oldingi muddatni dastur qabul qilmaydi: bu deyarli har doim xato yozuv.",
            ),
            both(
              "При отгрузке партии списываются по FEFO: первой уходит та, у которой срок истекает раньше. Просроченная партия не отгружается вовсе, партии без срока идут последними. Списание тоже начинается с просроченных.",
              "Jo'natishda partiyalar FEFO bo'yicha chiqariladi: birinchi bo'lib muddati oldinroq tugaydigani ketadi. Muddati o'tgan partiya umuman jo'natilmaydi, muddatsiz partiyalar oxirida ketadi. Hisobdan chiqarish ham muddati o'tganlardan boshlanadi.",
            ),
            both(
              "Если годного товара не хватает, заказ не пройдёт, и агент увидит, сколько товара на складе, сколько из него просрочено и сколько годно.",
              "Yaroqli tovar yetmasa, buyurtma o'tmaydi va agent omborda qancha tovar borligini, undan qanchasi muddati o'tganini va qanchasi yaroqli ekanini ko'radi.",
            ),
          ],
        },
        {
          p: both(
            "Вкладка «Сроки» — список дел: партии, с которыми пора что-то делать. По каждой — прогноз, сколько успеет продаться до срока, и действия: уценить, перевезти на склад, с которого продают, или списать.",
            "«Muddatlar» yorlig'i — vazifalar ro'yxati: biror narsa qilish kerak bo'lgan partiyalar. Har biri bo'yicha — muddatgacha qanchasi sotilib ulgurishi haqida prognoz va amallar: narxini tushirish, sotiladigan omborga ko'chirish yoki hisobdan chiqarish.",
          ),
        },
        { see: "delivery", text: both("Как собирается погрузочный лист и закрывается доставка", "Yuklash varag'i qanday yig'iladi va yetkazish qanday yopiladi") },
      ],
    },
    {
      id: "reorder",
      h2: both("Дозаказ: что и сколько заказать", "Qayta buyurtma: nimani va qancha buyurtma qilish"),
      blocks: [
        {
          p: both(
            "Вкладка «Дозаказ» собирает товары, у которых доступный остаток на выбранном складе — по умолчанию на основном — опустился до порога или ниже. По каждому — средние продажи в день, на сколько дней хватит остатка, сколько уже едет и сколько предлагается заказать. Строки собраны по поставщикам: одной кнопкой из них получаются черновики заказов поставщикам, а согласует их директор. Список можно и выгрузить в Excel.",
            "«Qayta buyurtma» yorlig'i tanlangan ombordagi — odatda asosiy ombordagi — mavjud qoldig'i chegaragacha yoki undan pastga tushgan mahsulotlarni yig'adi. Har biri bo'yicha — kunlik o'rtacha sotuv, qoldiq necha kunga yetishi, qanchasi allaqachon yo'lda va qancha buyurtma qilish taklif etilgani. Qatorlar yetkazib beruvchilar bo'yicha guruhlangan: bitta tugma bilan ulardan yetkazib beruvchilarga buyurtma qoralamalari tuziladi, ularni esa direktor kelishadi. Ro'yxatni Excelga ham yuklash mumkin.",
          ),
        },
        {
          p: both(
            "Порог задаётся в карточке товара. Если его не указали, берётся общий из настроек — «Точка заказа для новых товаров», а если пусто и там — 10.",
            "Chegara mahsulot kartasida belgilanadi. Ko'rsatilmagan bo'lsa, sozlamalardagi umumiy qiymat olinadi — «Yangi tovarlar uchun buyurtma nuqtasi», u yerda ham bo'sh bo'lsa — 10.",
          ),
        },
        {
          p: both(
            "Программа проверяет остатки каждые полчаса. Когда товар опускается до порога, директор и оператор получают одно уведомление — в программе и в Telegram, если он подключён. О том же товаре оно не повторяется, пока остаток не поднимется выше порога и не опустится снова.",
            "Dastur qoldiqlarni har yarim soatda tekshiradi. Mahsulot chegaragacha tushganda direktor va operator bitta bildirishnoma oladi — dasturda va, Telegram ulangan bo'lsa, Telegramda. Qoldiq chegaradan yuqoriga ko'tarilib, yana tushmaguncha o'sha mahsulot haqida u takrorlanmaydi.",
          ),
        },
      ],
    },
    {
      id: "count",
      h2: both("Инвентаризация", "Inventarizatsiya"),
      blocks: [
        {
          steps: [
            both(
              "На вкладке «Инвентаризация» создаётся документ: программа запоминает, сколько каждого товара должно быть на складе в этот момент.",
              "«Inventarizatsiya» yorlig'ida hujjat yaratiladi: dastur shu paytda omborda har bir mahsulotdan qancha bo'lishi kerakligini eslab qoladi.",
            ),
            both(
              "Кладовщик вносит построчно, сколько насчитал.",
              "Omborchi qancha sanaganini qatorma-qator kiritadi.",
            ),
            both(
              "Документ проводится одним действием: разницы становятся движениями «инвентаризация» в журнале, и остатки выравниваются по факту. Если директор не дал оператору права проводить правки самому, документ уходит директору «на утверждение», и остатки меняются, когда он нажмёт «Утвердить».",
              "Hujjat bitta amal bilan o'tkaziladi: farqlar jurnalda «inventarizatsiya» harakatlariga aylanadi va qoldiqlar haqiqiy holatga tenglashtiriladi. Agar direktor operatorga tuzatishlarni o'zi o'tkazish huquqini bermagan bo'lsa, hujjat direktorga «tasdiqlashga» yuboriladi va qoldiqlar u «Tasdiqlash»ni bosganda o'zgaradi.",
            ),
            both(
              "Проведённый документ больше не меняется — его можно только смотреть.",
              "O'tkazilgan hujjat endi o'zgarmaydi — uni faqat ko'rish mumkin.",
            ),
          ],
        },
        {
          p: both(
            "Вкладка видна тем, у кого есть право корректировать склад.",
            "Bu yorliq omborni tuzatish huquqi borlarga ko'rinadi.",
          ),
        },
      ],
    },
    {
      id: "transfer",
      h2: both("Несколько складов и перемещения", "Bir nechta ombor va ko'chirishlar"),
      blocks: [
        {
          p: both(
            "Если складов больше одного, появляются вкладки «Перемещения» и «Сравнение». Перемещение — один документ на несколько товаров: программа проверяет, что на складе-источнике хватает свободного годного остатка, и товар едет своими партиями со сроками. По умолчанию он сразу числится на складе-получателе. В настройках можно включить перемещение в два шага: тогда товар «в пути», пока получатель не примет его по строкам, а недоехавшее остаётся недостачей на документе. Делают это директор или оператор с правом корректировать склад.",
            "Omborlar bittadan ko'p bo'lsa, «Ko'chirishlar» va «Taqqoslash» yorliqlari paydo bo'ladi. Ko'chirish — bir nechta mahsulot uchun bitta hujjat: dastur manba omborda bo'sh yaroqli qoldiq yetarliligini tekshiradi va tovar o'z partiyalari va muddatlari bilan ketadi. Odatda u darhol qabul qiluvchi omborda hisoblanadi. Sozlamalarda ikki bosqichli ko'chirishni yoqish mumkin: unda qabul qiluvchi qatorlar bo'yicha qabul qilmaguncha tovar «yo'lda» bo'ladi, yetib kelmagani esa hujjatda kamomad bo'lib qoladi. Buni direktor yoki omborni tuzatish huquqi bor operator bajaradi.",
          ),
        },
        {
          note: {
            title: both("Чего здесь нет", "Bu yerda nima yo'q"),
            text: both(
              "В Warehouse Pro нет адресного хранения по ячейкам, работы с терминалами сбора данных (ТСД), маркировки товара и приёмки по предварительным уведомлениям поставщика. Если склад живёт по ячейкам и сканерам, ему нужна отдельная WMS. Если нужно знать, сколько товара, под какие заказы он занят, что истекает и что заказать, — этого хватает.",
              "Warehouse Pro'da yacheykalar bo'yicha manzilli saqlash, ma'lumot yig'ish terminallari bilan ishlash, tovarlarni markirovkalash va yetkazib beruvchining oldindan xabarnomalari bo'yicha qabul qilish yo'q. Agar ombor yacheykalar va skanerlar bilan ishlasa, unga alohida WMS kerak. Agar qancha tovar borligi, qaysi buyurtmalarga band qilingani, nimaning muddati tugayotgani va nimani buyurtma qilish kerakligini bilish kerak bo'lsa — bu yetarli.",
            ),
          },
        },
      ],
    },
  ],
  faq: [
    {
      q: both("Нужно ли покупать оборудование для склада?", "Ombor uchun uskuna sotib olish kerakmi?"),
      a: both(
        "Нет. Склад ведётся в веб-версии программы. Адресного хранения по ячейкам и работы с терминалами сбора данных в программе нет.",
        "Yo'q. Ombor dasturning veb-versiyasida yuritiladi. Dasturda yacheykalar bo'yicha manzilli saqlash va ma'lumot yig'ish terminallari bilan ishlash yo'q.",
      ),
    },
    {
      q: both("Как программа выбирает, какую партию отгрузить?", "Dastur qaysi partiyani jo'natishni qanday tanlaydi?"),
      a: both(
        "По FEFO: первой уходит партия с самым ранним сроком годности. Просроченные партии не отгружаются, партии без срока идут последними.",
        "FEFO bo'yicha: birinchi bo'lib yaroqlilik muddati eng erta tugaydigan partiya ketadi. Muddati o'tgan partiyalar jo'natilmaydi, muddatsiz partiyalar oxirida ketadi.",
      ),
    },
    {
      q: both("Можно ли вести несколько складов?", "Bir nechta omborni yuritish mumkinmi?"),
      a: both(
        "Да. Остатки видны по каждому складу, между складами есть перемещения и сравнение. Заказы резервируются и отгружаются с основного склада, а со склада, который директор отметил точкой продаж, — заказы закреплённых за ним агентов.",
        "Ha. Qoldiqlar har bir ombor bo'yicha ko'rinadi, omborlar orasida ko'chirish va taqqoslash bor. Buyurtmalar asosiy ombordan zahiraga olinadi va jo'natiladi, direktor savdo nuqtasi deb belgilagan ombordan esa — unga biriktirilgan agentlarning buyurtmalari.",
      ),
    },
    {
      q: both("Как часто проверяется порог дозаказа?", "Qayta buyurtma chegarasi qanchalik tez-tez tekshiriladi?"),
      a: both(
        "Каждые 30 минут. О товаре, опустившемся до порога, директор и оператор получают одно уведомление — в программе и в Telegram, если он подключён.",
        "Har 30 daqiqada. Chegaragacha tushgan mahsulot haqida direktor va operator bitta bildirishnoma oladi — dasturda va, Telegram ulangan bo'lsa, Telegramda.",
      ),
    },
    {
      q: both("Можно ли исправить проведённую инвентаризацию?", "O'tkazilgan inventarizatsiyani tuzatish mumkinmi?"),
      a: both(
        "Нет: проведённый документ не меняется. Если ошиблись, создайте новую инвентаризацию — она начнётся с текущих остатков.",
        "Yo'q: o'tkazilgan hujjat o'zgarmaydi. Xato qilingan bo'lsa, yangi inventarizatsiya yarating — u joriy qoldiqlardan boshlanadi.",
      ),
    },
  ],
};
