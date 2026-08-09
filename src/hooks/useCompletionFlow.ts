import { useCallback } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useLang } from "@/i18n";
import { useInvalidateOrderCaches } from "./useOrderCacheSync";
import type { CompletionData, CompletionMode } from "@/components/orders/CompletionFlowModal";

// Statuses that require the completion flow modal
export const COMPLETION_STATUSES: Record<string, CompletionMode> = {
  delivered: "partial_payment",
};

type StatusType = "new" | "processing" | "shipped" | "pending" | "delivered" | "cancelled" | "returned";

interface UseCompletionFlowOptions {
  orderId: number;
  onSuccess?: () => void;
}

/**
 * Shared hook for order completion flow — used by Orders list, OrderSlideOver, and OrderDetail.
 * Centralizes: status interception, mutations, save logic.
 */
export function useCompletionFlow({ orderId, onSuccess }: UseCompletionFlowOptions) {
  const { lang } = useLang();
  const invalidateOrderCaches = useInvalidateOrderCaches();

  const updateStatus = trpc.order.updateStatus.useMutation({
    onSuccess: () => {
      invalidateOrderCaches();
      onSuccess?.();
    },
  });

  const recordPartialDelivery = trpc.order.recordPartialDelivery.useMutation({
    onSuccess: () => {
      invalidateOrderCaches();
      onSuccess?.();
    },
  });

  const recordDeliveryAndPayment = trpc.order.recordDeliveryAndPayment.useMutation({
    onSuccess: () => {
      invalidateOrderCaches();
      onSuccess?.();
    },
  });

  const saving = recordPartialDelivery.isPending || recordDeliveryAndPayment.isPending || updateStatus.isPending;

  const handleCompletionSave = useCallback(async (data: CompletionData, pendingStatus: string | null) => {
    const hasReturns = data.items.some(it => it.deliveredQuantity === 0 || it.returnReason);
    const hasPayment = data.paidAmount && Number(data.paidAmount) > 0;

    try {
      if (hasReturns && hasPayment) {
        await recordDeliveryAndPayment.mutateAsync({
          orderId,
          deliveredItems: data.items,
          payment: { paidAmount: data.paidAmount!, method: data.paymentMethod || "cash", notes: data.notes },
        });
      } else if (hasReturns) {
        await recordPartialDelivery.mutateAsync({ orderId, items: data.items });
      } else if (hasPayment) {
        await recordDeliveryAndPayment.mutateAsync({
          orderId,
          deliveredItems: data.items,
          payment: { paidAmount: data.paidAmount!, method: data.paymentMethod || "cash", notes: data.notes },
        });
      }

      if (pendingStatus) {
        await updateStatus.mutateAsync({ id: orderId, status: pendingStatus as StatusType });
      }

      notify.success(lang === "uz" ? "Buyurtma tugatildi" : "Заказ завершён");
      return true;
    } catch (e) {
      notify.error(e instanceof Error ? e.message : (lang === "uz" ? "Xatolik yuz berdi" : "Произошла ошибка"));
      return false;
    }
  }, [orderId, recordDeliveryAndPayment, recordPartialDelivery, updateStatus, lang]);

  const directStatusChange = useCallback((newStatus: string) => {
    updateStatus.mutate({ id: orderId, status: newStatus as StatusType });
  }, [orderId, updateStatus]);

  return {
    saving,
    handleCompletionSave,
    directStatusChange,
    isCompletionStatus: (status: string) => status in COMPLETION_STATUSES,
    getCompletionMode: (status: string) => COMPLETION_STATUSES[status] as CompletionMode | undefined,
  };
}
