import { useMemo } from "react";
import { useTranslate } from "@/i18n";
import { MapPin, Check } from "lucide-react";
import { SectionHead } from "./landing-shared";
import { LX, MONO } from "./landing-tokens";
import CityMap from "./CityMap";

/* ═══════════════════════════════════════════════════════════════════════════
   Содержательные секции на бумаге.

   «Возможности» намеренно свёрстаны СТРОКАМИ реестра, а не сеткой карточек
   «иконка-заголовок-текст»: таблица — это буквально то, что продаёт WMS,
   и после чернильного окна продукта вторая сетка 3×2 читалась бы шаблоном.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── 03 / Как работает: день с Warehouse Pro ─────────────────────────────── */
function DaySection() {
  const tr = useTranslate();
  const steps = useMemo(
    () => [
      {
        time: "07:30",
        who: tr("Агент", "Agent"),
        title: tr("Маршрут уже в телефоне", "Marshrut allaqachon telefonda"),
        desc: tr(
          "Санжар открывает приложение: 18 точек на сегодня, по каждой — долг, история заказов и что взять на пробу.",
          "Sanjar ilovani ochadi: bugunga 18 nuqta, har birida qarz, buyurtmalar tarixi va namuna uchun nima olish kerakligi.",
        ),
      },
      {
        time: "14:00",
        who: tr("В поле", "Dalada"),
        title: tr("Заказ без связи — не потерян", "Aloqasiz buyurtma yo'qolmaydi"),
        desc: tr(
          "В подвальном павильоне сети нет. Заказ сохраняется в очередь и уходит на сервер, как только появляется сигнал.",
          "Yerto'la do'konida tarmoq yo'q. Buyurtma navbatga saqlanadi va signal paydo bo'lishi bilan serverga jo'naydi.",
        ),
      },
      {
        time: "18:30",
        who: tr("Директор", "Direktor"),
        title: tr("День виден целиком", "Kun to'liq ko'rinadi"),
        desc: tr(
          "Выручка, долги, маршруты и остатки — в отчётах и уже выгружены в 1С. Без обзвона агентов и сведения тетрадей.",
          "Tushum, qarzlar, marshrutlar va qoldiqlar — hisobotlarda va allaqachon 1C ga yuklangan. Agentlarga qo'ng'iroqsiz, daftarlarni solishtirmasdan.",
        ),
      },
    ],
    [tr],
  );

  return (
    <section className="py-16 md:py-24" style={{ borderTop: `1px solid ${LX.rule}` }}>
      <div className="max-w-[1240px] mx-auto px-6">
        <SectionHead
          id="how"
          index="03"
          label={tr("Как работает", "Qanday ishlaydi")}
          title={tr("Один день с Warehouse Pro", "Warehouse Pro bilan bir kun")}
        />
        <div className="mt-12 grid md:grid-cols-3" style={{ borderTop: `1px solid ${LX.rule}` }}>
          {steps.map((s, i) => (
            <div
              key={s.time}
              className={i > 0 ? "py-8 md:py-10 md:px-8 last:md:pr-0 md:border-l" : "py-8 md:py-10 md:pr-8"}
              style={{
                borderBottom: `1px solid ${LX.rule}`,
                borderLeftColor: LX.rule,
              }}
            >
              <div className="flex items-baseline gap-3 mb-4">
                <span className="text-[26px] font-medium" style={{ ...MONO, color: LX.brassText }}>
                  {s.time}
                </span>
                <span className="text-[11px] uppercase" style={{ ...MONO, color: LX.inkFaint, letterSpacing: "0.08em" }}>
                  {s.who}
                </span>
              </div>
              <h3 className="text-[17px] font-bold mb-2.5" style={{ color: LX.ink }}>
                {s.title}
              </h3>
              <p className="text-[14px] leading-relaxed" style={{ color: LX.inkSoft }}>
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── 04 / Возможности: строки реестра ────────────────────────────────────── */
function LedgerSection() {
  const tr = useTranslate();
  /*
    Ведомость, а не восемь одинаковых строк. У настоящей ведомости есть шапка
    столбцов, разная плотность позиций и итог под двойной чертой — здесь не
    было ничего из этого. Четвёртый столбец — не «показатель» (их пришлось бы
    выдумывать), а имя раздела боевой программы, куда человек попадёт после
    регистрации: столбец работает оглавлением продукта.

    Две позиции развёрнуты во врезки на всю ширину — скачок масштаба ВНУТРИ
    секции. Цифры во врезках — из боевой базы, подписаны как пример.
  */
  const rows = [
    { title: tr("Склад и остатки", "Ombor va qoldiqlar"), desc: tr("Приходы, резервы, движения, контроль лежалого товара по каждому складу.", "Kirimlar, rezervlar, harakatlar, har bir ombor bo'yicha turib qolgan tovar nazorati."), where: tr("Склад → Остатки", "Ombor → Qoldiqlar") },
    { title: tr("Заказы и частичная доставка", "Buyurtmalar va qisman yetkazish"), desc: tr("Магазин принял часть — остаток вернулся на склад, долг посчитан по факту.", "Do'kon bir qismini qabul qildi — qolgani omborga qaytdi, qarz fakt bo'yicha hisoblandi."), where: tr("Заказы → Частичная доставка", "Buyurtmalar → Qisman yetkazish"), insert: "partial" },
    { title: tr("Доставка и курьеры", "Yetkazish va kuryerlar"), desc: tr("Погрузочные листы, маршруты, сбор наличных и сверка в конце дня.", "Yuklash varaqlari, marshrutlar, naqd yig'ish va kun oxirida solishtiruv."), where: tr("Доставка → Курьеры", "Yetkazish → Kuryerlar") },
    { title: tr("GPS-контроль агентов", "Agentlar GPS nazorati"), desc: tr("Живая карта, история маршрутов, отметки визитов в торговых точках.", "Jonli xarita, marshrutlar tarixi, savdo nuqtalaridagi tashrif belgilari."), where: tr("Агенты → GPS", "Agentlar → GPS") },
    { title: tr("Долги магазинов", "Do'konlar qarzlari"), desc: tr("Баланс каждой точки: заказы, оплаты, возвраты — и список должников на утро.", "Har bir nuqta balansi: buyurtmalar, to'lovlar, qaytarishlar — va ertalabki qarzdorlar ro'yxati."), where: tr("Магазины → Долги", "Do'konlar → Qarzlar"), insert: "debt" },
    { title: tr("Аналитика и прибыль", "Tahlil va foyda"), desc: tr("Выручка, маржа, эффективность агентов и KPI — по доставленному, а не по обещанному.", "Tushum, marja, agentlar samaradorligi va KPI — va'da emas, yetkazilgan bo'yicha."), where: tr("Отчёты → Прибыль", "Hisobotlar → Foyda") },
    { title: tr("Обмен с 1С:Предприятие", "1C:Predpriyatiye bilan almashinuv"), desc: tr("Товары, заказы, контрагенты — двусторонняя синхронизация, без двойного ввода.", "Tovarlar, buyurtmalar, kontragentlar — ikki tomonlama sinxronlash, ikki marta kiritmasdan."), where: tr("Настройки → Обмен с 1С", "Sozlamalar → 1C almashinuvi") },
    { title: tr("Мобильное приложение", "Mobil ilova"), desc: tr("iOS и Android, офлайн-режим, камера, GPS. Агенту хватает одного дня, чтобы освоить.", "iOS va Android, oflayn rejim, kamera, GPS. Agentga o'rganish uchun bir kun yetadi."), where: tr("Приложение агента", "Agent ilovasi") },
  ];

  const cols = "grid grid-cols-[44px_1fr] md:grid-cols-[56px_260px_1fr_200px]";
  const registerA = { ...MONO, fontWeight: 500, letterSpacing: "0.08em" } as const;

  return (
    <section id="features" className="py-16 md:py-24 scroll-mt-16" style={{ background: LX.verso }}>
      <div className="max-w-[1240px] mx-auto px-6">
        <SectionHead
          index="04"
          label={tr("Возможности", "Imkoniyatlar")}
          title={tr("Реестр возможностей", "Imkoniyatlar reyestri")}
          lead={tr("От прихода на склад до сверки наличных вечером — полный контур дистрибуции.", "Omborga kirimdan kechki naqd solishtiruvigacha — distributsiyaning to'liq konturi.")}
        />

        {/* Шапка столбцов: одной строкой таблица объявляет себя таблицей. */}
        <div
          className={`mt-12 ${cols} gap-x-4 md:gap-x-8 py-3 text-[11px] uppercase`}
          style={{ ...registerA, color: LX.brassDeep, borderTop: `1px solid ${LX.ruleStrong}`, borderBottom: `1px solid ${LX.rule}` }}
        >
          {/* В DM Mono нет знака №: браузер подставлял чужой глиф. */}
          <span>#</span>
          <span>{tr("Позиция", "Pozitsiya")}</span>
          <span className="hidden md:block">{tr("Что делает", "Nima qiladi")}</span>
          <span className="hidden md:block text-right">{tr("Где это в программе", "Dasturda qayerda")}</span>
        </div>

        {rows.map((r, i) => (
          <div key={r.title} data-reveal="ledger">
            <div
              className={`${cols} gap-x-4 md:gap-x-8 py-5 md:py-6 items-baseline transition-colors duration-200 hover:bg-[#ece8de]`}
              style={{ borderBottom: r.insert ? "none" : `1px solid ${LX.rule}` }}
            >
              <span className="text-[13px]" style={{ ...MONO, color: LX.inkSoft }}>{String(i + 1).padStart(2, "0")}</span>
              <h3 className="text-[18px] md:text-[20px] font-bold" style={{ color: LX.ink, letterSpacing: "-0.015em" }}>{r.title}</h3>
              <p className="col-start-2 md:col-start-3 text-[13px] leading-relaxed max-w-xl mt-1 md:mt-0" style={{ color: LX.inkSoft }}>{r.desc}</p>
              <span className="col-start-2 md:col-start-4 text-[13px] font-medium md:text-right mt-1 md:mt-0" style={{ color: LX.inkSoft }}>{r.where}</span>
            </div>

            {r.insert === "partial" && (
              <div
                className="grid md:grid-cols-[400px_1fr] gap-8 md:gap-12 p-6 md:p-8 mb-px"
                style={{ background: LX.paperRaised, border: `1px solid ${LX.rule}`, borderBottom: `1px solid ${LX.rule}` }}
              >
                <div>
                  <div className="flex items-baseline gap-3 text-[40px] md:text-[56px] leading-none whitespace-nowrap" style={{ ...MONO, letterSpacing: "-0.02em", color: LX.ink }}>
                    <span data-count="100">100</span>
                    <span style={{ color: LX.brass }}>→</span>
                    <span data-count="80">80</span>
                    <span style={{ color: LX.brass }}>→</span>
                    <span data-count="20" style={{ color: LX.brassDeep }}>20</span>
                  </div>
                  <div className="mt-3 flex gap-6 text-[13px] font-medium" style={{ color: LX.inkSoft }}>
                    <span>{tr("отгружено", "jo'natildi")}</span><span>{tr("принято", "qabul qilindi")}</span><span>{tr("вернулось", "qaytdi")}</span>
                  </div>
                </div>
                <div>
                  <p className="text-[16px]" style={{ lineHeight: 1.6, color: LX.ink }}>
                    {tr(
                      "Единственное, чего тетрадь не умеет в принципе. Магазин принял восемьдесят коробок из ста — двадцать возвращаются на склад тем же днём, и долг магазина считается по тому, что он оставил себе, а не по накладной.",
                      "Daftar tubdan qila olmaydigan yagona narsa. Do'kon yuzdan sakson quti qabul qildi — yigirmasi o'sha kuni omborga qaytadi, va do'kon qarzi hujjat bo'yicha emas, o'zida qoldirgani bo'yicha hisoblanadi.",
                    )}
                  </p>
                  <p className="mt-3 text-[13px] font-medium" style={{ color: LX.brassDeep }}>{tr("долг пересчитан по факту приёмки · пример", "qarz qabul fakti bo'yicha qayta hisoblandi · misol")}</p>
                </div>
              </div>
            )}

            {r.insert === "debt" && (
              <div
                className="grid md:grid-cols-[400px_1fr] gap-8 md:gap-12 p-6 md:p-8 mb-px"
                style={{ background: LX.paperRaised, border: `1px solid ${LX.rule}` }}
              >
                <div>
                  <div className="text-[44px] md:text-[64px] leading-none" style={{ ...MONO, letterSpacing: "-0.02em", color: LX.ink }}>
                    <span data-count="200000">200 000</span>
                  </div>
                  <div className="mt-3 text-[13px] font-medium" style={{ color: LX.inkSoft }}>
                    {tr("сум долга по одному заказу — из боевой базы", "so'm — bitta buyurtma bo'yicha qarz, jonli bazadan")}
                  </div>
                </div>
                <div>
                  <p className="text-[16px]" style={{ lineHeight: 1.6, color: LX.ink }}>
                    {tr(
                      "Заказ на 379 000, магазин отдал 179 000. Разница легла на баланс точки в ту же минуту — и попала в список должников на утро. Без записи она бы не существовала нигде, кроме памяти агента.",
                      "379 000 ga buyurtma, do'kon 179 000 berdi. Farq o'sha daqiqada nuqta balansiga tushdi — va ertalabki qarzdorlar ro'yxatiga kirdi. Yozuvsiz u agent xotirasidan boshqa hech qayerda bo'lmasdi.",
                    )}
                  </p>
                  <p className="mt-3 text-[13px] font-medium" style={{ color: LX.brassDeep }}>{tr("сверка на утро · заказ №981, 27.08", "ertalabki solishtiruv · №981 buyurtma, 27.08")}</p>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Итог под двойной чертой: линия 2px, зазор 3px, линия 1px. Канонический бухгалтерский приём. */}
        <div className="mt-2">
          <div data-rule="" style={{ height: 2, background: LX.ink }} />
          <div style={{ height: 3 }} />
          <div data-rule="" style={{ height: 1, background: LX.ink }} />
        </div>
        <div className={`${cols} gap-x-4 md:gap-x-8 pt-5 items-baseline`}>
          <span className="text-[13px]" style={{ ...MONO, color: LX.inkSoft }}>{tr("Итого", "Jami")}</span>
          <span className="col-span-1 md:col-span-3 text-[20px] md:text-[24px]" style={{ ...MONO, letterSpacing: "-0.02em", color: LX.ink }}>
            8 {tr("позиций", "pozitsiya")} <span style={{ color: LX.brass }}>·</span> {tr("один ввод", "bitta kiritish")} <span style={{ color: LX.brass }}>·</span> {tr("одна база", "bitta baza")}
          </span>
        </div>

        {/* Роли — одной строкой вместо секции из шести плиток. */}
        <p id="roles" className="mt-6 text-[13px] scroll-mt-24" style={{ color: LX.inkSoft }}>
          {tr("Шесть ролей — директор, оператор, склад, агент, курьер, супервайзер — у каждой свой набор экранов. ", "Oltita rol — direktor, operator, ombor, agent, kuryer, supervayzer — har birining o'z ekranlari bor. ")}
          <a href="#product" className="font-medium underline underline-offset-4" style={{ color: LX.ink, textDecorationColor: LX.ruleStrong }}>
            {tr("Посмотреть интерфейс", "Interfeysni ko'rish")}
          </a>
        </p>
      </div>
    </section>
  );
}

/* ── 05 / GPS-сплит ──────────────────────────────────────────────────────── */
function GpsSection() {
  const tr = useTranslate();
  const agents = [
    { name: tr("Санжар · Юнусабад", "Sanjar · Yunusobod"), pts: "14/18", tone: LX.good },
    { name: tr("Бехруз · Мирзо-Улугбек", "Behruz · Mirzo Ulug'bek"), pts: "11/16", tone: LX.good },
    { name: tr("Отабек · Чиланзар", "Otabek · Chilonzor"), pts: "6/15", tone: LX.warn },
  ];
  return (
    <section className="py-16 md:py-24" style={{ borderTop: `1px solid ${LX.rule}` }}>
      <div className="max-w-[1240px] mx-auto px-6 grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        <div>
          <SectionHead
            id="map"
            index="05"
            label={tr("Контроль", "Nazorat")}
            title={tr("Вы видите поле, не выходя из кабинета", "Dalani kabinetdan chiqmasdan ko'rasiz")}
          />
          <ul className="mt-8 space-y-4">
            {[
              tr("Живая карта с позициями всех агентов и курьеров", "Barcha agentlar va kuryerlar joylashuvi bilan jonli xarita"),
              tr("История маршрутов за день, неделю, месяц", "Kun, hafta, oy bo'yicha marshrutlar tarixi"),
              tr("Отметки визитов: был в точке или проехал мимо", "Tashrif belgilari: nuqtada bo'ldimi yoki o'tib ketdimi"),
              tr("Визит без заказа — повод для разговора, и он виден", "Buyurtmasiz tashrif — suhbat uchun sabab, va u ko'rinadi"),
            ].map(item => (
              <li key={item} className="flex items-start gap-3 text-[14.5px]" style={{ color: LX.inkSoft }}>
                <Check size={15} strokeWidth={3} className="mt-1 shrink-0" style={{ color: LX.brassText }} />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl relative overflow-hidden h-[300px]" style={{ border: `1px solid ${LX.ruleStrong}` }}>
          <CityMap
            pins={[
              { x: 26, y: 24, tone: LX.goodDot },
              { x: 44, y: 14, tone: LX.goodDot },
              { x: 58, y: 26, tone: LX.brass, pulse: true },
              { x: 74, y: 44, tone: LX.goodDot },
              { x: 40, y: 52, tone: LX.warn },
              { x: 86, y: 26, tone: LX.goodDot },
            ]}
            route={[
              [26, 24],
              [44, 14],
              [58, 26],
              [74, 44],
            ]}
          />
          <div className="absolute bottom-3 left-3 right-3 space-y-1.5">
            {agents.map(a => (
              <div
                key={a.name}
                className="rounded-lg px-3.5 py-2 flex items-center justify-between gap-3"
                style={{ background: LX.paper, border: `1px solid ${LX.rule}` }}
              >
                <span className="flex items-center gap-2 text-[11.5px] min-w-0 truncate" style={{ color: LX.ink }}>
                  <MapPin size={12} className="shrink-0" style={{ color: a.tone }} />
                  {a.name}
                </span>
                <span className="text-[11px] shrink-0" style={{ ...MONO, color: LX.inkFaint }}>
                  {a.pts} {tr("точек", "nuqta")}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── 06 / Роли ───────────────────────────────────────────────────────────── */
export default function FeaturesSection() {
  return (
    <>
      <DaySection />
      <LedgerSection />
      <GpsSection />
    </>
  );
}
