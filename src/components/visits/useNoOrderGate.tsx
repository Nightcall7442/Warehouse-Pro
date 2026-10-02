import { useState } from "react";
import { useNavigate } from "react-router";
import { NoOrderReasonDialog, type GatePlan, type NoOrderChoice } from "./NoOrderReason";

/**
 * Ворота закрытия визита: есть заказ — пропускают сразу, нет — спрашивают
 * причину. proceed получает выбор (или ничего, если заказ был) и сам зовёт
 * нужную ручку — отметку или снимок.
 */
export function useNoOrderGate({ busy = false }: { busy?: boolean } = {}) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<{ plan: GatePlan; proceed: (choice?: NoOrderChoice) => void } | null>(null);

  const ask = (plan: GatePlan, proceed: (choice?: NoOrderChoice) => void) => {
    if (plan.hasOrder) { proceed(); return; }
    setPending({ plan, proceed });
  };

  const dialog = pending ? (
    <NoOrderReasonDialog
      shopName={pending.plan.shopName}
      busy={busy}
      onCancel={() => setPending(null)}
      onOrder={pending.plan.shopId ? () => { const id = pending.plan.shopId; setPending(null); navigate(`/orders/new?shopId=${id}`); } : undefined}
      onConfirm={choice => { const go = pending.proceed; setPending(null); go(choice); }}
    />
  ) : null;

  return { ask, dialog, open: pending !== null };
}
