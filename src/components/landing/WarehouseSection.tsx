import { Boxes, PackagePlus, ClipboardCheck, SlidersHorizontal, ArrowLeftRight, Gauge, AlarmClock, Warehouse, Undo2, Handshake, BarChart3, Database } from "lucide-react";
import { useTranslate } from "@/i18n";
import { LX, MONO } from "./landing-tokens";
import { SectionHead } from "./landing-shared";
import { Browser } from "./landing-frames";
import { useAnime } from "./landing-anime";

/* ═══════════════════════════════════════════════════════════════════════════
   07 / СКЛАД — КОТОРЫЙ СХОДИТСЯ С ПОЛКОЙ

   FEFO показан, а не назван: пять партий одного товара стоят как пришли, и
   при появлении блока anime.js переставляет их по сроку годности — самая
   ранняя уходит первой. Это правило зашито в api/services/stock-ledger.ts и
   в комплектацию погрузочных листов; здесь оно нарисовано ровно так, как
   работает.

   Тринадцать возможностей ниже — каждая есть в api/warehouse*-router.ts,
   arrival-router.ts, supplier-router.ts, returns-router.ts, onec-router.ts.
   ═══════════════════════════════════════════════════════════════════════════ */

const BATCHES = [
  { id: "P-118", exp: "12.10", days: 28 },
  { id: "P-097", exp: "24.09", days: 10 },
  { id: "P-131", exp: "30.11", days: 77 },
  { id: "P-104", exp: "03.10", days: 19 },
  { id: "P-088", exp: "18.09", days: 4 },
];

