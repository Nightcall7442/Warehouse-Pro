import { useMemo, useState } from "react";
import { APP, appCard } from "./app-skin";
import { useTranslate } from "@/i18n";
import { MapPin, WifiOff, Check } from "lucide-react";
import { LX, MONO } from "./landing-tokens";
import CityMap from "./CityMap";

/* ═══════════════════════════════════════════════════════════════════════════
   ОКНО ПРОДУКТА — чернильная зона №1 (из двух на страницу).

   Полноширинная чернильная полоса, в которую вплавлено окно приложения:
   не тёмная рамка, плавающая на беже, а единый блок. Вкладки листаются
   ТОЛЬКО вручную — автокарусель уводила таблицу из-под глаз читающего, а
   пауза по hover не существует на планшете.

   Внутри — узнаваемая фактура: районы Ташкента, суммы в сумах табличными
   цифрами, отметка «Выгружено в 1С», офлайн-очередь в мобильном. Директор
   верит скриншоту, в котором узнаёт свой день, а не «Store #12, $1,240».
   ═══════════════════════════════════════════════════════════════════════════ */

function Kpi({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div style={appCard(16)}>
      <div className="text-[9.5px] uppercase mb-2" style={{ ...MONO, color: APP.textTertiary, letterSpacing: "0.14em" }}>
        {label}
      </div>
      <div className="text-[19px] font-bold" style={{ ...MONO, color: APP.textPrimary }}>
        {value}
      </div>
      {sub && (
        <div className="text-[10.5px] mt-1" style={{ ...MONO, color: subColor ?? APP.textTertiary }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function OverviewTab() {
  const tr = useTranslate();
  const bars = [34, 52, 41, 68, 57, 84, 73];
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi label={tr("Выручка сегодня", "Bugungi tushum")} value="48 250 000" sub={tr("сум · +18%", "so'm · +18%")} subColor={APP.success} />
        <Kpi label={tr("Заказов", "Buyurtmalar")} value="142" sub={tr("31 в доставке", "31 tasi yo'lda")} />
        <Kpi label={tr("Долги магазинов", "Do'kon qarzlari")} value="12 400 000" sub={tr("сум · 9 точек", "so'm · 9 nuqta")} subColor={APP.danger} />
      </div>
      <div style={appCard(16)}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[9.5px] uppercase" style={{ ...MONO, color: APP.textTertiary, letterSpacing: "0.14em" }}>
            {tr("Продажи, 7 дней", "Sotuvlar, 7 kun")}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10.5px]" style={{ ...MONO, color: APP.success }}>
            <Check size={11} strokeWidth={3} />
            {tr("Выгружено в 1С", "1C ga yuklandi")}
          </span>
        </div>
        <div className="flex items-end gap-2 h-20">
          {bars.map((h, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-[3px]"
              style={{ height: `${h}%`, background: i === bars.length - 1 ? APP.primary : "rgba(72,66,55,0.18)" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function OrdersTab() {
  const tr = useTranslate();
  const rows = useMemo(
    () => [
      { n: "W-2451", shop: "Baraka Market", area: tr("Чиланзар", "Chilonzor"), sum: "2 450 000", s: tr("Доставлен", "Yetkazildi"), tone: APP.success },
      { n: "W-2452", shop: "Diyor Savdo", area: tr("Сергели", "Sergeli"), sum: "1 180 000", s: tr("В пути", "Yo'lda"), tone: "#d4973a" },
      { n: "W-2453", shop: "Olmazor Trade", area: tr("Олмазор", "Olmazor"), sum: "3 640 000", s: tr("Новый", "Yangi"), tone: APP.textTertiary },
      { n: "W-2454", shop: "Mega Do'kon", area: tr("Юнусабад", "Yunusobod"), sum: "940 000", s: tr("Част. возврат", "Qisman qaytdi"), tone: APP.danger },
    ],
    [tr],
  );
  return (
    <div style={{ ...appCard(0), borderRadius: 18 }}>
      {/*
        Четыре колонки только с sm. На 360px фиксированные 64+92+74 плюс
        отступы съедали всю ширину, и колонке «Магазин» оставалось 0 —
        название превращалось в многоточие, а таблица вылезала за карточку.
        Ниже sm строка складывается в две: слева магазин, справа сумма.
      */}
      <div
        className="hidden sm:grid grid-cols-[64px_1fr_96px_88px] md:grid-cols-[76px_1fr_120px_110px] gap-3 px-4 py-2.5 text-[9.5px] uppercase"
        style={{ ...MONO, color: APP.textTertiary, letterSpacing: "0.12em", borderBottom: `1px solid ${APP.border}` }}
      >
        <span>№</span>
        <span>{tr("Магазин", "Do'kon")}</span>
        <span className="text-right">{tr("Сумма", "Summa")}</span>
        <span>{tr("Статус", "Holat")}</span>
      </div>
      {rows.map(r => (
        <div
          key={r.n}
          className="grid grid-cols-[1fr_auto] sm:grid-cols-[64px_1fr_96px_88px] md:grid-cols-[76px_1fr_120px_110px] gap-x-3 gap-y-1 px-4 py-3 items-center"
          style={{ borderBottom: `1px solid ${APP.border}` }}
        >
          <span className="hidden sm:block text-[11px]" style={{ ...MONO, color: APP.textTertiary }}>{r.n}</span>
          <span className="min-w-0">
            <span className="block text-[12.5px] font-medium truncate" style={{ color: APP.textPrimary }}>{r.shop}</span>
            <span className="block text-[10.5px] truncate" style={{ ...MONO, color: APP.textTertiary }}>
              <span className="sm:hidden">{r.n} · </span>{r.area}
            </span>
          </span>
          <span className="text-[12px] text-right whitespace-nowrap" style={{ ...MONO, color: APP.textPrimary }}>
            <span className="block sm:hidden text-[10.5px]" style={{ color: r.tone }}>{r.s}</span>
            {r.sum}
          </span>
          <span className="hidden sm:block text-[10.5px] truncate" style={{ ...MONO, color: r.tone }}>{r.s}</span>
        </div>
      ))}
      <div className="px-4 py-2.5 text-[10.5px]" style={{ ...MONO, color: APP.textTertiary }}>
        {tr("142 заказа сегодня · показаны последние", "Bugun 142 buyurtma · oxirgilari ko'rsatilgan")}
      </div>
    </div>
  );
}

function MapTab() {
  const tr = useTranslate();
  return (
    <div className="relative overflow-hidden h-[240px]" style={{ ...appCard(0), borderRadius: 18 }}>
      <CityMap
        pins={[
          { x: 24, y: 26, tone: APP.success },
          { x: 43, y: 38, tone: APP.success },
          { x: 58, y: 24, tone: APP.primary, pulse: true },
          { x: 72, y: 52, tone: APP.success },
          { x: 38, y: 64, tone: APP.textTertiary },
          { x: 84, y: 34, tone: APP.success },
        ]}
        route={[
          [24, 26],
          [43, 38],
          [58, 24],
          [72, 52],
          [84, 34],
        ]}
      />
      <div
        className="absolute bottom-3 left-3 right-3 rounded-lg px-3.5 py-2.5 flex items-center gap-2.5"
        style={{ background: APP.surfaceLight, border: `1px solid ${APP.border}` }}
      >
        <MapPin size={13} style={{ color: APP.primary }} />
        <span className="text-[11.5px] min-w-0 truncate" style={{ ...MONO, color: APP.textPrimary }}>
          {tr("Санжар · Юнусабад · 14/18 точек · 12 мин назад", "Sanjar · Yunusobod · 14/18 nuqta · 12 daqiqa oldin")}
        </span>
      </div>
    </div>
  );
}

function MobileTab() {
  const tr = useTranslate();
  const orders = [
    { n: "W-2455", shop: "Sardor Market", sum: "1 320 000" },
    { n: "W-2456", shop: "Do'stlik Savdo", sum: "760 000" },
    { n: "W-2457", shop: "Chinor Market", sum: "2 080 000" },
  ];
  return (
    <div className="grid md:grid-cols-[220px_1fr] gap-5 items-center">
      <div className="mx-auto w-[200px] rounded-[1.4rem] p-2" style={{ background: APP.surface, border: `1px solid ${APP.border}`, boxShadow: APP.raisedSm }}>
        <div className="rounded-[1.05rem] overflow-hidden" style={{ background: APP.surfaceLight }}>
          <div
            className="px-3 py-2 flex items-center gap-2"
            style={{ background: "rgba(176,90,68,0.12)", borderBottom: `1px solid ${APP.border}` }}
          >
            <WifiOff size={11} style={{ color: APP.danger, flexShrink: 0 }} />
            <span className="text-[9px] whitespace-nowrap" style={{ ...MONO, color: APP.textPrimary }}>
              {tr("Оффлайн · 3 в очереди", "Oflayn · navbatda 3")}
            </span>
          </div>
          <div className="p-2.5 space-y-2">
            {orders.map(o => (
              <div key={o.n} className="rounded-md px-2.5 py-2" style={{ border: `1px solid ${APP.border}` }}>
                <div className="flex justify-between text-[9px]" style={{ ...MONO, color: APP.textTertiary }}>
                  <span>{o.n}</span>
                  <span>{o.sum}</span>
                </div>
                <div className="text-[10.5px] font-medium mt-0.5" style={{ color: APP.textPrimary }}>{o.shop}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-3 px-1">
        {[
          tr("Связи нет — агент продолжает принимать заказы", "Aloqa yo'q — agent buyurtma qabul qilaveradi"),
          tr("Появилась сеть — очередь уходит на сервер сама", "Tarmoq paydo bo'ldi — navbat o'zi serverga ketadi"),
          tr("Фото полки, GPS-отметка визита, долги магазина — всё в телефоне", "Peshtaxta surati, GPS belgisi, do'kon qarzlari — hammasi telefonda"),
        ].map(s => (
          <div key={s} className="flex items-start gap-3">
            <Check size={14} strokeWidth={3} className="mt-0.5 shrink-0" style={{ color: APP.success }} />
            <span className="text-[13.5px] leading-relaxed" style={{ color: APP.textSecondary }}>{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProductWindow() {
  const tr = useTranslate();
  const [tab, setTab] = useState(0);
  const tabs = [
    tr("Обзор", "Umumiy"),
    tr("Заказы", "Buyurtmalar"),
    tr("Карта", "Xarita"),
    tr("Мобильное", "Mobil"),
  ];
  return (
    <section id="product" className="lx-ink scroll-mt-16" style={{ background: LX.ink }}>
      <div className="max-w-[1240px] mx-auto px-6 py-16 md:py-20">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
          <h2
            className="font-bold"
            style={{ fontSize: "clamp(1.6rem, 2.8vw, 2.2rem)", letterSpacing: "-0.025em", color: LX.paperOnInk }}
          >
            {tr("Один экран вместо пяти тетрадей", "Beshta daftar o'rniga bitta ekran")}
          </h2>
          <span className="text-[11px] uppercase" style={{ ...MONO, color: LX.softOnInk, letterSpacing: "0.18em" }}>
            {tr("Интерфейс без прикрас", "Interfeys bo'yoqsiz")}
          </span>
        </div>

        {/* Окно приложения, вплавленное в чернильную полосу */}
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${LX.ruleOnInk}` }}>
          <div className="flex items-center gap-4 px-4 py-3" style={{ background: "rgba(240,238,232,0.06)" }}>
            <div className="hidden sm:flex gap-1.5" aria-hidden="true">
              {[0, 1, 2].map(i => (
                <span key={i} className="w-2.5 h-2.5 rounded-full" style={{ background: LX.faintOnInk }} />
              ))}
            </div>
            <span className="hidden md:block text-[11px]" style={{ ...MONO, color: LX.softOnInk }}>
              app.warehouse-pro.uz
            </span>
            {/*
              Полный паттерн вкладок, а не половина его: объявив
              role="tablist", мы обещаем скринридеру навигацию стрелками и
              связь вкладки с панелью. Без aria-controls, role="tabpanel" и
              обработчика стрелок это обещание не выполнялось — стрелки
              молча не работали, а смена содержимого не озвучивалась.
            */}
            <div
              role="tablist"
              aria-label={tr("Разделы приложения", "Ilova bo'limlari")}
              className="flex gap-1 ml-auto overflow-x-auto"
              onKeyDown={e => {
                const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (!d) return;
                e.preventDefault();
                const next = (tab + d + tabs.length) % tabs.length;
                setTab(next);
                (e.currentTarget.children[next] as HTMLElement | undefined)?.focus();
              }}
            >
              {tabs.map((t, i) => (
                <button
                  key={t}
                  role="tab"
                  id={`wp-tab-${i}`}
                  aria-selected={tab === i}
                  aria-controls={`wp-panel-${i}`}
                  tabIndex={tab === i ? 0 : -1}
                  onClick={() => setTab(i)}
                  className="lx-anim px-3.5 h-10 md:h-8 rounded-md text-[12px] font-medium whitespace-nowrap cursor-pointer transition-colors duration-200"
                  style={
                    tab === i
                      ? { background: LX.paper, color: APP.textPrimary }
                      : { color: LX.softOnInk }
                  }
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div
            role="tabpanel"
            id={`wp-panel-${tab}`}
            aria-labelledby={`wp-tab-${tab}`}
            tabIndex={0}
            className="p-4 md:p-6 outline-none"
            style={{ background: APP.surface }}
          >
            {tab === 0 && <OverviewTab />}
            {tab === 1 && <OrdersTab />}
            {tab === 2 && <MapTab />}
            {tab === 3 && <MobileTab />}
          </div>
        </div>
      </div>
    </section>
  );
}
