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

  useEffect(() => {
    // Nothing to wait for when the value is cleared — a person who wipes the
    // box wants the full list back immediately, not a third of a second later.
    if (value === "" || value === null || value === undefined) {
      setDebounced(value);
      return;
    }
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);

  return debounced;
}
