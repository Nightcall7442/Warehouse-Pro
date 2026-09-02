import { useMemo } from "react";
import { useTranslate } from "@/i18n";
import { SectionHead } from "./landing-shared";
import { LX, MONO } from "./landing-tokens";

/* ═══════════════════════════════════════════════════════════════════════════
   02 / Где теряются деньги.

   ── Зачем раздел ───────────────────────────────────────────────────────────

   Вся остальная страница обращена к тому, кто СИСТЕМОЙ ПОЛЬЗУЕТСЯ: день
   агента, экраны, роли. А решение о покупке принимает тот, кто за неё платит,
   и ему нужен другой разговор — про деньги, которые уходят прямо сейчас.

   ── Почему тут нет процентов ───────────────────────────────────────────────

   Ни одной цифры вида «вы теряете 15% выручки». Таких данных у нас нет, и
   выдуманный процент здесь работал бы ровно как выдуманный отзыв: человек,
   который двадцать лет в дистрибуции, знает свои числа лучше и на подставном
   проценте перестаёт верить всему остальному.

   Поэтому названы МЕХАНИЗМЫ: как именно деньги утекают, когда учёта нет. Свои
   числа читатель подставит сам — и это сильнее, потому что они настоящие.

   Каждый пункт заканчивается тем, где это видно в системе. Не обещанием, а
   названием экрана или отчёта, который есть в продукте.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function LossSection() {
  const tr = useTranslate();

  const items = useMemo(
    () => [
      {
        who: tr("Директор", "Direktor"),
        title: tr("Отгружено, но не получено", "Jo'natilgan, lekin olinmagan"),
        body: tr(
          "Долг магазина живёт в тетради агента и в его памяти. Сколько точка должна на сегодня — выясняется звонком, а не открытием экрана. Пока сумма не названа вслух, её никто и не требует.",
          "Do'kon qarzi agentning daftarida va xotirasida. Nuqta bugun qancha qarzdor — qo'ng'iroq bilan aniqlanadi. Summa aytilmaguncha uni hech kim talab qilmaydi.",
        ),
        where: tr(
          "Баланс каждой точки: заказы, оплаты, возвраты — и список должников на утро.",
          "Har bir nuqta balansi: buyurtma, to'lov, qaytarish — va ertalabki qarzdorlar ro'yxati.",
        ),
      },
      {
        who: tr("Директор · склад", "Direktor · ombor"),
        title: tr("Деньги, замороженные в остатках", "Qoldiqlarda muzlagan pul"),
        body: tr(
          "Часть склада не двигалась месяцами. Это не убыток в отчёте — это оборотные деньги, которые лежат на полке вместо того, чтобы работать. Без учёта такой товар не виден: он просто есть.",
          "Omborning bir qismi oylab qimirlamagan. Bu hisobotdagi zarar emas — bu javonda yotgan aylanma pul. Hisobsiz bunday tovar ko'rinmaydi.",
        ),
        where: tr(
          "Мёртвый сток и оценка стоимости склада: что лежит, сколько это стоит, когда продавалось в последний раз.",
          "O'lik stok va ombor qiymati: nima yotibdi, qancha turadi, oxirgi marta qachon sotilgan.",
        ),
      },
      {
        who: tr("Супервайзер", "Supervayzer"),
        title: tr("Визиты, которых не было", "Bo'lmagan tashriflar"),
        body: tr(
          "Маршрут отмечен пройденным, но в половине точек агент не был. Или был — и уехал без заказа, и никто об этом не спросил. Разница между планом и полем не видна до конца месяца.",
          "Marshrut bajarilgan deb belgilangan, lekin agent nuqtalarning yarmida bo'lmagan. Yoki bo'lgan — va buyurtmasiz ketgan, va hech kim so'ramagan.",
        ),
        where: tr(
          "Отметка визита по GPS, история маршрутов и визиты, закончившиеся без заказа.",
          "GPS bo'yicha tashrif belgisi, marshrutlar tarixi va buyurtmasiz tugagan tashriflar.",
        ),
      },
      {
        who: tr("Оператор", "Operator"),
        title: tr("Разница между отгруженным и принятым", "Jo'natilgan va qabul qilingan orasidagi farq"),
        body: tr(
          "Магазин принял восемьдесят коробок из ста, двадцать уехали обратно. Если возврат не записан в тот же день, долг посчитан по накладной, а не по факту — и расхождение всплывает при сверке, когда вспомнить уже некому.",
          "Do'kon yuzdan sakson quti qabul qildi, yigirmasi qaytdi. Qaytarish o'sha kuni yozilmasa, qarz hujjat bo'yicha hisoblanadi, fakt bo'yicha emas.",
        ),
        where: tr(
          "Частичная приёмка: остаток возвращается на склад, долг пересчитывается по факту.",
          "Qisman qabul: qoldiq omborga qaytadi, qarz fakt bo'yicha qayta hisoblanadi.",
        ),
      },
    ],
    [tr],
  );

  return (
    <section id="loss" className="py-20 md:py-28 scroll-mt-16" style={{ background: LX.night }}>
      <div className="max-w-[1240px] mx-auto px-6 lg:pl-[136px]">
      {/* Одна цифра на всю тёмную главу — из боевой базы, не выдумана. */}
      <div data-reveal="loss-figure" className="mb-10 md:mb-14">
        <div className="text-[56px] md:text-[72px] leading-none" style={{ ...MONO, letterSpacing: "-0.02em", color: LX.brassOnNight }}>
          <span data-count="200000">200 000</span>
        </div>
        <p className="mt-3 text-[13px] font-medium max-w-md" style={{ color: LX.softOnInk }}>
          {tr("сум по одному заказу, которые остались бы незаписанными без сверки. Боевая база, заказ №981.", "so'm — bitta buyurtma bo'yicha, solishtiruvsiz yozilmay qolardi. Jonli baza, №981 buyurtma.")}
        </p>
      </div>
      <SectionHead
        tone="dark"
        index="02"
        label={tr("Где теряются деньги", "Pul qayerda yo'qoladi")}
        title={tr("Учёт нужен не ради порядка", "Hisob tartib uchun emas")}
        lead={tr(
          "Порядок — следствие. Причина в том, что без него деньги утекают четырьмя способами, и каждый из них тихий: он не выглядит как убыток, поэтому его не ищут.",
          "Tartib — natija. Sabab shundaki, usiz pul to'rt yo'l bilan oqib ketadi, va ularning har biri jimgina.",
        )}
      />

      {/* Двумя колонками: четыре пункта в ряд ужимаются до нечитаемых полосок,
          а в столбик уходят вниз экрана и теряют сопоставление между собой. */}
      <div className="grid md:grid-cols-2 gap-px mt-12" style={{ background: LX.ruleOnInk }}>
        {items.map((it, i) => (
          <div key={i} data-reveal="loss" className="p-6 md:p-8" style={{ background: LX.ink }}>
            <div className="flex items-baseline gap-3 mb-3">
              <span className="text-[11px]" style={{ ...MONO, fontWeight: 500, color: LX.brassOnNight, letterSpacing: "0.08em" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className="text-[10.5px] uppercase"
                style={{ ...MONO, fontWeight: 500, color: LX.faintOnInk, letterSpacing: "0.08em" }}
              >
                {it.who}
              </span>
            </div>

            <h3
              className="font-bold mb-3"
              style={{ fontSize: "clamp(1.05rem, 1.6vw, 1.3rem)", letterSpacing: "-0.02em", color: LX.paperOnInk }}
            >
              {it.title}
            </h3>

            <p className="text-[15px] leading-relaxed" style={{ color: LX.softOnInk }}>
              {it.body}
            </p>

            <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${LX.ruleOnInk}` }}>
              <span
                className="block text-[13px] font-medium mb-1.5"
                style={{ color: LX.faintOnInk }}
              >
                {tr("В системе это видно как", "Tizimda bu shunday ko'rinadi")}
              </span>
              <span className="block text-[14px]" style={{ color: LX.paperOnInk }}>
                {it.where}
              </span>
            </div>
          </div>
        ))}
      </div>
      </div>
    </section>
  );
}
