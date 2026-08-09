import { useCallback, useMemo, useState } from "react";
import {
  ORDER_COLUMNS,
  defaultLayout,
  findColumn,
  layoutStorageKey,
  normaliseLayout,
  visibleColumns,
  type ColumnId,
  type ColumnLayout,
} from "@/components/orders/order-columns";

/**
 * Read a layout out of storage, surviving anything it might contain.
 *
 * Corrupt JSON, storage disabled by policy, a quota error — none of them are
 * worth a blank page over a table preference.
 */
function read(key: string): ColumnLayout {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? normaliseLayout(JSON.parse(raw)) : defaultLayout();
  } catch {
    return defaultLayout();
  }
}

/**
 * The user's column layout, remembered between visits.
 *
 * localStorage rather than the server: the project has no user-preferences
 * table yet, and adding one to remember which columns someone likes would be a
 * larger change than the feature itself. The cost is that the layout does not
 * follow a person to another browser — worth revisiting if anyone asks, and the
 * read/write are behind this hook precisely so that swap is one file.
 */
export function useOrderColumns(tenantId: number | undefined, userId: number | undefined) {
  const key = layoutStorageKey(tenantId, userId);

  const [layout, setLayout] = useState<ColumnLayout>(() => read(key));

  // The key only settles once the session is known, so it does change after the
  // first render, and signing in as somebody else must not leave the previous
  // person's layout on screen. Adjusting during render rather than in an effect:
  // an effect would paint the default layout first and then correct it, which
  // is a visible flicker of the wrong columns on every load.
  const [readKey, setReadKey] = useState(key);
  if (key !== readKey) {
    setReadKey(key);
    setLayout(read(key));
  }

  const persist = useCallback((next: ColumnLayout) => {
    setLayout(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch { /* preference only; losing it is not worth an error */ }
  }, [key]);

  const toggle = useCallback((id: ColumnId) => {
    if (findColumn(id)?.locked) return;
    setLayout(current => {
      const hidden = current.hidden.includes(id)
        ? current.hidden.filter(x => x !== id)
        : [...current.hidden, id];
      const next = { ...current, hidden };
      try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [key]);

  const move = useCallback((from: ColumnId, to: ColumnId) => {
    if (from === to) return;
    // A locked column stays where it is, and nothing may be dropped onto its
    // slot — the order number leads the row and the actions close it.
    if (findColumn(from)?.locked || findColumn(to)?.locked) return;
    setLayout(current => {
      const order = [...current.order];
      const fromIdx = order.indexOf(from);
      const toIdx = order.indexOf(to);
      if (fromIdx === -1 || toIdx === -1) return current;
      order.splice(toIdx, 0, ...order.splice(fromIdx, 1));
      const next = { ...current, order };
      try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [key]);

  const reset = useCallback(() => {
    persist(defaultLayout());
  }, [persist]);

  const columns = useMemo(() => visibleColumns(layout), [layout]);

  /** Every column in display order, for the settings panel. */
  const all = useMemo(
    () => layout.order.map(id => findColumn(id)).filter((c): c is NonNullable<typeof c> => Boolean(c)),
    [layout.order],
  );

  const isCustomised = useMemo(() => {
    const base = defaultLayout();
    return layout.order.join() !== base.order.join()
      || [...layout.hidden].sort().join() !== [...base.hidden].sort().join();
  }, [layout]);

  return {
    layout, columns, all, toggle, move, reset, isCustomised,
    hiddenCount: layout.hidden.length,
    totalCount: ORDER_COLUMNS.length,
  };
}
