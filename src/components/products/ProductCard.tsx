import { memo } from "react";
import { Tag, Scale, Boxes, Trash2, CheckSquare, Square, AlertCircle } from "lucide-react";
import { ProductPhoto } from "./ProductPhoto";
import { F, COLORS } from "./constants";
import { formatQty } from "@/lib/format";
import { unitShort } from "@/lib/units";

export interface ProductCardProps {
  p: Record<string, unknown>;
  onClick: () => void;
  onDelete?: (id: number) => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  lang: string;
  fmt: (v: string | number, opts?: Record<string, unknown>) => string;
}

/**
 * Строка товара — та же, что строка магазина (shops/ShopCard).
 *
 * Владелец сравнил два списка и сказал «сделай товары как магазины». Разница
 * была в трёх вещах: плашка 80 точек с обводкой против 96 без неё; своя тень
 * и своя рамка выделения против .neo-card, который отзывается на наведение
 * как всё приложение; и ряд из четырёх плашек-«чипов» под названием, где
 * остаток стоял вперемешку с категорией и кнопкой удаления.
 *
 * Строка делится на три части: ЧТО, ИТОГ, ДЕЙСТВИЕ. Слева — название, код и
 * сведения строчкой со значками, как адрес и телефон у точки. Справа один
 * правый край: цена, под ней себестоимость, под ней остаток. Остаток
 * повышает голос только когда есть что сказать — ниже точки дозаказа или
 * ноль; обычный остаток — тихая цифра. Удаление вынесено за итог отдельной
 * кнопкой: это действие, а не сведение.
 */
export const ProductCard = memo(function ProductCard({ p, onClick, onDelete, selected, onToggleSelect, lang, fmt }: ProductCardProps) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const available = Number(p.available ?? 0);
  const low = available < Number(p.reorderPoint);
  const empty = !(available > 0);
  // Короткая единица: «134 шт», а не «134 штук» — в строке она стоит трижды.
  const u = unitShort(p.unit as string, lang);
  const packSize = Number(p.packSize ?? 0);

  return (
    <div
      className="neo-card"
      data-testid="product-row"
      style={{
        padding: "18px", display: "flex", alignItems: "center", gap: "16px",
        cursor: "pointer",
        ...(selected ? { boxShadow: "var(--shadow-raised), 0 0 0 2px var(--color-primary)" } : {}),
      }}
      onClick={onClick}
    >
      {onToggleSelect && (
        // 44×44 — нижняя граница цели касания вокруг значка в 20 точек.
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

      <ProductPhoto productId={p.id as number} productName={String(p.name ?? "")} photoUrl={p.photoUrl as string} size="lg" />

      {/* ЧТО */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontFamily: F.display, fontWeight: 700, color: COLORS.textPrimary, fontSize: "16px",
          letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0,
        }}>
          {String(p.name)}
        </p>
        {p.code ? (
          <p style={{ fontSize: "12px", color: COLORS.textSecondary, marginTop: "2px", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {String(p.code)}
          </p>
        ) : null}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "8px", flexWrap: "wrap" }}>
          {p.category ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11.5px", color: COLORS.textTertiary }}>
              <Tag size={11} />{String(p.category)}
            </span>
          ) : null}
          {packSize > 0 && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11.5px", color: COLORS.textTertiary, fontVariantNumeric: "tabular-nums" }}>
              <Boxes size={11} />1 {String(p.packLabel || t("упаковка", "qadoq"))} = {formatQty(packSize)} {u}
            </span>
          )}
          {/* «1 кг = 1 кг» ничего не говорит: масса показывается, только когда единица — не килограмм или вес не единичный. */}
          {Number(p.unitWeight) > 0 && !(p.unit === "kg" && Number(p.unitWeight) === 1) && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11.5px", color: COLORS.textTertiary, fontVariantNumeric: "tabular-nums" }}>
              <Scale size={11} />1 {u} = {formatQty(p.unitWeight as number)} {t("кг", "kg")}
            </span>
          )}
        </div>
      </div>

      {/* ИТОГ — один правый край */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
        <p style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 700, color: COLORS.primaryText, margin: 0, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
          {fmt(String(p.unitPrice), { decimals: Number(p.unitPrice) % 1 ? 2 : 0 })}
        </p>
        {Number(p.costPrice) > 0 && (
          <p style={{ fontSize: "11.5px", color: COLORS.textTertiary, margin: 0, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
            {t("себест.", "tannarx")} {fmt(String(p.costPrice), { decimals: Number(p.costPrice) % 1 ? 2 : 0 })}
          </p>
        )}
        {empty || low ? (
          <span style={{
            display: "inline-flex", alignItems: "center", gap: "5px", whiteSpace: "nowrap", marginTop: "3px",
            fontSize: "12.5px", fontWeight: 700, padding: "5px 11px", borderRadius: "999px",
            background: "var(--color-danger-subtle)", color: "var(--color-danger-text)",
            fontVariantNumeric: "tabular-nums",
          }}>
            <AlertCircle size={12} />
            {empty ? t("нет на складе", "omborda yo'q") : `${formatQty(available)} ${u} · ${t("мало", "kam")}`}
          </span>
        ) : (
          <span style={{ fontSize: "12.5px", color: COLORS.textSecondary, whiteSpace: "nowrap", marginTop: "3px", fontVariantNumeric: "tabular-nums" }}>
            {formatQty(available)} {u}
          </span>
        )}
      </div>

      {/* ДЕЙСТВИЕ — только тем, кому его позволит сервер: onDelete не
          передаётся, когда прав нет. */}
      {onDelete && (
        <button
          onClick={e => { e.stopPropagation(); onDelete(Number(p.id)); }}
          aria-label={t("Удалить", "O'chirish")}
          title={t("Удалить", "O'chirish")}
          className="product-delete"
          style={{
            width: "44px", height: "44px", background: "none", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, margin: "-12px -6px -12px 0",
            borderRadius: "12px", color: COLORS.textTertiary,
          }}
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  );
});
