import { memo, useCallback, useMemo, useRef, useState } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { useNavigate } from "react-router";
import { Search, Plus, Package, Upload, Trash2, CheckSquare, Square, FileDown, AlertTriangle } from "lucide-react";
import { ExcelImport } from "@/components/ExcelImport";
import { PremiumSelect } from "@/components/PremiumSelect";
import { useConfirm } from "@/components/ConfirmDialog";
import { exportToExcel, formatProductsForExport } from "@/lib/excel";
import { CardDots, Card, KpiCard, PageHeader, TableContainer, thStyle, tdStyle, btnPrimary, btnSecondary, btnDanger } from "@/components/DashboardLayout";

export default function Products() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.product.list.useQuery({ page: 1, pageSize: 1000, search, category: category === "all" ? undefined : category }) as { data: any; isLoading: boolean };
  const { data: categories } = trpc.product.categories.useQuery() as { data: string[] | undefined };

  const deleteMutation = trpc.product.delete.useMutation({
    onSuccess: () => { utils.product.list.invalidate(); notify.success(t("Товар удалён", "Mahsulot o'chirildi")); },
    onError: (e) => notify.error(e.message),
  });

  const products = data?.data ?? [];
  const totalCount = data?.total ?? 0;
  const lowStockCount = products.filter((p: any) => Number(p.available ?? 0) < Number(p.reorderPoint ?? 0) && Number(p.reorderPoint ?? 0) > 0).length;
  const categoryCount = categories?.length ?? 0;

  const allVisibleIds = useMemo(() => products.map((p: any) => p.id as number), [products]);
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => selected.has(id));

  const handleDelete = async (id: number, name: string) => {
    const ok = await confirm({ title: t("Удалить товар?", "Mahsulot o'chirilsinmi?"), message: t(`«${name}» будет удалён навсегда.`, `«${name}» doimiy o'chiriladi.`), confirmText: t("Удалить", "O'chirish"), danger: true });
    if (ok) deleteMutation.mutate({ id });
  };

  const handleBulkDelete = async () => {
    const count = selected.size;
    if (count === 0) return;
    const ok = await confirm({ title: t(`Удалить ${count} товаров?`, `${count} ta mahsulot o'chirilsinmi?`), message: t("Данные будут удалены безвозвратно.", "Ma'lumotlar qaytarib bo'lmaydigan tarzda o'chiriladi."), confirmText: t("Удалить", "O'chirish"), danger: true });
    if (ok) { for (const id of selected) await deleteMutation.mutateAsync({ id }); setSelected(new Set()); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {dialog}
      <PageHeader
        title={t("Товары", "Mahsulotlar")}
        subtitle={t("Управление каталогом товаров", "Mahsulotlar katalogini boshqarish")}
        actions={
          <>
            <button onClick={() => setShowImport(true)} style={btnSecondary}><Upload size={14} /> {t("Импорт", "Import")}</button>
            <button onClick={() => {}} style={btnSecondary}><FileDown size={14} /> Excel</button>
            <button onClick={() => navigate("/products/new")} style={btnPrimary}><Plus size={14} /> {t("Добавить", "Qo'shish")}</button>
          </>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
        <KpiCard label={t("ВСЕГО ТОВАРОВ", "JAMI MAHSULOT")} value={String(totalCount)} icon={<Package size={18} color="#818cf8" />} gradient="rgba(129,140,248,.10)" />
        <KpiCard label={t("С КАТЕГОРИЕЙ", "KATEGORIYA BILAN")} value={String(categoryCount)} icon={<Package size={18} color="#4ade80" />} gradient="rgba(74,222,128,.10)" />
        <KpiCard label={t("НИЗКИЙ ОСТАТОК", "KAM QOLDIQ")} value={String(lowStockCount)} icon={<AlertTriangle size={18} color="#fbbf24" />} gradient="rgba(251,191,36,.10)">
          {lowStockCount > 0 && <p style={{ fontSize: "12px", color: "var(--color-danger, #f87171)", margin: "4px 0 0" }}>↘ 100%</p>}
        </KpiCard>
        <KpiCard label={t("СЕССИЯ", "SESSIYA")} value="p.1" icon={<Package size={18} color="#818cf8" />} gradient="rgba(129,140,248,.10)" />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #9ca3af)" }} />
          <input placeholder={t("Поиск товаров...", "Mahsulot qidirish...")} value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: "36px" }} className="input-field" />
        </div>
        <PremiumSelect value={category} onChange={setCategory} options={[{ value: "all", label: t("Все категории", "Barcha kategoriyalar") }, ...(categories ?? []).map(c => ({ value: c, label: c }))]} width="160px" />
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderRadius: "14px", background: "var(--color-primary-subtle, rgba(129,140,248,.10))" }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-primary, #818cf8)" }}>{selected.size} {t("выбрано", "tanlandi")}</span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={() => setSelected(new Set())} style={btnSecondary}>{t("Сбросить", "Bekor qilish")}</button>
            <button onClick={handleBulkDelete} style={btnDanger}><Trash2 size={14} /> {t("Удалить", "O'chirish")}</button>
          </div>
        </div>
      )}

      {/* Select all */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <button onClick={() => setSelected(allSelected ? new Set() : new Set(allVisibleIds))} style={{ display: "flex", alignItems: "center", gap: "6px", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-secondary, #6b7280)", fontSize: "13px", fontFamily: "'DM Sans', sans-serif" }}>
          {allSelected ? <CheckSquare size={16} color="var(--color-primary, #818cf8)" /> : <Square size={16} />}
          {t("Выбрать все", "Hammasini tanlash")}
        </button>
      </div>

      {/* Product list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {isLoading ? (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>...</div>
        ) : products.length === 0 ? (
          <Card><p style={{ textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)", padding: "32px 0" }}>{t("Нет товаров", "Mahsulot yo'q")}</p></Card>
        ) : products.map((p: any) => {
          const low = Number(p.available ?? 0) < Number(p.reorderPoint ?? 0) && Number(p.reorderPoint ?? 0) > 0;
          return (
            <Card key={p.id} onClick={() => navigate(`/products/${p.id}`)} style={{ display: "flex", alignItems: "center", gap: "16px", padding: "16px 20px" }}>
              <button onClick={e => { e.stopPropagation(); setSelected(prev => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; }); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                {selected.has(p.id) ? <CheckSquare size={18} color="var(--color-primary, #818cf8)" /> : <Square size={18} color="var(--color-text-tertiary, #9ca3af)" />}
              </button>
              <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "var(--color-surface-light, #f3f4f6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Package size={20} color="var(--color-text-tertiary, #9ca3af)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary, #111827)", margin: 0 }}>{p.name}</p>
                <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #9ca3af)", margin: "2px 0 0" }}>{p.code}</p>
                {p.category && <span style={{ display: "inline-block", marginTop: "4px", padding: "2px 8px", borderRadius: "6px", fontSize: "11px", background: "var(--color-surface-light, #f3f4f6)", color: "var(--color-text-secondary, #6b7280)" }}>⚙ {p.category}</span>}
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary, #111827)", margin: 0 }}>{fmt(Number(p.unitPrice ?? 0) * Number(p.available ?? 0))}</p>
                <p style={{ fontSize: "11px", color: "var(--color-text-tertiary, #9ca3af)", margin: "2px 0 0" }}>{t("себест.", "tannarx")}: {fmt(Number(p.costPrice ?? 0) * Number(p.available ?? 0))}</p>
              </div>
              <span style={{ padding: "3px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, background: low ? "rgba(248,113,113,.10)" : "rgba(74,222,128,.10)", color: low ? "#f87171" : "#4ade80", flexShrink: 0 }}>
                {Number(p.available ?? 0).toFixed(0)} {p.unit === "kg" ? "кг" : "шт"}
              </span>
              <button onClick={e => { e.stopPropagation(); handleDelete(p.id, p.name); }} style={{ background: "none", border: "none", cursor: "pointer", padding: "6px", color: "var(--color-danger, #f87171)", opacity: 0.6, flexShrink: 0 }}>
                <Trash2 size={14} />
              </button>
            </Card>
          );
        })}
      </div>

      {showImport && <ExcelImport onClose={() => setShowImport(false)} />}
    </div>
  );
}
