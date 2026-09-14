import { useTranslate } from "@/i18n";
import { EXTRA_PRICES_UZS } from "@contracts/constants";
import { LX, MONO } from "./landing-tokens";
import { SectionHead } from "./landing-shared";
import { Browser, Ledger, Split } from "./landing-frames";
import { useAnime } from "./landing-anime";

/* ═══════════════════════════════════════════════════════════════════════════
   09 / НАСТРОЙКИ — ОТДЕЛЬНО

   Владелец просил «про настройки отдельно»: роли, права оператора, импорт
   из Excel, сверхлимит. Всё ниже — реальные экраны раздела «Настройки» и
   «Пользователи» (src/pages/Settings.tsx, Users.tsx, ExcelImport.tsx),
   цены сверхлимита берутся из contracts/constants.ts, не набираются руками.

   Движение: роли выезжают фишками; три переключателя прав оператора
   переводятся по очереди; строки листа Excel «перелетают» в каталог.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function SetupSection() {
  const tr = useTranslate();
  const fmt = (n: number) => n.toLocaleString("ru-RU");

  const roles = [
    tr("Директор", "Direktor"), tr("Оператор", "Operator"), tr("Супервайзер", "Supervayzer"),
    tr("Агент", "Agent"), tr("Мерчендайзер", "Merchandayzer"), tr("Курьер", "Kuryer"),
  ];
  const rights = [tr("Удалять заказы", "Buyurtmalarni o'chirish"), tr("Править товары", "Mahsulotlarni tahrirlash"), tr("Принимать деньги", "Pul qabul qilish")];
  const sheet = [
    ["SKU-1042", tr("Вода «Орол» 1,5 л", "«Orol» suvi 1,5 l"), "6 500"],
    ["SKU-1043", tr("Сок «Дена» яблоко", "«Dena» olma sharbati"), "9 800"],
    ["SKU-1044", tr("Печенье «Роҳат»", "«Rohat» pechenyesi"), "12 400"],
  ];

  const caps = [
    { t: tr("Сотрудники и приглашения", "Xodimlar va takliflar"), d: tr("Пригласить по почте или завести с паролем; уволил — отключил", "Pochta orqali taklif yoki parol bilan yaratish; ishdan ketdi — o'chirildi") },
    { t: tr("Склады и склад по умолчанию", "Omborlar va asosiy ombor"), d: tr("Продажи идут с основного; между складами — перемещения", "Savdo asosiy ombordan; omborlar orasida — ko'chirish") },
    { t: tr("Магазины и территории", "Do'konlar va hududlar"), d: tr("Координаты, районы, закреплённый агент; автораспределение точек", "Koordinatalar, tumanlar, biriktirilgan agent; nuqtalarni avtomatik taqsimlash") },
    { t: tr("Прайс-листы", "Narx ro'yxatlari"), d: tr("Своя цена сети и своя ларьку; агент видит правильную в телефоне", "Tarmoqqa o'z narxi, do'konchaga o'z narxi; agent telefonda to'g'risini ko'radi") },
    { t: tr("Telegram", "Telegram"), d: tr("Группа компании, сотрудники по ID, правила уведомлений, ответы бота", "Kompaniya guruhi, xodimlar ID bo'yicha, bildirishnoma qoidalari, bot javoblari") },
    { t: tr("1С по OData", "1C OData orqali"), d: tr("Номенклатура и заказы в обе стороны, экран состояния обмена", "Nomenklatura va buyurtmalar ikki tomonlama, almashinuv holati ekrani") },
    { t: tr("Ключи API", "API kalitlari"), d: tr("Чужой программе — только чтение, журнал выгрузок", "Boshqa dasturga — faqat o'qish, eksport jurnali") },
    { t: tr("Брендинг", "Brending"), d: tr("Логотип и цвета вашей компании — у сотрудников и на входе", "Kompaniyangiz logotipi va ranglari — xodimlarda va kirishda") },
    { t: tr("Экспорт документов", "Hujjatlar eksporti"), d: tr("Отчёты в Excel и CSV, печатные формы, журнал действий", "Hisobotlar Excel va CSV da, chop shakllari, amallar jurnali") },
    { t: tr("Поддержка в системе", "Tizim ichida yordam"), d: tr("Чат с нами прямо из программы", "Biz bilan chat to'g'ridan-to'g'ri dasturdan") },
  ];

  const root = useAnime<HTMLDivElement>(({ animate, stagger, createTimeline }, el) => {
    animate(el.querySelectorAll("[data-role]"), { scale: [0.85, 1], opacity: [0, 1], duration: 420, delay: stagger(90, { start: 150 }), ease: "outBack" });
    // Переключатели прав — по очереди выключаются: директор решает, что оператору не положено.
    const knobs = el.querySelectorAll<HTMLElement>("[data-knob]");
    const tracks = el.querySelectorAll<HTMLElement>("[data-track]");
    const tl = createTimeline({ loop: true, defaults: { ease: "outCubic" } });
    knobs.forEach((k, i) => {
      tl.add(k, { x: [20, 0], duration: 360, delay: i ? 0 : 1200 }, i ? "<+=500" : 0)
        .add(tracks[i], { backgroundColor: [LX.good, LX.ruleStrong], duration: 360 }, "<");
    });
    tl.add(el, { duration: 2400 });
    knobs.forEach((k, i) => {
      tl.add(k, { x: [0, 20], duration: 360 }, i ? "<+=300" : ">")
        .add(tracks[i], { backgroundColor: [LX.ruleStrong, LX.good], duration: 360 }, "<");
    });
    tl.add(el, { duration: 1800 });
    // Строки листа перелетают в карточки.
    animate(el.querySelectorAll("[data-fly]"), { x: [-40, 0], opacity: [0, 1], duration: 620, delay: stagger(220, { start: 900 }), ease: "outCubic" });
    return () => tl.pause();
  }, 0.2);

  return (
    <section id="setup" className="py-20 md:py-32 scroll-mt-16" style={{ background: LX.verso, borderTop: `1px solid ${LX.rule}` }}>
      <div ref={root} className="max-w-[1240px] mx-auto px-6">
        <SectionHead
          index="09"
          label={tr("Настройки", "Sozlamalar")}
          title={tr("Настроили один раз — работает у всех", "Bir marta sozladingiz — hammada ishlaydi")}
          lead={tr("Роль задаёт потолок, настройка опускает пол. Права зашиты на сервере, а не в кнопках: «покажите мне на минутку» не работает — и это правильно.", "Rol shiftni belgilaydi, sozlama polni tushiradi. Huquqlar serverga yozilgan, tugmalarga emas: «bir daqiqaga ko'rsating» ishlamaydi — va bu to'g'ri.")}
        />

        {/* Три колонки с линиями, без коробок: роли · права оператора · сверхлимит */}
        <div className="mt-14 grid md:grid-cols-3" style={{ borderTop: `1px solid ${LX.ruleStrong}`, borderBottom: `1px solid ${LX.rule}` }}>
          <div className="py-7 md:pr-10">
            <div className="text-[11px] uppercase mb-4" style={{ ...MONO, color: LX.brassText, letterSpacing: "0.08em" }}>{tr("Шесть ролей", "Oltita rol")}</div>
            <div className="flex flex-wrap gap-2">
              {roles.map(r => (
                <span key={r} data-role className="inline-flex items-center rounded-full px-3.5 h-10 text-[13.5px] font-medium" style={{ background: LX.paperRaised, border: `1px solid ${LX.ruleStrong}`, color: LX.ink }}>{r}</span>
              ))}
            </div>
            <p className="mt-5 text-[13.5px] leading-relaxed" style={{ color: LX.inkSoft }}>{tr("У каждой — свой набор экранов и ничего лишнего. Агент не увидит прибыль, курьер — каталог.", "Har birida — o'z ekranlari va ortiqchasi yo'q. Agent foydani ko'rmaydi, kuryer — katalogni.")}</p>
          </div>

          <div className="py-7 md:px-10" style={{ borderLeft: `1px solid ${LX.rule}`, borderRight: `1px solid ${LX.rule}` }}>
            <div className="text-[11px] uppercase mb-4" style={{ ...MONO, color: LX.brassText, letterSpacing: "0.08em" }}>{tr("Права оператора", "Operator huquqlari")}</div>
            <ul>
              {rights.map(r => (
                <li key={r} className="flex items-center justify-between gap-3 text-[14px] py-2.5" style={{ color: LX.ink, borderBottom: `1px solid ${LX.rule}` }}>
                  {r}
                  <span data-track className="relative shrink-0 w-11 h-6 rounded-full" style={{ background: LX.good }} aria-hidden="true">
                    <span data-knob className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full" style={{ background: LX.paperRaised, transform: "translateX(20px)", boxShadow: `0 1px 2px ${LX.black25}` }} />
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[13.5px] leading-relaxed" style={{ color: LX.inkSoft }}>{tr("Выключенное закрыто на сервере. По умолчанию разрешено всё — запрет появляется только там, где его поставили руками.", "O'chirilgani serverda yopiladi. Sukut bo'yicha hammasi ruxsat — taqiq faqat qo'lda qo'yilgan joyda paydo bo'ladi.")}</p>
          </div>

          <div className="py-7 md:pl-10">
            <div className="text-[11px] uppercase mb-4" style={{ ...MONO, color: LX.brassText, letterSpacing: "0.08em" }}>{tr("Мало мест или SKU?", "Joy yoki SKU kammi?")}</div>
            <dl>
              {[
                [tr("Рабочее место", "Ish o'rni"), EXTRA_PRICES_UZS.user],
                [tr("Позиция товара (SKU)", "Mahsulot pozitsiyasi (SKU)"), EXTRA_PRICES_UZS.product],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex items-baseline justify-between gap-3 py-2.5" style={{ borderBottom: `1px solid ${LX.rule}` }}>
                  <dt className="text-[14px]" style={{ color: LX.inkSoft }}>{k}</dt>
                  <dd className="text-[18px] font-bold whitespace-nowrap" style={{ ...MONO, color: LX.ink, letterSpacing: "-0.01em" }}>{fmt(Number(v))} <span className="text-[11px] font-normal" style={{ color: LX.inkFaint }}>{tr("сум/мес", "so'm/oy")}</span></dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 text-[13.5px] leading-relaxed" style={{ color: LX.inkSoft }}>{tr("Сверх тарифа — поштучно, без перехода на следующий. Предел ничего не удаляет: всё заведённое работает, нельзя лишь добавить сверх.", "Tarifdan tashqari — donalab, keyingisiga o'tmasdan. Chegara hech narsani o'chirmaydi: kiritilgan hamma narsa ishlaydi, faqat ustiga qo'shib bo'lmaydi.")}</p>
          </div>
        </div>

        {/* Импорт из Excel: лист слева, экран товаров справа */}
        <Split
          className="mt-20 md:mt-24"
          left={
            <div>
              <h3 className="text-[24px] font-bold" style={{ color: LX.ink, letterSpacing: "-0.02em" }}>{tr("Товары и магазины — из Excel", "Mahsulot va do'konlar — Excel dan")}</h3>
              <p className="mt-3 text-[15.5px] leading-relaxed" style={{ color: LX.inkSoft }}>{tr("Скачали шаблон, заполнили, загрузили. Программа сначала показывает, что получится, и только потом записывает.", "Shablonni yukladingiz, to'ldirdingiz, yukladingiz. Dastur avval nima chiqishini ko'rsatadi, keyingina yozadi.")}</p>
              <div className="mt-7 rounded-lg overflow-hidden" style={{ border: `1px solid ${LX.ruleStrong}` }}>
                <div className="grid grid-cols-[92px_1fr_72px] text-[10.5px] uppercase px-3.5 py-2" style={{ ...MONO, background: LX.paper, color: LX.inkFaint, letterSpacing: "0.06em" }}>
                  <span>{tr("код", "kod")}</span><span>{tr("название", "nomi")}</span><span className="text-right">{tr("цена", "narx")}</span>
                </div>
                {sheet.map(r => (
                  <div key={r[0]} data-fly className="grid grid-cols-[92px_1fr_72px] text-[13px] px-3.5 py-2.5" style={{ background: LX.paperRaised, borderTop: `1px solid ${LX.rule}`, color: LX.ink }}>
                    <span style={MONO}>{r[0]}</span><span className="truncate">{r[1]}</span><span className="text-right" style={MONO}>{r[2]}</span>
                  </div>
                ))}
              </div>
            </div>
          }
          right={<Browser shot="products" content alt={tr("Товары: каталог, категории, штрихкоды, импорт из Excel", "Mahsulotlar: katalog, kategoriyalar, shtrix-kodlar, Excel dan import")} />}
        />

        <div className="mt-20 md:mt-24">
          <div className="text-[11px] uppercase mb-4" style={{ ...MONO, color: LX.brassText, letterSpacing: "0.08em" }}>{tr("Что настраивается", "Nima sozlanadi")}</div>
          <Ledger items={caps} />
        </div>
      </div>
    </section>
  );
}
