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
                <span className="text-[11px] uppercase" style={{ ...MONO, color: LX.inkFaint, letterSpacing: "0.16em" }}>
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
  const rows = useMemo(
    () => [
      {
        title: tr("Склад и остатки", "Ombor va qoldiqlar"),
        desc: tr("Приходы, резервы, движения, контроль лежалого товара по каждому складу.", "Kirimlar, zaxiralar, harakatlar, har bir ombor bo'yicha turg'un tovar nazorati."),
        tag: tr("резервы", "zaxiralar"),
      },
      {
        title: tr("Заказы и частичная доставка", "Buyurtmalar va qisman yetkazish"),
        desc: tr("Магазин принял 80 из 100 — остаток вернулся на склад, долг посчитан по факту.", "Do'kon 100 tadan 80 tasini oldi — qolgani omborga qaytdi, qarz fakt bo'yicha hisoblandi."),
        tag: tr("возвраты", "qaytarishlar"),
      },
      {
        title: tr("Доставка и курьеры", "Yetkazish va kuryerlar"),
        desc: tr("Погрузочные листы, маршруты, сбор наличных и сверка в конце дня.", "Yuklash varaqalari, marshrutlar, naqd yig'ish va kun oxirida solishtirish."),
        tag: tr("наличные", "naqd pul"),
      },
      {
        title: tr("GPS-контроль агентов", "Agentlar GPS nazorati"),
        desc: tr("Живая карта, история маршрутов, отметки визитов в торговых точках.", "Jonli xarita, marshrutlar tarixi, savdo nuqtalaridagi tashrif belgilari."),
        tag: "GPS",
      },
      {
        title: tr("Долги магазинов", "Do'kon qarzlari"),
        desc: tr("Баланс каждой точки: заказы, оплаты, возвраты — и список должников на утро.", "Har bir nuqta balansi: buyurtmalar, to'lovlar, qaytarishlar — va ertalabki qarzdorlar ro'yxati."),
        tag: tr("сверка", "solishtiruv"),
      },
      {
        title: tr("Аналитика и прибыль", "Tahlil va foyda"),
        desc: tr("Выручка, маржа, эффективность агентов и KPI — по доставленному, а не по обещанному.", "Tushum, marja, agentlar samaradorligi va KPI — va'da emas, yetkazilgan asosida."),
        tag: "P&L",
      },
      {
        title: tr("Обмен с 1С:Предприятие", "1C:Predpriyatiye bilan almashinuv"),
        desc: tr("Товары, заказы, контрагенты — двусторонняя синхронизация, без двойного ввода.", "Tovarlar, buyurtmalar, kontragentlar — ikki tomonlama sinxronizatsiya, ikki marta kiritmasdan."),
        tag: "1C",
      },
      {
        title: tr("Мобильное приложение", "Mobil ilova"),
        desc: tr("iOS и Android, офлайн-режим, камера, GPS. Агенту хватает одного дня, чтобы освоить.", "iOS va Android, oflayn rejim, kamera, GPS. Agent bir kunda o'rganib oladi."),
        tag: tr("офлайн", "oflayn"),
      },
    ],
    [tr],
  );

  return (
    <section className="py-16 md:py-24" style={{ borderTop: `1px solid ${LX.rule}` }}>
      <div className="max-w-[1240px] mx-auto px-6">
        <SectionHead
          id="features"
          index="04"
          label={tr("Возможности", "Imkoniyatlar")}
          title={tr("Реестр возможностей", "Imkoniyatlar reyestri")}
          lead={tr(
            "От прихода на склад до сверки наличных вечером — полный контур дистрибуции.",
            "Omborga kirimdan kechki naqd solishtiruvigacha — distributsiyaning to'liq konturi.",
          )}
        />
        <div className="mt-12" style={{ borderTop: `1px solid ${LX.rule}` }}>
          {rows.map((r, i) => (
            <div
              key={r.title}
              className="group grid grid-cols-[44px_1fr] md:grid-cols-[64px_260px_1fr_120px] gap-x-4 md:gap-x-8 py-5 md:py-6 items-baseline transition-colors duration-200 hover:bg-[#faf9f5]"
              style={{ borderBottom: `1px solid ${LX.rule}` }}
            >
              <span className="text-[12px]" style={{ ...MONO, color: LX.inkFaint }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="text-[15.5px] font-bold" style={{ color: LX.ink }}>
                {r.title}
              </h3>
              <p className="col-start-2 md:col-start-3 text-[13.5px] leading-relaxed max-w-xl mt-1 md:mt-0" style={{ color: LX.inkSoft }}>
                {r.desc}
              </p>
              <span
                className="hidden md:block text-[11px] uppercase text-right"
                style={{ ...MONO, color: LX.brassText, letterSpacing: "0.1em" }}
              >
                {r.tag}
              </span>
            </div>
          ))}
        </div>
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
function RolesSection() {
  const tr = useTranslate();
  const roles = useMemo(
    () => [
      { code: tr("ДИР", "DIR"), role: tr("Директор", "Direktor"), items: [tr("KPI и прибыль", "KPI va foyda"), tr("Финансовые отчёты", "Moliyaviy hisobotlar"), tr("Контроль долгов", "Qarzlar nazorati")] },
      { code: tr("ОПР", "OPR"), role: tr("Оператор", "Operator"), items: [tr("Обработка заказов", "Buyurtmalarni qayta ishlash"), tr("Назначение курьеров", "Kuryerlarni tayinlash"), tr("Обмен с 1С", "1C bilan almashinuv")] },
      { code: tr("АГТ", "AGT"), role: tr("Агент", "Agent"), items: [tr("Заказы в поле", "Daladagi buyurtmalar"), tr("План визитов", "Tashriflar rejasi"), tr("Офлайн-режим", "Oflayn rejim")] },
      { code: tr("СПВ", "SPV"), role: tr("Супервайзер", "Supervayzer"), items: [tr("Мониторинг агентов", "Agentlar monitoringi"), tr("Планы и цели", "Rejalar va maqsadlar"), tr("Отчёты по визитам", "Tashriflar hisobotlari")] },
      { code: tr("МРЧ", "MRC"), role: tr("Мерчандайзер", "Merchandayzer"), items: [tr("Фото-отчёты с полки", "Peshtaxtadan foto-hisobotlar"), tr("Чек-листы товаров", "Tovarlar chek-listlari"), tr("Заметки о конкурентах", "Raqobatchilar haqida qaydlar")] },
      { code: tr("КУР", "KUR"), role: tr("Курьер", "Kuryer"), items: [tr("Список доставок", "Yetkazishlar ro'yxati"), tr("Сбор наличных", "Naqd pul yig'ish"), tr("Частичная приёмка", "Qisman qabul qilish")] },
    ],
    [tr],
  );
  return (
    <section className="py-16 md:py-24" style={{ borderTop: `1px solid ${LX.rule}` }}>
      <div className="max-w-[1240px] mx-auto px-6">
        <SectionHead
          id="roles"
          index="06"
          label={tr("Роли", "Rollar")}
          title={tr("Каждый видит только своё", "Har kim faqat o'zinikini ko'radi")}
          lead={tr(
            "Шесть ролей с разными правами: курьер не видит прибыль, агент — чужие маршруты.",
            "Har xil huquqli oltita rol: kuryer foydani ko'rmaydi, agent boshqalar marshrutini ko'rmaydi.",
          )}
        />
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-px rounded-xl overflow-hidden" style={{ background: LX.rule, border: `1px solid ${LX.rule}` }}>
          {roles.map(r => (
            <div key={r.role} className="p-6" style={{ background: LX.paper }}>
              <div className="flex items-center gap-3 mb-4">
                <span
                  className="px-2 py-1 rounded-[6px] text-[10.5px]"
                  style={{ ...MONO, color: LX.brassText, background: LX.brassSoft, letterSpacing: "0.08em" }}
                >
                  {r.code}
                </span>
                <h3 className="text-[15px] font-bold" style={{ color: LX.ink }}>
                  {r.role}
                </h3>
              </div>
              <ul className="space-y-2">
                {r.items.map(f => (
                  <li key={f} className="flex items-center gap-2.5 text-[13px]" style={{ color: LX.inkSoft }}>
                    <span aria-hidden="true" className="w-3 h-px shrink-0" style={{ background: LX.ruleStrong }} />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function FeaturesSection() {
  return (
    <>
      <DaySection />
      <LedgerSection />
      <GpsSection />
      <RolesSection />
    </>
  );
}
