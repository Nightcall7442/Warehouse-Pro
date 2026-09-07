import { useEffect, useRef } from "react";
import { Camera, Clock, Route } from "lucide-react";
import { countTo, sweepRing, revealRows, pulse } from "@/lib/tracking-motion";

/**
 * День выбранного агента: что сделано, насколько это норма и чем подтверждено.
 *
 * ── Зачем панель ────────────────────────────────────────────────────────────
 *
 * Карта отвечала на один вопрос — ГДЕ человек. Директор приходит сюда с
 * другим: ЧТО ОН СЕГОДНЯ СДЕЛАЛ. Ответ был рассыпан по трём экранам: визиты
 * на «Планах визитов», норма на «Планах продаж», фотоотчёт не показывался
 * нигде вовсе. Свести их на карту — не украшение: решение принимают, глядя на
 * точку, и три вкладки между вопросом и ответом это решение откладывают.
 *
 * ── Почему кольца, а не полоски ─────────────────────────────────────────────
 *
 * Здесь два разных прогресса рядом — обход и выручка, — и они меряются в
 * разном: штуки и деньги. Две полоски одинаковой ширины читались бы как одна
 * шкала, разбитая надвое. Кольца различаются формой, а не только подписью, и
 * не выстраиваются в ложное сравнение.
 *
 * ── Числа считаются, а не подставляются ─────────────────────────────────────
 *
 * Экран живой: точки приходят каждые тридцать секунд, и «7 из 9» становится
 * «8 из 9» само. Подставленное число такую перемену не показывает — экран
 * просто выглядит другим. Досчёт от прежнего значения показывает ровно то,
 * что случилось.
 */

export interface AgentDay {
  /** Сколько точек обошли из запланированных. */
  visited: number;
  planned: number;
  /** Доля выполнения плана продаж, проценты. null — плана на месяц нет. */
  normPct: number | null;
  /** Заряд телефона, проценты. null — телефон не сообщал. */
  battery: number | null;
  /** Пройдено за день по точкам GPS, километры. null — точек меньше двух. */
  distanceKm: number | null;
  /** Фотоотчёты сегодняшних визитов: ссылка и подпись магазина. */
  photos: Array<{ planId: number; url: string; shopName: string; at: Date | null }>;
}

const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;

/** Кольцо прогресса с подписью внутри. */
function Ring({
  pct, label, caption, tint, valueText,
}: {
  pct: number | null;
  label: string;
  caption: string;
  tint: string;
  valueText: string;
}) {
  const arcRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    sweepRing(arcRef.current, pct ?? 0, RING_C);
  }, [pct]);

  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex-shrink-0" style={{ width: 62, height: 62 }}>
        <svg width="62" height="62" viewBox="0 0 62 62" style={{ transform: "rotate(-90deg)" }}>
          <circle
            cx="31" cy="31" r={RING_R} fill="none" strokeWidth="6"
            stroke="var(--color-border-subtle)"
          />
          {/*
            Пустое кольцо задаётся сдвигом на всю длину окружности, и ставится
            оно здесь, а не анимацией: не выполнится сценарий — человек увидит
            пустое кольцо с верной подписью рядом, а не полное с чужой долей.
          */}
          <circle
            ref={arcRef}
            cx="31" cy="31" r={RING_R} fill="none" strokeWidth="6" strokeLinecap="round"
            stroke={tint}
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C}
          />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center text-[13px] font-bold font-data"
          style={{ color: "var(--color-text-primary)" }}
        >
          {valueText}
        </span>
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-primary">{label}</div>
        <div className="text-[10px]" style={{ color: "var(--color-text-tertiary)" }}>{caption}</div>
      </div>
    </div>
  );
}

