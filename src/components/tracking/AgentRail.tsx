import { useEffect, useRef } from "react";
import { ChevronDown, ChevronUp, Navigation } from "lucide-react";
import { revealRows } from "@/lib/tracking-motion";
import { cssVar } from "@/lib/css-var";
import { readableInk } from "@/lib/contrast";
import { plural } from "@/lib/plural";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { STATE_TINT, timeAgo, type TrackedAgent } from "./agent-roster";

/**
 * Панель агентов на карте слежения.
 *
 * Лежит НА карте, а не отбирает у неё треть ширины: карта здесь главное, а
 * список — то, чем по ней ходят. Поэтому же он сворачивается до заголовка.
 *
 * Отдельным файлом ради проверяемости: самое частое состояние этого экрана —
 * пустое, и оно должно быть не «нет данных», а объяснением. Проверить это на
 * странице целиком значило бы поднимать tRPC, карту и Яндекс.
 */

/** Что агент сделал за сегодня — ровно то, что помещается в строку. */
export interface RailDay {
  visited: number;
  planned: number;
  /** Доля выполнения плана продаж, проценты. null — плана нет. */
  normPct: number | null;
}

interface AgentRailProps {
  rows: TrackedAgent[];
  /** День по агентам. Нет записи — у агента нет плана на сегодня. */
  day: Map<number, RailDay>;
  /** Сколько всего молчащих — не только видимых при отборе. */
  silentCount: number;
  /** Список отобран по состоянию: пусто здесь значит «в этой группе никого». */
  filtered: boolean;
  onResetFilter: () => void;
  title: string;
  open: boolean;
  onToggle: () => void;
  /** Отказ запроса без данных. Это НЕ то же самое, что «никто не делится». */
  failed: boolean;
  loading: boolean;
  onRetry: () => void;
  selected: number | null;
  onSelect: (agentId: number) => void;
  lang: string;
  t: (ru: string, uz: string) => string;
}

export function AgentRail({
  rows, day, silentCount, filtered, onResetFilter,
  title, open, onToggle, failed, loading, onRetry,
  selected, onSelect, lang, t,
}: AgentRailProps) {
  /*
    Список появляется волной, когда меняется его состав.

    Не для красоты: строки приезжают пачкой, и одновременное появление десятка
    одинаковых прямоугольников читается как мелькание. Зависимость — по числу
    строк, а не по данным: точки приходят каждые тридцать секунд, и пере-
    проигрывать волну на каждом опросе значило бы дёргать список под рукой у
    человека.
  */
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!listRef.current) return;
    revealRows(Array.from(listRef.current.children));
  }, [rows.length]);

  return (
    <aside
      className={`flex flex-col mt-3 lg:mt-0 lg:absolute lg:left-3 lg:top-3 lg:w-[270px] lg:z-10${
        open ? " max-h-[340px] lg:max-h-none lg:bottom-3" : ""}`}
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 16,
        boxShadow: "var(--shadow-raised)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="tap flex items-center justify-between px-3 py-2 w-full"
        style={{ borderBottom: open ? "1px solid var(--color-border-subtle)" : "none" }}
      >
        <span className="font-label text-[10px] text-primary tracking-wider">{title}</span>
        <span className="flex items-center gap-1.5" style={{ color: "var(--color-text-tertiary)" }}>
          <span className="font-data text-[11px]">{rows.length}</span>
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-1.5" hidden={!open}>
        {failed ? (
          <QueryErrorFallback
            onRetry={onRetry}
            message={t("Не удалось получить местоположения агентов.",
                       "Agentlar joylashuvini olishning iloji bo'lmadi.")}
          />
        ) : loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 bg-surface-light animate-pulse rounded-xl" />
          ))
        ) : rows.length === 0 ? (
          <EmptyRail filtered={filtered} onReset={onResetFilter} t={t} />
        ) : (
          rows.map(agent => (
            <AgentRow
              key={agent.id}
              agent={agent}
              day={day.get(agent.id)}
              selected={selected === agent.id}
              onSelect={() => onSelect(agent.id)}
              lang={lang}
              t={t}
            />
          ))
        )}
      </div>

      {/* Подвал объясняет молчание — это и есть обычное состояние экрана.
          Когда молчат все, объяснение нужно целиком: где включается и кем.
          Когда молчит часть, хватает счёта — сами строки уже в списке. */}
      {open && !failed && !loading && silentCount > 0 && (
        <div className="px-3 py-2 text-[11px] leading-relaxed"
             style={{ borderTop: "1px solid var(--color-border-subtle)", color: "var(--color-text-tertiary)" }}>
          {rows.length > 0 && rows.every(r => r.state === "silent")
            ? t("Никто не делится местоположением. Геолокацию включает сам агент — на экране «GPS» в приложении.",
                "Hech kim joylashuvni ulashmayapti. Joylashuvni agent o'zi yoqadi — ilovadagi «GPS» ekranida.")
            : t(`${silentCount} ${lang === "uz" ? "agent" : plural(silentCount, "агент", "агента", "агентов")} `
                + `${plural(silentCount, "не делится", "не делятся", "не делятся")} местоположением`,
                `${silentCount} agent joylashuvni ulashmayapti`)}
        </div>
      )}
    </aside>
  );
}

