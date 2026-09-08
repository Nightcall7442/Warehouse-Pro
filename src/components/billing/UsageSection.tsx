import { Users, Package, ClipboardList } from "lucide-react";
import { UsageBar } from "./UsageBar";

interface UsageSectionProps {
  usage: { users: number; products: number; orders: number };
  limits: { maxUsers: number | null; maxProducts: number | null; maxOrdersMonth: number | null };
  t: (ru: string, uz: string) => string;
}

export function UsageSection({ usage, limits, t }: UsageSectionProps) {
  return (
    <div className="neo-card neo-card-static" style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "18px" }}>
      <p style={{
        fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
        color: "var(--color-text-tertiary)",
      }}>
        {t("Использование в этом месяце", "Shu oydagi foydalanish")}
      </p>

      <UsageBar
        icon={Users}
        used={usage.users}
        max={limits.maxUsers}
        label={t("Пользователи", "Foydalanuvchilar")}
        atLimit={t("На пределе новых сотрудников не добавить — сначала тариф выше.",
          "Limitda yangi xodim qo'shib bo'lmaydi — avval yuqori tarif.")}
      />
      <UsageBar
        icon={Package}
        used={usage.products}
        max={limits.maxProducts}
        label={t("Товары (SKU)", "Mahsulotlar (SKU)")}
        atLimit={t("На пределе новый товар в каталог не заведётся.",
          "Limitda katalogga yangi mahsulot qo'shilmaydi.")}
      />
      <UsageBar
        icon={ClipboardList}
        used={usage.orders}
        max={limits.maxOrdersMonth}
        label={t("Заказы (мес.)", "Buyurtmalar (oy)")}
        atLimit={t("На пределе заказы этого месяца перестанут проводиться. Счёт обнуляется первого числа.",
          "Limitda shu oy buyurtmalari o'tmay qoladi. Hisob oyning birinchi kunida yangilanadi.")}
      />
    </div>
  );
}
