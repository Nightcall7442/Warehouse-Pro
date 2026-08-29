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
    <section className="py-16 md:py-24">
      <SectionHead
        id="loss"
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
      <div className="grid md:grid-cols-2 gap-px" style={{ background: LX.rule }}>
        {items.map((it, i) => (
          <div key={i} className="p-6 md:p-8" style={{ background: LX.paper }}>
            <div className="flex items-baseline gap-3 mb-3">
              <span className="text-[11px]" style={{ ...MONO, color: LX.brassText, letterSpacing: "0.18em" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className="text-[10.5px] uppercase"
                style={{ ...MONO, color: LX.inkFaint, letterSpacing: "0.16em" }}
              >
                {it.who}
              </span>
            </div>

            <h3
              className="font-bold mb-3"
              style={{ fontSize: "clamp(1.05rem, 1.6vw, 1.3rem)", letterSpacing: "-0.02em", color: LX.ink }}
            >
              {it.title}
            </h3>

            <p className="text-[14.5px] leading-relaxed" style={{ color: LX.inkSoft }}>
              {it.body}
            </p>

            <div className="mt-5 pt-4" style={{ borderTop: `1px solid ${LX.rule}` }}>
              <span
                className="block text-[9.5px] uppercase mb-1.5"
                style={{ ...MONO, color: LX.inkFaint, letterSpacing: "0.16em" }}
              >
                {tr("В системе это видно как", "Tizimda bu shunday ko'rinadi")}
              </span>
              <span className="block text-[13.5px]" style={{ color: LX.ink }}>
                {it.where}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