/**
 * Пустой список — не «нет данных», а объяснение.
 *
 * Здесь стояло «Нет данных о локации. Агенты делятся геолокацией со страницы
 * GPS» — фраза, из которой непонятно ни кто должен что-то сделать, ни где.
 * Причём это самое частое состояние экрана, а не редкое: геолокацию включает
 * сам агент, и полсмены проходит без неё.
 */
function EmptyRail({ filtered, onReset, t }: {
  filtered: boolean;
  onReset: () => void;
  t: (ru: string, uz: string) => string;
}) {
  if (filtered) {
    return (
      <div className="text-center py-8 px-3">
        <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          {t("В этой группе никого нет", "Bu guruhda hech kim yo'q")}
        </p>
        <button onClick={onReset} className="neo-btn neo-btn-sm tap mt-3">
          {t("Показать всех", "Hammasini ko'rsatish")}
        </button>
      </div>
    );
  }
  return (
    <div className="text-center py-8 px-3">
      <Navigation size={26} className="mx-auto mb-2 opacity-25" style={{ color: "var(--color-text-tertiary)" }} />
      <p className="text-sm font-medium" style={{ color: "var(--color-text-secondary)" }}>
        {t("Агентов пока нет", "Hozircha agent yo'q")}
      </p>
      <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "var(--color-text-tertiary)" }}>
        {t("Сотрудники с ролью «Агент» заводятся в разделе «Пользователи».",
           "«Agent» rolidagi xodimlar «Foydalanuvchilar» bo'limida qo'shiladi.")}
      </p>
    </div>
  );
}

/**
 * Заряд телефона значком, а не эмодзи.
 *
 * «🔋» на Android отрисовывается зелёной картинкой независимо от заряда: у
 * агента оставалось семь процентов, а строка выглядела бодро. Здесь заливка
 * равна заряду, и красным она становится там, где телефон живёт меньше часа
 * под GPS.
 */
function Battery({ level, t }: { level: number; t: (ru: string, uz: string) => string }) {
  const low = level < 20;
  return (
    <span
      className="flex items-center gap-1 text-[10px] font-data"
      style={{ color: low ? "var(--color-danger-text)" : "var(--color-text-tertiary)" }}
      title={low
        ? t("Телефон скоро сядет — точки и фотоотчёты прекратятся",
             "Telefon tez orada o'chadi — nuqtalar va foto hisobotlar to'xtaydi")
        : t("Заряд телефона", "Telefon quvvati")}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="2" y="7" width="17" height="10" rx="2.5" stroke="currentColor" strokeWidth="2" />
        <rect x="4" y="9" width={Math.max(1, Math.round(13 * (level / 100)))} height="6" rx="1" fill="currentColor" />
        <path d="M21 10.5v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {level}%
    </span>
  );
}