export default function WarehouseSection() {
  const tr = useTranslate();

  const caps = [
    { I: Boxes, t: tr("Остатки по каждому складу", "Har bir ombor qoldig'i"), d: tr("Остаток, резерв под заказы и свободное — три числа, а не одно", "Qoldiq, buyurtma zaxirasi va bo'sh — bitta emas, uchta raqam") },
    { I: PackagePlus, t: tr("Приходы с партиями", "Partiyali kirimlar"), d: tr("Закупочная цена, партия, срок годности — по каждой позиции", "Xarid narxi, partiya, yaroqlilik muddati — har bir pozitsiyada") },
    { I: ClipboardCheck, t: tr("Инвентаризация", "Inventarizatsiya"), d: tr("Пересчёт по факту и акт расхождений — кто, когда, на сколько", "Haqiqiy sanoq va farqlar dalolatnomasi — kim, qachon, qancha") },
    { I: SlidersHorizontal, t: tr("Корректировки", "Tuzatishlar"), d: tr("Каждая — с автором и временем; «просто поправить цифру» нельзя", "Har biri — muallif va vaqt bilan; «shunchaki raqamni to'g'rilash» yo'q") },
    { I: ArrowLeftRight, t: tr("Движения", "Harakatlar"), d: tr("Что пришло, что ушло, по какому документу", "Nima keldi, nima ketdi, qaysi hujjat bo'yicha") },
    { I: Gauge, t: tr("Оценка склада", "Ombor bahosi"), d: tr("Сколько денег лежит на полках прямо сейчас", "Hozir javonlarda qancha pul yotibdi") },
    { I: AlarmClock, t: tr("Лежалый товар и дозаказ", "Turib qolgan mahsulot va qayta buyurtma"), d: tr("Что не продавалось месяц, что скоро просрочится и что заканчивается раньше, чем приедет", "Bir oy sotilmagan, tez orada muddati o'tadigan va kelguncha tugab qoladigan") },
    { I: Warehouse, t: tr("Перемещения", "Ko'chirishlar"), d: tr("Между складами: создали, завершили — товар переехал", "Omborlar orasida: yaratdingiz, yakunladingiz — mahsulot ko'chdi") },
    { I: Undo2, t: tr("Возвраты", "Qaytarishlar"), d: tr("Отдельный документ после доставки — со статусами и сводкой", "Yetkazishdan keyin alohida hujjat — holatlar va xulosa bilan") },
    { I: Handshake, t: tr("Контрагенты", "Kontragentlar"), d: tr("Поставки, платежи поставщику, сверка взаиморасчётов", "Yetkazib beruvchi ta'minoti, to'lovlari, o'zaro hisob solishtiruvi") },
    { I: BarChart3, t: tr("Отчёты склада", "Ombor hisobotlari"), d: tr("По категориям, движения, топ по стоимости, оборачиваемость", "Kategoriya bo'yicha, harakatlar, qiymat bo'yicha top, aylanma") },
    { I: Database, t: tr("1С в обе стороны", "1C ikki tomonlama"), d: tr("Номенклатура и заказы по OData — без двойного ввода", "Nomenklatura va buyurtmalar OData orqali — ikki marta kiritishsiz") },
  ];

  const root = useAnime<HTMLDivElement>(({ animate, stagger }, el) => {
    // Партии стоят как пришли; через секунду выстраиваются по сроку (FEFO).
    const rows = Array.from(el.querySelectorAll<HTMLElement>("[data-batch]"));
    const h = rows[0]?.offsetHeight ?? 44;
    const gap = 8;
    const order = [...BATCHES].map((b, i) => ({ i, days: b.days })).sort((a, b) => a.days - b.days);
    rows.forEach((row, i) => {
      const to = order.findIndex(o => o.i === i);
      animate(row, { y: (to - i) * (h + gap), duration: 900, delay: 1100 + to * 60, ease: "inOutCubic" });
    });
    const first = rows[order[0].i];
    if (first) animate(first, { backgroundColor: [LX.paperRaised, LX.brassSoft], borderColor: [LX.rule, LX.brass], duration: 500, delay: 2100 });
    animate(el.querySelectorAll("[data-fefo-tag]"), { opacity: [0, 1], x: [-6, 0], duration: 400, delay: 2200 });
    animate(el.querySelectorAll("[data-cap]"), { y: [16, 0], opacity: [0, 1], duration: 480, delay: stagger(45, { start: 200 }), ease: "outCubic" });
  }, 0.25);

  return (
    <section id="warehouse" className="py-16 md:py-24 scroll-mt-16" style={{ background: LX.verso, borderTop: `1px solid ${LX.rule}` }}>
      <div ref={root} className="max-w-[1240px] mx-auto px-6">
        <div className="grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-10 lg:gap-14 items-start">
          <div>
            <SectionHead
              index="07"
              label={tr("Склад", "Ombor")}
              title={tr("Склад, который сходится с полкой", "Javon bilan mos keladigan ombor")}
              lead={tr("Остаток не пишут руками — он выводится из приходов, отгрузок, приёмок и возвратов. Программа отгружает то, что портится раньше.", "Qoldiq qo'lda yozilmaydi — u kirim, jo'natish, qabul va qaytarishlardan chiqariladi. Dastur avval buziladigan mahsulotni birinchi jo'natadi.")}
            />

            {/* FEFO */}
            <div data-reveal="fefo" className="mt-10 rounded-xl p-5" style={{ background: LX.paperRaised, border: `1px solid ${LX.ruleStrong}` }}>
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] uppercase" style={{ ...MONO, color: LX.brassText, letterSpacing: "0.08em" }}>{tr("Вода «Орол» 1,5 л · партии", "«Orol» suvi 1,5 l · partiyalar")}</span>
                <span className="text-[11px]" style={{ ...MONO, color: LX.inkFaint }}>FEFO</span>
              </div>
              <div className="mt-4 space-y-2 relative">
                {BATCHES.map(b => (
                  <div key={b.id} data-batch className="flex items-center justify-between gap-3 rounded-lg px-3.5 h-11 text-[13px]" style={{ background: LX.paperRaised, border: `1px solid ${LX.rule}` }}>
                    <span style={{ ...MONO, color: LX.ink }}>{b.id}</span>
                    <span style={{ color: LX.inkSoft }}>{tr("годен до", "muddati")} <span style={MONO}>{b.exp}</span></span>
                    <span className="text-[11px]" style={{ ...MONO, color: b.days <= 10 ? LX.bad : LX.inkFaint }}>{b.days} {tr("дн.", "kun")}</span>
                  </div>
                ))}
              </div>
              <p data-fefo-tag className="mt-4 text-[12.5px]" style={{ color: LX.brassDeep }}>
                {tr("Партия P-088 уходит первой: до срока 4 дня. Комплектация и погрузочный лист берут её сами.", "P-088 partiyasi birinchi ketadi: muddatgacha 4 kun. Komplektatsiya va yuklash varaqasi uni o'zi oladi.")}
              </p>
            </div>
          </div>

          <div data-reveal="wh-shot">
            <Browser shot="warehouse" alt={tr("Экран склада: остатки, резерв, доступно, движения", "Ombor ekrani: qoldiq, zaxira, bo'sh, harakatlar")} />
            <div className="mt-6 grid sm:grid-cols-2 gap-3">
              <div className="rounded-lg p-4" style={{ background: LX.paperRaised, border: `1px solid ${LX.rule}` }}>
                <div className="text-[12px] font-semibold" style={{ color: LX.ink }}>{tr("Частичная приёмка", "Qisman qabul")}</div>
                <p className="mt-1 text-[12.5px]" style={{ color: LX.inkSoft }}>{tr("При разгрузке. Остаток — на склад, сумма заказа меняется.", "Tushirishda. Qolgani — omborga, buyurtma summasi o'zgaradi.")}</p>
              </div>
              <div className="rounded-lg p-4" style={{ background: LX.paperRaised, border: `1px solid ${LX.rule}` }}>
                <div className="text-[12px] font-semibold" style={{ color: LX.ink }}>{tr("Возврат", "Qaytarish")}</div>
                <p className="mt-1 text-[12.5px]" style={{ color: LX.inkSoft }}>{tr("Позже. Отдельный документ, сумма заказа не трогается.", "Keyinroq. Alohida hujjat, buyurtma summasi tegilmaydi.")}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-16 grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {caps.map(c => (
            <div key={c.t} data-cap className="rounded-lg p-5" style={{ background: LX.paperRaised, border: `1px solid ${LX.rule}` }}>
              <c.I size={18} strokeWidth={1.8} style={{ color: LX.brassText }} />
              <div className="mt-3 text-[14.5px] font-semibold" style={{ color: LX.ink }}>{c.t}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: LX.inkSoft }}>{c.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
