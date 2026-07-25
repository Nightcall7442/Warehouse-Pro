import { useState } from "react";
import { X, Pencil, Trash2, Loader2, Plus } from "lucide-react";
import { trpc } from "@/providers/trpc.client";
import { notify } from "@/lib/toast";
import { COLORS, SHADOW, F } from "./constants";

interface TerritoryManagerProps {
  lang: string;
  onClose: () => void;
}

export function TerritoryManager({ lang, onClose }: TerritoryManagerProps) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const utils = trpc.useContext();
  const { data: territories = [], isLoading } = trpc.territory.list.useQuery();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#5b6d8a");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#5b6d8a");

  const createMutation = trpc.territory.create.useMutation({
    onSuccess: () => {
      utils.territory.list.invalidate();
      notify.success(t("Территория создана", "Territoriya yaratildi"));
      setShowCreate(false);
      setNewName("");
    },
    onError: (e) => notify.error(e.message),
  });

  const updateMutation = trpc.territory.update.useMutation({
    onSuccess: () => {
      utils.territory.list.invalidate();
      notify.success(t("Территория обновлена", "Territoriya yangilandi"));
      setEditingId(null);
    },
    onError: (e) => notify.error(e.message),
  });

  const deleteMutation = trpc.territory.delete.useMutation({
    onSuccess: () => {
      utils.territory.list.invalidate();
      notify.success(t("Территория удалена", "Territoriya o'chirildi"));
      setDeleteConfirm(null);
    },
    onError: (e) => notify.error(e.message),
  });

  const PRESET_COLORS = ["#5b6d8a", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4"];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }} onClick={onClose} />
      <div style={{
        position: "relative", background: COLORS.surface, borderRadius: "20px", padding: "24px",
        boxShadow: SHADOW, width: "440px", maxWidth: "90vw", maxHeight: "80vh", display: "flex", flexDirection: "column",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
            {t("Управление территориями", "Territoriyalarni boshqarish")}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
            <X size={18} style={{ color: COLORS.textSecondary }} />
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <div style={{ padding: "12px", borderRadius: "12px", border: `1px solid ${COLORS.border}`, marginBottom: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <input className="neo-input" placeholder={t("Название территории", "Territoriya nomi")} value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setNewColor(c)} style={{
                  width: "24px", height: "24px", borderRadius: "6px", border: newColor === c ? `2px solid ${COLORS.textPrimary}` : "2px solid transparent",
                  background: c, cursor: "pointer",
                }} />
              ))}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => newName.trim() && createMutation.mutate({ name: newName.trim(), color: newColor })}
                disabled={!newName.trim() || createMutation.isPending}
                className="neo-btn-primary" style={{ flex: 1, fontSize: "12px", padding: "8px" }}>
                {createMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : t("Создать", "Yaratish")}
              </button>
              <button onClick={() => setShowCreate(false)} className="neo-btn" style={{ fontSize: "12px", padding: "8px" }}>
                {t("Отмена", "Bekor")}
              </button>
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
          {isLoading ? (
            <div style={{ padding: "24px", textAlign: "center" }}><Loader2 size={20} className="animate-spin" style={{ color: COLORS.primary }} /></div>
          ) : territories.length === 0 && !showCreate ? (
            <div style={{ padding: "24px", textAlign: "center", color: COLORS.textSecondary, fontSize: "13px" }}>
              {t("Нет территорий", "Territoriyalar yo'q")}
            </div>
          ) : (
            territories.map((ter: { id: number; name: string; color?: string | null; shopCount?: number }) => (
              <div key={ter.id} style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "8px 12px", borderRadius: "10px",
                background: deleteConfirm === ter.id ? "rgba(212,80,80,0.06)" : "transparent",
              }}>
                {editingId === ter.id ? (
                  <>
                    <input className="neo-input" style={{ flex: 1, padding: "4px 8px", fontSize: "13px" }} value={editName} onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && editName.trim()) updateMutation.mutate({ id: ter.id, name: editName.trim(), color: editColor }); if (e.key === "Escape") setEditingId(null); }} autoFocus />
                    <div style={{ display: "flex", gap: "4px" }}>
                      {PRESET_COLORS.slice(0, 4).map(c => (
                        <button key={c} onClick={() => setEditColor(c)} style={{
                          width: "18px", height: "18px", borderRadius: "4px", border: editColor === c ? `2px solid ${COLORS.textPrimary}` : "1px solid transparent", background: c, cursor: "pointer",
                        }} />
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: ter.color || COLORS.primary, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: "13px", color: COLORS.textPrimary }}>{ter.name}</span>
                    {ter.shopCount > 0 && <span style={{ fontSize: "11px", color: COLORS.textSecondary }}>{ter.shopCount} {t("магазин(ов)", "do'kon(lar)")}</span>}
                  </>
                )}

                {deleteConfirm === ter.id ? (
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button onClick={() => deleteMutation.mutate({ id: ter.id })} disabled={deleteMutation.isPending}
                      style={{ padding: "4px 10px", borderRadius: "6px", border: "none", fontSize: "11px", fontWeight: 600, background: COLORS.danger, color: "#fff", cursor: "pointer" }}>
                      {deleteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : t("Да", "Ha")}
                    </button>
                    <button onClick={() => setDeleteConfirm(null)}
                      style={{ padding: "4px 10px", borderRadius: "6px", border: `1px solid ${COLORS.border}`, fontSize: "11px", background: COLORS.surface, color: COLORS.textPrimary, cursor: "pointer" }}>
                      {t("Нет", "Yo'q")}
                    </button>
                  </div>
                ) : editingId !== ter.id && (
                  <div style={{ display: "flex", gap: "2px" }}>
                    <button onClick={() => { setEditingId(ter.id); setEditName(ter.name); setEditColor(ter.color || "#5b6d8a"); }}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", borderRadius: "6px" }}>
                      <Pencil size={14} style={{ color: COLORS.textSecondary }} />
                    </button>
                    <button onClick={() => setDeleteConfirm(ter.id)}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", borderRadius: "6px" }}>
                      <Trash2 size={14} style={{ color: COLORS.danger }} />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {!showCreate && (
          <button onClick={() => setShowCreate(true)} className="neo-btn" style={{ marginTop: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "13px" }}>
            <Plus size={14} /> {t("Добавить территорию", "Territoriya qo'shish")}
          </button>
        )}
      </div>
    </div>
  );
}