function AgentRow({ agent, day, selected, onSelect, lang, t }: {
  agent: TrackedAgent;
  day?: RailDay;
  selected: boolean;
  onSelect: () => void;
  lang: string;
  t: (ru: string, uz: string) => string;
}) {
  const hasPoint = agent.lat != null && agent.lng != null;
  const tint = cssVar(...STATE_TINT[agent.state]);
  const name = agent.name ?? `${t("Агент", "Agent")} #${agent.id}`;

  return (
    <button
      type="button"
      onClick={hasPoint ? onSelect : undefined}
      disabled={!hasPoint}
      className="tap w-full text-left p-2 rounded-xl border transition-colors"
      style={{
        borderColor: selected ? "var(--color-primary)" : "var(--color-border-subtle)",
        background: selected ? "var(--color-primary-subtle)" : "transparent",
        // Строка без точки никуда не ведёт, и притворяться кнопкой ей нечем.
        cursor: hasPoint ? "pointer" : "default",
        opacity: hasPoint ? 1 : 0.75,
      }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
          // Надпись на заливке — через readableInk: цвета темы у арендатора
          // свои, и «белым по светло-зелёному» в тёмной теме уже было — там
          // --color-success равен #00e68a, контраст с белым 1.7:1.
          style={{ background: tint, color: readableInk(tint) }}
        >
          {name[0].toUpperCase()}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-primary truncate">{name}</span>
          <span className="block text-[11px] truncate" style={{ color: "var(--color-text-tertiary)" }}>
            {agent.state === "silent"
              ? t("Не выходил на связь за сутки", "Sutka davomida aloqaga chiqmadi")
              : `${agent.state === "online" ? t("На связи", "Aloqada") : t("Был здесь", "Shu yerda edi")}`
                + `${agent.at ? ` · ${timeAgo(agent.at, lang)}` : ""}`}
          </span>
        </span>
        <span className="flex flex-col items-end gap-0.5 flex-shrink-0">
          {agent.batteryLevel != null && <Battery level={agent.batteryLevel} t={t} />}
          {agent.accuracy != null && Number.isFinite(agent.accuracy) && (
            <span className="text-[10px] font-data" style={{ color: "var(--color-text-tertiary)" }}>
              ±{Math.round(agent.accuracy)} {t("м", "m")}
            </span>
          )}
        </span>
      </div>

      {/*
        Обход и норма — прямо в строке.

        Кого окликнуть первым, по прежней строке понять было нельзя: у одного
        из девяти точек обойдено две, у другого восемь, и выглядели они
        одинаково. Полоска показывает долю обхода, число справа — норму за
        месяц; вместе они и есть ответ на «кто отстаёт».
      */}
      {day && day.planned > 0 && (
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[10px] font-data flex-shrink-0" style={{ color: "var(--color-text-tertiary)" }}>
            {day.visited}/{day.planned}
          </span>
          <span className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "var(--color-border-subtle)" }}>
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.round((day.visited / day.planned) * 100))}%`,
                background: day.visited >= day.planned ? "var(--color-success)" : "var(--color-primary)",
                transition: "width 400ms ease-out",
              }}
            />
          </span>
          {day.normPct != null && (
            <span
              className="text-[10px] font-data flex-shrink-0"
              title={t("Выполнение плана продаж за месяц", "Oylik savdo rejasining bajarilishi")}
              style={{
                color: day.normPct >= 100 ? "var(--color-success-text)"
                  : day.normPct >= 60 ? "var(--color-warning-text)" : "var(--color-danger-text)",
              }}
            >
              {Math.round(day.normPct)}%
            </span>
          )}
        </div>
      )}
    </button>
  );
}
