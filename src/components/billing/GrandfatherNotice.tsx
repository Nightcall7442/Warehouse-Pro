import { CalendarClock, Loader2, RefreshCw } from "lucide-react";
import { FIELD_PRICE_UZS, formatDay, formatSum, type TenantPrice } from "@contracts/pricing";

interface GrandfatherNoticeProps {
  /** Имя прежнего тарифа: «Pro». */
  planName: string;
  pricing: TenantPrice;
  isPending: boolean;
  /** Продлить прежний тариф по прежней цене. */
  onRenew: () => void;
  t: (ru: string, uz: string) => string;
}

/**
 * Прежний тариф действует до GRANDFATHER_UNTIL — сказать это прямо.
 *
 * Решение владельца 05.10.2026: кто уже платит по Basic / Pro / Exclusive,
 * год живёт по прежней цене и с прежними пределами. Директору важно не
 * «тарифы поменялись», а две вещи: до какого числа у него ничего не меняется
 * и сколько он будет платить потом — по своим людям, а не по прайсу.
 */
export function GrandfatherNotice({ planName, pricing, isPending, onRenew, t }: GrandfatherNoticeProps) {
  const until = formatDay(pricing.grandfatheredUntil ?? "");
  return (
    <div className="neo-card neo-card-static" data-testid="grandfather-notice"
      style={{ padding: "22px", display: "flex", flexDirection: "column", gap: "14px",
        background: "linear-gradient(135deg, color-mix(in srgb, var(--color-info) 7%, var(--color-surface)) 0%, var(--color-surface) 100%)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
        <span style={{
          width: "40px", height: "40px", borderRadius: "14px", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--color-info-subtle)", color: "var(--color-info-text)",
        }}><CalendarClock size={18} /></span>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: "15px", fontWeight: 700, lineHeight: 1.35, color: "var(--color-text-primary)" }}>
            {t(`Ваш тариф ${planName} действует по прежней цене до ${until}`, `${planName} tarifingiz ${until} gacha avvalgi narxda amal qiladi`)}
          </p>
          <p style={{ marginTop: "6px", fontSize: "13.5px", lineHeight: 1.55, color: "var(--color-text-secondary)" }}>
            {t(`Затем — ${formatSum(FIELD_PRICE_UZS)} сум за полевого сотрудника: у вас сейчас `, `Keyin — har bir dala xodimi uchun ${formatSum(FIELD_PRICE_UZS)} so'm: hozir sizda `)}
            <b style={{ color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }} data-testid="grandfather-next">
              {pricing.fieldUsers} → {formatSum(pricing.nextMonthly)} {t("сум/мес", "so'm/oy")}
            </b>.
            {" "}{t("До этой даты не меняется ничего: ни цена, ни пределы.", "Shu sanagacha hech narsa o'zgarmaydi: na narx, na limitlar.")}
          </p>
        </div>
      </div>
      <button type="button" className="neo-btn" disabled={isPending} onClick={onRenew} data-testid={`plan-request-${pricing.plan}`}
        style={{ minHeight: "44px", borderRadius: "14px", fontSize: "13.5px", alignSelf: "flex-start", padding: "0 18px" }}>
        {isPending ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <RefreshCw size={15} />}
        {t(`Продлить ${planName} — ${formatSum(pricing.monthly)} сум/мес`, `${planName}ni uzaytirish — ${formatSum(pricing.monthly)} so'm/oy`)}
      </button>
    </div>
  );
}
