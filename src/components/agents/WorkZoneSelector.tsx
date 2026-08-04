import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, MapPin, Check } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { COLORS, SHADOW, F } from "@/components/shops/constants";

interface WorkZoneSelectorProps {
  agentId: number;
  agentName: string;
  lang: string;
  onClose: () => void;
  onSaved: () => void;
}

export function WorkZoneSelector({ agentId, agentName, lang, onClose, onSaved }: WorkZoneSelectorProps) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const utils = trpc.useUtils();

  const { data: allTerritories = [] } = trpc.territory.list.useQuery();
  const { data: currentZones = [], isLoading } = trpc.agent.listWorkZones.useQuery({ agentId });
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (currentZones.length > 0) {
      setSelected(new Set(currentZones.map((z: { id: number }) => z.id)));
    }
  }, [currentZones]);

  const saveMutation = trpc.agent.setWorkZones.useMutation({
    onSuccess: () => {
      utils.agent.listWorkZones.invalidate();
      notify.success(t("Рабочая зона обновлена", "Ish zonasi yangilandi"));
      onSaved();
    },
    onError: (e) => notify.error(e.message),
  });

  const toggle = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }} onClick={onClose} />
      <div style={{
        position: "relative", background: COLORS.surface, borderRadius: "20px", padding: "24px",
        boxShadow: SHADOW, width: "400px", maxWidth: "90vw", maxHeight: "80vh", display: "flex", flexDirection: "column",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
            <MapPin size={16} style={{ verticalAlign: "middle", marginRight: "6px" }} />
            {t("Рабочая зона", "Ish zonasi")}: {agentName}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
            <X size={18} style={{ color: COLORS.textSecondary }} />
          </button>
        </div>

        {isLoading ? (
          <div style={{ padding: "24px", textAlign: "center" }}>
            <Loader2 size={20} className="animate-spin" style={{ color: COLORS.primaryText }} />
          </div>
        ) : (
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
            {allTerritories.map((ter: { id: number; name: string; color?: string | null }) => {
              const isSelected = selected.has(ter.id);
              return (
                <div key={ter.id} onClick={() => toggle(ter.id)} style={{
                  display: "flex", alignItems: "center", gap: "10px",
                  padding: "10px 12px", borderRadius: "10px", cursor: "pointer",
                  background: isSelected ? "color-mix(in srgb, var(--color-primary) 8%, transparent)" : "transparent",
                  border: `1px solid ${isSelected ? COLORS.primary : "transparent"}`,
                  transition: "all 0.15s",
                }}>
                  <div style={{
                    width: "20px", height: "20px", borderRadius: "6px", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: isSelected ? COLORS.primary : COLORS.surfaceHover,
                    border: `2px solid ${isSelected ? COLORS.primary : COLORS.border}`,
                    transition: "all 0.15s",
                  }}>
                    {isSelected && <Check size={12} color="#fff" />}
                  </div>
                  <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: ter.color || "#5b6d8a", flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: "13px", color: COLORS.textPrimary }}>{ter.name}</span>
                </div>
              );
            })}
            {allTerritories.length === 0 && (
              <div style={{ padding: "20px", textAlign: "center", color: COLORS.textTertiary, fontSize: "13px" }}>
                {t("Нет территорий", "Territoriyalar yo'q")}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
          <button onClick={() => saveMutation.mutate({ agentId, territoryIds: Array.from(selected) })}
            disabled={saveMutation.isPending}
            className="neo-btn-primary" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "13px" }}>
            {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
            {t("Сохранить", "Saqlash")}
          </button>
          <button onClick={onClose} className="neo-btn" style={{ fontSize: "13px" }}>
            {t("Отмена", "Bekor")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
