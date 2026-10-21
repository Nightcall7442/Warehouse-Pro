import { useLang } from "@/i18n";
import { labelled, PURCHASE_ORDER_STATUS_LABEL } from "@/lib/entity-labels";
import { colorMix } from "@/lib/color-mix";
import { F } from "@/components/counterparties/constants";

export type PurchaseOrderStatus = keyof typeof PURCHASE_ORDER_STATUS_LABEL;

/*
  Цвет — по тому, чего заказ ждёт: директора (жёлтый), склада (синий),
  ничего (зелёный — принят; серый — закрыт или черновик; красный — отменён).
  Слова — из общего словаря (contracts/entity-labels), а не свои.
*/
const TONE: Record<PurchaseOrderStatus, string> = {
  draft:              "var(--color-text-tertiary)",
  pending_approval:   "var(--color-warning-text)",
  approved:           "var(--color-info)",
  partially_received: "var(--color-primary-text)",
  received:           "var(--color-success-text)",
  closed:             "var(--color-text-secondary)",
  cancelled:          "var(--color-danger-text)",
};

export function PurchaseOrderStatusBadge({ status }: { status: string }) {
  const { lang } = useLang();
  const color = TONE[status as PurchaseOrderStatus] ?? TONE.draft;
  return (
    <span data-testid="po-status" style={{
      display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 12px",
      borderRadius: "24px", fontSize: "11px", fontWeight: 600, whiteSpace: "nowrap",
      background: colorMix(color, 7), color, fontFamily: F.body,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
      {labelled(PURCHASE_ORDER_STATUS_LABEL, status, lang === "uz" ? "uz" : "ru")}
    </span>
  );
}
