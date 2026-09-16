# Обмен с 1С — что нужно от вашей 1С

Warehouse Pro обменивается с 1С по **стандартному интерфейсу OData платформы
8.3**. Ничего дописывать в конфигурацию не нужно: достаточно опубликовать базу
на веб-сервере и разрешить OData для нескольких объектов. Поддерживается
**1С:Бухгалтерия 8 для Узбекистана (ред. 3.0)** — это пресет по умолчанию;
1С:Управление торговлей 11 и «своя конфигурация» — через переопределение имён.

## Что делает обмен

| Направление | Что | Как часто |
|---|---|---|
| 1С → Warehouse Pro | Номенклатура (без папок и помеченных на удаление): название, артикул, единица измерения, цена выбранного *типа цен* | по расписанию и по кнопке |
| 1С → Warehouse Pro | Контрагенты — для связи с магазинами (по названию и телефону, остальное руками) | по расписанию и по кнопке |
| Warehouse Pro → 1С | Доставленный заказ → **Реализация товаров и услуг**, проведённая; при частичной доставке — только довезённое | по расписанию, через журнал с повторами |
| Warehouse Pro → 1С | Оплата магазина **наличными** → **Приходный кассовый ордер** (если включено) | по расписанию |
| 1С → Warehouse Pro | **Поступления на расчётный счёт** — только чтение: перевод или карта, записанные агентом, считаются пришедшими, когда в 1С есть проведённое поступление от того же контрагента на ту же сумму (если включены оплаты) | по расписанию и по кнопке «Выгрузить очередь сейчас» |

Выгружаются только заказы, доставленные **после** подключения 1С: прошлые
периоды бухгалтер разбирает сам.

Безнал в 1С **не создаётся**: он приходит из выписки банка, как всегда.
Warehouse Pro лишь сверяет свои переводы с этими поступлениями и ставит
«пришло» с номером документа 1С — в кассе, вкладка «Безнал». Перевод одной
суммой за несколько накладных автоматически не подбирается: кассир
подтверждает его вручную.

## Шаг 1. Публикация базы с OData

На сервере с 1С (Apache или IIS), в Конфигураторе: **Администрирование →
Публикация на веб-сервере**. Поставьте галочку **«Публиковать стандартный
интерфейс OData»** и укажите имя публикации, например `buh`. После публикации
проверьте в браузере:

```
https://ваш-сервер/buh/odata/standard.odata/$metadata
```

Должен открыться XML со структурой базы (после ввода логина и пароля).
Адрес публикации (`https://ваш-сервер/buh`) — это то, что вводится в
Warehouse Pro; `/odata/standard.odata` допишется само.

Сервер должен быть доступен из интернета (Warehouse Pro работает в облаке).
Обязательно HTTPS — по HTTP пароль 1С уходит открытым текстом.

## Шаг 2. Состав OData

В режиме 1С:Предприятие: **Администрирование → Настройки программы →
Общие настройки → (Интеграция) → Настройка автоматического REST-сервиса**
(в старых версиях — обработка «Настройка состава стандартного интерфейса
OData»). Включите объекты:

Справочники: `Номенклатура`, `КлассификаторЕдиницИзмерения`, `ТипыЦенНоменклатуры`,
`Контрагенты`, `ДоговорыКонтрагентов`, `Организации`, `Склады`.
Регистр сведений: `ЦеныНоменклатуры`.
Документы: `РеализацияТоваровУслуг`, `ПриходныйКассовыйОрдер` и
`ПоступлениеНаРасчетныйСчет` (последние два — если нужны оплаты).

Для Управления торговлей 11 вместо `ТипыЦенНоменклатуры` — `ВидыЦен`, вместо
`ЦеныНоменклатуры` — `ЦеныНоменклатуры25`, вместо `ПоступлениеНаРасчетныйСчет`
— `ПоступлениеБезналичныхДенежныхСредств`; договоры не нужны.

## Шаг 3. Пользователь 1С для обмена

Заведите отдельного пользователя (например, `warehousepro`) с аутентификацией
1С:Предприятия (логин и пароль), без входа в интерфейс. Права:

- чтение всех перечисленных справочников и регистра цен;
- запись в `Контрагенты` и `ДоговорыКонтрагентов` (создание контрагента по
  карточке магазина и договора «Основной договор» — если их нет);
