import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";

/**
 * Свод для карточки на главной директора — или null, когда карточки нет:
 * не директор (деньги по закупке; главную открывает ещё супервайзер, которому
 * склад не отдают) или делать нечего.
 */
export function useExpiryHome() {
  const { user } = useAuth();
  const ceo = user?.role === "ceo";
  const { data } = trpc.warehouseReports.expiringSummary.useQuery({ withinDays: 30 }, { enabled: ceo, retry: false });
  return ceo && data && data.riskCount + data.expiredCount > 0 ? data : null;
}

/** Подсказки главной о сроках — их заменяет карточка «Сгорит на складе». */
export const EXPIRY_ALERT_TYPES: ReadonlySet<string> = new Set(["expired_stock", "expiring_stock"]);
