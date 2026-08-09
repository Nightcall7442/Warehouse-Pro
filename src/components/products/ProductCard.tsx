import { memo } from "react";
import { Tag, Scale, Trash2, CheckSquare, Square } from "lucide-react";
import { ProductPhoto } from "./ProductPhoto";
import { F, COLORS, SHADOW, unitLabel } from "./constants";
import { formatQty } from "@/lib/format";

export interface ProductCardProps {
  p: Record<string, unknown>;
  onClick: () => void;
  onDelete: (id: number) => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  lang: string;
  fmt: (v: string | number, opts?: Record<string, unknown>) => string;
}

export const ProductCard = memo(function ProductCard({ p, onClick, onDelete, selected, onToggleSelect, lang, fmt }: ProductCardProps) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const low = Number(p.available ?? 0) < Number(p.reorderPoint);
  const u = unitLabel(p.unit as string, lang);
  return (
    <div
      style={{
        background: COLORS.surface, borderRadius: "16px", padding: "16px",
        boxShadow: SHADOW, display: "flex", alignItems: "center", gap: "16px",
        cursor: "pointer", transition: "all 0.2s",
        border: selected ? `2px solid ${COLORS.primary}` : "2px solid transparent",
      }}
      onClick={onClick}
      onMouseEnter={e => {
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {onToggleSelect && (
        // 44x44 hit area (the touch-target floor) around a 20px glyph: the
        // button itself is the full size and centers a same-looking icon,
        // rather than growing the icon or the row to get there.
        <button
          onClick={e => { e.stopPropagation(); onToggleSelect(); }}
          aria-label={selected ? t("Убрать выделение", "Belgilashni olib tashlash") : t("Выбрать", "Tanlash")}
          style={{
            width: "44px", height: "44px", background: "none", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, margin: "-12px",
          }}
        >
          {selected
            ? <CheckSquare size={20} style={{ color: COLORS.primaryText }} />
            : <Square size={20} style={{ color: COLORS.textTertiary }} />
          }
        </button>
      )}
      <ProductPhoto productId={p.id as number} photoUrl={p.photoUrl as string} size="lg" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontFamily: F.display, fontWeight: 600, color: COLORS.textPrimary, fontSize: "16px", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {String(p.name)}
            </p>
            <p style={{ fontFamily: F.body, color: COLORS.textSecondary, fontSize: "12px", margin: "4px 0 0" }}>
              {String(p.code)}
            </p>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <p style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 700, color: COLORS.primaryText, margin: 0 }}>
              {fmt(String(p.unitPrice), { decimals: 2 })}
            </p>
            {Number(p.costPrice) > 0 && (
              <p style={{ fontSize: "11px", color: COLORS.textSecondary, margin: "2px 0 0" }}>
                {t("себест.", "tannarx")} {fmt(String(p.costPrice), { decimals: 2 })}
              </p>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", flexWrap: "wrap" }}>
          {p.category ? (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "4px",
              fontSize: "11px", padding: "2px 8px", borderRadius: "6px",
              background: COLORS.surfaceLight, color: COLORS.textSecondary,
              fontFamily: F.body,
            }}>
              <Tag size={10} />{String(p.category)}
            </span>
          ) : null}
          {Number(p.unitWeight) > 0 && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "4px",
              fontSize: "11px", padding: "2px 8px", borderRadius: "6px",
              background: COLORS.surfaceLight, color: COLORS.textSecondary,
              fontFamily: F.body,
            }}>
              <Scale size={10} />1 {u} = {formatQty(p.unitWeight as number)} {t("кг", "kg")}
            </span>
          )}
          <span style={{
            marginLeft: "auto", fontSize: "12px", fontFamily: F.body, fontWeight: 600,
            padding: "2px 8px", borderRadius: "6px",
            background: low ? "rgba(232,80,80,0.15)" : "rgba(74,222,128,0.15)",
            color: low ? "var(--color-danger-text)" : "var(--color-success-text)",
          }}>
            {formatQty(p.available as number)} {u}
          </span>
          {/* The visible pill stays 28px so it doesn't dwarf the other badges
              on the row; the button itself is the 44px touch-target floor,
              transparent outside the pill, so tap area grows without the
              circle visually growing with it. */}
          <button
            onClick={e => { e.stopPropagation(); onDelete(Number(p.id)); }}
            aria-label={t("Удалить", "O'chirish")}
            style={{
              width: "44px", height: "44px", background: "none", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, margin: "-8px",
            }}
            title={t("Удалить", "O'chirish")}
          >
            <span
              className="product-delete-pill"
              style={{
                width: "28px", height: "28px", borderRadius: "8px",
                background: "rgba(232,80,80,0.1)",
                display: "flex", alignItems: "center", justifyContent: "center",
                transition: "background 0.15s",
              }}
            >
              <Trash2 size={13} style={{ color: "var(--color-danger-text)" }} />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
});
