import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Pencil, Trash2, Loader2, Plus, MapPin } from "lucide-react";
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
  const [editLat, setEditLat] = useState("");
  const [editLng, setEditLng] = useState("");
  const [editRadius, setEditRadius] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#5b6d8a");
  const [newLat, setNewLat] = useState("");
  const [newLng, setNewLng] = useState("");
  const [newRadius, setNewRadius] = useState("10");

  const createMutation = trpc.territory.create.useMutation({
    onSuccess: () => {
      utils.territory.list.invalidate();
      utils.shop.territories.invalidate();
      notify.success(t("Территория создана", "Territoriya yaratildi"));
      setShowCreate(false);
      setNewName("");
      setNewLat("");
      setNewLng("");
      setNewRadius("10");
    },
    onError: (e) => notify.error(e.message),
  });

  const updateMutation = trpc.territory.update.useMutation({
    onSuccess: () => {
      utils.territory.list.invalidate();
      utils.shop.territories.invalidate();
      notify.success(t("Территория обновлена", "Territoriya yangilandi"));
      setEditingId(null);
    },
    onError: (e) => notify.error(e.message),
  });

  const deleteMutation = trpc.territory.delete.useMutation({
    onSuccess: () => {
      utils.territory.list.invalidate();
      utils.shop.territories.invalidate();
      notify.success(t("Территория удалена", "Territoriya o'chirildi"));
      setDeleteConfirm(null);
    },
    onError: (e) => notify.error(e.message),
  });

  const autoAssignMutation = trpc.territory.autoAssign.useMutation({
    onSuccess: (data) => {
      utils.territory.list.invalidate();
      utils.shop.list.invalidate();
      notify.success(t(`Назначено ${data.assigned} из ${data.total} магазинов`, `${data.assigned} / ${data.total} do'kon tayinlandi`));
    },
    onError: (e) => notify.error(e.message),
  });

  const PRESET_COLORS = ["#5b6d8a", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4"];

  const startEditing = (ter: { id: number; name: string; color?: string | null; centerLat?: string | null; centerLng?: string | null; radiusKm?: string | null }) => {
    setEditingId(ter.id);
    setEditName(ter.name);
    setEditColor(ter.color || "#5b6d8a");
    setEditLat(ter.centerLat ?? "");
    setEditLng(ter.centerLng ?? "");
    setEditRadius(ter.radiusKm ?? "");
  };

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }} onClick={onClose} />
      <div style={{
        position: "relative", background: COLORS.surface, borderRadius: "20px", padding: "24px",
        boxShadow: SHADOW, width: "480px", maxWidth: "90vw", maxHeight: "80vh", display: "flex", flexDirection: "column",
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
              <input className="neo-input" type="number" step="any" placeholder={t("Широта", "Kenglik")} value={newLat} onChange={e => setNewLat(e.target.value)} style={{ flex: 1 }} />
              <input className="neo-input" type="number" step="any" placeholder={t("Долгота", "Uzunlik")} value={newLng} onChange={e => setNewLng(e.target.value)} style={{ flex: 1 }} />
              <input className="neo-input" type="number" step="any" placeholder={t("Радиус км", "Radius km")} value={newRadius} onChange={e => setNewRadius(e.target.value)} style={{ width: "80px" }} />
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => newName.trim() && createMutation.mutate({
                name: newName.trim(), color: newColor,
                centerLat: newLat ? Number(newLat) : undefined,
                centerLng: newLng ? Number(newLng) : undefined,
                radiusKm: newRadius ? Number(newRadius) : undefined,
              })}
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
            territories.map((ter: { id: number; name: string; color?: string | null; shopCount?: number; centerLat?: string | null; centerLng?: string | null; radiusKm?: string | null }) => (
              <div key={ter.id} style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "8px 12px", borderRadius: "10px",
                background: deleteConfirm === ter.id ? "rgba(212,80,80,0.06)" : "transparent",
              }}>
                {editingId === ter.id ? (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                    <input className="neo-input" style={{ padding: "4px 8px", fontSize: "13px" }} value={editName} onChange={e => setEditName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && editName.trim()) updateMutation.mutate({ id: ter.id, name: editName.trim(), color: editColor }); if (e.key === "Escape") setEditingId(null); }} autoFocus />
                    <div style={{ display: "flex", gap: "4px" }}>
                      {PRESET_COLORS.slice(0, 4).map(c => (
                        <button key={c} onClick={() => setEditColor(c)} style={{
                          width: "18px", height: "18px", borderRadius: "4px", border: editColor === c ? `2px solid ${COLORS.textPrimary}` : "1px solid transparent", background: c, cursor: "pointer",
                        }} />
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <input className="neo-input" type="number" step="any" placeholder={t("Широта", "Kenglik")} value={editLat} onChange={e => setEditLat(e.target.value)} style={{ flex: 1, padding: "4px 8px", fontSize: "12px" }} />
                      <input className="neo-input" type="number" step="any" placeholder={t("Долгота", "Uzunlik")} value={editLng} onChange={e => setEditLng(e.target.value)} style={{ flex: 1, padding: "4px 8px", fontSize: "12px" }} />
                      <input className="neo-input" type="number" step="any" placeholder={t("Радиус", "Radius")} value={editRadius} onChange={e => setEditRadius(e.target.value)} style={{ width: "70px", padding: "4px 8px", fontSize: "12px" }} />
                    </div>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <button onClick={() => editName.trim() && updateMutation.mutate({
                        id: ter.id, name: editName.trim(), color: editColor,
                        centerLat: editLat ? Number(editLat) : undefined,
                        centerLng: editLng ? Number(editLng) : undefined,
                        radiusKm: editRadius ? Number(editRadius) : undefined,
                      })} disabled={updateMutation.isPending}
                        className="neo-btn-primary" style={{ flex: 1, fontSize: "11px", padding: "4px" }}>
                        {updateMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : t("Сохранить", "Saqlash")}
                      </button>
                      <button onClick={() => setEditingId(null)} className="neo-btn" style={{ fontSize: "11px", padding: "4px" }}>
                        {t("Отмена", "Bekor")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: ter.color || COLORS.primary, flexShrink: 0 }} />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: "13px", color: COLORS.textPrimary }}>{ter.name}</span>
                      {ter.centerLat && ter.centerLng && (
                        <span style={{ fontSize: "10px", color: COLORS.textTertiary }}>
                          GPS: {Number(ter.centerLat).toFixed(4)}, {Number(ter.centerLng).toFixed(4)} ({ter.radiusKm || 10} km)
                        </span>
                      )}
                    </div>
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
                    <button onClick={() => startEditing(ter)}
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

        <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
          {!showCreate && (
            <button onClick={() => setShowCreate(true)} className="neo-btn" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "13px" }}>
              <Plus size={14} /> {t("Добавить территорию", "Territoriya qo'shish")}
            </button>
          )}
          <button onClick={() => autoAssignMutation.mutate()} disabled={autoAssignMutation.isPending}
            className="neo-btn" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", fontSize: "13px" }}>
            {autoAssignMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}
            {t("Авто-назначение", "Avtotayinlash")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
