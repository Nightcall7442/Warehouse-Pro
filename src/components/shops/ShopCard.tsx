import { memo, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { Store, MapPin, Phone, Camera, Loader2, AlertCircle, ChevronRight, CheckSquare, Square } from "lucide-react";
import { F, COLORS, SHADOW } from "./constants";

export interface ShopCardData { id: number; name: string; ownerName: string | null; phone: string | null; city: string | null; district: string | null; status: string; debt: string | null; photoUrl: string | null; agentName: string | null; }

export function ShopPhoto({ shopId, photoUrl, size = "md" }: { shopId: number; photoUrl?: string | null; size?: "sm" | "md" | "lg" }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const upload = trpc.shop.uploadPhoto.useMutation({
    onSuccess: () => { utils.shop.list.invalidate(); utils.shop.getById.invalidate({ id: shopId }); notify.success("Фото обновлено"); },
    onError: (e) => notify.error(e.message),
  });
  const dim = size === "sm" ? "w-12 h-12" : size === "lg" ? "w-20 h-20" : "w-16 h-16";
  const iconSize = size === "sm" ? 18 : size === "lg" ? 32 : 22;
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { notify.error("Макс. 2 МБ"); return; }
    const r = new FileReader(); r.onload = () => upload.mutate({ shopId, dataUrl: r.result as string }); r.readAsDataURL(file); e.target.value = "";
  };
  return (
    <div className="relative group" onClick={e => e.stopPropagation()}>
      <div className={`${dim} rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0 cursor-pointer border border-border-subtle`}
        style={{ background: "rgba(75,108,246,.08)" }} onClick={() => fileRef.current?.click()}>
        {upload.isPending ? <Loader2 size={iconSize} className="text-primary animate-spin" />
          : photoUrl ? <img src={photoUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          : <Store size={iconSize} className="text-primary" />}
        <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-xl">
          <Camera size={iconSize - 4} color="#fff" />
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  );
}

export const ShopCard = memo(function ShopCard({ s, onClick, selected, onToggleSelect, lang, fmt, delay }: {
  s: ShopCardData; onClick: () => void; selected?: boolean; onToggleSelect?: () => void;
  lang: string; fmt: (v: number | string | null | undefined, opts?: { decimals?: number }) => string; delay: number;
}) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const hasDebt = Number(s.debt ?? 0) > 0;
  return (
    <div style={{
      background: COLORS.surface, borderRadius: "24px", padding: "20px",
      boxShadow: SHADOW, display: "flex", alignItems: "center", gap: "16px",
      cursor: "pointer", transition: "transform 0.2s, box-shadow 0.2s",
      animation: `slideUp ${0.4 + delay}s ease forwards`,
      border: selected ? `2px solid ${COLORS.primary}` : "2px solid transparent",
    }}
    onClick={onClick}
    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(0,0,0,0.08)"; }}
    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLElement).style.boxShadow = SHADOW; }}
    >
      {onToggleSelect && (
        <button
          onClick={e => { e.stopPropagation(); onToggleSelect(); }}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0, display: "flex" }}
        >
          {selected
            ? <CheckSquare size={20} style={{ color: COLORS.primary }} />
            : <Square size={20} style={{ color: COLORS.textTertiary }} />
          }
        </button>
      )}
      <ShopPhoto shopId={s.id} photoUrl={s.photoUrl} size="lg" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontFamily: F.display, fontWeight: 600, color: COLORS.textPrimary, fontSize: "16px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>
              {s.name}
            </p>
            {s.ownerName && <p style={{ fontSize: "12px", color: COLORS.textSecondary, marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>
              {s.ownerName}
            </p>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            {hasDebt && <span style={{
              display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "12px", fontWeight: 600,
              padding: "2px 8px", borderRadius: "9999px", background: "rgba(232,80,80,.15)",
              color: "#d45050", fontFamily: F.body,
            }}><AlertCircle size={11} />{fmt(s.debt, { decimals: 0 })}</span>}
            <span style={{
              fontSize: "10px", padding: "2px 8px", borderRadius: "9999px", fontWeight: 500,
              background: s.status === "active" ? "rgba(74,222,128,.15)" : COLORS.surfaceLight,
              color: s.status === "active" ? "#34c473" : COLORS.textSecondary,
            }}>
              {s.status === "active" ? t("Актив", "Aktiv") : t("Неактив", "Noaktiv")}
            </span>
            <ChevronRight size={16} style={{ color: COLORS.textSecondary }} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "8px", flexWrap: "wrap" }}>
          {(s.city || s.district) && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", color: COLORS.textSecondary }}>
              <MapPin size={10} />{[s.city, s.district].filter(Boolean).join(", ")}
            </span>
          )}
          {s.phone && <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", color: COLORS.textSecondary }}><Phone size={10} />{s.phone}</span>}
          {s.agentName && <span style={{ marginLeft: "auto", fontSize: "11px", color: COLORS.textSecondary }}>👤 {s.agentName}</span>}
        </div>
      </div>
    </div>
  );
});
