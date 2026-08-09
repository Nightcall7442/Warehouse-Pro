import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Pencil, Trash2, Tag, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc.client";
import { notify } from "@/lib/toast";
import { COLORS, SHADOW, F } from "./constants";

interface CategoryManagerProps {
  lang: string;
  onClose: () => void;
}

export function CategoryManager({ lang, onClose }: CategoryManagerProps) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const utils = trpc.useContext();
  const { data: categories = [], isLoading } = trpc.product.categories.useQuery();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const renameMutation = trpc.product.renameCategory.useMutation({
    onSuccess: () => {
      utils.product.categories.invalidate();
      utils.product.list.invalidate();
      notify.success(t("Категория переименована", "Kategoriya yangilandi"));
      setEditingId(null);
    },
    onError: (e) => notify.error(e.message),
  });

  const deleteMutation = trpc.product.deleteCategory.useMutation({
    onSuccess: () => {
      utils.product.categories.invalidate();
      utils.product.list.invalidate();
      notify.success(t("Категория удалена", "Kategoriya o'chirildi"));
      setDeleteConfirm(null);
    },
    onError: (e) => notify.error(e.message),
  });

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)" }} onClick={onClose} />
      <div style={{
        position: "relative", background: COLORS.surface, borderRadius: "20px", padding: "24px",
        boxShadow: SHADOW, width: "420px", maxWidth: "90vw", maxHeight: "80vh", display: "flex", flexDirection: "column",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h3 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
            {t("Управление категориями", "Kategoriyalarni boshqarish")}
          </h3>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
            <X size={18} style={{ color: COLORS.textSecondary }} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
          {isLoading ? (
            <div style={{ padding: "24px", textAlign: "center" }}><Loader2 size={20} className="animate-spin" style={{ color: COLORS.primaryText }} /></div>
          ) : categories.length === 0 ? (
            <div style={{ padding: "24px", textAlign: "center", color: COLORS.textSecondary, fontSize: "13px" }}>
              {t("Нет категорий", "Kategoriyalar yo'q")}
            </div>
          ) : (
            categories.map(cat => (
              <div key={cat} style={{
                display: "flex", alignItems: "center", gap: "8px",
                padding: "8px 12px", borderRadius: "10px",
                background: deleteConfirm === cat ? "rgba(212,80,80,0.06)" : "transparent",
                transition: "background 0.15s",
              }}>
                <Tag size={14} style={{ color: COLORS.primaryText, flexShrink: 0 }} />

                {editingId === cat ? (
                  <input
                    autoFocus
                    className="neo-input"
                    style={{ flex: 1, padding: "4px 8px", fontSize: "13px" }}
                    value={editValue}
                    onChange={e => setEditValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && editValue.trim() && editValue !== cat) {
                        renameMutation.mutate({ from: cat, to: editValue.trim() });
                      }
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                ) : (
                  <span style={{ flex: 1, fontSize: "13px", color: COLORS.textPrimary, fontFamily: "'DM Sans', sans-serif" }}>
                    {cat}
                  </span>
                )}

                {deleteConfirm === cat ? (
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button
                      onClick={() => deleteMutation.mutate({ category: cat })}
                      disabled={deleteMutation.isPending}
                      style={{
                        padding: "4px 10px", borderRadius: "6px", border: "none", fontSize: "11px", fontWeight: 600,
                        background: COLORS.danger, color: "#fff", cursor: "pointer",
                      }}
                    >
                      {deleteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : t("Да", "Ha")}
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      style={{
                        padding: "4px 10px", borderRadius: "6px", border: `1px solid ${COLORS.border}`, fontSize: "11px",
                        background: COLORS.surface, color: COLORS.textPrimary, cursor: "pointer",
                      }}
                    >
                      {t("Нет", "Yo'q")}
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: "2px" }}>
                    <button
                      onClick={() => { setEditingId(cat); setEditValue(cat); }}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", borderRadius: "6px" }}
                      title={t("Переименовать", "Nomini o'zgartirish")}
                    >
                      <Pencil size={14} style={{ color: COLORS.textSecondary }} />
                    </button>
                    <button
                      onClick={() => setDeleteConfirm(cat)}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", borderRadius: "6px" }}
                      title={t("Удалить", "O'chirish")}
                    >
                      <Trash2 size={14} style={{ color: COLORS.danger }} />
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
