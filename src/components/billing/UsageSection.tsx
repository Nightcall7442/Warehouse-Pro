import { Users, Package, ClipboardList } from "lucide-react";
import { COLORS, GRADIENTS, SHADOWS } from "./designTokens";
import { UsageBar } from "./UsageBar";

interface UsageData {
  users: number;
  products: number;
  orders: number;
}

interface LimitsData {
  maxUsers: number | null;
  maxProducts: number | null;
  maxOrdersMonth: number | null;
}

interface UsageSectionProps {
  usage: UsageData;
  limits: LimitsData;
  t: (ru: string, uz: string) => string;
}

export function UsageSection({ usage, limits, t }: UsageSectionProps) {
  return (
    <div className="neo-card" style={{
      padding: "28px",
      marginBottom: "32px",
      animation: "slideUp 0.8s ease forwards",
    }}>
      <p style={{
        fontSize: "12px",
        fontWeight: "600",
        letterSpacing: "0.08em",
        color: COLORS.textSecondary,
        margin: "0 0 20px",
        textTransform: "uppercase",
      }}>
        {t("ИСПОЛЬЗОВАНИЕ В ЭТОМ МЕСЯЦЕ", "SHU OYDAGI FOYDALANISH")}
      </p>
      <UsageBar icon={Users} used={usage.users} max={limits.maxUsers} label={t("Пользователи", "Foydalanuvchilar")} />
      <UsageBar icon={Package} used={usage.products} max={limits.maxProducts} label={t("Товары (SKU)", "Mahsulotlar (SKU)")} />
      <UsageBar icon={ClipboardList} used={usage.orders} max={limits.maxOrdersMonth} label={t("Заказы (мес.)", "Buyurtmalar (oy)")} />
    </div>
  );
}