export function AgentDayPanel({
  name, day, loading, onPhotoOpen, t,
}: {
  name: string;
  day: AgentDay;
  loading: boolean;
  onPhotoOpen: (url: string) => void;
  t: (ru: string, uz: string) => string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const visitedRef = useRef<HTMLSpanElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const visitPct = day.planned > 0 ? Math.round((day.visited / day.planned) * 100) : 0;

  // Число обойдённых точек досчитывается от прежнего значения: на живом экране
  // перемена важнее самого числа.
  useEffect(() => {
    countTo(visitedRef.current, day.visited);
  }, [day.visited]);

  // Панель отзывается на приход новых данных — иначе не видно, живой ли экран.
  useEffect(() => { pulse(rootRef.current); }, [day.visited, day.normPct, day.battery]);

  // Снимки приезжают пачкой; волна превращает мелькание в порядок.
  useEffect(() => {
    if (!stripRef.current) return;
    revealRows(Array.from(stripRef.current.children));
  }, [day.photos.length]);

  /*
    Заряд телефона — не любопытство. Агент с севшим телефоном перестанет
    присылать точки и не сможет снять фотоотчёт, и увидеть это надо ДО того,
    как он пропал, а не после. Порог в двадцать процентов — тот, после
    которого телефон живёт меньше часа под GPS.
  */
  const lowBattery = day.battery != null && day.battery < 20;

  return (
    <div
      ref={rootRef}
      className="flex flex-col gap-3 p-3"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 16,
        boxShadow: "var(--shadow-raised)",
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-primary truncate">{name}</div>
          <div className="text-[10px]" style={{ color: "var(--color-text-tertiary)" }}>
            {t("Сегодня", "Bugun")}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {day.distanceKm != null && (
            <span className="flex items-center gap-1 text-[11px] font-data"
                  style={{ color: "var(--color-text-tertiary)" }}>
              <Route size={12} />{day.distanceKm.toFixed(1)} {t("км", "km")}
            </span>
          )}
          {day.battery != null && (
            <span
              className="flex items-center gap-1 text-[11px] font-data px-1.5 py-0.5 rounded-md"
              style={{
                color: lowBattery ? "var(--color-danger-text)" : "var(--color-text-tertiary)",
                background: lowBattery ? "var(--color-danger-subtle)" : "transparent",
              }}
              title={lowBattery
                ? t("Телефон скоро сядет — точки и фотоотчёты прекратятся",
                     "Telefon tez orada o'chadi — nuqtalar va foto hisobotlar to'xtaydi")
                : t("Заряд телефона", "Telefon quvvati")}
            >
              {/*
                Значок рисуется здесь, а не берётся эмодзи. Эмодзи «🔋» на
                Android отрисовывается зелёной картинкой независимо от заряда,
                и садящийся телефон выглядел бодрым.
              */}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect x="2" y="7" width="17" height="10" rx="2.5" stroke="currentColor" strokeWidth="2" />
                <rect x="4" y="9" width={Math.max(1, Math.round(13 * (day.battery / 100)))} height="6" rx="1" fill="currentColor" />
                <path d="M21 10.5v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {day.battery}%
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Ring
          pct={day.planned > 0 ? visitPct : null}
          tint={visitPct >= 100 ? "var(--color-success)" : "var(--color-primary)"}
          label={t("Обход", "Aylanma")}
          caption={day.planned > 0
            ? t(`из ${day.planned} точек`, `${day.planned} nuqtadan`)
            : t("плана на день нет", "kunlik reja yo'q")}
          valueText={day.planned > 0 ? `${visitPct}%` : "—"}
        />
        <Ring
          pct={day.normPct}
          tint={(day.normPct ?? 0) >= 100 ? "var(--color-success)"
            : (day.normPct ?? 0) >= 60 ? "var(--color-warning)" : "var(--color-danger)"}
          label={t("Норма", "Norma")}
          caption={day.normPct != null
            ? t("плана продаж за месяц", "oylik savdo rejasi")
            : t("план не задан", "reja belgilanmagan")}
          valueText={day.normPct != null ? `${Math.round(day.normPct)}%` : "—"}
        />
      </div>

      <div className="flex items-baseline gap-1.5 text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
        <span ref={visitedRef} className="text-sm font-bold font-data text-primary">0</span>
        <span>{t("из", "dan")}</span>
        <span className="font-data">{day.planned}</span>
        <span>{t("точек обойдено", "nuqta aylanildi")}</span>
      </div>

      {/*
        Фотоотчёты — доказательство обхода, и место им рядом с его долей.

        Снимок хранился с самого начала и не показывался нигде: ручки для его
        отдачи не существовало, а отчёт печатал про него «да» или «нет». Здесь
        он открывается в один щелчок — от точки на карте до фотографии витрины.
      */}
      <div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Camera size={12} style={{ color: "var(--color-text-tertiary)" }} />
          <span className="text-[10px] font-semibold tracking-wide uppercase"
                style={{ color: "var(--color-text-tertiary)" }}>
            {t("Фотоотчёты", "Foto hisobotlar")}
          </span>
          <span className="text-[10px] font-data" style={{ color: "var(--color-text-tertiary)" }}>
            {day.photos.length}
          </span>
        </div>

        {loading ? (
          <div className="flex gap-1.5">
            {[0, 1, 2].map(i => (
              <div key={i} className="rounded-lg animate-pulse"
                   style={{ width: 44, height: 44, background: "var(--color-surface-light)" }} />
            ))}
          </div>
        ) : day.photos.length === 0 ? (
          /*
            Пусто — это не сбой, а обычное утро: отметить визит можно и без
            снимка. Строка объясняет именно это, иначе директор считает, что
            фотографии не грузятся.
          */
          <p className="text-[11px] m-0" style={{ color: "var(--color-text-tertiary)" }}>
            {day.visited === 0
              ? t("Сегодня визитов ещё не было", "Bugun hali tashriflar bo'lmadi")
              : t("Визиты отмечены без снимков", "Tashriflar rasmsiz belgilangan")}
          </p>
        ) : (
          <div ref={stripRef} className="flex gap-1.5 overflow-x-auto pb-1">
            {day.photos.map(photo => (
              <button
                key={photo.planId}
                type="button"
                onClick={() => onPhotoOpen(photo.url)}
                className="tap flex-shrink-0 rounded-lg overflow-hidden"
                style={{ width: 44, height: 44, border: "1px solid var(--color-border)" }}
                title={photo.at
                  ? `${photo.shopName} · ${photo.at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
                  : photo.shopName}
              >
                <img src={photo.url} alt={photo.shopName} loading="lazy"
                     style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </button>
            ))}
          </div>
        )}
      </div>

      {day.visited > 0 && day.photos.length < day.visited && (
        <div className="flex items-center gap-1.5 text-[10px]" style={{ color: "var(--color-text-tertiary)" }}>
          <Clock size={11} />
          {t(`Без снимка: ${day.visited - day.photos.length}`,
             `Rasmsiz: ${day.visited - day.photos.length}`)}
        </div>
      )}
    </div>
  );
}
