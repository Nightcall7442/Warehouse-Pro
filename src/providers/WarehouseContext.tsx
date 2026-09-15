import { createContext, useContext, useState, useMemo, type ReactNode } from "react";
import { trpc } from "./trpc.client";

const STORAGE_KEY = "selectedWarehouseId";

interface Warehouse {
  id: number;
  name: string;
  isDefault: boolean;
}

interface WarehouseContextValue {
  /** Выбранный склад. Пусто только пока список не пришёл. */
  selectedId: number | null;
  setSelectedId: (id: number) => void;
  warehouses: Warehouse[];
  isLoading: boolean;
  /** Складов больше одного — только тогда на экранах появляется выбор склада,
   *  сравнение и перемещения. При одном складе слова «мультисклад» нет нигде. */
  multi: boolean;
}

const WarehouseContext = createContext<WarehouseContextValue | null>(null);

export function WarehouseProvider({ children }: { children: ReactNode }) {
  const { data: warehouses = [], isLoading } = trpc.warehouseMulti.list.useQuery();
  const [selectedId, setSelectedIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored !== null ? Number(stored) : null;
  });

  // Resolve the effective selectedId: stored value > default warehouse from data > null.
  // This avoids the useEffect-based setState that caused an extra render on mount.
  const effectiveId = useMemo(() => {
    // Сохранённый выбор действует, только если такой склад ещё есть: удалённый
    // или чужой (после смены организации) — падает на основной.
    if (selectedId !== null && warehouses.some((w) => w.id === selectedId)) return selectedId;
    if (warehouses.length > 0) {
      const def = warehouses.find((w) => w.isDefault) ?? warehouses[0];
      localStorage.setItem(STORAGE_KEY, String(def.id));
      return def.id;
    }
    return null;
  }, [selectedId, warehouses]);

  const setSelectedId = (id: number) => {
    setSelectedIdState(id);
    localStorage.setItem(STORAGE_KEY, String(id));
  };

  const trimmedWarehouses = warehouses.map(({ id, name, isDefault }) => ({
    id,
    name,
    isDefault,
  }));

  return (
    <WarehouseContext.Provider
      value={{ selectedId: effectiveId, setSelectedId, warehouses: trimmedWarehouses, isLoading, multi: warehouses.length > 1 }}
    >
      {children}
    </WarehouseContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWarehouse(): WarehouseContextValue {
  const ctx = useContext(WarehouseContext);
  if (!ctx) {
    throw new Error("useWarehouse must be used within a WarehouseProvider");
  }
  return ctx;
}