- добавление и **проведение** `РеализацияТоваровУслуг` и
  `ПриходныйКассовыйОрдер`;
- **чтение** `ПоступлениеНаРасчетныйСчет` — записывать в него обмен не будет.

Проще всего — роль «Полные права» для этого пользователя, если политика
безопасности допускает; иначе набор ролей «Добавление/изменение… продаж»
плюс чтение справочников.

## Шаг 4. В Warehouse Pro

**Настройки → 1С** (только директор):

1. Адрес публикации, пользователь, пароль, конфигурация → **Проверить связь**.
   Проверка сверяет имена объектов пресета с `$metadata` вашей базы и
   перечисляет расхождения: «набора нет» — объект не включён в состав OData
   (шаг 2) либо называется иначе; «поля нет» — иная редакция конфигурации.
2. Выберите **организацию**, **склад** (откуда 1С списывает товар) и
   **тип цен** (откуда берутся цены номенклатуры). Списки читаются из 1С.
3. Включите обмен по расписанию и сохраните.
4. **Магазины ↔ контрагенты**: «Сопоставить по названию и телефону», затем
   для оставшихся — «Найти в 1С» или «Создать в 1С».
5. **Загрузить номенклатуру из 1С** — товары появятся в Warehouse Pro с
   нулевым остатком; остатки заводите приходом.

Дальше заказы после доставки сами встают в очередь и уезжают в 1С. Отказ
виден в **журнале обмена** с причиной: обмен повторит попытку через 5, 15,
45 минут, 2 и 6 часов, потом ждёт кнопки «Повторить». Заказ, который
возвращали в работу после выгрузки, очередь **не** перепроводит — он
помечается «ждёт решения»: разберите прежний документ в 1С и выгрузите
заказ заново из его карточки.

## Своя конфигурация

Если объекты называются иначе, выберите «Своя конфигурация» и задайте
переопределения в JSON поверх пресета Бухгалтерии, например:

```json
{
  "sale": { "set": "Document_РеализацияТоваровУслуг", "fields": { "operation": null } },
  "prices": { "set": "InformationRegister_ЦеныНоменклатуры", "type": "ТипЦен_Key" },
  "contracts": null
}
```

`null` отключает поле или объект (например, `contracts: null` — договор в
реализацию не подставляется). Полный список имён — `api/lib/onec-presets.ts`.

---

# 1C bilan almashinuv — sizning 1C dan nima kerak

Warehouse Pro 1C bilan **8.3 platformasining standart OData interfeysi** orqali
ma'lumot almashadi. Konfiguratsiyaga hech narsa yozish shart emas: bazani
veb-serverda nashr etish va bir nechta obyekt uchun OData ni yoqish kifoya.
Asosiy preset — **1C:Buxgalteriya 8 O'zbekiston uchun (3.0)**; UT 11 va
«o'z konfiguratsiyasi» — nomlarni almashtirish orqali.

## Almashinuv nima qiladi

