import { Wallet } from "lucide-react";

interface PaymentMethodsCardProps {
  t: (ru: string, uz: string) => string;
}

export function PaymentMethodsCard({ t }: PaymentMethodsCardProps) {
  return (
    <div className="neo-card neo-card-static" style={{ padding: "22px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "14px" }}>
        <div style={{
          width: "40px", height: "40px", borderRadius: "14px", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--color-primary-subtle)", color: "var(--color-primary-text)",
        }}>
          <Wallet size={18} />
        </div>
        <div>
          <p style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "4px" }}>
            {t("Способы оплаты", "To'lov usullari")}
          </p>
          <p style={{ fontSize: "13px", lineHeight: 1.55, color: "var(--color-text-secondary)" }}>
            {t("Оплата через Click, Payme, Uzum Pay. Оператор свяжется с вами в течение 30 минут после запроса.",
              "Click, Payme, Uzum Pay orqali to'lash mumkin. Operator 30 daqiqa ichida bog'lanadi.")}
          </p>
        </div>
      </div>
    </div>
  );
}
