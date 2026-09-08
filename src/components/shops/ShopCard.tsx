import { memo, useRef } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { compressImage } from "@/lib/compress-image";
import { MapPin, Phone, Camera, Loader2, AlertCircle, CheckSquare, Square, User } from "lucide-react";
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

      {/*
        Строка делится на три части: КТО, ИТОГ, ДЕЙСТВИЕ.

        Раньше значок статуса, стрелка и имя агента стояли вперемешку: стрелка
        сидела в одной строке со значком и сдвигала его влево, а имя агента
        оказывалось на второй строке с другим правым краем. Оттого столбец
        справа и выглядел рваным — выравнивать было нечего по чему.

        Теперь у итога один правый край на обе строки, а стрелка вынесена за
        него отдельным кружком по центру высоты: это не сведение, а действие,
        и стоять в ряду со сведениями ей незачем.
      */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontFamily: F.display, fontWeight: 700, color: COLORS.textPrimary, fontSize: "16px",
          letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {s.name}
        </p>
        {s.ownerName && (
          <p style={{ fontSize: "12px", color: COLORS.textSecondary, marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {s.ownerName}
          </p>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "8px", flexWrap: "wrap" }}>
          {(s.city || s.district) && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11.5px", color: COLORS.textTertiary }}>
              <MapPin size={11} />{[s.city, s.district].filter(Boolean).join(", ")}
            </span>
          )}
          {s.phone && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11.5px", color: COLORS.textTertiary, fontVariantNumeric: "tabular-nums" }}>
              <Phone size={11} />{s.phone}
            </span>
          )}
        </div>
      </div>

      {/*
        ── Итог ────────────────────────────────────────────────────────────

        Справа стоит только то, что РАЗЛИЧАЕТСЯ между строками.

        Было иначе: в каждой строке одинаковый зелёный значок «Актив», в каждой
        строке стрелка, и обе повторялись сверху донизу. Сведение, которое у
        всех одно и то же, ничего не сообщает — это украшение, выдающее себя за
        данные, и от него столбец и выглядел дёшево.

        Поэтому: состояние показывается ТОЛЬКО когда оно не обычное — «Актив»
        молчит, «Неактив» говорит. Стрелка убрана совсем: нажимается вся
        строка, и она уже отзывается подъёмом при наведении.

        У обычного действующего магазина без долга справа не остаётся ничего —
        и это верно: сказать про него нечего.
      */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "7px", flexShrink: 0 }}>
        {hasDebt && (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: "5px", whiteSpace: "nowrap",
            fontSize: "12.5px", fontWeight: 700, padding: "5px 11px", borderRadius: "999px",
            background: "var(--color-danger-subtle)", color: "var(--color-danger-text)",
            fontVariantNumeric: "tabular-nums",
          }}>
            <AlertCircle size={12} />{fmt(s.debt, { decimals: 0 })}
          </span>
        )}

        {s.status !== "active" && (
          <span style={{
            fontSize: "10px", padding: "5px 11px", borderRadius: "999px", fontWeight: 700,
            letterSpacing: "0.04em", whiteSpace: "nowrap", textTransform: "uppercase",
            background: "var(--color-surface-light)", color: COLORS.textTertiary,
          }}>
            {t("Неактив", "Noaktiv")}
          </span>
        )}

        {/* Значок, а не смайлик: набор смайликов у каждой системы свой, и на
            части устройств «👤» приезжает квадратом. */}
        {s.agentName && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "11.5px", color: COLORS.textTertiary, whiteSpace: "nowrap" }}>
            <User size={11} />{s.agentName}
          </span>
        )}
      </div>
    </div>
  );
});
