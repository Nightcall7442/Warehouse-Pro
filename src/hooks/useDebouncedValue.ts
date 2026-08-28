import { useEffect, useState } from "react";

/**
 * The value, held back until the user stops changing it.
 *
 * Search boxes here fed their state straight into a tRPC query, so every
 * keystroke was a request and a new query key. A new key means React Query has
 * no data for it yet, and a page that renders a skeleton while `!data` throws
 * away the whole screen — including the input the person is typing into, which
 * loses focus. From the user's side that reads as the page reloading on the
 * first letter.
 *
 * Keep the input bound to the immediate state so typing stays instant, and
 * pass the debounced value to the query. 300ms is below the threshold where a
 * pause feels like waiting, and above a comfortable typing cadence, so a
 * fifteen-letter shop name costs one request instead of fifteen.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  // Ждать нечего, когда поле очистили: человек, стерший запрос, хочет полный
  // список сразу, а не через треть секунды.
  //
  // Сброс сделан условной записью при отрисовке, а не в эффекте. Эффект
  // выполняется уже после кадра, поэтому очистка поля давала лишний проход:
  // сначала список, отфильтрованный стёртым запросом, и только следующим
  // кадром — полный. Это тот самый приём с данными предыдущей отрисовки из
  // документации React.
  const cleared = value === "" || value === null || value === undefined;
  if (cleared && debounced !== value) {
    setDebounced(value);
  }

  useEffect(() => {
    if (cleared) return;
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs, cleared]);

  return debounced;
}