| Yo'nalish | Nima | Qachon |
|---|---|---|
| 1C → Warehouse Pro | Nomenklatura (papkalar va o'chirishga belgilanganlarsiz): nom, artikul, o'lchov birligi, tanlangan *narx turi* bo'yicha narx | jadval bo'yicha va tugma bilan |
| 1C → Warehouse Pro | Kontragentlar — do'konlar bilan bog'lash uchun (nom va telefon bo'yicha, qolgani qo'lda) | jadval bo'yicha va tugma bilan |
| Warehouse Pro → 1C | Yetkazilgan buyurtma → o'tkazilgan **Tovar va xizmatlar sotuvi**; qisman yetkazilganda — faqat yetkazilgani | jadval bo'yicha, qayta urinishli jurnal orqali |
| Warehouse Pro → 1C | Do'kon **naqd** to'lovi → **Kirim kassa orderi** (yoqilgan bo'lsa) | jadval bo'yicha |
| 1C → Warehouse Pro | **Hisob-raqamga tushumlar** — faqat o'qish: agent yozgan o'tkazma yoki karta 1C da o'sha kontragentdan o'sha summaga o'tkazilgan tushum bo'lsa «keldi» hisoblanadi (to'lovlar yoqilgan bo'lsa) | jadval bo'yicha va «Navbatni hozir yuklash» tugmasi bilan |

Faqat 1C ulangandan **keyin** yetkazilgan buyurtmalar yuklanadi.

Naqdsiz to'lov 1C da **yaratilmaydi**: u har doimgidek bank ko'chirmasidan
keladi. Warehouse Pro faqat o'z o'tkazmalarini shu tushumlar bilan
solishtiradi va 1C hujjat raqami bilan «keldi» qo'yadi — kassa, «Naqdsiz»
bo'limi. Bir necha nakladnoy uchun bitta summa bilan o'tkazma avtomatik
topilmaydi: kassir uni qo'lda tasdiqlaydi.

## 1-qadam. Bazani OData bilan nashr etish

1C serverida (Apache yoki IIS), Konfiguratorda: **Administrirovanie →
Veb-serverda nashr etish**. **«Standart OData interfeysini nashr etish»**
belgisini qo'ying, nashr nomini bering (masalan `buh`). Brauzerda tekshiring:

```
https://server/buh/odata/standard.odata/$metadata
```

Login-parol so'ralgach, baza tuzilmasi XML ko'rinishida ochilishi kerak.
Warehouse Pro ga `https://server/buh` kiritiladi. Server internetdan ochiq
bo'lishi va HTTPS bo'lishi shart.

## 2-qadam. OData tarkibi

1C:Korxona rejimida: **Administrirovanie → Dastur sozlamalari → Umumiy →
Avtomatik REST-servis sozlamasi** (eski versiyalarda — «Standart OData
interfeysi tarkibini sozlash» ishlovi). Yoqing:

Ma'lumotnomalar: `Номенклатура`, `КлассификаторЕдиницИзмерения`,
`ТипыЦенНоменклатуры`, `Контрагенты`, `ДоговорыКонтрагентов`, `Организации`,
`Склады`. Ma'lumot registri: `ЦеныНоменклатуры`. Hujjatlar:
`РеализацияТоваровУслуг`, `ПриходныйКассовыйОрдер` va
`ПоступлениеНаРасчетныйСчет` (oxirgi ikkitasi — to'lovlar kerak bo'lsa).

## 3-qadam. Almashinuv uchun 1C foydalanuvchisi

Alohida foydalanuvchi (masalan `warehousepro`), 1C autentifikatsiyasi bilan.
Huquqlar: sanab o'tilgan ma'lumotnomalar va narx registrini o'qish;
`Контрагенты` va `ДоговорыКонтрагентов` ga yozish; `РеализацияТоваровУслуг`
va `ПриходныйКассовыйОрдер` ni qo'shish va **o'tkazish**;
`ПоступлениеНаРасчетныйСчет` ni **o'qish** (almashinuv unga yozmaydi). Eng
oson — «To'liq huquqlar» roli.

## 4-qadam. Warehouse Pro da

**Sozlamalar → 1C** (faqat direktor):

1. Nashr manzili, foydalanuvchi, parol, konfiguratsiya → **Aloqani tekshirish**.
   Tekshiruv preset nomlarini bazangiz `$metadata` si bilan solishtiradi va
   farqlarni sanaydi: «to'plam yo'q» — obyekt OData tarkibiga kiritilmagan
   (2-qadam) yoki nomi boshqa; «maydon yo'q» — konfiguratsiya tahriri boshqa.
2. **Tashkilot**, **ombor** va **narx turi** ni tanlang — ro'yxatlar 1C dan.
3. Jadval bo'yicha almashinuvni yoqing va saqlang.
4. **Do'konlar ↔ kontragentlar**: «Nom va telefon bo'yicha moslash», qolganlari
   uchun — «1C dan topish» yoki «1C da yaratish».
5. **1C dan nomenklaturani yuklash** — tovarlar nol qoldiq bilan paydo bo'ladi.

Keyin buyurtmalar yetkazilgach, o'zi navbatga tushadi va 1C ga ketadi. Xato —
**almashinuv jurnalida** sababi bilan; 5, 15, 45 daqiqa, 2 va 6 soatdan keyin
qayta urinadi, so'ng «Qayta» tugmasini kutadi. Yuklangandan keyin ishga
qaytarilgan buyurtmani navbat qayta o'tkazmaydi — «qaror kutmoqda» belgisi
qo'yiladi: 1C dagi eski hujjatni hal qiling va buyurtmani kartochkasidan
qaytadan yuklang.
