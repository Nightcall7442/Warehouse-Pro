import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useNavigate } from "react-router";
import { Truck, MapPin, Clock, CheckCircle2, ChevronRight } from "lucide-react";
import { CardDots, Card, KpiCard, PageHeader } from "@/components/DashboardLayout";

const STATUS: Record<string, { ru: string; uz: string; color: string }> = {
  pending: { ru: "Ожидание", uz: "Kutilmoqda", color: "#fbbf24" },
  delivering: { ru: "Доставка", uz: "Yetkazilmoqda", color: "#60a5fa" },
  delivered: { ru: "Доставлен", uz: "Yetkazildi", color: "#4ade80" },
};

export default function CourierDeliveries() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const navigate = useNavigate();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: deliveries, isLoading } = trpc.courier.deliveries.useQuery() as { data: any; isLoading: boolean };
  const items = deliveries ?? [];
  const pendingCount = items.filter((d: any) => d.status === "pending").length;
  const deliveredCount = items.filter((d: any) => d.status === "delivered").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader title={t("Доставки", "Yetkazishlar")} subtitle={`${items.length} ${t("всего", "jami")}`} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
        <KpiCard label={t("ВСЕГО", "JAMI")} value={String(items.length)} icon={<Truck size={18} color="#818cf8" />} gradient="rgba(129,140,248,.10)" />
        <KpiCard label={t("ОЖИДАНИЕ", "KUTILMOQDA")} value={String(pendingCount)} icon={<Clock size={18} color="#fbbf24" />} gradient="rgba(251,191,36,.10)" />
        <KpiCard label={t("ДОСТАВЛЕНЫ", "YETKAZILDI")} value={String(deliveredCount)} icon={<CheckCircle2 size={18} color="#4ade80" />} gradient="rgba(74,222,128,.10)" />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {isLoading ? (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>...</div>
        ) : items.length === 0 ? (
          <Card><p style={{ textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)", padding: "32px 0" }}>{t("Нет доставок", "Yetkazish yo'q")}</p></Card>
        ) : items.map((d: any) => {
          const s = STATUS[d.status] ?? STATUS.pending;
          return (
            <Card key={d.id} style={{ display: "flex", alignItems: "center", gap: "14px", padding: "16px 20px", cursor: "pointer" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: s.color, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: "14px", fontWeight: 500, color: "var(--color-text-primary, #111827)", margin: 0 }}>{d.shopName ?? "—"}</p>
                <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #9ca3af)", margin: "2px 0 0" }}>
                  <MapPin size={11} style={{ display: "inline", verticalAlign: "middle" }} /> {d.address ?? ""}
                </p>
              </div>
              <span style={{ padding: "3px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, background: `${s.color}15`, color: s.color }}>
                {s[lang as "ru" | "uz"]}
              </span>
              <ChevronRight size={14} color="var(--color-text-tertiary, #9ca3af)" />
            </Card>
          );
        })}
      </div>
    </div>
  );
}
