import { Check, Loader2, RefreshCw, Zap, Users, Truck, ClipboardCheck } from "lucide-react";
import { FEATURES, PRODUCT_FEATURES, SERVICE_FEATURES } from "@contracts/constants";
import {
  ANNUAL_DISCOUNT, FIELD_PRICE_UZS, MIN_FIELD_USERS,
  annualPrice, annualSaving, formatSum, monthlyPrice, type FieldRole,
} from "@contracts/pricing";
import { plural } from "@/lib/plural";

export type PlanPeriod = "month" | "year";

interface FieldPlanCardProps {
  /** Активные полевые сейчас и по ролям — с сервера (billing.status). */
  fieldUsers: number;
  byRole: Record<FieldRole, number>;
  /**
   * connect — пробный или новый: «Подключить»;
   * renew — уже на «Стандарте»: «Продлить»;
   * switch — прежний тариф: перейти раньше даты.
   */
  mode: "connect" | "renew" | "switch";
  isPending: boolean;
  onRequest: (period: PlanPeriod) => void;
  t: (ru: string, uz: string) => string;
  /** Экран блокировки: без списка функций — там важна кнопка. */
  compact?: boolean;
}

const ROLE_ICON: Record<FieldRole, typeof Users> = { agent: Users, courier: Truck, merchandiser: ClipboardCheck };

/**
 * «Стандарт» — цена за полевого сотрудника (contracts/pricing.ts).
 *
 * Одна карточка вместо трёх тарифов: выбирать нечего, надо знать, сколько
 * выйдет у этой организации. Поэтому крупно — цена за человека, ниже —
 * сколько людей в поле сейчас (по ролям) и что это даёт за месяц и за год.
 * Все числа из модуля цены; сумму в заявке сервер считает заново сам.
 */
