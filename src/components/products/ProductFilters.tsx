import { Search, Settings2 } from "lucide-react";
import { COLORS } from "./constants";
import { CategorySelector } from "./CategorySelector";

export interface ProductFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  category: string | undefined;
  onCategoryChange: (category: string | undefined) => void;
  categories: string[];
  lang: string;
  onManageCategories?: () => void;
}

export function ProductFilters({ search, onSearchChange, category, onCategoryChange, categories, lang, onManageCategories }: ProductFiltersProps) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
          <Search size={16} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: COLORS.textSecondary }} />
          <input
            className="neo-input"
            style={{ paddingLeft: "36px", width: "100%" }}
            placeholder={t("Поиск товаров…", "Mahsulot qidirish…")}
            value={search}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>
        <CategorySelector
          value={category}
          onChange={onCategoryChange}
          categories={categories}
          lang={lang}
        />
        {onManageCategories && categories.length > 0 && (
          <button
            onClick={onManageCategories}
            title={t("Управление категориями", "Kategoriyalarni boshqarish")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: "36px", height: "36px", borderRadius: "10px",
              background: "var(--color-surface-light, #f6f4f0)", border: "none",
              cursor: "pointer", flexShrink: 0,
            }}
          >
            <Settings2 size={16} style={{ color: COLORS.textSecondary }} />
          </button>
        )}
      </div>
    </div>
  );
}
