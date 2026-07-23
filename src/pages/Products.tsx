import { useCallback, useMemo, useState } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { useNavigate, useSearchParams } from "react-router";
import { Plus, Upload, FileDown, Box, Tag, AlertTriangle, BarChart3, Trash2, CheckSquare, Square } from "lucide-react";
import { ExcelImport } from "@/components/ExcelImport";
import { useConfirm } from "@/components/ConfirmDialog";
import { exportToExcel, formatProductsForExport } from "@/lib/excel";
import { ProductCard, ProductForm, ProductList, ProductFilters, KpiCard, F, COLORS } from "@/components/products";

export default function Products() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(() => Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1));

  const updatePage = useCallback((p: number | ((prev: number) => number)) => {
    setPage(prev => {
      const next = typeof p === "function" ? p(prev) : p;
      setSearchParams(sp => { sp.set("page", String(next)); return sp; });
      return next;
    });
  }, [setSearchParams]);
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const navigate = useNavigate();
  const { data, isLoading } = trpc.product.list.useQuery({ page, pageSize: 25, search: search || undefined, category }) as { data: any; isLoading: boolean };
  const { data: allProductsData } = trpc.product.list.useQuery({ page: 1, pageSize: 10000, includeAll: true }) as { data: any };
  const { data: categories } = trpc.product.categories.useQuery();
  const utils = trpc.useUtils();
  const createMutation = trpc.product.create.useMutation({
    onSuccess: () => { utils.product.list.invalidate(); setShowForm(false); notify.success("Товар добавлен"); },
    onError: (e) => notify.error(e.message),
  });
  const deleteMutation = trpc.product.delete.useMutation({
    onSuccess: () => { utils.product.list.invalidate(); notify.success("Товар удалён"); },
    onError: (e) => notify.error(e.message),
  });
  const bulkDeleteMutation = trpc.product.bulkDelete.useMutation({
    onSuccess: (res) => {
      utils.product.list.invalidate();
      setSelected(new Set());
      const msg = res.softDeleted > 0
        ? t(`Удалено: ${res.deleted}, скрыто: ${res.softDeleted}`, `${res.deleted} o'chirildi, ${res.softDeleted} yashirildi`)
        : t(`Удалено: ${res.deleted}`, `${res.deleted} o'chirildi`);
      notify.success(msg);
    },
    onError: (e) => notify.error(e.message),
  });
  const clearAllMutation = trpc.product.clearAll.useMutation({
    onSuccess: () => { utils.product.list.invalidate(); notify.success(t("Все товары удалены", "Barcha mahsulotlar o'chirildi")); },
    onError: (e) => notify.error(e.message),
  });
  const { confirm, dialog } = useConfirm();
  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);

  const totalCount = data?.total ?? 0;
  const lowStockCount = data?.data?.filter((p: any) => Number(p.available ?? 0) < Number(p.reorderPoint)).length ?? 0;
  const categoryCount = categories?.length ?? 0;

  const handleDelete = async (id: number, name: string) => {
    const ok = await confirm({
      title: t("Удалить товар?", "Mahsulot o'chirilsinmi?"),
      message: t(`«${name}» будет удалён навсегда.`, `«${name}» doimiy o'chiriladi.`),
      confirmText: t("Удалить", "O'chirish"),
      danger: true,
    });
    if (ok) deleteMutation.mutate({ id });
  };

  const allVisibleIds = useMemo(() => (data?.data ?? []).map((p: any) => p.id as number), [data]);
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => selected.has(id));

  const toggleSelect = useCallback((id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(async () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allVisibleIds));
    }
  }, [allSelected, allVisibleIds]);

  const handleBulkDelete = async () => {
    const count = selected.size;
    if (count === 0) return;
    const ok = await confirm({
      title: t(`Удалить ${count} товаров?`, `${count} ta mahsulot o'chirilsinmi?`),
      message: t("Данные будут удалены безвозвратно.", "Ma'lumotlar qaytarib bo'lmaydigan tarzda o'chiriladi."),
      confirmText: t("Удалить", "O'chirish"),
      danger: true,
    });
    if (ok) {
      bulkDeleteMutation.mutate({ ids: Array.from(selected) });
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {dialog}
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.025em", margin: 0 }}>
            {t("Товары", "Mahsulotlar")}
          </h1>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: "4px 0 0" }}>
            {t("Управление каталогом товаров", "Mahsulotlar katalogini boshqarish")}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={() => setShowImport(v => !v)}
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
              fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
              border: `1px solid ${COLORS.border}`, cursor: "pointer",
              background: COLORS.surface, color: COLORS.textSecondary,
            }}
          >
            <Upload size={14} /><span className="hidden sm:inline">{t("Импорт", "Import")}</span>
          </button>
          <button
            onClick={async () => {
              const ok = await confirm({
                title: t("Очистить все товары?", "Barcha mahsulotlar o'chirilsinmi?"),
                message: t("Это удалит все товары безвозвратно.", "Bu barcha mahsulotlarni qaytarib bo'lmaydigan tarzda o'chiradi."),
                confirmText: t("Очистить", "O'chirish"),
                danger: true,
              });
              if (ok) clearAllMutation.mutate();
            }}
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
              fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
              border: `1px solid ${COLORS.border}`, cursor: "pointer",
              background: COLORS.surface, color: "#d45050",
            }}
          >
            <Trash2 size={14} /><span className="hidden sm:inline">{t("Очистить", "Tozalash")}</span>
          </button>
          <button
            onClick={async () => {
              const allProds = allProductsData?.data ?? [];
              if (!allProds.length) return;
              await exportToExcel(formatProductsForExport(allProds), `products-all`, "Товары", `Все товары (${allProds.length})`);
            }}
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
              fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
              border: `1px solid ${COLORS.border}`, cursor: "pointer",
              background: COLORS.surface, color: COLORS.textSecondary,
            }}
          >
            <FileDown size={14} /><span className="hidden sm:inline">Excel</span>
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="neo-btn-primary"
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            }}
          >
            <Plus size={14} /><span className="hidden sm:inline">{t("Добавить", "Qo'shish")}</span>
          </button>
        </div>
      </div>

      {/* Import Section */}
      {showImport && <ExcelImport type="products" onDone={() => { setShowImport(false); utils.product.list.invalidate(); }} onCancel={() => setShowImport(false)} />}

      {/* Form Section */}
      {showForm && <ProductForm isPending={createMutation.isPending} lang={lang} onSave={d => createMutation.mutate(d)} onCancel={() => setShowForm(false)} />}

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
        <KpiCard
          label={t("ВСЕГО ТОВАРОВ", "JAMI MAHSULOTLAR")}
          value={String(totalCount)}
          delta={null}
          icon={<Box size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #5b6d8a, #5b6d8a)"
          delay={0}
        />
        <KpiCard
          label={t("С КАТЕГОРИЯМИ", "KATEGORIYALI")}
          value={String(categoryCount)}
          delta={null}
          icon={<Tag size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #16a34a, #22c47a)"
          delay={0.05}
        />
        <KpiCard
          label={t("НИЗКИЙ ОСТАТОК", "KAM QOLDIQ")}
          value={String(lowStockCount)}
          delta={lowStockCount > 0 ? -100 : 0}
          icon={<AlertTriangle size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #fb923c, #f97316)"
          delay={0.1}
        />
        <KpiCard
          label={t("СЕССИЯ", "SEANS")}
          value={`p.${page}`}
          delta={null}
          icon={<BarChart3 size={20} color="#fff" />}
          gradient="linear-gradient(135deg, #a78bfa, #5b6d8a)"
          delay={0.15}
        />
      </div>

      {/* Search and Filter */}
      <ProductFilters
        search={search}
        onSearchChange={v => { setSearch(v); updatePage(1); }}
        category={category}
        onCategoryChange={v => { setCategory(v); updatePage(1); }}
        categories={(categories ?? []).map(c => String(c))}
        lang={lang}
      />

      {/* Selection bar */}
      {selected.size > 0 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 20px", borderRadius: "14px",
          background: "var(--color-primary-subtle, rgba(75,108,246,.10))",
          border: "1px solid rgba(75,108,246,.20)",
        }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "#5b6d8a" }}>
            {selected.size} {t("выбрано", "tanlangan")}
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={() => setSelected(new Set())} className="neo-btn text-xs py-1.5 px-3">
              {t("Сбросить", "Bekor qilish")}
            </button>
            <button onClick={handleBulkDelete} disabled={bulkDeleteMutation.isPending}
              style={{
                display: "flex", alignItems: "center", gap: "5px", padding: "6px 14px",
                fontSize: "12px", fontWeight: 600, borderRadius: "8px",
                border: "none", cursor: "pointer", color: "#fff",
                background: "#d45050", opacity: bulkDeleteMutation.isPending ? 0.5 : 1,
              }}>
              <Trash2 size={13} />{t("Удалить", "O'chirish")}
            </button>
          </div>
        </div>
      )}

      {/* Select all */}
      {data && data.data.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={toggleSelectAll}
            style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", display: "flex", alignItems: "center", gap: "6px" }}>
            {allSelected
              ? <CheckSquare size={16} style={{ color: COLORS.primary }} />
              : <Square size={16} style={{ color: COLORS.textTertiary }} />
            }
            <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{t("Выбрать все", "Barchasini tanlash")}</span>
          </button>
        </div>
      )}

      {/* Product List */}
      <ProductList
        products={data?.data ?? []}
        isLoading={isLoading}
        lang={lang}
        fmt={fmt}
        onProductClick={(p) => navigate(`/products/${p.id}?fromPage=${page}${search ? `&search=${encodeURIComponent(search)}` : ""}${category ? `&category=${encodeURIComponent(category)}` : ""}`)}
        onDelete={(id, name) => handleDelete(id, name)}
        selected={selected}
        onToggleSelect={toggleSelect}
      />

      {/* Pagination */}
      {data && data.total > 25 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: COLORS.surface, borderRadius: "16px", padding: "16px 20px",
        }}>
          <span style={{ fontSize: "13px", color: COLORS.textSecondary, fontFamily: F.body }}>
            {data.total} {t("всего", "jami")}
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => updatePage(p => Math.max(1, p - 1))} disabled={page === 1}
              style={{
                padding: "8px 16px", fontSize: "13px", fontWeight: 500, fontFamily: F.body,
                borderRadius: "8px", border: `1px solid ${COLORS.border}`, cursor: "pointer",
                background: COLORS.surface, color: page === 1 ? COLORS.textTertiary : COLORS.textPrimary,
                opacity: page === 1 ? 0.5 : 1,
              }}
            >
              {t("Назад", "Orqaga")}
            </button>
            <button
              onClick={() => updatePage(p => p + 1)} disabled={page * 25 >= data.total}
              className="neo-btn-primary"
              style={{
                padding: "8px 16px",
                opacity: page * 25 >= data.total ? 0.5 : 1,
              }}
            >
              {t("Далее", "Keyingi")}
            </button>
          </div>
        </div>
      )}

      {/* SlideUp Animation Keyframes */}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
