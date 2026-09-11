import { env } from "../lib/env";
import { logger } from "../lib/logger";

/* ═══════════════════════════════════════════════════════════════════════════
   Меню команд бота.

   ── Зачем ───────────────────────────────────────────────────────────────────

   Бот и раньше понимал «/остатки» и «/долги» — разбор команд принимает их со
   слэшем. Но узнать об этом было неоткуда: синяя кнопка «Меню» в Telegram
   пуста, пока приложение не сказало, какие команды у него есть. Директор
   нажимал «/» и не видел ничего.

   Возможность, о которой нельзя догадаться, — это возможность, которой нет.

   ── Почему два набора ───────────────────────────────────────────────────────

   Telegram различает личную переписку и группы, и у них разные задачи:

     · в личной — вопросы про дела организации. Их читает человек, чья роль
       это позволяет;
     · в группе — только связывание. Спрашивать в группе нельзя: остатки и
       выручку там прочитали бы все, кого туда добавили, включая тех, кому
       такие числа не показывают.

   Роли Telegram не знает, и раздать команды «директору, но не агенту» он не
   умеет. Поэтому список в личной переписке ОДИН для всех, а отказ по роли
   даёт сам бот — и объясняет его словами.

   ── Почему это отдельный файл ───────────────────────────────────────────────

   Подписка на вебхук решает, ДОЙДЁТ ли сообщение. Меню решает, узнает ли
   человек, что спросить. Обе задачи молчаливые — ошибка в любой выглядит как
   «бот не работает», — но чинятся они по-разному.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Что видно в личной переписке. */
export const PRIVATE_COMMANDS = [
  { command: "help",    description: "Что умеет бот" },
  { command: "stock",   description: "Остатки: что заканчивается" },
  { command: "orders",  description: "Последние заказы" },
  { command: "summary", description: "Сводка за сегодня" },
  { command: "top",     description: "Что лучше продаётся" },
  { command: "debts",   description: "Долги магазинов" },
  { command: "staff",   description: "Кто из сотрудников подключён" },
  { command: "plans",   description: "Визиты на сегодня" },
  { command: "lang",    description: "Сменить язык" },
  { command: "stop",    description: "Отключить уведомления" },
] as const;

/** Что видно в групповом чате. */
export const GROUP_COMMANDS = [
  { command: "link",   description: "Связать чат с организацией" },
  { command: "unlink", description: "Отключить чат от организации" },
] as const;

async function setScope(
  token: string,
  commands: readonly { command: string; description: string }[],
  scope: { type: string },
): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${token}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands, scope }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    logger.error("telegram: меню команд не поставилось", {
      scope: scope.type,
      status: res.status,
      detail: detail.slice(0, 200),
    });
    return false;
  }
  return true;
}

/**
 * Поставить меню команд.
 *
 * Вызывается при старте рядом с подпиской на вебхук. Telegram хранит список у
 * себя, так что повторный вызов ничего не ломает — он просто перезаписывает
 * то же самое.
 *
 * Ни одного слова с токеном в журнал: он даёт право писать от имени бота кому
 * угодно, и место ему в переменных окружения.
 */
export async function registerTelegramCommands(): Promise<void> {
  const token = env.telegramBotToken;
  if (!token) return;

  try {
    const ok = await Promise.all([
      setScope(token, PRIVATE_COMMANDS, { type: "all_private_chats" }),
      setScope(token, GROUP_COMMANDS, { type: "all_group_chats" }),
    ]);
    if (ok.every(Boolean)) {
      logger.info("telegram: меню команд на месте", {
        личных: PRIVATE_COMMANDS.length,
        групповых: GROUP_COMMANDS.length,
      });
    }
  } catch (e) {
    // Не роняем запуск: без меню бот работает, просто команды приходится
    // набирать руками.
    logger.error("telegram: меню команд не поставилось", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
