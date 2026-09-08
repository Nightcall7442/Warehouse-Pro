import { memo, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { compressImage } from "@/lib/compress-image";
import { MapPin, Phone, Camera, Loader2, AlertCircle, ChevronRight, CheckSquare, Square, User } from "lucide-react";
import { F, COLORS } from "./constants";
import { useAuth } from "@/hooks/useAuth";
import { canOperate } from "@/lib/permissions";
import { useTranslate } from "@/i18n";
import { PhotoOrIcon } from "@/components/PhotoOrIcon";
import { ShopAvatar } from "./ShopAvatar";

export interface ShopCardData { id: number; name: string; ownerName: string | null; phone: string | null; city: string | null; district: string | null; status: string; debt: string | null; photoUrl: string | null; agentName: string | null; }

/**
 * Фото точки. Меняет его тот, кто ведёт магазины.
 *
 * shop.uploadPhoto — operatorQuery, а карточка встречается в общем списке:
 * супервайзер нажимал на фото, выбирал файл и получал отказ уже после
 * загрузки. Роль спрашиваем прямо здесь: компонент один, а мест, откуда его
 * рисуют, будет больше.
 */
export function ShopPhoto({ shopId, shopName = "", photoUrl, size = "md" }: { shopId: number; shopName?: string; photoUrl?: string | null; size?: "sm" | "md" | "lg" }) {
  const t = useTranslate();
  const { user } = useAuth();
  const canEdit = canOperate(user?.role);
  const fileRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const upload = trpc.shop.uploadPhoto.useMutation({
    onSuccess: () => { utils.shop.list.invalidate(); utils.shop.getById.invalidate({ id: shopId }); notify.success(t("Фото обновлено", "Rasm yangilandi")); },
    onError: (e) => notify.error(e.message),
  });
  /*
    Плашка крупнее прежней: в списке она была 80 точек и терялась рядом с
    названием в шестнадцать пунктов. Фотография точки — то, по чему её узнают
    в поле, и разглядывать её должно быть можно.
  */
  const px = size === "sm" ? 52 : size === "lg" ? 96 : 72;
  const iconSize = Math.round(px * 0.34);
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 10 * 1024 * 1024) { notify.error(t("Макс. 10 МБ", "Maks. 10 MB")); return; }
    try {
      const compressed = await compressImage(file);
      upload.mutate({ shopId, dataUrl: compressed });
    } catch { notify.error(t("Ошибка обработки изображения", "Rasmni qayta ishlashda xatolik")); }
    e.target.value = "";
  };
  return (
    <div className="relative group" onClick={e => e.stopPropagation()}>
      <div
        className={`overflow-hidden flex items-center justify-center flex-shrink-0 ${canEdit ? "cursor-pointer" : ""}`}
        style={{
          width: `${px}px`, height: `${px}px`,
          borderRadius: `${Math.round(px * 0.28)}px`,
          // Приподнята тенью, а не обведена рамкой: обводка в один пиксель —
          // приём из другого языка, и на тёмной теме она светлая полоса.
          boxShadow: "var(--shadow-sm)",
          background: "var(--color-surface-light)",
        }}
        onClick={canEdit ? () => fileRef.current?.click() : undefined}
      >
        {upload.isPending
          ? <Loader2 size={iconSize} className="animate-spin" style={{ color: "var(--color-primary-text)" }} />
          : <PhotoOrIcon
              src={photoUrl}
              className="w-full h-full object-cover"
              fallback={<ShopAvatar id={shopId} name={shopName} size={px} />}
            />}
        {canEdit && (
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
            style={{ borderRadius: `${Math.round(px * 0.28)}px`, background: "rgba(0,0,0,0.34)" }}
          >
            <Camera size={iconSize} color="#fff" />
          </div>
        )}
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
    /*
      Подъём и нажатие берёт на себя .neo-card — та же отзывчивость, что у всех
      карточек приложения. Раньше это делали обработчики наведения: они
      присваивали тень числом (rgba(0,0,0,0.08)), которая не знает про тему, и
      возвращали не ту, что стояла изначально.
    */
    <div
      className="neo-card"
      style={{
        padding: "18px", display: "flex", alignItems: "center", gap: "16px",
        cursor: "pointer",
        animation: `slideUp ${0.4 + delay}s ease`,
        ...(selected ? { boxShadow: "var(--shadow-raised), 0 0 0 2px var(--color-primary)" } : {}),
      }}
      onClick={onClick}
    >
      {onToggleSelect && (
        <button
          onClick={e => { e.stopPropagation(); onToggleSelect(); }}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0, display: "flex" }}
        >
          {selected
            ? <CheckSquare size={20} style={{ color: COLORS.primaryText }} />
            : <Square size={20} style={{ color: COLORS.textTertiary }} />
          }
        </button>
      )}
      <ShopPhoto shopId={s.id} shopName={s.name} photoUrl={s.photoUrl} size="lg" />
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
            {/* Заливки — из токенов. Числом здесь стояли rgba(232,80,80,.15) и
                rgba(74,222,128,.15): оба из отменённой палитры и оба не
                менялись вместе с темой. */}
            {hasDebt && <span style={{
              display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: 700,
              padding: "4px 10px", borderRadius: "999px", whiteSpace: "nowrap",
              background: "var(--color-danger-subtle)", color: "var(--color-danger-text)",
              fontVariantNumeric: "tabular-nums",
            }}><AlertCircle size={11} />{fmt(s.debt, { decimals: 0 })}</span>}
            <span style={{
              fontSize: "10px", padding: "4px 10px", borderRadius: "999px", fontWeight: 700,
              letterSpacing: "0.03em", whiteSpace: "nowrap",
              background: s.status === "active" ? "var(--color-success-subtle)" : "var(--color-surface-light)",
              color: s.status === "active" ? "var(--color-success-text)" : COLORS.textTertiary,
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
          {/* Значок, а не смайлик: набор смайликов у каждой системы свой, и
              на части устройств «👤» приезжает квадратом. */}
          {s.agentName && (
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", color: COLORS.textSecondary }}>
              <User size={10} />{s.agentName}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
