/**
 * Ссылка из ошибки прямо в её журнал.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * У каждой записи об ошибке есть correlation id — им помечены все строки
 * журнала одного и того же запроса. Пока ссылки не было, путь выглядел так:
 * переписать идентификатор глазами, открыть Grafana, выбрать источник Loki,
 * набрать запрос, выставить период. Пять шагов между «вижу ошибку» и «вижу,
 * что было вокруг неё» — достаточно, чтобы этого не делал никто.
 *
 * Ведём в Grafana, а не в Loki напрямую: у Loki своей защиты нет, и публичного
 * домена у него нет намеренно. У Grafana вход есть, и Loki подключён к ней
 * источником данных.
 *
 * ── Про формат адреса ───────────────────────────────────────────────────────
 *
 * Grafana читает состояние Explore из параметра `panes` (schemaVersion=1).
 * Прежний `left` в новых выпусках уже не поддерживается, поэтому пишем текущий.
 * Имя источника данных приходит с сервера: в разных установках оно разное, а
 * зашитое в код однажды приведёт в пустой Explore.
 */
export function lokiExploreUrl(opts: {
  grafanaUrl: string;
  datasource: string;
  /** Что искать: обычно correlation id. */
  needle: string;
  /** Метка приложения в журнале. */
  app?: string;
  /** Насколько назад смотреть. */
  from?: string;
}): string {
  const { grafanaUrl, datasource, needle, app = "warehouse-pro", from = "now-24h" } = opts;
  const expr = `{app="${app}"} |= \`${needle}\``;
  const panes = {
    a: {
      datasource,
      queries: [{ refId: "A", datasource: { type: "loki", uid: datasource }, expr, queryType: "range" }],
      range: { from, to: "now" },
    },
  };
  const base = grafanaUrl.replace(/\/+$/, "");
  return `${base}/explore?schemaVersion=1&orgId=1&panes=${encodeURIComponent(JSON.stringify(panes))}`;
}
