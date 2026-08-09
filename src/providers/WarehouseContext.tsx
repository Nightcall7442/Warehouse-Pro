import { createContext, useContext, useState, useMemo, useEffect, type ReactNode } from "react";
import { trpc } from "./trpc.client";

const STORAGE_KEY = "selectedWarehouseId";

interface Warehouse {
  id: number;
  name: string;
  isDefault: boolean;
}

interface WarehouseContextValue {
  selectedId: number | null;
  setSelectedId: (id: number) => void;
  warehouses: Warehouse[];
  isLoading: boolean;
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
    if (selectedId !== null) return selectedId;
    if (warehouses.length > 0) {
      const def = warehouses.find((w) => w.isDefault);
      if (def) return def.id;
    }
    return null;
  }, [selectedId, warehouses]);

  // Persist resolved warehouse to localStorage (outside render)
  useEffect(() => {
    if (effectiveId !== null) localStorage.setItem(STORAGE_KEY, String(effectiveId));
  }, [effectiveId]);

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
      value={{ selectedId: effectiveId, setSelectedId, warehouses: trimmedWarehouses, isLoading }}
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
