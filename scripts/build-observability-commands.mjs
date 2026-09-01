import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/* ═══════════════════════════════════════════════════════════════════════════
   Собрать команды запуска для Prometheus и AlertManager.

   ── Зачем скрипт, а не «написать руками» ───────────────────────────────────

   Обе службы в Railway развёрнуты из готовых образов, без репозитория. Своей
   настройки им взять неоткуда, поэтому её пишет команда запуска: сначала
   создаёт файлы, потом запускает процесс.

   Писать такой однострочник руками — то, на чём Prometheus уже лежал: там
   стоял `echo "global:\n  scrape_interval: 15s\n…"`, а echo эти \n не
   разворачивает, и весь файл ложился одной строкой. Служба падала в цикле
   каждые 0,8 секунды, а Railway показывал «Online».

   Здесь однострочник порождается из читаемых файлов в docs/observability/,
   так что разойтись они не могут, а опечатка в экранировании исключена.

   ── Запуск ─────────────────────────────────────────────────────────────────

       node scripts/build-observability-commands.mjs

   Выводит две команды. Вставить их в Railway: служба → Settings → Deploy →
   Custom Start Command.
   ═══════════════════════════════════════════════════════════════════════════ */

const here = dirname(fileURLToPath(import.meta.url));
const docs = join(here, "..", "docs", "observability");

/**
 * Подготовить содержимое файла к подстановке в `printf "%b" "…"`.
 *
 * Комментарии убираются: в поле команды запуска они не нужны, а место
 * занимают. Пустые строки остаются — внутри блочных значений YAML (например,
 * шаблона сообщения в Telegram) они разделяют абзацы, и терять их нельзя.
 */
function prepare(name) {
  const raw = readFileSync(join(docs, name), "utf8").split("\r\n").join("\n");

  const body = raw
    .split("\n")
    .filter(line => !/^\s*#/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Знаки, которые оборвали бы команду и починить которые заменой нельзя.
  // Проверяем ПОСЛЕ вырезания комментариев: в пояснениях они встречаются
  // законно и до файла настроек не доходят.
  if (body.includes("'")) throw new Error(`${name}: одинарная кавычка закроет sh -c '…'`);
  if (body.includes("`")) throw new Error(`${name}: обратная кавычка выполнится как команда`);

  // Знак процента здесь трогать НЕ надо, хотя рука тянется его удвоить.
  // printf разбирает проценты только в строке формата, а она у нас постоянная
  // — "%b". Настройка идёт доводом, и в доводе % остаётся обычным знаком.
  // Проверено: с удвоением в файл попадало «выше 5%%».
  return body
    .replace(/\\/g, "\\\\")   // обратный слэш — первым, иначе испортим следующие замены
    .replace(/"/g, '\\"')     // кавычки внутри двойных кавычек printf
    .replace(/\n/g, "\\n");   // переносы — теми самыми \n, ради которых нужен %b
}

const prometheus = prepare("prometheus.yml");
const alerts = prepare("alerts.yml");
const alertmanager = prepare("alertmanager.yml");
const loki = prepare("loki.yml");

const promCommand =
  `sh -c 'printf "%b" "${prometheus}" > /etc/prometheus/prometheus.yml && ` +
  `printf "%b" "${alerts}" > /etc/prometheus/alerts.yml && ` +
  `exec /bin/prometheus --config.file=/etc/prometheus/prometheus.yml ` +
  `--storage.tsdb.path=/prometheus --web.listen-address=:9090'`;

const amCommand =
  `sh -c 'printf "%b" "${alertmanager}" > /etc/alertmanager/alertmanager.yml && ` +
  `exec /bin/alertmanager --config.file=/etc/alertmanager/alertmanager.yml ` +
  `--storage.path=/alertmanager --web.listen-address=:9093'`;

const lokiCommand =
  `sh -c 'printf "%b" "${loki}" > /etc/loki/loki.yml && ` +
  `exec /usr/bin/loki -config.file=/etc/loki/loki.yml'`;

console.log("─".repeat(78));
console.log("loki-railway → Settings → Deploy → Custom Start Command");
console.log(`(${lokiCommand.length} знаков)`);
console.log("ВАЖНО: сперва переключить Source на образ grafana/loki:latest");
console.log("       и добавить переменную RAILWAY_RUN_UID=0 — иначе том не запишется");
console.log("─".repeat(78));
console.log(lokiCommand);
console.log();

console.log("─".repeat(78));
console.log("Prometheus-KmLc → Settings → Deploy → Custom Start Command");
console.log(`(${promCommand.length} знаков)`);
console.log("─".repeat(78));
console.log(promCommand);
console.log();
console.log("─".repeat(78));
console.log("AlertManager → Settings → Deploy → Custom Start Command");
console.log(`(${amCommand.length} знаков)`);
console.log("─".repeat(78));
console.log(amCommand);
console.log();
console.log("Перед этим задайте у AlertManager переменные:");
console.log("  TELEGRAM_BOT_TOKEN      — токен бота");
console.log("  TELEGRAM_ALERT_CHAT_ID  — идентификатор чата (у групп со знаком минус)");
