import { useState } from "react";
import { MapPin, ChevronDown, ChevronUp, Pencil, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { COLORS, SHADOW, F, type Lang } from "./types";

interface Props {
  lang: Lang;
}

export function AgentTerritoriesSection({ lang }: Props) {
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const [expanded, setExpanded] = useState(true);
  const [editAgent, setEditAgent] = useState<{ id: number; name: string } | null>(null);
  const [selectedTerritories, setSelectedTerritories] = useState<Set<number>>(new Set());

  const { data: agentsWithZones = [], isLoading } = trpc.agent.listAgentsWithZones.useQuery();
  const { data: allTerritories = [] } = trpc.territory.list.useQuery();
  const utils = trpc.useUtils();

  const saveMutation = trpc.agent.setWorkZones.useMutation({
    onSuccess: () => {
      utils.agent.listAgentsWithZones.invalidate();
      utils.agent.listWorkZones.invalidate();
      setEditAgent(null);
    },
  });

  const startEdit = (agentId: number, agentName: string, currentZones: { id: number }[]) => {
    setEditAgent({ id: agentId, name: agentName });
    setSelectedTerritories(new Set(currentZones.map((z) => z.id)));
  };

  const toggleTerritory = (id: number) => {
    setSelectedTerritories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) return null;

  return (
    <div
      style={{
        background: COLORS.surface,
        borderRadius: "24px",
        boxShadow: SHADOW,
        overflow: "visible",
      }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "20px 24px",
          background: "none",
          border: "none",
          cursor: "pointer",
          borderBottom: expanded ? `1px solid ${COLORS.border}` : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "12px",
              background: "linear-gradient(135deg, #5b6d8a, #7b8db0)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MapPin size={18} color="#fff" />
          </div>
          <div style={{ textAlign: "left" }}>
            <h2
              style={{
                fontFamily: F.display,
                fontSize: "16px",
                fontWeight: 600,
                color: COLORS.textPrimary,
                margin: 0,
              }}
            >
              {t("Территории агентов", "Agentlar hududlari")}
            </h2>
            <p
              style={{
                fontSize: "12px",
                color: COLORS.textTertiary,
                margin: "2px 0 0",
                fontFamily: F.body,
              }}
            >
              {t(
                "Распределение территорий по агентам",
                "Agentlar bo'yicha hududlar taqsimoti"
              )}
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp size={18} color={COLORS.textTertiary} />
        ) : (
          <ChevronDown size={18} color={COLORS.textTertiary} />
        )}
      </button>

      {/* Content */}
      {expanded && (
        <div style={{ padding: "16px 24px 24px" }}>
          {agentsWithZones.length === 0 ? (
            <p
              style={{
                textAlign: "center",
                color: COLORS.textTertiary,
                fontSize: "13px",
                padding: "24px",
              }}
            >
              {t("Нет агентов", "Agentlar yo'q")}
            </p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
                gap: "12px",
              }}
            >
              {agentsWithZones.map((agent) => {
                const isEditing = editAgent?.id === agent.id;
                return (
                  <div
                    key={agent.id}
                    style={{
                      border: `1px solid ${isEditing ? COLORS.primary : COLORS.border}`,
                      borderRadius: "16px",
                      padding: "16px",
                      transition: "all 0.15s",
                      background: isEditing ? "rgba(75,108,246,0.04)" : "transparent",
                    }}
                  >
                    {/* Agent header */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "12px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div
                          style={{
                            width: "32px",
                            height: "32px",
                            borderRadius: "10px",
                            background: "rgba(75,108,246,.12)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "12px",
                            fontWeight: 700,
                            color: "#5b6d8a",
                            fontFamily: F.display,
                          }}
                        >
                          {agent.name?.[0]?.toUpperCase()}
                        </div>
                        <span
                          style={{
                            fontSize: "14px",
                            fontWeight: 500,
                            color: COLORS.textPrimary,
                            fontFamily: F.body,
                          }}
                        >
                          {agent.name}
                        </span>
                      </div>
                      {!isEditing && (
                        <button
                          onClick={() => startEdit(agent.id, agent.name, agent.zones)}
                          style={{
                            background: "none",
                            border: `1px solid ${COLORS.border}`,
                            borderRadius: "8px",
                            padding: "6px 10px",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                            fontSize: "11px",
                            color: COLORS.textSecondary,
                            fontFamily: F.body,
                            transition: "all 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = COLORS.primary;
                            e.currentTarget.style.color = COLORS.primary;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = COLORS.border;
                            e.currentTarget.style.color = COLORS.textSecondary;
                          }}
                        >
                          <Pencil size={12} />
                          {t("Изменить", "O'zgartirish")}
                        </button>
                      )}
                    </div>

                    {/* Territories display / edit */}
                    {isEditing ? (
                      <div>
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "6px",
                            marginBottom: "12px",
                            maxHeight: "160px",
                            overflowY: "auto",
                          }}
                        >
                          {allTerritories.map(
                            (ter: { id: number; name: string; color?: string | null }) => {
                              const isSelected = selectedTerritories.has(ter.id);
                              return (
                                <button
                                  key={ter.id}
                                  onClick={() => toggleTerritory(ter.id)}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "6px",
                                    padding: "6px 12px",
                                    borderRadius: "20px",
                                    border: `1.5px solid ${isSelected ? COLORS.primary : COLORS.border}`,
                                    background: isSelected ? "rgba(75,108,246,0.1)" : "transparent",
                                    cursor: "pointer",
                                    fontSize: "12px",
                                    fontFamily: F.body,
                                    color: isSelected ? COLORS.primary : COLORS.textSecondary,
                                    fontWeight: isSelected ? 600 : 400,
                                    transition: "all 0.15s",
                                  }}
                                >
                                  <div
                                    style={{
                                      width: "8px",
                                      height: "8px",
                                      borderRadius: "50%",
                                      background: ter.color || "#5b6d8a",
                                    }}
                                  />
                                  {ter.name}
                                </button>
                              );
                            }
                          )}
                          {allTerritories.length === 0 && (
                            <span style={{ fontSize: "12px", color: COLORS.textTertiary, padding: "8px" }}>
                              {t("Нет территорий", "Territoriyalar yo'q")}
                            </span>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            onClick={() =>
                              saveMutation.mutate({
                                agentId: agent.id,
                                territoryIds: Array.from(selectedTerritories),
                              })
                            }
                            disabled={saveMutation.isPending}
                            className="neo-btn-primary"
                            style={{
                              flex: 1,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "6px",
                              fontSize: "12px",
                              padding: "8px",
                              color: "#fff",
                            }}
                          >
                            {saveMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                            {t("Сохранить", "Saqlash")}
                          </button>
                          <button
                            onClick={() => setEditAgent(null)}
                            className="neo-btn"
                            style={{ fontSize: "12px", padding: "8px 14px" }}
                          >
                            {t("Отмена", "Bekor")}
                          </button>
                        </div>
                      </div>
                    ) : agent.zones.length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {agent.zones.map((z) => (
                          <span
                            key={z.id}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "5px",
                              padding: "4px 10px",
                              borderRadius: "20px",
                              background: "rgba(75,108,246,0.06)",
                              border: `1px solid ${COLORS.border}`,
                              fontSize: "12px",
                              fontFamily: F.body,
                              color: COLORS.textPrimary,
                            }}
                          >
                            <div
                              style={{
                                width: "7px",
                                height: "7px",
                                borderRadius: "50%",
                                background: z.color || "#5b6d8a",
                              }}
                            />
                            {z.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p
                        style={{
                          fontSize: "12px",
                          color: COLORS.textTertiary,
                          margin: 0,
                          fontStyle: "italic",
                        }}
                      >
                        {t("Территория не назначена", "Hudud biriktirilmagan")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
