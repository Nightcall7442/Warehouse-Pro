import { Package } from "lucide-react";
import { ProductCard } from "./ProductCard";
import { COLORS, SHADOW } from "./constants";

export interface ProductListProps {
  products: Record<string, unknown>[];
  isLoading: boolean;
  lang: string;
  fmt: (v: string | number, opts?: Record<string, unknown>) => string;
  onProductClick: (product: Record<string, unknown>) => void;
  onDelete: (id: number, name: string) => void;
  selected: Set<number>;
  onToggleSelect: (id: number) => void;
  /** Может ли смотрящий менять каталог. Без права строки рисуются без кнопки
   *  удаления и без флажка выбора — выбирать становится не для чего. По
   *  умолчанию true, чтобы существующие вызовы не меняли поведения. */
  canEdit?: boolean;
}

export function ProductList({ products, isLoading, lang, fmt, onProductClick, onDelete, selected, onToggleSelect, canEdit = true }: ProductListProps) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {isLoading ? (
        Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{
            height: "120px", borderRadius: "16px",
            background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease forwards`,
          }} />
        ))
      ) : products.length === 0 ? (
        <div style={{
          background: COLORS.surface, borderRadius: "24px", padding: "48px",
          boxShadow: SHADOW, textAlign: "center",
        }}>
          <Package size={48} style={{ color: COLORS.textTertiary, margin: "0 auto 16px" }} />
          <p style={{ color: COLORS.textSecondary, fontSize: "14px", margin: 0 }}>
            {t("Нет товаров", "Mahsulot yo'q")}
          </p>
        </div>
      ) : (
        products.map((p) => (
          <ProductCard key={p.id as number} p={p} lang={lang} fmt={fmt}
            onClick={() => onProductClick(p)}
            onDelete={canEdit ? (id) => onDelete(id, String(p.name)) : undefined}
            selected={selected.has(p.id as number)}
            onToggleSelect={canEdit ? () => onToggleSelect(p.id as number) : undefined}
          />
        ))
      )}
    </div>
  );
}