export function FieldPlanCard({ fieldUsers, byRole, mode, isPending, onRequest, t, compact = false }: FieldPlanCardProps) {
  const month = monthlyPrice(fieldUsers);
  const year = annualPrice(fieldUsers);
  const saving = annualSaving(fieldUsers);
  const discount = `−${Math.round(ANNUAL_DISCOUNT * 100)}%`;
  const roleLabel: Record<FieldRole, string> = {
    agent: t(plural(byRole.agent, "агент", "агента", "агентов"), "agent"),
    courier: t(plural(byRole.courier, "курьер", "курьера", "курьеров"), "kuryer"),
    merchandiser: t(plural(byRole.merchandiser, "мерчендайзер", "мерчендайзера", "мерчендайзеров"), "merchandayzer"),
  };
  const action = mode === "renew" ? t("Продлить", "Uzaytirish") : mode === "switch" ? t("Перейти сейчас ·", "Hozir o'tish ·") : t("Подключить", "Ulash");
  const Icon = mode === "renew" ? RefreshCw : Zap;

  return (
    <div className="neo-card neo-card-static" data-testid="field-plan-card"
      style={{ padding: compact ? "22px" : "26px", display: "flex", flexDirection: "column", gap: "20px", textAlign: "left" }}>

      {/* Имя и цена за человека */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-tertiary)" }}>
            {t("Тариф «Стандарт»", "«Standart» tarifi")}
          </p>
          <p style={{ marginTop: "8px", display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
            <span data-testid="field-plan-price" style={{ fontSize: "34px", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1, fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)" }}>
              {formatSum(FIELD_PRICE_UZS)}
            </span>
            <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>{t("сум в месяц", "so'm oyiga")}</span>
          </p>
          <p style={{ marginTop: "6px", fontSize: "13.5px", lineHeight: 1.45, color: "var(--color-text-secondary)" }}>
            {t("за каждого агента, курьера или мерчендайзера", "har bir agent, kuryer yoki merchandayzer uchun")}
          </p>
        </div>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "999px",
          fontSize: "11.5px", fontWeight: 700, whiteSpace: "nowrap",
          color: "var(--color-success-text)", background: "var(--color-success-subtle)",
        }}>
          <Check size={13} /> {t("Все функции включены", "Barcha funksiyalar kiritilgan")}
        </span>
      </div>

      {/* Команда в поле — вдавленная полка, роли приподняты */}
      <div className="neo-card-pressed" style={{ padding: "14px", borderRadius: "18px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "10px" }}>
          {(Object.keys(ROLE_ICON) as FieldRole[]).map(r => {
            const RIcon = ROLE_ICON[r];
            return (
              <div key={r} className="neo-card-sm" data-testid={`field-plan-role-${r}`}
                style={{ padding: "12px 14px", borderRadius: "14px", minWidth: 0, display: "flex", alignItems: "center", gap: "10px" }}>
                <RIcon size={16} style={{ color: "var(--color-primary-text)", flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: "13px", color: "var(--color-text-secondary)" }}>{roleLabel[r]}</span>
                <span style={{ fontSize: "20px", fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)" }}>{byRole[r]}</span>
              </div>
            );
          })}
        </div>
        <p style={{ marginTop: "12px", fontSize: "12.5px", lineHeight: 1.5, color: "var(--color-text-secondary)" }}>
          {t(`Сейчас в поле: ${fieldUsers}. `, `Hozir dalada: ${fieldUsers}. `)}
          {fieldUsers < MIN_FIELD_USERS
            ? t(`Минимум — ${MIN_FIELD_USERS}, к оплате ${MIN_FIELD_USERS}. `, `Eng kami — ${MIN_FIELD_USERS}, to'lovga ${MIN_FIELD_USERS}. `)
            : ""}
          {t("Офис, склад, супервайзеры и директор — бесплатно.", "Ofis, ombor, supervayzerlar va direktor — bepul.")}
        </p>
      </div>

      {/* Месяц и год — две кнопки с суммой на них */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }}>
        <button type="button" className="neo-btn" disabled={isPending} onClick={() => onRequest("month")} data-testid="plan-request-standard"
          style={{ minHeight: "72px", borderRadius: "16px", padding: "12px 16px", display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: "4px", textAlign: "left" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600, color: "var(--color-text-secondary)" }}>
            {isPending ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Icon size={13} />}
            {action} {mode === "switch" ? t("месяц", "bir oy") : t("на месяц", "bir oyga")}
          </span>
          <span data-testid="field-plan-month" style={{ fontSize: "19px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--color-text-primary)" }}>
            {formatSum(month)} <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-secondary)" }}>{t("сум/мес", "so'm/oy")}</span>
          </span>
        </button>
        <button type="button" className="neo-btn-primary" disabled={isPending} onClick={() => onRequest("year")} data-testid="plan-request-standard-year"
          style={{ minHeight: "72px", borderRadius: "16px", padding: "12px 16px", display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: "4px", textAlign: "left" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", fontWeight: 600, opacity: 0.9 }}>
            {isPending ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Icon size={13} />}
            {action} {mode === "switch" ? t(`год · ${discount}`, `bir yil · ${discount}`) : t(`на год · ${discount}`, `bir yilga · ${discount}`)}
          </span>
          <span data-testid="field-plan-year" style={{ fontSize: "19px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {formatSum(year)} <span style={{ fontSize: "12px", fontWeight: 500, opacity: 0.85 }}>{t(`сум · экономия ${formatSum(saving)}`, `so'm · tejash ${formatSum(saving)}`)}</span>
          </span>
        </button>
      </div>

      {!compact && (
        <>
          <div style={{ height: "1px", background: "var(--color-border-subtle)" }} />
          <div>
            <p style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "10px" }}>
              {t("Без ограничений по заказам, товарам и сотрудникам", "Buyurtmalar, mahsulotlar va xodimlar bo'yicha cheklovsiz")}
            </p>
            <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "8px 18px" }}>
              {PRODUCT_FEATURES.map(f => (
                <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: "8px", fontSize: "13px", lineHeight: 1.45, color: "var(--color-text-secondary)" }}>
                  <span style={{
                    width: "18px", height: "18px", borderRadius: "50%", flexShrink: 0, marginTop: "1px",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "var(--color-primary-subtle)", color: "var(--color-primary-text)",
                  }}><Check size={10} /></span>
                  {t(FEATURES[f].ru, FEATURES[f].uz)}
                </li>
              ))}
            </ul>
            <p style={{ marginTop: "14px", fontSize: "12.5px", lineHeight: 1.5, color: "var(--color-text-tertiary)" }}>
              {t("По запросу, отдельно: ", "So'rov bo'yicha, alohida: ")}
              {SERVICE_FEATURES.map(f => t(FEATURES[f].ru, FEATURES[f].uz)).join(" · ")}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
