import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
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

  // Set default when warehouses load and nothing is selected
  useEffect(() => {
    if (!isLoading && warehouses.length > 0 && selectedId === null) {
      const defaultWarehouse = warehouses.find((w) => w.isDefault);
      if (defaultWarehouse) {
        setSelectedIdState(defaultWarehouse.id);
        localStorage.setItem(STORAGE_KEY, String(defaultWarehouse.id));
      }
    }
  }, [isLoading, warehouses, selectedId]);

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
      value={{ selectedId, setSelectedId, warehouses: trimmedWarehouses, isLoading }}
    >
      {children}
    </WarehouseContext.Provider>
  );
}

export function useWarehouse(): WarehouseContextValue {
  const ctx = useContext(WarehouseContext);
  if (!ctx) {
    throw new Error("useWarehouse must be used within a WarehouseProvider");
  }
  return ctx;
}
