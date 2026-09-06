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
        {/*
          Вход в управление категориями — с подписью и всегда.

          Здесь стоял квадрат 36×36 с одной иконкой шестерёнки и подсказкой в
          title. На касании title не показывается вовсе, а рядом лежат поиск и
          выбор категории — значок читался как «настройки фильтра». Владелец
          так и сказал: работать с категориями негде. Оно было, просто без
          вывески.

          Условие categories.length > 0 убрано: именно когда категорий ноль,
          человек и идёт искать, где их завести.
        */}
        {onManageCategories && (
          <button
            onClick={onManageCategories}
            className="neo-btn tap"
            style={{ flexShrink: 0, gap: "8px", paddingLeft: "14px", paddingRight: "14px" }}
          >
            <Settings2 size={16} style={{ color: COLORS.textSecondary }} />
            <span>{t("Категории", "Kategoriyalar")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
