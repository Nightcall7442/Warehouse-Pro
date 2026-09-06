import { ChevronDown, ChevronUp, Navigation } from "lucide-react";
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

interface AgentRailProps {
  rows: TrackedAgent[];
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
  rows, silentCount, filtered, onResetFilter,
  title, open, onToggle, failed, loading, onRetry,
  selected, onSelect, lang, t,
}: AgentRailProps) {
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

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5" hidden={!open}>
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

function AgentRow({ agent, selected, onSelect, lang, t }: {
  agent: TrackedAgent;
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
          {agent.batteryLevel != null && (
            <span className="text-[10px] font-data"
                  style={{ color: agent.batteryLevel < 20 ? "var(--color-danger-text)" : "var(--color-text-tertiary)" }}>
              🔋 {agent.batteryLevel}%
            </span>
          )}
          {agent.accuracy != null && Number.isFinite(agent.accuracy) && (
            <span className="text-[10px] font-data" style={{ color: "var(--color-text-tertiary)" }}>
              ±{Math.round(agent.accuracy)} {t("м", "m")}
            </span>
          )}
        </span>
      </div>
    </button>
  );
}
