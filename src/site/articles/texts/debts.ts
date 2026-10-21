import { both, type ArticleText } from "../types";

/*
  Статья о долгах магазинов. Сверено с кодом (октябрь 2026): правило долга —
  api/services/shop-debt.ts (recalcShopDebt, overdueDebtByShop), лимит —
  api/services/order-create.ts (только заказ «в долг», под замком строки
  магазина), стоп отгрузки — api/services/overdue-hold.ts и «Настройки →
  Компания → Просроченный долг», светофор — contracts/shop-light.ts,
  напоминания — api/cron/debt-reminders.ts, ручные оплаты — ShopDetail
  («Добавить платёж», право payments.accept: директор и оператор).

  Колонка «долг» в загрузке магазинов из Excel здесь не упоминается: она
  пишет shops.debt мимо документов, и следующий пересчёт её стирает.
  Переносить старые долги — ручным «Начислением».
*/
export const DEBTS_ARTICLE: ArticleText = {
  key: "debts",
  h1: both(
    "Учёт долгов магазинов: откуда берётся долг, кредитный лимит и стоп отгрузки",
    "Do'kon qarzlari hisobi: qarz qayerdan paydo bo'ladi, kredit limiti va yuklashni to'xtatish",
  ),
  lead: [
    both(
      "Долги магазинов живут в тетради агента и в голове бухгалтера, и цифры не сходятся. Магазин говорит «я же отдал курьеру», курьер не помнит, а товар тем временем снова уехал в долг тому, кто не платит второй месяц. О том, что срок оплаты прошёл, узнают, когда магазин уже закрылся.",
      "Do'konlar qarzi agent daftarida va buxgalter xotirasida yuradi, raqamlar esa bir-biriga to'g'ri kelmaydi. Do'kon «kuryerga berganman-ku» deydi, kuryer eslay olmaydi, tovar esa bu orada ikkinchi oy to'lamayotgan do'konga yana qarzga ketib qoladi. To'lov muddati o'tganini do'kon yopilib bo'lgandan keyin bilishadi.",
    ),
    both(
      "В Warehouse Pro долг магазина не вводится руками — он считается из документов. Ниже — из чего он складывается, как ограничить отгрузку должникам и кто о чём узнаёт.",
      "Warehouse Pro'da do'kon qarzi qo'lda kiritilmaydi — u hujjatlardan hisoblanadi. Quyida u nimalardan yig'ilishi, qarzdorlarga yuklashni qanday cheklash va kim nimadan xabar topishi haqida.",
    ),
  ],
  sections: [
    {
      id: "sum",
      h2: both("Из чего складывается долг", "Qarz nimalardan yig'iladi"),
      blocks: [
        {
          p: both(
            "Программа пересчитывает долг магазина сама после каждого движения денег и товара:",
            "Dastur do'kon qarzini pul va tovarning har bir harakatidan keyin o'zi qayta hisoblaydi:",
          ),
        },
        {
          list: [
            both(
              "заказ «в долг» должен с момента оформления; остальные заказы — после доставки, за вычетом оплат по этому заказу;",
              "qarzga buyurtma rasmiylashtirilgan paytdan qarzdor bo'ladi; qolgan buyurtmalar — yetkazilgandan keyin, shu buyurtma bo'yicha to'lovlar ayirilgan holda;",
            ),
            both(
              "отменённый или возвращённый заказ не должен ничего, но деньги, уже внесённые по нему, остаются в расчётах с магазином;",
              "bekor qilingan yoki qaytarilgan buyurtma hech narsa qarzdor emas, lekin u bo'yicha to'langan pul do'kon bilan hisob-kitobda qoladi;",
            ),
            both(
              "оплата без заказа уменьшает долг, а ручное «Начисление» увеличивает;",
              "buyurtmasiz to'lov qarzni kamaytiradi, qo'lda kiritilgan «Hisoblash» esa oshiradi;",
            ),
            both(
              "проведённый возврат уменьшает долг;",
              "o'tkazilgan qaytarish qarzni kamaytiradi;",
            ),
            both(
              "долг не уходит ниже нуля: переплата видна в акте сверки отдельной строкой.",
              "qarz noldan pastga tushmaydi: ortiqcha to'lov solishtirma dalolatnomada alohida qatorda ko'rinadi.",
            ),
          ],
        },
        {
          p: both(
            "Ручные оплаты и начисления вносят директор и оператор в карточке магазина: «Добавить платёж» → «Оплата — уменьшает долг» или «Начисление — увеличивает». Так же переносятся долги, которые были до программы: одно начисление на сумму старого долга.",
            "Qo'lda to'lov va hisoblashlarni direktor va operator do'kon kartasida kiritadi: «To'lov qo'shish» → «To'lov — qarzni kamaytiradi» yoki «Hisoblash — oshiradi». Dasturdan oldingi qarzlar ham shunday o'tkaziladi: eski qarz summasiga bitta hisoblash.",
          ),
        },
      ],
    },
    {
      id: "agent",
      h2: both("Что видит агент", "Agent nimani ko'radi"),
      blocks: [
        {
          p: both(
            "В телефоне агента — «Мои долги»: неоплаченные заказы его магазинов, от самого старого, с датой, числом дней и телефоном магазина — позвонить можно прямо из списка. Долг агент не меняет: список только для чтения.",
            "Agent telefonida — «Mening qarzlarim»: uning do'konlaridagi to'lanmagan buyurtmalar, eng eskisidan boshlab, sana, kunlar soni va do'kon telefoni bilan — ro'yxatdan to'g'ridan-to'g'ri qo'ng'iroq qilish mumkin. Agent qarzni o'zgartirmaydi: ro'yxat faqat o'qish uchun.",
          ),
        },
        {
          shot: {
            phone: "debts",
            alt: both(
              "Экран «Мои долги» в телефоне агента: неоплаченные заказы с суммой, датой и телефоном магазина",
              "Agent telefonidagi «Mening qarzlarim» ekrani: summa, sana va do'kon telefoni bilan to'lanmagan buyurtmalar",
            ),
            caption: both(
              "«Мои долги»: каждый неоплаченный заказ с датой, возрастом долга в днях и телефоном магазина.",
              "«Mening qarzlarim»: har bir to'lanmagan buyurtma sanasi, qarzning kunlardagi yoshi va do'kon telefoni bilan.",
            ),
          },
        },
        {
          p: both(
            "Долг стоит и рядом с магазином в визитах на сегодня — агент знает о нём до того, как зайдёт.",
            "Qarz bugungi tashriflarda ham do'kon yonida turadi — agent u haqida do'konga kirishdan oldin biladi.",
          ),
        },
      ],
    },
    {
      id: "limit",
      h2: both("Кредитный лимит: сколько можно дать в долг", "Kredit limiti: qancha qarzga berish mumkin"),
      blocks: [
        {
          p: both(
            "В карточке магазина есть поле «Кредитный лимит (пусто — без лимита)». Пусто — без ограничений; ноль — в долг нельзя совсем.",
            "Do'kon kartasida «Kredit limiti (bo'sh — limitsiz)» maydoni bor. Bo'sh — cheklovsiz; nol — qarzga umuman berilmaydi.",
          ),
        },
        {
          p: both(
            "Когда заказ оформляется «в долг», программа складывает текущий долг и сумму заказа. Если выходит больше лимита, заказ не создаётся, а человек видит, сколько долг, сколько заказ и что делать: принять оплату или попросить офис поднять лимит. Проверка идёт под блокировкой — два заказа, оформленные одновременно, не проскочат лимит вдвоём.",
            "Buyurtma qarzga rasmiylashtirilganda dastur joriy qarz bilan buyurtma summasini qo'shadi. Natija limitdan oshsa, buyurtma yaratilmaydi, odam esa qarz qancha, buyurtma qancha va nima qilish kerakligini ko'radi: to'lovni olish yoki ofisdan limitni oshirishni so'rash. Tekshiruv qulf ostida o'tadi — bir vaqtda rasmiylashtirilgan ikkita buyurtma limitdan birgalikda o'tib keta olmaydi.",
          ),
        },
      ],
    },
    {
      id: "overdue",
      h2: both("Стоп отгрузки при просроченном долге", "Muddati o'tgan qarzda yuklashni to'xtatish"),
      blocks: [
        {
          p: both(
            "Лимит — про сумму, а не про время: магазин может быть в пределах лимита и при этом не платить третий месяц. Для этого есть отдельное правило.",
            "Limit — summa haqida, vaqt haqida emas: do'kon limit doirasida bo'lib, uchinchi oy to'lamasligi mumkin. Buning uchun alohida qoida bor.",
          ),
        },
        {
          steps: [
            both(
              "В «Настройках» → «Компания» → «Просроченный долг» включите «Заказ магазину с просроченным долгом ждёт решения офиса».",
              "«Sozlamalar» → «Kompaniya» → «Muddati o'tgan qarz» bo'limida «Muddati o'tgan qarzi bor do'kon buyurtmasi ofis qarorini kutadi»ni yoqing.",
            ),
            both(
              "Задайте «Отсрочку оплаты по умолчанию» в днях — изначально 14. Она считается от доставки, если срок оплаты не назначен явно. Магазину с особыми условиями отсрочку можно задать в его карточке.",
              "«Standart to'lov muddati»ni kunlarda belgilang — boshida 14. Agar to'lov muddati aniq belgilanmagan bo'lsa, u yetkazilgan kundan hisoblanadi. Alohida shartli do'kon uchun muddatni uning kartasida belgilash mumkin.",
            ),
            both(
              "Теперь заказ агента такому магазину не отказывается, а встаёт в статус «Ожидает» с причиной: сколько просрочено и сколько дней самому старому долгу. Отгружать или нет — решает офис.",
              "Endi agentning bunday do'konga buyurtmasi rad etilmaydi, balki sababi bilan «Kutishda» holatiga o'tadi: qancha muddati o'tgan va eng eski qarz necha kunlik. Yuklash yoki yo'qligini ofis hal qiladi.",
            ),
          ],
        },
        {
          p: both(
            "Агент видит просрочку ещё на шаге выбора магазина — у прилавка, а не после отправки, — и может сначала забрать деньги. Заказы директора и оператора не ждут: они решают сами.",
            "Agent muddati o'tgan qarzni do'konni tanlash bosqichidayoq ko'radi — yuborgandan keyin emas, peshtaxta oldida — va avval pulni olishi mumkin. Direktor va operator buyurtmalari kutmaydi: ular o'zlari hal qiladi.",
          ),
        },
      ],
    },
    {
      id: "light",
      h2: both("Светофор магазина", "Do'kon svetofori"),
      blocks: [
        {
          p: both(
            "Чтобы не открывать три отчёта перед каждой отгрузкой, у магазина горит один цвет — в списке и карточке магазина в веб-версии и в списке магазинов в телефоне агента:",
            "Har bir yuklashdan oldin uchta hisobotni ochmaslik uchun do'konda bitta rang yonadi — veb-versiyadagi do'konlar ro'yxati va kartasida hamda agent telefonidagi do'konlar ro'yxatida:",
          ),
        },
        {
          list: [
            both(
              "красный, «Грузить рискованно», — есть просроченный долг или долг больше лимита;",
              "qizil, «Yuklash xavfli», — muddati o'tgan qarz bor yoki qarz limitdan katta;",
            ),
            both(
              "жёлтый, «Обратите внимание», — долг выше 70% лимита или магазин не заказывает дольше двух своих обычных перерывов;",
              "sariq, «E'tibor bering», — qarz limitning 70% idan yuqori yoki do'kon o'zining odatiy ikki tanaffusidan uzoqroq buyurtma bermayapti;",
            ),
            both(
              "зелёный, «Всё в порядке», — ни того ни другого.",
              "yashil, «Hammasi joyida», — na unisi, na bunisi.",
            ),
          ],
        },
        {
          p: both(
            "Рядом с цветом — причина словами: сколько просрочено и сколько дней самому старому долгу, на сколько процентов выбран лимит или сколько дней магазин не заказывает. С этим уже можно идти к магазину.",
            "Rang yonida — sabab so'z bilan: qancha muddati o'tgan va eng eski qarz necha kunlik, limitning necha foizi ishlatilgan yoki do'kon necha kundan beri buyurtma bermayapti. Bu bilan endi do'konga borish mumkin.",
          ),
        },
      ],
    },
    {
      id: "remind",
      h2: both("Напоминания о сроке оплаты", "To'lov muddati haqida eslatmalar"),
      blocks: [
        {
          p: both(
            "Срок оплаты появляется, когда курьер принимает частичную оплату и записывает, когда магазин обещал доплатить, или когда офис закрывает расчёт с остатком долга и ставит дату. По этим срокам программа напоминает сама:",
            "To'lov muddati kuryer qisman to'lovni qabul qilib, do'kon qachon to'lashni va'da qilganini yozganda yoki ofis hisob-kitobni qarz qoldig'i bilan yopib, sana qo'yganda paydo bo'ladi. Shu muddatlar bo'yicha dastur o'zi eslatadi:",
          ),
        },
        {
          list: [
            both(
              "за день до срока — уведомление «Напоминание о долге» директору и операторам;",
              "muddatdan bir kun oldin — direktor va operatorlarga «Qarz haqida eslatma» bildirishnomasi;",
            ),
            both(
              "когда срок прошёл — «ПРОСРОЧЕННЫЙ ДОЛГ» директору в программе и сообщение в Telegram директору и агенту этого магазина, если Telegram подключён;",
              "muddat o'tganda — direktorga dasturda «MUDDATI O'TGAN QARZ» va, Telegram ulangan bo'lsa, direktor hamda shu do'kon agentiga Telegramda xabar;",
            ),
            both(
              "оплаченный или возвращённый долг закрывает напоминание сам — лишних сообщений нет.",
              "to'langan yoki qaytarilgan qarz eslatmani o'zi yopadi — ortiqcha xabarlar bo'lmaydi.",
            ),
          ],
        },
        {
          note: {
            title: both("Чего здесь нет", "Bu yerda nima yo'q"),
            text: both(
              "Магазину программа сама ничего не пишет: напоминания получают ваши сотрудники, а разговор с магазином остаётся за агентом.",
              "Dastur do'konga o'zi hech narsa yozmaydi: eslatmalarni sizning xodimlaringiz oladi, do'kon bilan gaplashish esa agentning ishi bo'lib qoladi.",
            ),
          },
        },
      ],
    },
    {
      id: "reports",
      h2: both("Отчёты по долгам", "Qarzlar bo'yicha hisobotlar"),
      blocks: [
        {
          p: both(
            "В «Отчётах» → «Долги» — должники с разбивкой долга по возрасту и журнал за всё время: кто и когда взял в долг и когда погасил, с номером заказа. Список должников выгружается в Excel и печатается.",
            "«Hisobotlar» → «Qarzlar» bo'limida — qarz yoshi bo'yicha taqsimlangan qarzdorlar va butun davr jurnali: kim qachon qarzga olgan va qachon to'lagan, buyurtma raqami bilan. Qarzdorlar ro'yxati Excelga yuklanadi va chop etiladi.",
          ),
        },
        { see: "reconciliation", text: both("Акт сверки с одним магазином за период", "Bitta do'kon bilan davr uchun solishtirma dalolatnoma") },
      ],
    },
  ],
  faq: [
    {
      q: both("Как перенести долги, которые были до программы?", "Dasturdan oldingi qarzlarni qanday o'tkazish mumkin?"),
      a: both(
        "В карточке магазина: «Добавить платёж» → «Начисление — увеличивает» на сумму старого долга. Это обычная строка расчётов: она видна в журнале долгов и в акте сверки.",
        "Do'kon kartasida: «To'lov qo'shish» → «Hisoblash — oshiradi», eski qarz summasiga. Bu oddiy hisob-kitob qatori: u qarzlar jurnalida va solishtirma dalolatnomada ko'rinadi.",
      ),
    },
    {
      q: both("Что если магазин заплатил больше, чем должен?", "Do'kon qarzidan ko'proq to'lasa-chi?"),
      a: both(
        "Долг не уходит ниже нуля. Переплата видна в акте сверки строкой «Расхождение с текущим долгом в системе».",
        "Qarz noldan pastga tushmaydi. Ortiqcha to'lov solishtirma dalolatnomada «Tizimdagi joriy qarz bilan farq» qatorida ko'rinadi.",
      ),
    },
    {
      q: both("Кредитный лимит проверяется и для заказов за наличные?", "Kredit limiti naqd pulli buyurtmalarda ham tekshiriladimi?"),
      a: both(
        "Нет, лимит — для заказов «в долг». Для магазинов, которые тянут с оплатой, есть отдельное правило: при просроченном долге заказ агента ждёт решения офиса, как бы его ни оплачивали.",
        "Yo'q, limit — qarzga buyurtmalar uchun. To'lovni cho'zayotgan do'konlar uchun alohida qoida bor: muddati o'tgan qarz bo'lsa, agent buyurtmasi qanday to'lanishidan qat'i nazar ofis qarorini kutadi.",
      ),
    },
    {
      q: both("Получает ли магазин напоминание сам?", "Do'kon eslatmani o'zi oladimi?"),
      a: both(
        "Нет. Напоминания получают директор и операторы в программе, а о просрочке — ещё директор и агент этого магазина в Telegram, если он подключён. Магазину программа ничего не отправляет.",
        "Yo'q. Eslatmalarni direktor va operatorlar dasturda oladi, muddati o'tgani haqida esa Telegram ulangan bo'lsa, direktor va shu do'kon agenti ham Telegramda oladi. Dastur do'konga hech narsa yubormaydi.",
      ),
    },
    {
      q: both("Может ли агент изменить долг магазина?", "Agent do'kon qarzini o'zgartira oladimi?"),
      a: both(
        "Нет. Агент видит долги своих магазинов в «Моих долгах», а ручные оплаты и начисления вносят только директор и оператор.",
        "Yo'q. Agent o'z do'konlari qarzlarini «Mening qarzlarim»da ko'radi, qo'lda to'lov va hisoblashlarni esa faqat direktor va operator kiritadi.",
      ),
    },
  ],
};
