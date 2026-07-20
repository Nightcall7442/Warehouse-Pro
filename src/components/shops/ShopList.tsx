import { MapPin, Trash2, CheckSquare, Square } from "lucide-react";
import { ShopCard } from "./ShopCard";
import type { ShopCardData } from "./ShopCard";
import { COLORS } from "./constants";

export function ShopList({ data, isLoading, lang, fmt, selected, allSelected, onSelectAll, onToggleSelect, onBulkDelete, onNavigate, isDeleting, page, setPage, total, t }: {
  data: ShopCardData[] | undefined; isLoading: boolean; lang: string;
  fmt: (v: number | string | null | undefined, opts?: { decimals?: number }) => string;
  selected: Set<number>; allSelected: boolean; onSelectAll: () => void; onToggleSelect: (id: number) => void;
  onBulkDelete: () => void; onNavigate: (id: number) => void; isDeleting: boolean;
  page: number; setPage: (v: number | ((p: number) => number)) => void;
  total: number; city?: string; district?: string; t: (ru: string, uz: string) => string;
}) {
  const count = selected.size;
  return (
    <>
      {/* Loading skeletons */}
      {isLoading ? Array.from({ length: 4 }).map((_, i) => (
        <div key={i} style={{ height: "96px", borderRadius: "24px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease forwards` }} />
      )) : (
        <>
          {/* Select all */}
          {data && data.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button onClick={onSelectAll}
                style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
                {allSelected
                  ? <CheckSquare size={16} style={{ color: COLORS.primary }} />
                  : <Square size={16} style={{ color: COLORS.textTertiary }} />
                }
                <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("Выбрать все", "Barchasini tanlash")}</span>
              </button>
            </div>
          )}

          {/* Cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {data?.length === 0
              ? <p style={{ textAlign: "center", color: COLORS.textSecondary, padding: "48px 0", fontSize: "14px" }}>{t("Нет магазинов", "Do'kon yo'q")}</p>
              : data?.map((s, i) => <ShopCard key={s.id} s={s} lang={lang} fmt={fmt} delay={i * 0.03}
                onClick={() => onNavigate(s.id)}
                selected={selected.has(s.id)}
                onToggleSelect={() => onToggleSelect(s.id)}
              />)}
          </div>

          {/* Pagination */}
          {total > 25 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "13px", color: COLORS.textSecondary }}>{total} {t("всего", "jami")}</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="neo-btn py-1 px-3 text-sm disabled:opacity-40">{t("Назад", "Orqaga")}</button>
                <button onClick={() => setPage(p => p + 1)} disabled={page * 25 >= total} className="neo-btn py-1 px-3 text-sm disabled:opacity-40">{t("Далее", "Keyingi")}</button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

export function SelectionBar({ count, lang, onReset, onBulkDelete, isDeleting }: {
  count: number; lang: string; onReset: () => void; onBulkDelete: () => void; isDeleting: boolean;
}) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "12px 20px", borderRadius: "14px",
      background: "var(--color-primary-subtle, rgba(75,108,246,.10))",
      border: "1px solid rgba(75,108,246,.20)",
    }}>
      <span style={{ fontSize: "13px", fontWeight: 600, color: "#5b6d8a" }}>
        {count} {t("выбрано", "tanlangan")}
      </span>
      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={onReset} className="neo-btn text-xs py-1.5 px-3">
          {t("Сбросить", "Bekor qilish")}
        </button>
        <button onClick={onBulkDelete} disabled={isDeleting}
          style={{
            display: "flex", alignItems: "center", gap: "5px", padding: "6px 14px",
            fontSize: "12px", fontWeight: 600, borderRadius: "8px",
            border: "none", cursor: "pointer", color: "#fff",
            background: "#d45050", opacity: isDeleting ? 0.5 : 1,
          }}>
          <Trash2 size={13} />{t("Удалить", "O'chirish")}
        </button>
      </div>
    </div>
  );
}

export function CityBreadcrumb({ city, district, total, lang }: { city?: string; district?: string; total: number; lang: string }) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: COLORS.textSecondary }}>
      <MapPin size={14} style={{ color: COLORS.primary }} />
      <span>{city && <strong style={{ color: COLORS.textPrimary }}>{city}</strong>}</span>
      {district && <><span>›</span><strong style={{ color: COLORS.textPrimary }}>{district}</strong></>}
      <span style={{ color: COLORS.textSecondary }}>({total} {t("магазинов", "do'kon")})</span>
    </div>
  );
}
