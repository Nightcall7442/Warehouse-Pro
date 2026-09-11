import { env } from "../lib/env";
import { logger } from "../lib/logger";

/**
 * Подписка бота на вебхук — при старте приложения.
 *
 * ── Почему не руками ────────────────────────────────────────────────────────
 *
 * Разовая команда curl работает ровно до первого переезда: сменился домен,
 * поднялся второй стенд, перевыпустили секрет — и Telegram продолжает стучаться
 * по старому адресу. Отказ при этом молчаливый: бот просто перестаёт отвечать,
 * а причина лежит на стороне Telegram, куда никто не смотрит.
 *
 * Приложение спрашивает у Telegram, куда он сейчас стучится, и переставляет
 * подписку, только если та отличается. Лишний вызов setWebhook на каждом
 * запуске сбрасывал бы очередь необработанных сообщений.
 *
 * ── Почему сверяется не только адрес ────────────────────────────────────────
 *
 * Потому что на этом уже обожглись, и молча. Вебхук оказался подписан ТОЛЬКО
 * на `callback_query`: текстовые сообщения Telegram не присылал вовсе. Адрес
 * при этом совпадал, ошибок не было, очередь пустая — и проверка говорила
 * «вебхук уже на месте». Бот не отвечал ни одному человеку, а по всем
 * признакам был исправен.
 *
 * Это худший вид поломки: ни отказа, ни записи в журнале. Поэтому сверяется
 * ВЕСЬ набор типов обновлений, а не только адрес.
 *
 * ── Чего сверить нельзя ─────────────────────────────────────────────────────
 *
 * Секрет. Telegram его не возвращает, и смену секрета этой проверкой не
 * поймать. Но она и не нужна: с чужим секретом запросы доходят и получают
 * отказ — то есть видны в журнале как 401, в отличие от подписки, которая
 * просто молчит.
 *
 * ── Чего здесь нет ──────────────────────────────────────────────────────────
 *
 * Ни одного слова в журнал с токеном или секретом. Токен даёт право писать от
 * имени бота кому угодно, и место ему в переменных окружения, а не в журнале,
 * который уходит в Loki и живёт там месяц.
 */
/**
 * Что мы просим присылать.
 *
 * Названо здесь, а не внутри запроса: этот набор нужен и для СВЕРКИ с тем, что
 * стоит у Telegram сейчас. Две копии списка разъехались бы, и сверка перестала
 * бы ловить ровно то, ради чего заведена.
 */
const ALLOWED_UPDATES = ["message", "callback_query"] as const;

export async function registerTelegramWebhook(): Promise<void> {
  const token = env.telegramBotToken;
  const secret = env.telegramWebhookSecret;

  if (!token) return;
  if (!secret) {
    // Без секрета вебхук принимать нельзя: его адрес виден всем, кто смотрит
    // трафик, и любой смог бы прислать боту поддельное сообщение.
    logger.warn("telegram: нет TELEGRAM_WEBHOOK_SECRET — бот не подписан на вебхук");
    return;
  }
  if (!env.appUrl.startsWith("https://")) {
    // Telegram принимает только https и молча отказывает на http.
    logger.warn("telegram: APP_URL не https — вебхук не ставится", { appUrl: env.appUrl });
    return;
  }

  const target = `${env.appUrl.replace(/\/+$/, "")}/api/webhooks/telegram`;

  try {
    const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal: AbortSignal.timeout(10_000) })
      .then(r => r.json() as Promise<{ result?: { url?: string; allowed_updates?: string[] } }>);

    const current = [...(info?.result?.allowed_updates ?? [])].sort();
    const wanted = [...ALLOWED_UPDATES].sort();
    const sameUrl = info?.result?.url === target;
    const sameUpdates = current.length === wanted.length && current.every((v, i) => v === wanted[i]);

    if (sameUrl && sameUpdates) {
      logger.info("telegram: вебхук уже на месте", { url: target, allowed: wanted });
      return;
    }

    if (sameUrl) {
      // Адрес тот же, а типы разъехались — именно так бот и молчал.
      logger.warn("telegram: подписка на типы обновлений не та — переставляем", {
        было: current, стало: wanted,
      });
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: target,
        secret_token: secret,
        // Нас интересуют только сообщения и нажатия кнопок. Остальное Telegram
        // не присылает вовсе — это меньше трафика и меньше поводов ошибиться.
        allowed_updates: [...ALLOWED_UPDATES],
        // Накопленное за время простоя не нужно: человек написал вчера, а
        // ответ придёт сегодня — это хуже молчания.
        drop_pending_updates: true,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      logger.error("telegram: не удалось подписаться на вебхук", { status: res.status, detail: detail.slice(0, 200) });
      return;
    }
    logger.info("telegram: вебхук установлен", { url: target });
  } catch (e) {
    // Не роняем запуск: без бота приложение работает, а сеть до Telegram может
    // быть недоступна ровно в момент выкладки.
    logger.error("telegram: подписка на вебхук не удалась", { error: e instanceof Error ? e.message : String(e) });
  }
}
