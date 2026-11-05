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
            {t("Оплатить можно наличными, переводом, картой, через Payme или Click. Оставьте заявку — оператор свяжется с вами и после оплаты подключит или продлит тариф.",
              "Naqd pul, o'tkazma, karta, Payme yoki Click orqali to'lash mumkin. So'rov qoldiring — operator siz bilan bog'lanadi va to'lovdan keyin tarifni ulaydi yoki uzaytiradi.")}
          </p>
        </div>
      </div>
    </div>
  );
}
