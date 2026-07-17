import { Search, X } from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { COLORS, SHADOW } from "./constants";

interface AgentOption { id: number; name: string; }

export function ShopFilters({ lang, search, setSearch, viewMode, setViewMode, agentFilter, setAgentFilter, city, district, agents, setPage, resetFilters }: {
  lang: string; search: string; setSearch: (v: string) => void;
  viewMode: "territories" | "list"; setViewMode: (v: "territories" | "list") => void;
  agentFilter: string | undefined; setAgentFilter: (v: string | undefined) => void;
  city: string | undefined; district: string | undefined;
  agents: AgentOption[]; setPage: (v: number | ((p: number) => number)) => void;
  resetFilters: () => void;
}) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  return (
    <div style={{
      background: COLORS.surface, borderRadius: "16px", padding: "16px 20px",
      boxShadow: SHADOW, display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
    }}>
      {/* View mode toggle */}
      <div style={{ display: "flex", borderRadius: "10px", overflow: "hidden", border: `1px solid ${COLORS.border}` }}>
        <button onClick={() => { setViewMode("territories"); resetFilters(); }}
          style={{
            padding: "8px 16px", fontSize: "13px", fontWeight: 600, border: "none", cursor: "pointer",
            background: viewMode === "territories" ? "#5b6d8a" : COLORS.surface,
            color: viewMode === "territories" ? "#fff" : COLORS.textSecondary,
            transition: "all 0.2s",
          }}>
          {t("Территории", "Hududlar")}
        </button>
        <button onClick={() => setViewMode("list")}
          style={{
            padding: "8px 16px", fontSize: "13px", fontWeight: 600, border: "none", cursor: "pointer",
            background: viewMode === "list" ? "#5b6d8a" : COLORS.surface,
            color: viewMode === "list" ? "#fff" : COLORS.textSecondary,
            transition: "all 0.2s",
          }}>
          {t("Все магазины", "Barcha do'konlar")}
        </button>
      </div>

      <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
        <Search size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: COLORS.textSecondary }} />
        <input className="neo-input" style={{ paddingLeft: "40px", width: "100%" }} placeholder={t("Поиск магазинов…", "Do'kon qidirish…")} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
      </div>
      {viewMode === "list" && agents.length > 0 && (
        <PremiumSelect value={agentFilter ?? ""} onChange={v => { setAgentFilter(v || undefined); setPage(1); }}
          options={[{ value: "", label: t("Все агенты", "Barcha agentlar"), ...(agents ?? []).map((a: { id: number; name: string }) => ({ value: String(a.id), label: a.name })) }]}
          width="180px" />
      )}
      {(city || district || agentFilter) && (
        <button onClick={() => { setAgentFilter(undefined); setPage(1); resetFilters(); }} className="neo-btn text-sm px-3 flex items-center gap-1">
          <X size={14} />{t("Сбросить", "Tozalash")}
        </button>
      )}
    </div>
  );
}
