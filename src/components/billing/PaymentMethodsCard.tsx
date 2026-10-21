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
            {t("Как оплатить", "Qanday to'lash")}
          </p>
          {/*
            Здесь стояло «Click, Payme, Uzum Pay» и «оператор свяжется в течение
            30 минут». Ни одной из этих оплат в программе нет, а срок ответа не
            держит ничто. Как есть: «Подключить» шлёт заявку
            (billing.requestUpgrade), тариф включают после оплаты.
          */}
          <p style={{ fontSize: "13px", lineHeight: 1.55, color: "var(--color-text-secondary)" }}>
            {t("Онлайн-оплаты в программе пока нет. Нажмите «Подключить» — заявка придёт нам, мы свяжемся и включим тариф после оплаты.",
              "Dasturda onlayn to'lov hozircha yo'q. «Ulash»ni bosing — ariza bizga keladi, biz bog'lanamiz va to'lovdan keyin tarifni yoqamiz.")}
          </p>
        </div>
      </div>
    </div>
  );
}
