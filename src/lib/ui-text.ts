/**
 * Двуязычная строка там, куда не дотягивается контекст языка.
 *
 * Провайдер (src/i18n) хранит выбор в localStorage. Модулям вне дерева React —
 * глобальному обработчику ошибок, очереди офлайн-заказов, экрану падения —
 * контекст недоступен, и берут они то же самое значение напрямую.
 *
 * В обычном компоненте пользоваться этим не нужно: там есть useTranslate().
 */
export function uiText(ru: string, uz: string): string {
  try {
    return localStorage.getItem("lang") === "uz" ? uz : ru;
  } catch {
    // Приватный режим или отключённое хранилище — язык по умолчанию.
    return ru;
  }
}

/**
 * Язык интерфейса там, куда не дотягивается контекст: заголовок x-lang в
 * каждом запросе к серверу и errorText (src/lib/error-text.ts).
 */
export function uiLang(): "ru" | "uz" {
  try {
    return localStorage.getItem("lang") === "uz" ? "uz" : "ru";
  } catch {
    return "ru";
  }
}
