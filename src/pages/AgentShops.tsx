import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { useNavigate } from "react-router";
import { Search, Store, MapPin, Phone, ChevronRight } from "lucide-react";
import { CardDots, Card, KpiCard, PageHeader, inputStyle } from "@/components/DashboardLayout";

export default function AgentShops() {
  const [search, setSearch] = useState("");
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const navigate = useNavigate();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: shops, isLoading } = trpc.agent.myShops.useQuery({ search }) as { data: any; isLoading: boolean };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader title={t("Мои магазины", "Mening do'konlarim")} subtitle={`${(shops ?? []).length} ${t("магазинов", "do'kon")}`} />

      {/* Search */}
      <div style={{ position: "relative" }}>
        <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #9ca3af)" }} />
        <input placeholder={t("Поиск магазинов...", "Do'kon qidirish...")} value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: "36px" }} className="input-field" />
      </div>

      {/* Shop list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {isLoading ? (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>...</div>
        ) : (shops ?? []).length === 0 ? (
          <Card><p style={{ textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)", padding: "32px 0" }}>{t("Нет магазинов", "Do'kon yo'q")}</p></Card>
        ) : (shops ?? []).map((s: any) => (
          <Card key={s.id} onClick={() => navigate(`/agent/visit/${s.id}`)} style={{ display: "flex", alignItems: "center", gap: "16px", padding: "16px 20px", cursor: "pointer" }}>
            <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "var(--color-surface-light, #f3f4f6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Store size={20} color="var(--color-text-tertiary, #9ca3af)" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary, #111827)", margin: 0 }}>{s.name}</p>
              <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #9ca3af)", margin: "2px 0 0" }}>
                <MapPin size={11} style={{ display: "inline", verticalAlign: "middle" }} /> {s.city ?? ""} · <Phone size={11} style={{ display: "inline", verticalAlign: "middle" }} /> {s.phone ?? ""}
              </p>
            </div>
            <ChevronRight size={14} color="var(--color-text-tertiary, #9ca3af)" />
          </Card>
        ))}
      </div>
    </div>
  );
}
