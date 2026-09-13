# Warehouse Pro — rollar bo'yicha qo'llanma

Suratlar haqiqiy ilovadan namunaviy ma'lumotlarda olingan («Demo UZ» tashkiloti). Ruscha: README.md, o'zbekcha: README.uz.md.

## Mundarija
- [Qanday boshlash](#start)
- [Ofis operatori va ombor](#operator)
- [Direktor](#ceo)
- [Supervayzer](#supervisor)
- [Savdo agenti (telefon)](#agent)
- [Kuryer (telefon)](#courier)
- [Merchandayzer (telefon)](#merchandiser)

<a id="start"></a>
## Qanday boshlash

Kirish barcha rollar uchun bir xil: kompaniya manzili, e-mail va parol. Kirgandan so'ng har kim faqat o'z ekranlarini ko'radi. Til menyuning pastida (veb) yoki profilda (telefon) almashtiriladi.

1. Veb: kompaniya manzilini oching, e-mail va parolni kiriting. Ikki bosqichli himoya yoqilgan bo'lsa — ilovadagi kod.

   ![Qanday boshlash — 1](img/web/uz/login/login.webp)

2. Telefon: o'sha e-mail va parol. Ilova kirishni eslab qoladi; qayta kirish — barmoq izi yoki Face ID orqali.

   ![Qanday boshlash — 2](img/mobile/uz/agent/login.webp)

3. Til: vebda — menyu pastidagi РУС / UZB tugmalari; telefonda — Profil → Til.

   ![Qanday boshlash — 3](img/mobile/uz/agent/profile.webp)

<a id="operator"></a>
## Ofis operatori va ombor

Operator «Buyurtmalar»da ishlaydi: agentlarning buyurtmalarini qabul qilib tekshiradi, yuklash varaqalarini yig'adi, reyslarni kuryerlarga beradi, kirim va qaytarishlarni o'tkazadi.

1. Buyurtmalar. Bir qatorli xulosa — har bir raqam filtr: «Kutmoqda» — ofis qarorini kutayotgan buyurtmalar (masalan, chegirma chegaradan yuqori). Qatorga bosilsa buyurtma paneli ochiladi; kutayotgan buyurtmada — sabab va «Tasdiqlash / Rad etish» tugmalari.

   ![Ofis operatori va ombor — 1](img/web/uz/operator/orders.webp)

2. Qo'ng'iroq bo'yicha yangi buyurtma: do'kon (nomi, egasi, telefoni bo'yicha qidiruv; yonida qarz), tovarlar («bo'sh N» ko'rinadi), to'lov usuli — tayyor.

   ![Ofis operatori va ombor — 2](img/web/uz/operator/order-new.webp)

3. Yuklash varaqasi: buyurtmalarni belgilang → «Yuklash varaqalari» → «Varaqa tuzish» → chop etish. Varaqa yopilguncha o'z buyurtmalarini ushlab turadi; ularni ikkinchi marta yig'ib bo'lmaydi.

4. Qatorlar bo'yicha yig'ish: varaqalar ro'yxatida «tayyorlanmoqda» varaqada — «Yig'ish» tugmasi. Qatorlar: kerak / partiyalar (FEFO bo'yicha — jo'natishda hisobdan chiqariladigan o'shalar) / yig'ildi. Kerakdan kam — kamomad: u ro'yxatda ko'rinadi va ofisga bildirishnoma bo'lib boradi. So'ng — butun varaqaga bitta tanlov bilan kuryer.

5. Tovar kirimi: «Kirim» → yangi nakladnoy, tovar kodi yoki skaner bilan, partiya va yaroqlilik muddati → «Saqlash va yakunlash». Qoldiq faqat yakunlangandan keyin o'zgaradi.

   ![Ofis operatori va ombor — 5](img/web/uz/operator/arrivals.webp)

6. Ombor: qoldiqlar, partiyalar va muddatlar; «Ombor hisobotlari» — nima yaroqsiz bo'lmoqda. Do'konlardan qaytarishlarni ofis o'tkazadi; yetkazib beruvchiga qaytarish — «Kirim»dagi yetkazib beruvchi kartasidan.

   ![Ofis operatori va ombor — 6](img/web/uz/operator/warehouse.webp)

7. Shtrix-kodlar: tovarlarga va kirim bo'yicha yorliqlar chop etish; skaner-klaviatura tovar qidiruvi bor har joyda ishlaydi («kod + Enter»).

   ![Ofis operatori va ombor — 7](img/web/uz/operator/barcode.webp)

<a id="ceo"></a>
## Direktor

Direktorning beshta savoli — birinchi ekranda: bugun qancha sotildi va yetkazildi, kim qarzdor, omborda nima yaroqsiz bo'lmoqda, agentlardan kim ishlamayapti, oylik bilan nima gap.

1. Bosh sahifa: bugungi tushum va buyurtmalar (strelka — kechaga nisbatan), «yetkazildi N / M», mijozlar qarzi, marja. Pastdagi ogohlantirishlar bosiladi: muddati o'tgan — ombor hisobotlariga, qarz — «Qarzlar»ga.

   ![Direktor — 1](img/web/uz/ceo/dashboard.webp)

2. Agentlar KPI: ballar, sotuvlar, tashriflar jadvali; agentga bosilsa — tahlil va uning davr uchun oyligi. «GPS» ustuni — kimning xaritada izi yo'q.

   ![Direktor — 2](img/web/uz/ceo/kpi.webp)

3. Xarita: kim aloqada, kim oldin bo'lgan, kim signalsiz; agentning kunlik yo'nalishi, tashrif fotolari, «koordinatalar almashtirilgan» — qizil.

   ![Direktor — 3](img/web/uz/ceo/map.webp)

4. Hisobotlar va qarzlar: «Qarzlar» — kim, qancha va qachondan beri; qator do'kon kartasiga olib boradi. P&L — davr uchun foyda yoki zarar.

   ![Direktor — 4](img/web/uz/ceo/reports-debts.webp)

5. Oyliklar: fond, hisoblangan va berilgan; «Hammaga berish» — xodim telefonda olganini tasdiqlaydi. Maosh va foizlar sozlamasi — o'sha yerda.

   ![Direktor — 5](img/web/uz/ceo/salaries.webp)

6. Foydalanuvchilar va amallar jurnali: kim nima qildi — buyurtma bekor qilindi, to'lov storno qilindi, limit o'zgardi; «Buyurtmalar / To'lovlar / Do'konlar» filtrlari.

   ![Direktor — 6](img/web/uz/ceo/audit-log.webp)

<a id="supervisor"></a>
## Supervayzer

Ertalab — xarita: kim ishga chiqdi. Oy — bitta tugma bilan tashrif rejalari. Kechqurun — koordinatalar bo'yicha kun tahlili.

1. Xarita (veb): butun jamoa — «Aloqada / Oldin bo'lgan / Signalsiz»; har birida — kunlik aylanish x/y va norma foizi.

   ![Supervayzer — 1](img/web/uz/supervisor/map.webp)

2. Rejalar: «Oy» bo'limi — agent, hudud, hafta kunlari → «Joylashtirish»; «Kun» bo'limi — «Kun qanday o'tdi»: nuqtalardagi vaqt, kilometrlar, izohlar.

   ![Supervayzer — 2](img/web/uz/supervisor/plans.webp)

3. Telefon: «Xarita», «Rejalar», «Normalar» — yo'lda ham o'sha.

   ![Supervayzer — 3](img/mobile/uz/supervisor/map.webp)

<a id="agent"></a>
## Savdo agenti (telefon)

Kuniga 30–60 tashrif. Bosh sahifa — tashriflar va qarzlar; peshtaxta oldida bir daqiqada buyurtma; hammasi aloqasiz ishlaydi va o'zi jo'natiladi.

1. Bosh sahifa: bugungi tashriflar (qator do'konga olib boradi), «Qarzlar» plitkasi — kimdan undirish kerak, kunlik tushum va buyurtmalar.

   ![Savdo agenti (telefon) — 1](img/mobile/uz/agent/home.webp)

2. Do'konlar: yaqinlari birinchi, kartadagi savat — bir teginishda buyurtma. Yangi do'kon nuqtaning o'zida ochiladi.

   ![Savdo agenti (telefon) — 2](img/mobile/uz/agent/shops.webp)

3. Yangi buyurtma — uch qadam: do'kon → tovarlar (qidiruv, skaner, «− n +», qoldiq ko'rinadi) → to'lov va va'da qilingan muddat → Tasdiqlash.

   ![Savdo agenti (telefon) — 3](img/mobile/uz/agent/order-new.webp)

4. Aloqasiz: do'konlar ro'yxati va katalog telefondagi nusxadan olinadi (sanasi bilan), buyurtma navbatga tushadi va o'zi jo'natiladi. «Buyurtmalar»da kechiktirilganlar «jo'natish kutilmoqda» kartalari bilan ko'rinadi.

   ![Savdo agenti (telefon) — 4](img/mobile/uz/agent/orders.webp)

5. Reja: «Tayyor» tashrifni belgilaydi (foto bilan yoki fotosiz); aloqasiz belgi saqlanadi va o'zi ketadi. Qarzlar: qarzdorlar ro'yxati, bir teginishda qo'ng'iroq.

   ![Savdo agenti (telefon) — 5](img/mobile/uz/agent/debts.webp)

6. Oylik: davr uchun hisoblangan, qo'lga berilgan — «Oldim» to'lovni tasdiqlaydi.

   ![Savdo agenti (telefon) — 6](img/mobile/uz/agent/salary.webp)

<a id="courier"></a>
## Kuryer (telefon)

Ertalab — «Hammasiga yo'lga chiqdim». Nuqtada — naqd summa va «Yetkazildi», yoki sababi bilan «Yetkazilmadi», yoki qisman to'lov va qaytarish uchun «Batafsil rasmiylashtirish». Hammasi — aloqasiz.

1. Yetkazishlar: yuqorida «Kutmoqda N · Yo'lda M», «Hammasiga yo'lga chiqdim» tugmasi. Karta: manzil, «Xaritada» (koordinatalar bo'yicha yo'nalish), summa, buyurtma tarkibi.

   ![Kuryer (telefon) — 1](img/mobile/uz/courier/deliveries.webp)

2. Qisman qaytarish pul bilan birga rasmiylashtiriladi: qaysi tovarlar qaytdi, qolgani uchun qancha to'landi, qachon qo'shimcha to'lanadi. Sanani odatdagidek yozish mumkin — 15.09.2026.

3. Server rad etgan belgi (masalan, buyurtma allaqachon yopilgan) sababi va «Qayta / Olib tashlash» tugmalarini ko'rsatadi. Oylik — Bosh sahifada.

   ![Kuryer (telefon) — 3](img/mobile/uz/courier/home.webp)

<a id="merchandiser"></a>
## Merchandayzer (telefon)

Kunlik reja → nuqtada «Tayyor» hisobotni ochadi: javon fotosi, narx va aksiya bilan tovarlar ro'yxati, izohlar.

1. Bosh sahifa va Reja: faqat tashriflar, do'konlar va profil — sotuv haqidagi begona bloklarsiz.

   ![Merchandayzer (telefon) — 1](img/mobile/uz/merchandiser/plan.webp)

2. Tashrif hisoboti: kameradan surat, tovarlar bo'yicha belgilar, «Tashrifni yakunlash». Chalg'isangiz, qoralama bir kun saqlanadi.

   ![Merchandayzer (telefon) — 2](img/mobile/uz/merchandiser/home.webp)
