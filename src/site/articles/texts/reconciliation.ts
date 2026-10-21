import { both, type ArticleText } from "../types";

/*
  Статья об акте сверки. Сверено с кодом (октябрь 2026): страница «Акт
  сверки» и блок в карточке магазина — components/shops/ShopStatement,
  периоды — contracts/statement-period.ts, строки — те же правила, что у
  recalcShopDebt (заказ «в долг» датируется оформлением, остальные —
  доставкой), печать в виде 1С и Excel — по-русски, как все документы.

  Снимка экрана нет намеренно: подходящего кадра в public/landing нет, а
  чужой кадр под этой статьёй показывал бы не то, о чём текст.
*/
export const RECONCILIATION_ARTICLE: ArticleText = {
  key: "reconciliation",
  h1: both(
    "Акт сверки с магазином: как он строится и как его напечатать",
    "Do'kon bilan solishtirma dalolatnoma: qanday tuziladi va qanday chop etiladi",
  ),
  lead: [
    both(
      "Магазин говорит, что должен вдвое меньше, и приносит свою тетрадь. Бухгалтер полдня сводит накладные, оплаты и возвраты в таблицу, а через неделю всё повторяется с другим магазином. Акт сверки нужен на каждый спор о долге, а собирать его руками дольше, чем спорить.",
      "Do'kon ikki baravar kam qarzdorman deydi va o'z daftarini olib keladi. Buxgalter yarim kun yuk xatlari, to'lovlar va qaytarishlarni jadvalga jamlaydi, bir haftadan keyin esa hammasi boshqa do'kon bilan takrorlanadi. Solishtirma dalolatnoma qarz haqidagi har bir bahsda kerak, uni qo'lda yig'ish esa bahslashishdan ham uzoqroq.",
    ),
    both(
      "В Warehouse Pro акт собирается из тех же документов, из которых считается долг: заказов, оплат, начислений и возвратов. Ниже — где он находится, как его читать и как отдать магазину на подпись.",
      "Warehouse Pro'da dalolatnoma qarz hisoblanadigan hujjatlarning o'zidan yig'iladi: buyurtmalar, to'lovlar, hisoblashlar va qaytarishlar. Quyida u qayerda joylashgani, uni qanday o'qish va do'konga imzoga qanday berish haqida.",
    ),
  ],
  sections: [
    {
      id: "open",
      h2: both("Где найти акт", "Dalolatnomani qayerdan topish mumkin"),
      blocks: [
        {
          p: both(
            "Отдельная страница «Акт сверки» открыта директору, оператору и супервайзеру. Тот же акт есть блоком в карточке магазина.",
            "Alohida «Solishtirma dalolatnoma» sahifasi direktor, operator va supervayzer uchun ochiq. Xuddi shu dalolatnoma do'kon kartasida ham blok sifatida bor.",
          ),
        },
        {
          steps: [
            both(
              "Найдите магазин: поиск идёт по названию, владельцу и телефону. Должники стоят в списке выше, архивные магазины тоже находятся — старый спор не теряется вместе с магазином.",
              "Do'konni toping: qidiruv nomi, egasi va telefoni bo'yicha ishlaydi. Qarzdorlar ro'yxatda yuqorida turadi, arxivdagi do'konlar ham topiladi — eski bahs do'kon bilan birga yo'qolmaydi.",
            ),
            both(
              "Выберите период: «За всё время», «Этот месяц», «Прошлый месяц», «Этот квартал», «Прошлый квартал», «С начала года», «Прошлый год» или «Свой период» с календарём.",
              "Davrni tanlang: «Butun davr», «Shu oy», «O'tgan oy», «Shu chorak», «O'tgan chorak», «Yil boshidan», «O'tgan yil» yoki taqvim bilan «O'z davri».",
            ),
            both(
              "Магазин и период остаются в адресе страницы: ссылку можно отправить коллеге, и у него откроется тот же акт.",
              "Do'kon va davr sahifa manzilida saqlanadi: havolani hamkasbga yuborish mumkin, unda ham xuddi shu dalolatnoma ochiladi.",
            ),
          ],
        },
      ],
    },
    {
      id: "read",
      h2: both("Как читать акт", "Dalolatnomani qanday o'qish kerak"),
      blocks: [
        {
          p: both(
            "Акт — таблица из шести колонок: «Дата», «Операция», «Документ», «Дебет (долг +)», «Кредит (оплата −)» и «Остаток». Сверху — «Сальдо начальное»: сколько магазин был должен на начало периода. Снизу — «Обороты за период» по дебету и кредиту и остаток на конец.",
            "Dalolatnoma — olti ustunli jadval: «Sana», «Amal», «Hujjat», «Debet (qarz +)», «Kredit (to'lov −)» va «Qoldiq». Yuqorida — «Boshlang'ich saldo»: davr boshida do'kon qancha qarzdor bo'lgani. Pastda — debet va kredit bo'yicha «Davr aylanmasi» va davr oxiridagi qoldiq.",
          ),
        },
        {
          p: both("Откуда берутся строки:", "Qatorlar qayerdan olinadi:"),
        },
        {
          list: [
            both(
              "отгрузка — по дебету. Заказ «в долг» датируется днём оформления: он должен с этого момента. Остальные заказы — днём доставки;",
              "jo'natish — debetda. Qarzga buyurtma rasmiylashtirilgan kun bilan sanalanadi: u shu paytdan qarzdor. Qolgan buyurtmalar — yetkazilgan kun bilan;",
            ),
            both(
              "оплата — по кредиту, с датой и номером заказа, если платили по заказу;",
              "to'lov — kreditda, sanasi bilan va agar buyurtma bo'yicha to'langan bo'lsa, buyurtma raqami bilan;",
            ),
            both(
              "ручное начисление из карточки магазина — по дебету;",
              "do'kon kartasidan qo'lda kiritilgan hisoblash — debetda;",
            ),
            both(
              "возврат — по кредиту.",
              "qaytarish — kreditda.",
            ),
          ],
        },
        {
          p: both(
            "Акт и долг в карточке магазина считаются по одним правилам и обычно сходятся. Если нет, под таблицей появляется строка «Расхождение с текущим долгом в системе» с суммой. Чаще всего это переплата: долг в программе не бывает меньше нуля, а акт показывает движения денег как есть.",
            "Dalolatnoma va do'kon kartasidagi qarz bir xil qoidalar bilan hisoblanadi va odatda mos keladi. Mos kelmasa, jadval ostida summasi bilan «Tizimdagi joriy qarz bilan farq» qatori paydo bo'ladi. Ko'pincha bu ortiqcha to'lov: dasturda qarz noldan kam bo'lmaydi, dalolatnoma esa pul harakatlarini borligicha ko'rsatadi.",
          ),
        },
      ],
    },
    {
      id: "check",
      h2: both("Как пройти акт вместе с магазином", "Dalolatnomani do'kon bilan birga qanday ko'rib chiqish"),
      blocks: [
        {
          steps: [
            both(
              "Откройте акт за тот же период, что в тетради магазина: чаще всего «За всё время» или «Свой период» — с даты, когда расчёты последний раз сходились.",
              "Dalolatnomani do'kon daftaridagi davr uchun oching: ko'pincha «Butun davr» yoki «O'z davri» — hisob-kitoblar oxirgi marta mos kelgan sanadan.",
            ),
            both(
              "Сверьте «Сальдо начальное». Если оно расходится, причина раньше выбранного периода — сдвиньте начало назад.",
              "«Boshlang'ich saldo»ni solishtiring. Agar u farq qilsa, sabab tanlangan davrdan oldinroq — boshlanishini orqaga suring.",
            ),
            both(
              "Идите по строкам сверху вниз: у каждой отгрузки и оплаты — дата и документ. Первая строка, которой нет в тетради магазина или которая записана там иначе, и есть причина расхождения.",
              "Qatorlarni yuqoridan pastga ko'rib chiqing: har bir jo'natish va to'lovning sanasi va hujjati bor. Do'kon daftarida yo'q yoki boshqacha yozilgan birinchi qator — farqning sababi.",
            ),
            both(
              "Если ошибка на вашей стороне, поправьте учёт в программе: акт строится из документов при каждом открытии, отдельно его править не нужно. Если всё сходится — печатайте акт на подпись.",
              "Xato sizning tomoningizda bo'lsa, dasturdagi hisobni tuzating: dalolatnoma har safar ochilganda hujjatlardan tuziladi, uni alohida tuzatish shart emas. Hammasi mos kelsa — dalolatnomani imzoga chop eting.",
            ),
          ],
        },
      ],
    },
    {
      id: "print",
      h2: both("Печать на подпись и Excel", "Imzo uchun chop etish va Excel"),
      blocks: [
        {
          p: both(
            "Кнопка печати открывает акт в привычном бухгалтерам виде:",
            "Chop etish tugmasi dalolatnomani buxgalterlarga tanish ko'rinishda ochadi:",
          ),
        },
        {
          list: [
            both(
              "заголовок «Акт сверки взаимных расчётов за период … между … и …» и вступление «Мы, нижеподписавшиеся…»;",
              "davr va ikki tomon nomi ko'rsatilgan o'zaro hisob-kitoblarni solishtirish sarlavhasi hamda odatiy «biz, quyida imzo chekuvchilar…» kirish so'zi;",
            ),
            both(
              "две половины: ваши данные с дебетом, кредитом и сальдо — и половина магазина, оставленная пустой, чтобы он заполнил её по своему учёту;",
              "ikki yarim: debet, kredit va saldo bilan sizning ma'lumotlaringiz — va do'kon o'z hisobi bo'yicha to'ldirishi uchun bo'sh qoldirilgan uning yarmi;",
            ),
            both(
              "итоговая фраза с суммой прописью — в сумах;",
              "summasi so'z bilan yozilgan yakuniy jumla — so'mda;",
            ),
            both(
              "места для подписей и печатей обеих сторон.",
              "ikkala tomonning imzo va muhrlari uchun joy.",
            ),
          ],
        },
        {
          p: both(
            "Из окна печати акт сохраняется в PDF («Сохранить как PDF») и отправляется магазину в Telegram или на почту. Реквизиты вашей стороны берутся из «Настроек» → «Компания» — заполните их один раз.",
            "Chop etish oynasidan dalolatnoma PDF ko'rinishida saqlanadi va do'konga Telegram yoki pochta orqali yuboriladi. Sizning tomoningiz rekvizitlari «Sozlamalar» → «Kompaniya»dan olinadi — ularni bir marta to'ldiring.",
          ),
        },
        {
          p: both(
            "Тот же акт выгружается в Excel в той же раскладке; суммы в файле — числами, а не текстом, их можно сразу складывать. Печатная форма и Excel — на русском, как и остальные документы программы.",
            "Xuddi shu dalolatnoma Excelga xuddi shu tartibda yuklanadi; fayldagi summalar matn emas, son ko'rinishida — ularni darhol qo'shish mumkin. Bosma shakl va Excel — boshqa hujjatlar kabi rus tilida.",
          ),
        },
        {
          note: {
            title: both("Вторая половина — за магазином", "Ikkinchi yarmi — do'konniki"),
            text: both(
              "Акт строится только по вашему учёту в программе. Данных магазина программа не знает и оставляет его половину пустой: её заполняет и подписывает сам магазин.",
              "Dalolatnoma faqat dasturdagi sizning hisobingiz bo'yicha tuziladi. Dastur do'kon ma'lumotlarini bilmaydi va uning yarmini bo'sh qoldiradi: uni do'konning o'zi to'ldiradi va imzolaydi.",
            ),
          },
        },
      ],
    },
    {
      id: "when",
      h2: both("Когда акт нужен", "Dalolatnoma qachon kerak"),
      blocks: [
        {
          list: [
            both(
              "магазин спорит с суммой долга — откройте акт «За всё время» и пройдите строки вместе с ним;",
              "do'kon qarz summasi bilan bahslashmoqda — «Butun davr» dalolatnomasini oching va qatorlarni u bilan birga ko'rib chiqing;",
            ),
            both(
              "конец квартала или года — акт за «Прошлый квартал» или «Прошлый год» на подпись;",
              "chorak yoki yil oxiri — «O'tgan chorak» yoki «O'tgan yil» uchun imzoga dalolatnoma;",
            ),
            both(
              "магазин закрылся или сменил владельца — архивный магазин тоже находится в поиске;",
              "do'kon yopilgan yoki egasi almashgan — arxivdagi do'kon ham qidiruvda topiladi;",
            ),
            both(
              "территорию передают другому агенту — по акту видно, что и когда было отгружено и оплачено.",
              "hudud boshqa agentga topshirilmoqda — dalolatnomadan nima va qachon jo'natilgani hamda to'langani ko'rinadi.",
            ),
          ],
        },
        { see: "debts", text: both("Откуда берётся долг магазина и как его ограничить", "Do'kon qarzi qayerdan paydo bo'ladi va uni qanday cheklash mumkin") },
      ],
    },
  ],
  faq: [
    {
      q: both("Можно ли сделать акт за произвольные даты?", "Dalolatnomani ixtiyoriy sanalar uchun tuzish mumkinmi?"),
      a: both(
        "Да: «Свой период» и календарь. Есть и готовые периоды: этот и прошлый месяц, этот и прошлый квартал, с начала года, прошлый год и всё время.",
        "Ha: «O'z davri» va taqvim. Tayyor davrlar ham bor: shu va o'tgan oy, shu va o'tgan chorak, yil boshidan, o'tgan yil va butun davr.",
      ),
    },
    {
      q: both("Почему акт не совпадает с долгом в карточке магазина?", "Nega dalolatnoma do'kon kartasidagi qarz bilan mos kelmaydi?"),
      a: both(
        "Обычно из-за переплаты: долг в программе не бывает меньше нуля. Разница показывается под таблицей строкой «Расхождение с текущим долгом в системе».",
        "Odatda ortiqcha to'lov sababli: dasturda qarz noldan kam bo'lmaydi. Farq jadval ostida «Tizimdagi joriy qarz bilan farq» qatorida ko'rsatiladi.",
      ),
    },
    {
      q: both("Можно ли отправить акт магазину в PDF?", "Dalolatnomani do'konga PDF qilib yuborish mumkinmi?"),
      a: both(
        "Да. Нажмите печать и в окне печати выберите «Сохранить как PDF». Для бухгалтерии есть и выгрузка в Excel.",
        "Ha. Chop etishni bosing va chop etish oynasida PDF sifatida saqlashni tanlang. Buxgalteriya uchun Excelga yuklash ham bor.",
      ),
    },
    {
      q: both("Есть ли акт на узбекском языке?", "Dalolatnoma o'zbek tilida bormi?"),
      a: both(
        "Экран акта — на русском и узбекском. Печатная форма и Excel — на русском, как и остальные документы программы.",
        "Dalolatnoma ekrani — rus va o'zbek tillarida. Bosma shakl va Excel — dasturning boshqa hujjatlari kabi rus tilida.",
      ),
    },
    {
      q: both("Кто может открыть акт сверки?", "Solishtirma dalolatnomani kim ocha oladi?"),
      a: both(
        "Директор, оператор и супервайзер. Агенту в телефоне доступны неоплаченные заказы его магазинов — «Мои долги».",
        "Direktor, operator va supervayzer. Agentga telefonda uning do'konlaridagi to'lanmagan buyurtmalar — «Mening qarzlarim» ochiq.",
      ),
    },
  ],
};
