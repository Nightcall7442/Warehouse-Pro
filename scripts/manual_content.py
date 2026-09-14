# -*- coding: utf-8 -*-
"""
Руководство дистрибьютора Warehouse Pro — содержание.

Одна структура, две языковые колонки: у каждого текста {"ru": …, "uz": …}.
Блоки: h2/h3 — заголовки; p — абзац; steps — нумерованные шаги; bullets —
список; tip — совет; warn — предупреждение; check — чек-лист; table — таблица
(header + rows); fig — снимок (kind, role, screen) с подписью и выносками по
ключам marks из index.json; role — карточка «ваш день» (morning/day/evening).
"""

def T(ru, uz=""):
    return {"ru": ru, "uz": uz}

DOC = {
  "title": T("Warehouse Pro — руководство дистрибьютора", "Warehouse Pro — distribyutor qo'llanmasi"),
  "subtitle": T("Внедрение за пять дней и рабочий день каждой роли", "Besh kunda joriy etish va har bir rolning ish kuni"),
  "edition": T("Издание 2026.09 · для организаций-арендаторов", "2026.09 nashri · ijarachi tashkilotlar uchun"),
  "chapters": [

  # ─────────────────────────────────────────────────────────── 0. Введение
  {"id": "about", "title": T("Как пользоваться этой книгой", "Bu kitobdan qanday foydalanish"), "blocks": [
    {"t": "p", "x": T("Warehouse Pro — учёт дистрибьютора: поле, склад, долги и зарплата в одной системе. Агент оформляет заказ у прилавка с телефона, склад собирает его по списку с партиями, курьер отдаёт товар и принимает деньги, а директор в тот же момент видит выручку, остаток и долги. Книга написана для владельца и его команды: за пять дней запустить работу и с первой недели получать честные цифры.", "Warehouse Pro — distribyutor hisobi: dala, ombor, qarzlar va oylik bitta tizimda. Agent buyurtmani peshtaxta oldida telefondan rasmiylashtiradi, ombor uni partiyalar ko'rsatilgan ro'yxat bo'yicha yig'adi, kuryer tovarni topshirib pulni oladi, direktor esa o'sha zahoti tushum, qoldiq va qarzlarni ko'radi. Kitob egasi va uning jamoasi uchun yozilgan: besh kunda ishni yo'lga qo'yish va birinchi haftadanoq halol raqamlarga ega bo'lish.")},
    {"t": "p", "x": T("Часть 1 — план внедрения по дням: что настроить, кого завести, чем проверить. Часть 2 — рабочий день каждой роли с настоящими снимками экранов: сначала веб для офиса, затем телефон для поля. Часть 3 — как система считает остаток, долг и зарплату: это стоит прочитать владельцу и бухгалтеру. Часть 4 — что делать, если что-то пошло не так.", "1-qism — kunma-kun joriy etish rejasi: nimani sozlash, kimni kiritish, qanday tekshirish. 2-qism — har bir rolning ish kuni, haqiqiy ekran suratlari bilan: avval ofis uchun veb, keyin dala uchun telefon. 3-qism — tizim qoldiq, qarz va oylikni qanday hisoblaydi: buni egasi va buxgalter o'qib chiqishi kerak. 4-qism — biror narsa noto'g'ri ketsa, nima qilish kerak.")},
    {"t": "table", "header": [T("Обозначение", "Belgi"), T("Что значит", "Ma'nosi")], "rows": [
      [T("«Заказы» → «Новый заказ»", "«Buyurtmalar» → «Yangi buyurtma»"), T("Пункт меню, затем кнопка на экране — названия даны так, как они написаны в программе", "Menyu bandi, so'ng ekrandagi tugma — nomlar dasturda qanday yozilgan bo'lsa, shunday berilgan")],
      [T("① ② ③ на снимке", "Suratdagi ① ② ③"), T("Выноски: цифры на снимке соответствуют подписям под ним", "Izohlar: suratdagi raqamlar uning ostidagi izohlarga mos keladi")],
      [T("Совет", "Maslahat"), T("Как делают опытные команды — не обязательно, но экономит время", "Tajribali jamoalar shunday qiladi — majburiy emas, lekin vaqtni tejaydi")],
      [T("Внимание", "Diqqat"), T("Действие, которое влияет на деньги или остаток и которое трудно отменить", "Pul yoki qoldiqqa ta'sir qiladigan va bekor qilish qiyin bo'lgan amal")],
    ]},
    {"t": "p", "x": T("Снимки сделаны с настоящей программы на демонстрационной организации «Demo UZ». У вас будут ваши магазины и товары, но кнопки и экраны те же. Язык интерфейса — русский или узбекский — переключается в любой момент: в вебе внизу меню, на телефоне в профиле.", "Suratlar haqiqiy dasturdan, «Demo UZ» namoyish tashkilotida olingan. Sizda o'z do'konlaringiz va mahsulotlaringiz bo'ladi, lekin tugmalar va ekranlar o'sha-o'sha. Interfeys tili — rus yoki o'zbek — istalgan vaqtda almashtiriladi: vebda menyuning pastida, telefonda profilda.")},
  ]},

  # ─────────────────────────────────────────────── 1. Внедрение за пять дней
  {"id": "rollout", "title": T("Часть 1. Внедрение за пять дней", "1-qism. Besh kunda joriy etish"), "blocks": [
    {"t": "p", "x": T("План рассчитан на организацию с 3–15 агентами и одним складом. Каждый день заканчивается проверкой: если она проходит, следующий день можно начинать. Всё делается в вебе директором или оператором; телефон подключается на третий день.", "Reja 3–15 agentli va bitta omborli tashkilotga mo'ljallangan. Har kun tekshiruv bilan tugaydi: u o'tsa, keyingi kunni boshlash mumkin. Hammasi vebda direktor yoki operator tomonidan bajariladi; telefon uchinchi kuni ulanadi.")},
    {"t": "table", "header": [T("День", "Kun"), T("Что делаем", "Nima qilamiz"), T("Кто", "Kim"), T("Проверка в конце дня", "Kun oxiridagi tekshiruv")], "rows": [
      [T("1", "1"), T("Организация, склад, товары, стартовый остаток", "Tashkilot, ombor, mahsulotlar, boshlang'ich qoldiq"), T("Директор", "Direktor"), T("На «Складе» видны все товары с правильными остатками", "«Ombor»da barcha mahsulotlar to'g'ri qoldiqlar bilan ko'rinadi")],
      [T("2", "2"), T("Магазины, территории, сотрудники и роли", "Do'konlar, hududlar, xodimlar va rollar"), T("Директор, оператор", "Direktor, operator"), T("Каждый сотрудник вошёл и увидел свой экран", "Har bir xodim tizimga kirib, o'z ekranini ko'rdi")],
      [T("3", "3"), T("Поле: телефоны агентов, план визитов, первые заказы", "Dala: agentlar telefonlari, tashrif rejasi, birinchi buyurtmalar"), T("Супервайзер, агенты", "Supervayzer, agentlar"), T("Заказ агента появился в «Заказах» у оператора", "Agent buyurtmasi operatorning «Buyurtmalar»ida paydo bo'ldi")],
      [T("4", "4"), T("Склад и доставка: лист, сборка, курьер, деньги", "Ombor va yetkazish: varaqa, yig'ish, kuryer, pul"), T("Оператор, курьер", "Operator, kuryer"), T("Первый заказ прошёл путь до «Доставлен», деньги и долг сошлись", "Birinchi buyurtma «Yetkazildi»gacha yo'lni bosib o'tdi, pul va qarz to'g'ri chiqdi")],
      [T("5", "5"), T("Контроль: главная, KPI, карта, отчёты, зарплата", "Nazorat: bosh sahifa, KPI, xarita, hisobotlar, oylik"), T("Директор", "Direktor"), T("Директор ответил на пять вопросов дня с первого экрана", "Direktor kunning beshta savoliga birinchi ekrandanoq javob berdi")],
    ]},

    {"t": "h3", "x": T("День 1. Организация, склад, товары", "1-kun. Tashkilot, ombor, tovarlar")},
    {"t": "steps", "items": [
      T("Зарегистрируйте организацию: адрес компании, e-mail директора, пароль. Первый вход открывает мастер: основной склад → первый товар → приглашения. Мастер можно пройти позже — все шаги есть в меню.", "Tashkilotni ro'yxatdan o'tkazing: kompaniya manzili, direktor e-maili, parol. Birinchi kirishda yordamchi ochiladi: asosiy ombor → birinchi mahsulot → taklifnomalar. Yordamchini keyinroq ham o'tish mumkin — barcha qadamlar menyuda bor."),
      T("«Настройки» → «Компания»: название, валюта и знак (сум), реквизиты для накладных (адрес, ИНН, директор, банк), логотип. Эти данные печатаются на всех документах — заполните сразу.", "«Sozlamalar» → «Kompaniya»: nomi, valyuta va belgisi (so'm), yuk xatlari uchun rekvizitlar (manzil, STIR, direktor, bank), logotip. Bu ma'lumotlar barcha hujjatlarda chop etiladi — darhol to'ldiring."),
      T("«Настройки» → «Склад»: основной склад — единственный, с которого продают. Дополнительные склады нужны только для хранения и перемещений.", "«Sozlamalar» → «Ombor»: asosiy ombor — sotuv faqat undan qilinadi. Qo'shimcha omborlar faqat saqlash va ko'chirish uchun kerak."),
      T("«Товары» → «Импорт из Excel»: скачайте шаблон, заполните код, название, единицу, цену, штрих-код, упаковку (сколько штук в коробке). Импорт покажет ошибки построчно до записи. Можно завести и по одному — «Новый товар».", "«Mahsulotlar» → «Excel'dan import»: shablonni yuklab oling, kod, nom, o'lchov birligi, narx, shtrix-kod, qadoq (qutida nechta dona) ustunlarini to'ldiring. Import xatolarni yozishdan oldin qatorma-qator ko'rsatadi. Bittalab ham kiritish mumkin — «Yangi mahsulot»."),
      T("Стартовый остаток — приходом: «Приходы» → «Новый приход» → строки с количеством, партией и сроком годности → «Сохранить и завершить». Остаток появится на складе только после завершения прихода. Если товар уже на полках — заведите один приход «стартовый остаток» с фактическими количествами.", "Boshlang'ich qoldiq — kirim orqali: «Kirim» → «Yangi kirim» → miqdor, partiya va yaroqlilik muddati ko'rsatilgan qatorlar → «Saqlash va yakunlash». Qoldiq omborda faqat kirim yakunlangandan keyin paydo bo'ladi. Tovar allaqachon javonlarda bo'lsa — haqiqiy miqdorlar bilan bitta «boshlang'ich qoldiq» kirimini kiriting."),
      T("Точка заказа: у товара поле «минимальный остаток» — при падении ниже система напомнит. Общий порог для всех — в «Настройках» → «Компания».", "Buyurtma nuqtasi: mahsulotda «minimal qoldiq» maydoni bor — qoldiq undan pastga tushsa, tizim eslatadi. Hamma uchun umumiy chegara — «Sozlamalar» → «Kompaniya»da."),
    ]},
    {"t": "fig", "fig": ("web", "operator", "arrival-form"), "cap": T("Новый приход: товар по коду или сканером, партия и срок, «Сохранить и завершить»", "Yangi kirim: mahsulot kod bo'yicha yoki skaner bilan, partiya va muddat, «Saqlash va yakunlash»"), "callouts": [("save", T("Сохранить и завершить — остаток изменится сразу", "Saqlash va yakunlash — qoldiq darhol o'zgaradi"))]},
    {"t": "tip", "x": T("Партия и срок годности не обязательны, но с ними система сама подскажет складу, что отгружать первым (FEFO — раньше сгорает, раньше уходит), и покажет директору, что скоро сгорит. Для продуктов и напитков это окупается в первый месяц.", "Partiya va yaroqlilik muddati majburiy emas, lekin ular bilan tizim omborga nimani birinchi yuklashni o'zi aytadi (FEFO — muddati oldin tugaydigani oldin ketadi) va direktorga nimaning muddati yaqinda tugashini ko'rsatadi. Oziq-ovqat va ichimliklar uchun bu birinchi oydayoq o'zini oqlaydi.")},
    {"t": "check", "items": [T("Валюта и реквизиты заполнены", "Valyuta va rekvizitlar to'ldirilgan"), T("Все товары загружены, у продаваемых есть цена и единица", "Barcha mahsulotlar yuklangan, sotiladiganlarida narx va o'lchov birligi bor"), T("Приход завершён, на «Складе» остатки совпадают с полками", "Kirim yakunlangan, «Ombor»dagi qoldiqlar javonlardagiga mos")]},

    {"t": "h3", "x": T("День 2. Магазины, территории, люди", "2-kun. Do'konlar, hududlar, odamlar")},
    {"t": "steps", "items": [
      T("«Магазины» → «Импорт из Excel» (или по одному): название, владелец, телефон, адрес, координаты, территория, стартовый долг, кредитный лимит. Поиск потом работает по названию, владельцу и телефону — заполняйте все три.", "«Do'konlar» → «Excel'dan import» (yoki bittalab): nomi, egasi, telefon, manzil, koordinatalar, hudud, boshlang'ich qarz, kredit limiti. Keyin qidiruv nom, egasi va telefon bo'yicha ishlaydi — uchalasini ham to'ldiring."),
      T("Территории: «Магазины» → «Территории». Территория — это маршрут агента; по ней супервайзер расставляет план на месяц одной кнопкой.", "Hududlar: «Do'konlar» → «Hududlar». Hudud — bu agentning marshruti; supervayzer u bo'yicha oylik rejani bitta tugma bilan joylashtiradi."),
      T("Кредитный лимит магазина: заказ в долг сверх лимита не пройдёт у агента — его подтвердит офис. Лимит ноль — без ограничений.", "Do'konning kredit limiti: limitdan oshgan qarzga buyurtma agentda o'tmaydi — uni ofis tasdiqlaydi. Limit nol — cheklovsiz."),
      T("«Пользователи» → «Пригласить»: e-mail и роль. Роли: директор (всё), оператор (заказы, склад, приходы, возвраты), супервайзер (агенты, планы, карта), агент, курьер, мерчандайзер. Приглашённый получает письмо, ставит пароль и входит.", "«Foydalanuvchilar» → «Taklif qilish»: e-mail va rol. Rollar: direktor (hammasi), operator (buyurtmalar, ombor, kirim, qaytarishlar), supervayzer (agentlar, rejalar, xarita), agent, kuryer, merchandayzer. Taklif qilingan xodim xat oladi, parol o'rnatadi va kiradi."),
      T("Порог скидки для полевых сотрудников: «Настройки» → «Компания». Скидка выше порога у агента не пройдёт сама — заказ встанет в «Ожидает», и оператор решит.", "Dala xodimlari uchun chegirma chegarasi: «Sozlamalar» → «Kompaniya». Chegaradan yuqori chegirma agentda o'z-o'zidan o'tmaydi — buyurtma «Kutishda»ga tushadi va operator hal qiladi."),
      T("Директору — включить двухфакторную защиту («Настройки» → «Профиль»): она нужна для выгрузки копии базы и удаления журнала действий.", "Direktor uchun — ikki bosqichli himoyani yoqish («Sozlamalar» → «Profil»): u baza nusxasini yuklab olish va amallar jurnalini o'chirish uchun kerak."),
    ]},
    {"t": "table", "header": [T("Роль", "Rol"), T("Веб", "Veb"), T("Телефон", "Telefon"), T("Что видит", "Nimani ko'radi")], "rows": [
      [T("Директор", "Direktor"), T("да", "ha"), T("да", "ha"), T("Всё: деньги, отчёты, зарплата, настройки, пользователи", "Hammasi: pul, hisobotlar, oylik, sozlamalar, foydalanuvchilar")],
      [T("Оператор", "Operator"), T("да", "ha"), T("—", "—"), T("Заказы, магазины, товары, склад, приходы, возвраты; зарплату — только свою", "Buyurtmalar, do'konlar, mahsulotlar, ombor, kirim, qaytarishlar; oylik — faqat o'ziniki")],
      [T("Супервайзер", "Supervayzer"), T("да", "ha"), T("да", "ha"), T("Карта, планы, KPI и зарплата агентов, магазины", "Xarita, rejalar, agentlarning KPI va oyligi, do'konlar")],
      [T("Агент", "Agent"), T("частично", "qisman"), T("да", "ha"), T("Свои магазины, заказы, план, долги, KPI и зарплата", "O'z do'konlari, buyurtmalar, reja, qarzlar, KPI va oylik")],
      [T("Курьер", "Kuryer"), T("частично", "qisman"), T("да", "ha"), T("Свои доставки и зарплата", "O'z yetkazishlari va oylik")],
      [T("Мерчандайзер", "Merchandayzer"), T("частично", "qisman"), T("да", "ha"), T("План визитов и отчёты по полке", "Tashrif rejasi va javon bo'yicha hisobotlar")],
    ]},
    {"t": "check", "items": [T("Все магазины с телефоном и территорией", "Barcha do'konlarda telefon va hudud bor"), T("Каждый сотрудник вошёл и увидел свой экран", "Har bir xodim tizimga kirib, o'z ekranini ko'rdi"), T("Порог скидки и кредитные лимиты заданы", "Chegirma chegarasi va kredit limitlari belgilangan")]},

    {"t": "h3", "x": T("День 3. Поле: телефоны, план, первые заказы", "3-kun. Dala: telefonlar, reja, birinchi buyurtmalar")},
    {"t": "steps", "items": [
      T("Установите приложение агентам, курьерам и мерчандайзерам (APK от вашего поставщика). Вход — тем же e-mail и паролем; язык — в профиле.", "Agentlar, kuryerlar va merchandayzerlarga ilovani o'rnating (APK — yetkazib beruvchingizdan). Kirish — o'sha e-mail va parol bilan; til — profilda."),
      T("Супервайзер в вебе: «Планы» → вкладка «Месяц» → агент, территория, дни недели → «Расставить». Система сама распределит точки по дням и покажет, сколько визитов получится.", "Supervayzer vebda: «Rejalar» → «Oy» yorlig'i → agent, hudud, hafta kunlari → «Joylashtirish». Tizim nuqtalarni kunlarga o'zi taqsimlaydi va nechta tashrif chiqishini ko'rsatadi."),
      T("Агент с телефона: главная показывает визиты на сегодня; в магазине — «Новый заказ» → товары → оплата → «Подтвердить». Первые заказы делайте при супервайзере: одна минута у прилавка, и человек больше не спрашивает.", "Agent telefondan: bosh sahifa bugungi tashriflarni ko'rsatadi; do'konda — «Yangi buyurtma» → mahsulotlar → to'lov → «Tasdiqlash». Birinchi buyurtmalarni supervayzer huzurida qiling: peshtaxta oldida bir daqiqa — va odam boshqa so'ramaydi."),
      T("Проверьте GPS: агент должен разрешить геолокацию «всегда». Без неё карта у супервайзера пуста, а визиты не подтверждаются.", "GPS'ni tekshiring: agent geolokatsiyaga «har doim» ruxsat berishi kerak. Usiz supervayzerning xaritasi bo'sh bo'ladi, tashriflar esa tasdiqlanmaydi."),
    ]},
    {"t": "fig", "fig": ("mobile", "agent", "order-step2"), "cap": T("Заказ у прилавка: поиск или сканер, «− n +», остаток виден до добавления", "Peshtaxta oldida buyurtma: qidiruv yoki skaner, «− n +», qoldiq qo'shishdan oldin ko'rinadi"), "callouts": []},
    {"t": "check", "items": [T("У всех агентов есть план на неделю", "Barcha agentlarda haftalik reja bor"), T("Первый заказ агента виден у оператора в «Заказах»", "Agentning birinchi buyurtmasi operatorning «Buyurtmalar»ida ko'rinadi"), T("Агент виден на карте у супервайзера", "Agent supervayzer xaritasida ko'rinadi")]},

    {"t": "h3", "x": T("День 4. Склад и доставка", "4-kun. Ombor va yetkazish")},
    {"t": "steps", "items": [
      T("Оператор: «Заказы» → отметить заказы дня галочками → «Загруз. лист» → «Сформировать лист» → печать. Лист — задание складу и одновременно рейс курьера.", "Operator: «Buyurtmalar» → kun buyurtmalarini belgilash → «Yuklash varaqasi» → «Varaqa tuzish» → chop etish. Varaqa — omborga topshiriq va ayni paytda kuryerning reysi."),
      T("Сборка: «Погрузочные листы» → «Собрать». Система показывает, сколько нужно и из каких партий брать; кладовщик отмечает, сколько собрал. Меньше — недостача, о которой офис узнаёт сразу.", "Yig'ish: «Yuklash varaqalari» → «Yig'ish». Tizim qancha kerakligini va qaysi partiyalardan olishni ko'rsatadi; omborchi qancha yig'ganini belgilaydi. Kam bo'lsa — kamomad, ofis bu haqda darhol biladi."),
      T("Курьер: в том же окне выбрать курьера — он проставится на все заказы листа. На телефоне курьера появится маршрут.", "Kuryer: o'sha oynada kuryerni tanlang — u varaqadagi barcha buyurtmalarga qo'yiladi. Kuryer telefonida marshrut paydo bo'ladi."),
      T("Доставка: курьер жмёт «Выехал по всем», у точки — сумма наличных и «Доставлено»; недовоз — «Не доставлено» с причиной; частичная оплата или возврат — «Оформить подробно».", "Yetkazish: kuryer «Hammasiga yo'lga chiqdim»ni bosadi, nuqtada — naqd summa va «Yetkazildi»; yetkazilmasa — sababi bilan «Yetkazilmadi»; qisman to'lov yoki qaytarish — «Batafsil rasmiylashtirish»."),
      T("Вечером оператор сверяет: «Заказы» → фильтр «Доставлены»; деньги курьера — в карточке каждого заказа и в отчётах.", "Kechqurun operator solishtiradi: «Buyurtmalar» → «Yetkazildi» filtri; kuryer puli — har bir buyurtma kartochkasida va hisobotlarda."),
    ]},
    {"t": "fig", "fig": ("web", "operator", "picking"), "cap": T("Сборка листа по строкам: нужно, партии по FEFO, собрано", "Varaqani qatorma-qator yig'ish: kerak, FEFO bo'yicha partiyalar, yig'ildi"), "callouts": [("picked", T("Собрано — правьте только то, чего не хватило", "Yig'ildi — faqat yetishmaganini o'zgartiring")), ("confirm", T("Подтвердить сборку — лист становится «готов»", "Yig'ishni tasdiqlash — varaqa «tayyor» bo'ladi"))]},
    {"t": "warn", "x": T("Остаток списывается при отгрузке, деньги и долг — при доставке. Не переводите заказ в «Доставлен» руками, пока курьер не отчитался: иначе долг магазина будет посчитан по тому, что не довезли.", "Qoldiq yuklashda hisobdan chiqariladi, pul va qarz — yetkazishda. Kuryer hisobot bermaguncha buyurtmani qo'lda «Yetkazildi»ga o'tkazmang: aks holda do'kon qarzi yetkazilmagan tovar bo'yicha hisoblanadi.")},
    {"t": "check", "items": [T("Лист собран, курьер назначен", "Varaqa yig'ilgan, kuryer tayinlangan"), T("Заказ прошёл «Отгружен» → «Доставлен»", "Buyurtma «Yuklandi» → «Yetkazildi» yo'lini o'tdi"), T("Долг магазина и наличные курьера сходятся с бумагой", "Do'kon qarzi va kuryer naqdi qog'ozdagiga mos")]},

    {"t": "h3", "x": T("День 5. Контроль", "5-kun. Nazorat")},
    {"t": "steps", "items": [
      T("Главная директора: выручка и заказы за сегодня, «довезено N из M», долг клиентов, маржа; ниже — алерты (низкий остаток, просрочка, новые заказы, долги). Каждый алерт ведёт на экран, где на него отвечают.", "Direktorning bosh sahifasi: bugungi tushum va buyurtmalar, «M dan N tasi yetkazildi», mijozlar qarzi, marja; pastda — ogohlantirishlar (kam qoldiq, muddati o'tgan, yangi buyurtmalar, qarzlar). Har bir ogohlantirish unga javob beriladigan ekranga olib boradi."),
      T("KPI: кто из агентов делает план, кто нет; клик по агенту — разбор и зарплата за период.", "KPI: qaysi agent rejani bajaryapti, qaysi biri yo'q; agentni bossangiz — tahlil va davr uchun oylik."),
      T("Отчёты → «Долги»: кто, сколько, как давно; P&L — заработали или потеряли за период.", "Hisobotlar → «Qarzlar»: kim, qancha, qachondan beri; P&L — davr ichida foyda qildikmi yoki zarar."),
      T("Зарплаты: оклад, процент от продаж или от довезённого (курьер), вычеты; «Выдать всем» — сотрудник подтверждает получение на телефоне.", "Oylik: maosh, sotuvdan yoki yetkazilgandan (kuryer) foiz, ushlab qolishlar; «Hammaga berish» — xodim olganini telefonda tasdiqlaydi."),
      T("Telegram: «Настройки» → «Telegram» — уведомления директору и операторам о новых заказах, долгах и остатках.", "Telegram: «Sozlamalar» → «Telegram» — direktor va operatorlarga yangi buyurtmalar, qarzlar va qoldiqlar haqida bildirishnomalar."),
    ]},
    {"t": "fig", "fig": ("web", "ceo", "dashboard"), "cap": T("Главная директора: ответы на вопросы дня одним экраном", "Direktorning bosh sahifasi: kun savollariga bitta ekranda javob"), "callouts": [("revenue", T("Выручка за сегодня и сравнение со вчера", "Bugungi tushum va kechagi bilan taqqoslash")), ("delivered", T("Довезено сегодня N из M", "Bugun M dan N tasi yetkazildi")), ("debt", T("Долг клиентов — ведёт в «Долги»", "Mijozlar qarzi — «Qarzlar»ga olib boradi")), ("alerts", T("Алерты — каждый открывает нужный экран", "Ogohlantirishlar — har biri kerakli ekranni ochadi"))]},
    {"t": "check", "items": [T("Директор проверил пять вопросов дня с главной", "Direktor kunning beshta savolini bosh sahifadan tekshirdi"), T("Зарплата настроена, ведомость сходится с ожиданиями", "Oylik sozlangan, to'lov vedomosti kutilganiga mos"), T("Telegram подключён", "Telegram ulangan")]},
  ]},

  # ─────────────────────────────────────────────── 2. Роли — рабочий день
  {"id": "roles", "title": T("Часть 2. Рабочий день каждой роли", "2-qism. Har bir rolning ish kuni"), "blocks": [
    {"t": "p", "x": T("Здесь каждая роль описана так, как проходит её день: утро, день, вечер. Сначала офис (веб), затем поле (телефон). Читать нужно только свою главу; директору полезно знать все.", "Bu yerda har bir rol o'z kuni qanday o'tsa, shunday tasvirlangan: ertalab, kunduzi, kechqurun. Avval ofis (veb), keyin dala (telefon). Faqat o'z bobingizni o'qish kifoya; direktorga hammasini bilish foydali.")},
  ]},

  {"id": "role-operator", "title": T("Оператор офиса и склад", "Ofis operatori va ombor"), "blocks": [
    {"t": "role", "morning": T("Проверить новые заказы и «Ожидает», собрать листы, назначить курьеров", "Yangi buyurtmalar va «Kutishda»ni tekshirish, varaqalarni yig'ish, kuryerlarni tayinlash"), "day": T("Принимать заказы по телефону, проводить приходы и возвраты, отвечать магазинам про долг", "Telefon orqali buyurtma qabul qilish, kirim va qaytarishlarni o'tkazish, do'konlarga qarz bo'yicha javob berish"), "evening": T("Сверить доставленные заказы, деньги курьеров, закрыть листы", "Yetkazilgan buyurtmalar va kuryerlar pulini solishtirish, varaqalarni yopish")},
    {"t": "h3", "x": T("Заказы — рабочий экран", "Buyurtmalar — ish ekrani")},
    {"t": "fig", "fig": ("web", "operator", "orders"), "cap": T("Экран «Заказы»", "«Buyurtmalar» ekrani"), "callouts": [("summary", T("Сводка — каждое число фильтр; «Ожидает» — заказы, которые ждут решения офиса", "Xulosa — har bir raqam filtr; «Kutishda» — ofis qarorini kutayotgan buyurtmalar")), ("search", T("Поиск по номеру, магазину, агенту", "Raqam, do'kon, agent bo'yicha qidiruv")), ("lists", T("Погрузочные листы", "Yuklash varaqalari")), ("new", T("Новый заказ по звонку", "Qo'ng'iroq bo'yicha yangi buyurtma")), ("status", T("Статус — меняется прямо в строке", "Holat — to'g'ridan-to'g'ri qatorda o'zgaradi")), ("complete", T("Выполнить — оплата и закрытие заказа", "Bajarish — to'lov va buyurtmani yopish"))]},
    {"t": "p", "x": T("Клик по строке открывает панель заказа: состав, оплата, курьер, корректировки, документы. Заказ агента со скидкой выше порога приходит в статусе «Ожидает» — в панели видна причина и кнопки «Подтвердить» и «Отклонить».", "Qatorni bossangiz buyurtma paneli ochiladi: tarkibi, to'lov, kuryer, tuzatishlar, hujjatlar. Chegaradan yuqori chegirmali agent buyurtmasi «Kutishda» holatida keladi — panelda sababi hamda «Tasdiqlash» va «Rad etish» tugmalari ko'rinadi.")},
    {"t": "fig", "fig": ("web", "operator", "order-panel"), "cap": T("Панель заказа", "Buyurtma paneli"), "callouts": [("status", T("Статус", "Holat")), ("tabs", T("Детали, история, документы", "Tafsilotlar, tarix, hujjatlar")), ("sum", T("Сумма заказа", "Buyurtma summasi"))]},
    {"t": "h3", "x": T("Заказ по телефону", "Telefon orqali buyurtma")},
    {"t": "steps", "items": [
      T("«Новый заказ» → магазин: поиск по названию, владельцу или телефону; рядом виден долг.", "«Yangi buyurtma» → do'kon: nom, egasi yoki telefon bo'yicha qidiruv; yonida qarz ko'rinadi."),
      T("Товары: код, название или сканер; у каждого «свободно N» — заказать больше нельзя.", "Mahsulotlar: kod, nom yoki skaner; har birida «mavjud N» — undan ko'p buyurtma qilib bo'lmaydi."),
      T("Способ оплаты и примечание → «Создать заказ». Заказ сразу резервирует остаток.", "To'lov usuli va izoh → «Buyurtma yaratish». Buyurtma qoldiqni darhol zaxiraga oladi."),
    ]},
    {"t": "fig", "fig": ("web", "operator", "quick-order"), "cap": T("Быстрый заказ", "Tezkor buyurtma"), "callouts": [("shop", T("Магазин — поиск по названию, владельцу, телефону", "Do'kon — nom, egasi, telefon bo'yicha qidiruv"))]},
    {"t": "h3", "x": T("Погрузочный лист и сборка", "Yuklash varaqasi va yig'ish")},
    {"t": "steps", "items": [
      T("Отметьте заказы галочками → «Загруз. лист» → выберите формат (сводный по товарам или по маршруту) → «Сформировать лист». До этой кнопки в системе ничего не записано — «Отмена» ничего не оставляет.", "Buyurtmalarni belgilang → «Yuklash varaqasi» → formatni tanlang (mahsulotlar bo'yicha jamlangan yoki marshrut bo'yicha) → «Varaqa tuzish». Bu tugmagacha tizimda hech narsa yozilmaydi — «Bekor qilish» hech qanday iz qoldirmaydi."),
      T("Печать — задание кладовщику: в нём колонка «Партия (срок)» и пустая «Собрано» под отметки рукой.", "Chop etilgan nusxa — omborchiga topshiriq: unda «Partiya (muddat)» ustuni va qo'lda belgilash uchun bo'sh «Yig'ildi» ustuni bor."),
      T("«Погрузочные листы» → «Собрать»: внесите собранное по строкам (по умолчанию — как в листе) → «Подтвердить сборку». Недостача остаётся в строках и уходит офису уведомлением.", "«Yuklash varaqalari» → «Yig'ish»: yig'ilganini qatorma-qator kiriting (sukut bo'yicha — varaqadagidek) → «Yig'ishni tasdiqlash». Kamomad qatorlarda qoladi va ofisga bildirishnoma bo'lib boradi."),
      T("В том же окне — курьер на весь лист. Лист «доставлен» закрывается после рейса; ошибочный лист удаляется, и заказы освобождаются.", "O'sha oynada — butun varaqa uchun kuryer. Varaqa reysdan keyin «yetkazildi» deb yopiladi; xato varaqa o'chiriladi va buyurtmalar bo'shatiladi."),
    ]},
    {"t": "fig", "fig": ("web", "operator", "loading-list-create"), "cap": T("Создание листа: до «Сформировать» ничего не записано", "Varaqa tuzish: «Varaqa tuzish» bosilguncha hech narsa yozilmaydi"), "callouts": [("make", T("Сформировать лист", "Varaqa tuzish"))]},
    {"t": "fig", "fig": ("web", "operator", "loading-lists"), "cap": T("Список листов: собрать, назначить курьера, удалить ошибочный", "Varaqalar ro'yxati: yig'ish, kuryer tayinlash, xatosini o'chirish"), "callouts": [("pick", T("Собрать — сборка по строкам", "Yig'ish — qatorma-qator yig'ish")), ("courier", T("Курьер на весь лист", "Butun varaqa uchun kuryer"))]},
    {"t": "h3", "x": T("Приходы, возвраты, склад", "Kirim, qaytarishlar, ombor")},
    {"t": "bullets", "items": [
      T("Приход: «Новый приход» → строки (код или сканер, количество, партия, срок, цена закупки) → «Сохранить и завершить». Черновик прихода сохраняется, если отвлеклись.", "Kirim: «Yangi kirim» → qatorlar (kod yoki skaner, miqdor, partiya, muddat, xarid narxi) → «Saqlash va yakunlash». Chalg'ib qolsangiz, kirim qoralamasi saqlanib qoladi."),
      T("Возврат от магазина: заводит агент с телефона, офис проводит — товар возвращается на склад или списывается (брак, просрочка), долг магазина уменьшается.", "Do'kondan qaytarish: agent telefondan kiritadi, ofis o'tkazadi — tovar omborga qaytadi yoki hisobdan chiqariladi (brak, muddati o'tgan), do'kon qarzi kamayadi."),
      T("Возврат поставщику: «Приходы» → «Контрагенты» → поставщик → «Вернуть товар».", "Yetkazib beruvchiga qaytarish: «Kirim» → «Kontragentlar» → yetkazib beruvchi → «Tovarni qaytarish»."),
      T("Склад: остатки по товарам, партии и сроки, инвентаризация документом; «Отчёты по складу» — что сгорает и на какую сумму.", "Ombor: mahsulotlar bo'yicha qoldiqlar, partiyalar va muddatlar, hujjat bilan inventarizatsiya; «Ombor hisobotlari» — nimaning muddati tugayapti va qancha summaga."),
    ]},
    {"t": "fig", "fig": ("web", "operator", "warehouse"), "cap": T("Склад: остаток, резерв, свободно", "Ombor: qoldiq, zaxira, mavjud"), "callouts": []},
    {"t": "tip", "x": T("Сканер-клавиатура работает везде, где есть поле поиска товара: отсканируйте код — товар добавится, следующий скан добавит следующий. В приёмке это быстрее любого списка.", "Klaviatura-skaner mahsulot qidiruv maydoni bor har qanday joyda ishlaydi: kodni skanerlang — mahsulot qo'shiladi, keyingi skan keyingisini qo'shadi. Qabul qilishda bu har qanday ro'yxatdan tezroq.")},
  ]},

  {"id": "role-ceo", "title": T("Директор", "Direktor"), "blocks": [
    {"t": "role", "morning": T("Главная: выручка, довезено, долги, алерты; карта — кто вышел", "Bosh sahifa: tushum, yetkazilgan, qarzlar, ogohlantirishlar; xarita — kim ishga chiqqan"), "day": T("KPI агентов, «Ожидает» и спорные заказы, журнал действий", "Agentlar KPI'si, «Kutishda» va bahsli buyurtmalar, amallar jurnali"), "evening": T("Отчёты за день; раз в неделю — P&L; раз в месяц — зарплата", "Kunlik hisobotlar; haftada bir — P&L; oyda bir — oylik")},
    {"t": "fig", "fig": ("web", "ceo", "kpi-agent"), "cap": T("KPI: разбор выбранного агента и его зарплата за период", "KPI: tanlangan agent tahlili va uning davr uchun oyligi"), "callouts": []},
    {"t": "bullets", "items": [
      T("Главная — пять вопросов дня; каждая плитка и алерт кликаются.", "Bosh sahifa — kunning beshta savoli; har bir plitka va ogohlantirish bosiladi."),
      T("KPI: таблица агентов (продажи, визиты, план, балл); «нет GPS» серым — у кого нет следов на карте; клик — разбор и зарплата агента.", "KPI: agentlar jadvali (sotuvlar, tashriflar, reja, ball); kulrang «GPS yo'q» — xaritada izi yo'qlar; bossangiz — agent tahlili va oyligi."),
      T("Карта: состав команды целиком — на связи, были раньше, без сигнала; маршрут за день, фото визитов, «подмена координат».", "Xarita: butun jamoa — aloqada, avval bo'lgan, signal yo'q; kunlik marshrut, tashrif fotolari, «soxta koordinatalar»."),
      T("Отчёты: обзор, продажи, агенты, долги; выгрузка в Excel и PDF. P&L: выручка минус возвраты, себестоимость, зарплата и расходы.", "Hisobotlar: umumiy ko'rinish, sotuvlar, agentlar, qarzlar; Excel va PDF'ga yuklab olish. P&L: tushum minus qaytarishlar, tannarx, oylik va xarajatlar."),
      T("Зарплаты: фонд за период, начислено/выдано, «Выдать всем»; настройки оклада, процента и вычетов.", "Oylik: davr uchun fond, hisoblangan/berilgan, «Hammaga berish»; maosh, foiz va ushlab qolishlar sozlamalari."),
      T("Пользователи: приглашения, роли, ограничения ролей по арендатору. Журнал действий: отмена заказа, сторно оплаты, смена лимита — кто и когда.", "Foydalanuvchilar: taklifnomalar, rollar, ijarachi bo'yicha rol cheklovlari. Amallar jurnali: buyurtmani bekor qilish, to'lov stornosi, limit o'zgarishi — kim va qachon."),
      T("Настройки: компания, склад, прайс-листы, Telegram, оформление, ключи API, 1С.", "Sozlamalar: kompaniya, ombor, narxnomalar, Telegram, ko'rinish, API kalitlari, 1C."),
    ]},
    {"t": "fig", "fig": ("web", "ceo", "salaries"), "cap": T("Зарплаты: фонд, выплачено / к выплате, «Выдать всем»", "Oylik: fond, to'langan / to'lanishi kerak, «Hammaga berish»"), "callouts": [("payAll", T("Выдать всем — сотрудники подтверждают получение на телефоне", "Hammaga berish — xodimlar olganini telefonda tasdiqlaydi"))]},
    {"t": "fig", "fig": ("web", "ceo", "reports-debts"), "cap": T("Долги: кто, сколько, как давно — строка ведёт в магазин", "Qarzlar: kim, qancha, qachondan beri — qator do'konga olib boradi"), "callouts": []},
  ]},

  {"id": "role-supervisor", "title": T("Супервайзер", "Supervayzer"), "blocks": [
    {"t": "role", "morning": T("Карта: кто вышел, кто без сигнала — позвонить", "Xarita: kim chiqqan, kim signalsiz — qo'ng'iroq qilish"), "day": T("Планы: перенести точку, закрыть визит за агента по звонку; KPI — кто отстаёт", "Rejalar: nuqtani ko'chirish, qo'ng'iroq bo'yicha agent o'rniga tashrifni yopish; KPI — kim orqada qolyapti"), "evening": T("«Как прошёл день»: время в точках, километры, замечания", "«Kun qanday o'tdi»: nuqtalardagi vaqt, kilometrlar, izohlar")},
    {"t": "fig", "fig": ("web", "supervisor", "map"), "cap": T("Карта: состав команды и состояния", "Xarita: jamoa tarkibi va holatlar"), "callouts": [("states", T("На связи / были раньше / без сигнала — фильтры", "Aloqada / avval bo'lgan / signal yo'q — filtrlar"))]},
    {"t": "steps", "items": [
      T("Месяц: «Планы» → «Месяц» → агент, территория, дни недели → «Расставить». Прошедшие дни не заполняются, чтобы не портить норму.", "Oy: «Rejalar» → «Oy» → agent, hudud, hafta kunlari → «Joylashtirish». O'tgan kunlar to'ldirilmaydi — norma buzilmasligi uchun."),
      T("День: список точек по агентам; «Посещён / Пропущен» — если агент отчитался по телефону; «Как прошёл день» — разбор по координатам.", "Kun: agentlar bo'yicha nuqtalar ro'yxati; «Tashrif qilindi / O'tkazib yuborildi» — agent telefon orqali hisobot bergan bo'lsa; «Kun qanday o'tdi» — koordinatalar bo'yicha tahlil."),
      T("Нормы: сколько визитов в месяц у агента; факт/план виден и агенту на телефоне.", "Normalar: agentda oyiga nechta tashrif; fakt/reja agentga ham telefonda ko'rinadi."),
    ]},
    {"t": "fig", "fig": ("web", "supervisor", "plans-month"), "cap": T("Планы на месяц одной кнопкой", "Oylik reja bitta tugma bilan"), "callouts": []},
    {"t": "fig", "fig": ("mobile", "supervisor", "map"), "cap": T("Телефон супервайзера: карта агентов", "Supervayzer telefoni: agentlar xaritasi"), "callouts": []},
  ]},

  {"id": "role-agent", "title": T("Торговый агент (телефон)", "Savdo agenti (telefon)"), "blocks": [
    {"t": "role", "morning": T("Главная: визиты на сегодня, долги — кому идти собирать", "Bosh sahifa: bugungi tashriflar, qarzlar — kimdan yig'ib kelish kerak"), "day": T("В точке: остаток и долг магазина, заказ за минуту, отметка визита", "Nuqtada: do'konning qoldig'i va qarzi, bir daqiqada buyurtma, tashrif belgisi"), "evening": T("Заказы: всё ли ушло; зарплата: сколько начислено", "Buyurtmalar: hammasi ketdimi; oylik: qancha hisoblangan")},
    {"t": "fig", "fig": ("mobile", "agent", "home"), "cap": T("Главная агента", "Agent bosh sahifasi"), "callouts": [("visits", T("Визиты сегодня — строка ведёт в магазин", "Bugungi tashriflar — qator do'konga olib boradi")), ("debts", T("Долги — кому идти собирать", "Qarzlar — kimdan yig'ib kelish kerak"))]},
    {"t": "steps", "items": [
      T("Магазины: ближайшие первыми, на карточке корзина — заказ в один тап. Новый магазин заводится прямо у точки.", "Do'konlar: eng yaqinlari birinchi, kartochkada savat — bir bosishda buyurtma. Yangi do'kon to'g'ridan-to'g'ri nuqtada kiritiladi."),
      T("Заказ: магазин → «Добавить товар» (поиск, сканер, «− n +», рядом остаток) → «Готово» → способ оплаты, обещанный срок → «Подтвердить заказ».", "Buyurtma: do'kon → «Mahsulot qo'shish» (qidiruv, skaner, «− n +», yonida qoldiq) → «Tayyor» → to'lov usuli, va'da qilingan muddat → «Buyurtmani tasdiqlash»."),
      T("Без связи: магазины и каталог берутся из копии на телефоне (с датой), заказ ложится в очередь и уходит сам; в «Заказах» такие заказы видны с пометкой «ожидает отправки».", "Aloqa bo'lmasa: do'konlar va katalog telefondagi nusxadan (sanasi bilan) olinadi, buyurtma navbatga tushadi va o'zi ketadi; «Buyurtmalar»da bunday buyurtmalar «yuborish kutilmoqda» belgisi bilan ko'rinadi."),
      T("Визит: «Готово» на плане (с фото или без). Долги: список должников и звонок; принять деньги за долг можно в вебе у оператора.", "Tashrif: rejada «Tayyor» (foto bilan yoki fotosiz). Qarzlar: qarzdorlar ro'yxati va qo'ng'iroq; qarz uchun pulni vebda operator qabul qiladi."),
    ]},
    {"t": "fig", "fig": ("mobile", "agent", "order-step1"), "cap": T("Шаг 1 — магазин", "1-qadam — do'kon"), "callouts": []},
    {"t": "fig", "fig": ("mobile", "agent", "orders"), "cap": T("Заказы, включая ожидающие отправки без связи", "Buyurtmalar, shu jumladan aloqasiz yuborishni kutayotganlari"), "callouts": []},
    {"t": "fig", "fig": ("mobile", "agent", "debts"), "cap": T("Долги магазинов агента", "Agent do'konlarining qarzlari"), "callouts": []},
    {"t": "warn", "x": T("Скидка выше порога, заданного директором, не оформится у прилавка: заказ уйдёт офису на подтверждение. Обещайте магазину то, что подтвердит офис.", "Direktor belgilagan chegaradan yuqori chegirma peshtaxta oldida rasmiylashmaydi: buyurtma tasdiqlash uchun ofisga ketadi. Do'konga ofis tasdiqlaydigan narsanigina va'da qiling.")},
  ]},

  {"id": "role-courier", "title": T("Курьер (телефон)", "Kuryer (telefon)"), "blocks": [
    {"t": "role", "morning": T("Доставки: «Выехал по всем»", "Yetkazishlar: «Hammasiga yo'lga chiqdim»"), "day": T("У точки: сумма наличных → «Доставлено»; недовоз — с причиной; частичное — «Оформить подробно»", "Nuqtada: naqd summa → «Yetkazildi»; yetkazilmasa — sababi bilan; qisman — «Batafsil rasmiylashtirish»"), "evening": T("Всё ли ушло на сервер; зарплата за довезённое", "Hammasi serverga ketdimi; yetkazilgan uchun oylik")},
    {"t": "fig", "fig": ("mobile", "courier", "deliveries"), "cap": T("Доставки курьера", "Kuryer yetkazishlari"), "callouts": [("all", T("Выехал по всем — одной кнопкой", "Hammasiga yo'lga chiqdim — bitta tugma bilan")), ("delivered", T("Доставлено — с суммой наличных", "Yetkazildi — naqd summasi bilan")), ("detail", T("Оформить подробно — частичная оплата, возврат, долг с датой", "Batafsil rasmiylashtirish — qisman to'lov, qaytarish, sanali qarz")), ("fail", T("Не доставлено — с причиной", "Yetkazilmadi — sababi bilan"))]},
    {"t": "fig", "fig": ("mobile", "courier", "deliver"), "cap": T("Оформить подробно: результат, оплата, возврат по позициям", "Batafsil rasmiylashtirish: natija, to'lov, pozitsiyalar bo'yicha qaytarish"), "callouts": [("result", T("Частичный возврат — вместе с деньгами за оставшееся", "Qisman qaytarish — qolgani uchun pul bilan birga")), ("submit", T("Завершить доставку", "Yetkazishni yakunlash"))]},
    {"t": "bullets", "items": [
      T("Без связи все отметки записываются на телефон и уходят сами; заказ с отложенным «выехал» показывается «в пути» со всеми кнопками.", "Aloqa bo'lmasa barcha belgilar telefonga yoziladi va o'zi ketadi; «yo'lga chiqdim» kechiktirilgan buyurtma barcha tugmalari bilan «yo'lda» deb ko'rsatiladi."),
      T("Отметку, которую сервер отклонил (заказ уже закрыт офисом), видно с причиной и кнопками «Повторить / Убрать».", "Server rad etgan belgi (buyurtma ofis tomonidan allaqachon yopilgan) sababi va «Qayta yuborish / Olib tashlash» tugmalari bilan ko'rinadi."),
      T("Деньги: наличные и карта записываются на заказ; долг магазина уменьшается на оплаченное. Дата обещанной доплаты пишется как привыкли — 15.09.2026.", "Pul: naqd va karta buyurtmaga yoziladi; do'kon qarzi to'langan summaga kamayadi. Va'da qilingan qo'shimcha to'lov sanasi odatdagidek yoziladi — 15.09.2026."),
    ]},
  ]},

  {"id": "role-merch", "title": T("Мерчандайзер (телефон)", "Merchandayzer (telefon)"), "blocks": [
    {"t": "role", "morning": T("План на день", "Kunlik reja"), "day": T("В точке: «Готово» → фото полки, отметки по товарам, заметки → «Завершить визит»", "Nuqtada: «Tayyor» → javon fotosi, mahsulotlar bo'yicha belgilar, izohlar → «Tashrifni yakunlash»"), "evening": T("Все визиты отмечены, отчёты ушли", "Barcha tashriflar belgilangan, hisobotlar ketgan")},
    {"t": "fig", "fig": ("mobile", "merchandiser", "plan"), "cap": T("План мерчандайзера", "Merchandayzer rejasi"), "callouts": [("done", T("Готово — открывает отчёт о визите", "Tayyor — tashrif hisobotini ochadi"))]},
    {"t": "fig", "fig": ("mobile", "merchandiser", "visit-report"), "cap": T("Отчёт о визите: фото, чек-лист, заметки", "Tashrif hisoboti: foto, nazorat ro'yxati, izohlar"), "callouts": []},
  ]},

  # ─────────────────────────────────── 3. Деньги и остаток — как считает система
  {"id": "money", "title": T("Часть 3. Деньги и остаток — как система считает", "3-qism. Pul va qoldiq — tizim qanday hisoblaydi"), "blocks": [
    {"t": "p", "x": T("Цифры на экранах директора честные только тогда, когда команда понимает, что за ними стоит. Эта глава — для владельца и бухгалтера.", "Direktor ekranlaridagi raqamlar faqat jamoa ularning ortida nima turganini tushungandagina halol bo'ladi. Bu bob — egasi va buxgalter uchun.")},
    {"t": "h3", "x": T("Путь заказа и остаток", "Buyurtma yo'li va qoldiq")},
    {"t": "table", "header": [T("Статус", "Holat"), T("Что произошло", "Nima bo'ldi"), T("Остаток", "Qoldiq"), T("Долг магазина", "Do'kon qarzi")], "rows": [
      [T("Новый", "Yangi"), T("Заказ оформлен агентом или оператором", "Buyurtma agent yoki operator tomonidan rasmiylashtirildi"), T("Резерв: свободно уменьшилось, на складе — нет", "Zaxira: mavjud kamaydi, ombordagi — yo'q"), T("—", "—")],
      [T("Ожидает", "Kutishda"), T("Скидка выше порога или лимит — ждёт офиса", "Chegaradan yuqori chegirma yoki limit — ofisni kutmoqda"), T("Резерв", "Zaxira"), T("—", "—")],
      [T("В обработке", "Jarayonda"), T("Офис принял, лист собирается", "Ofis qabul qildi, varaqa yig'ilmoqda"), T("Резерв", "Zaxira"), T("—", "—")],
      [T("Отгружен", "Yuklandi"), T("Товар уехал", "Tovar jo'nadi"), T("Списан со склада по партиям (FEFO)", "Ombordan partiyalar bo'yicha hisobdan chiqarildi (FEFO)"), T("—", "—")],
      [T("Доставлен", "Yetkazildi"), T("Курьер отчитался", "Kuryer hisobot berdi"), T("—", "—"), T("+ сумма заказа − оплата; частичная доставка — по довезённому", "+ buyurtma summasi − to'lov; qisman yetkazish — yetkazilgani bo'yicha")],
      [T("Отменён / Возвращён", "Bekor qilindi / Qaytarildi"), T("Заказ снят или вернулся", "Buyurtma olib tashlandi yoki qaytdi"), T("Резерв снят / товар вернулся", "Zaxira olindi / tovar qaytdi"), T("Долг снят", "Qarz olib tashlandi")],
    ]},
    {"t": "p", "x": T("FEFO: при отгрузке первой уходит партия, у которой раньше срок; просроченная в отгрузку не берётся — только в списание. Сборка листа показывает те же партии заранее, чтобы склад брал именно их.", "FEFO: yuklashda muddati oldinroq tugaydigan partiya birinchi ketadi; muddati o'tgani yuklashga olinmaydi — faqat hisobdan chiqarishga. Varaqani yig'ish o'sha partiyalarni oldindan ko'rsatadi — ombor aynan ularni olishi uchun.")},
    {"t": "h3", "x": T("Долг магазина — два правила", "Do'kon qarzi — ikki qoida")},
    {"t": "bullets", "items": [
      T("Долг считается по заказу: сумма доставленного минус оплаты по этому заказу. Оплата больше остатка по заказу ложится на магазин отдельной строкой — переплата не теряется.", "Qarz buyurtma bo'yicha hisoblanadi: yetkazilgan summa minus shu buyurtma bo'yicha to'lovlar. Buyurtma qoldig'idan ortiq to'lov do'konga alohida qator bo'lib yoziladi — ortiqcha to'lov yo'qolmaydi."),
      T("Возврат по заказу уменьшает долг этого заказа; возврат за период уменьшает выручку периода. Одно и то же событие не считается дважды.", "Buyurtma bo'yicha qaytarish shu buyurtma qarzini kamaytiradi; davr bo'yicha qaytarish davr tushumini kamaytiradi. Bitta hodisa ikki marta hisoblanmaydi."),
      T("Кредитный лимит: заказ в долг сверх лимита уходит офису на подтверждение. Стартовый долг задаётся при заведении магазина.", "Kredit limiti: limitdan oshgan qarzga buyurtma tasdiqlash uchun ofisga ketadi. Boshlang'ich qarz do'konni kiritishda belgilanadi."),
    ]},
    {"t": "h3", "x": T("Зарплата", "Oylik")},
    {"t": "bullets", "items": [
      T("Агент: оклад + процент от продаж (по умолчанию организации или по товару) − вычеты (предлагаются за подозрительные визиты — решает директор).", "Agent: maosh + sotuvdan foiz (tashkilot bo'yicha sukut yoki mahsulot bo'yicha) − ushlab qolishlar (shubhali tashriflar uchun taklif qilinadi — direktor hal qiladi)."),
      T("Курьер: за штуку или процентом от довезённого — способ задаётся по человеку.", "Kuryer: donasiga yoki yetkazilgandan foiz — usul har bir odam uchun alohida belgilanadi."),
      T("Обед и дорожные — за рабочий день; в P&L идёт выданное, а не начисленное.", "Tushlik va yo'l puli — ish kuni uchun; P&L'ga hisoblangani emas, berilgani kiradi."),
      T("«Выдать всем» записывает выплату; сотрудник видит её на телефоне и подтверждает «Получил».", "«Hammaga berish» to'lovni yozadi; xodim uni telefonda ko'radi va «Oldim» deb tasdiqlaydi."),
    ]},
    {"t": "h3", "x": T("P&L и журнал действий", "P&L va amallar jurnali")},
    {"t": "p", "x": T("P&L считает выручку за вычетом возвратов, себестоимость по партиям (или по товару, если у партии нет цены), выданную зарплату и расходы. Журнал действий хранит, кто и когда отменил заказ, сделал сторно оплаты, поменял лимит или цену — с фильтрами «Заказы», «Оплаты», «Магазины». Спорный вопрос с сотрудником решается за минуту.", "P&L qaytarishlar chegirilgan tushumni, partiyalar bo'yicha tannarxni (partiyada narx bo'lmasa — mahsulot bo'yicha), berilgan oylik va xarajatlarni hisoblaydi. Amallar jurnali kim va qachon buyurtmani bekor qilgani, to'lovni storno qilgani, limit yoki narxni o'zgartirganini saqlaydi — «Buyurtmalar», «To'lovlar», «Do'konlar» filtrlari bilan. Xodim bilan bahsli masala bir daqiqada hal bo'ladi.")},
  ]},

  # ─────────────────────────────────────────────── 4. Что делать, если
  {"id": "faq", "title": T("Часть 4. Что делать, если", "4-qism. Agar … bo'lsa, nima qilish kerak"), "blocks": [
    {"t": "table", "header": [T("Ситуация", "Vaziyat"), T("Что делать", "Nima qilish kerak")], "rows": [
      [T("Агент говорит: «заказ не ушёл»", "Agent aytadi: «buyurtma ketmadi»"), T("На телефоне «Заказы» → карточка «ожидает отправки» — уйдёт при связи. Если «сервер отклонил» — причина написана: чаще всего остатка не хватило, оператор проверяет склад.", "Telefonda «Buyurtmalar» → «yuborish kutilmoqda» kartochkasi — aloqa paydo bo'lganda ketadi. Agar «server rad etdi» bo'lsa — sababi yozilgan: ko'pincha qoldiq yetmagan, operator omborni tekshiradi.")],
      [T("Заказ висит в «Ожидает»", "Buyurtma «Kutishda»da turibdi"), T("Скидка выше порога или превышен лимит: оператор открывает панель заказа → «Подтвердить» или «Отклонить».", "Chegaradan yuqori chegirma yoki limit oshgan: operator buyurtma panelini ochadi → «Tasdiqlash» yoki «Rad etish».")],
      [T("Склад собрал меньше, чем в листе", "Ombor varaqadagidan kam yig'di"), T("Это недостача при сборке: она записана в строках листа и в уведомлении. Проверьте остаток и партии на «Складе», при расхождении — инвентаризация.", "Bu yig'ishdagi kamomad: u varaqa qatorlarida va bildirishnomada yozilgan. «Ombor»da qoldiq va partiyalarni tekshiring, farq bo'lsa — inventarizatsiya.")],
      [T("Курьер привёз меньше или магазин вернул часть", "Kuryer kam olib keldi yoki do'kon bir qismini qaytardi"), T("Курьер оформляет «подробно»: возврат по позициям и оплата за оставшееся. Долг считается по довезённому.", "Kuryer «batafsil» rasmiylashtiradi: pozitsiyalar bo'yicha qaytarish va qolgani uchun to'lov. Qarz yetkazilgani bo'yicha hisoblanadi.")],
      [T("Магазин не находится в поиске", "Do'kon qidiruvda topilmayapti"), T("Ищите по владельцу или телефону; проверьте, что магазин не в архиве.", "Egasi yoki telefon bo'yicha qidiring; do'kon arxivda emasligini tekshiring.")],
      [T("Просрочка на складе", "Omborda muddati o'tgan tovar"), T("«Отчёты по складу» → сгорает / просрочено; списать через инвентаризацию или возврат поставщику. В отгрузку просроченное не уйдёт.", "«Ombor hisobotlari» → muddati tugayapti / o'tgan; inventarizatsiya yoki yetkazib beruvchiga qaytarish orqali hisobdan chiqaring. Muddati o'tgani yuklashga ketmaydi.")],
      [T("Нужно отменить или исправить заказ", "Buyurtmani bekor qilish yoki tuzatish kerak"), T("До отгрузки — правка состава в панели заказа или отмена; после — корректировка с причиной. Всё остаётся в журнале действий.", "Yuklashgacha — buyurtma panelida tarkibni tahrirlash yoki bekor qilish; keyin — sababi bilan tuzatish. Hammasi amallar jurnalida qoladi.")],
      [T("Сотрудник забыл пароль", "Xodim parolni unutdi"), T("«Забыли пароль» на экране входа — письмо на e-mail. Директор может выслать приглашение заново из «Пользователей».", "Kirish ekranida «Parolni unutdingizmi» — e-mailga xat keladi. Direktor «Foydalanuvchilar»dan taklifnomani qayta yuborishi mumkin.")],
      [T("Нет карты у супервайзера", "Supervayzerda xarita yo'q"), T("У агента не разрешена геолокация «всегда» или выключен GPS. «Без сигнала» на карте — позвоните агенту.", "Agentda geolokatsiyaga «har doim» ruxsat berilmagan yoki GPS o'chirilgan. Xaritada «Signal yo'q» — agentga qo'ng'iroq qiling.")],
      [T("Не хватает функции в тарифе", "Tarifda funksiya yetishmayapti"), T("Пробный период даёт все функции. Границы платных отчётов (P&L, KPI, долги) — по тарифу; обратитесь к поставщику.", "Sinov davri barcha funksiyalarni beradi. Pullik hisobotlar (P&L, KPI, qarzlar) chegaralari — tarif bo'yicha; yetkazib beruvchiga murojaat qiling.")],
      [T("Как поменять язык", "Tilni qanday almashtirish"), T("Веб: РУС / UZB внизу меню. Телефон: Профиль → Язык.", "Veb: menyuning pastida РУС / UZB. Telefon: Profil → Til.")],
    ]},
  ]},

  # ─────────────────────────────────────────────── 5. Глоссарий
  {"id": "glossary", "title": T("Словарь терминов", "Atamalar lug'ati"), "blocks": [
    {"t": "table", "header": [T("Русский", "Ruscha"), T("O'zbekcha", "O'zbekcha"), T("Что это", "Bu nima")], "rows": [
      [T("Заказ", "Заказ"), T("Buyurtma", "Buyurtma"), T("Заявка магазина, оформленная агентом или оператором", "Agent yoki operator rasmiylashtirgan do'kon so'rovi")],
      [T("Погрузочный лист", "Погрузочный лист"), T("Yuklash varaqasi", "Yuklash varaqasi"), T("Задание складу и рейс курьера из нескольких заказов", "Bir nechta buyurtmadan iborat omborga topshiriq va kuryer reysi")],
      [T("Сборка", "Сборка"), T("Yig'ish", "Yig'ish"), T("Подтверждение по строкам, сколько собрано", "Qatorma-qator qancha yig'ilganini tasdiqlash")],
      [T("Партия / срок", "Партия / срок"), T("Partiya / muddat", "Partiya / muddat"), T("Порция товара с одним сроком годности; FEFO отдаёт первой ту, что раньше сгорает", "Bitta yaroqlilik muddatiga ega tovar qismi; FEFO muddati oldin tugaydiganini birinchi beradi")],
      [T("Резерв", "Резерв"), T("Zaxira", "Zaxira"), T("Остаток, занятый открытыми заказами", "Ochiq buyurtmalar band qilgan qoldiq")],
      [T("Долг", "Долг"), T("Qarz", "Qarz"), T("Что магазин должен за доставленное минус оплаты", "Do'konning yetkazilgan tovar uchun qarzi minus to'lovlar")],
      [T("Кредитный лимит", "Кредитный лимит"), T("Kredit limiti", "Kredit limiti"), T("Потолок долга, выше которого заказ подтверждает офис", "Qarz chegarasi; undan yuqorida buyurtmani ofis tasdiqlaydi")],
      [T("Визит", "Визит"), T("Tashrif", "Tashrif"), T("Посещение точки агентом или мерчандайзером по плану", "Agent yoki merchandayzerning reja bo'yicha nuqtaga borishi")],
      [T("Норма", "Норма"), T("Norma", "Norma"), T("Сколько визитов в месяц должен сделать агент", "Agent oyiga nechta tashrif qilishi kerak")],
      [T("Приход", "Приход"), T("Kirim", "Kirim"), T("Поступление товара на склад от поставщика", "Yetkazib beruvchidan omborga tovar kelishi")],
      [T("Возврат", "Возврат"), T("Qaytarish", "Qaytarish"), T("Товар от магазина обратно на склад или в списание", "Do'kondan tovarning omborga qaytishi yoki hisobdan chiqarilishi")],
      [T("KPI", "KPI"), T("KPI", "KPI"), T("Показатели агента: продажи, визиты, план, балл", "Agent ko'rsatkichlari: sotuvlar, tashriflar, reja, ball")],
    ]},
  ]},
  ],
}
