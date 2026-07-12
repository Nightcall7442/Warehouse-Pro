import { memo, useCallback, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useNavigate } from "react-router";
import { Search, Plus, Store, Users, AlertCircle, DollarSign, Trash2, CheckSquare, Square, FileDown, Upload, ChevronRight } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { notify } from "@/lib/toast";
import { useCurrency } from "@/hooks/useCurrency";
import { PremiumSelect } from "@/components/PremiumSelect";
import { CardDots, Card, KpiCard, PageHeader, btnPrimary, btnSecondary, btnDanger } from "@/components/DashboardLayout";

export default function Shops() {
  const [search, setSearch] = useState("");
  const [filterAgent, setFilterAgent] = useState("all");
  const [filterCity, setFilterCity] = useState("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.shop.list.useQuery({ search, pageSize: 1000 }) as { data: any; isLoading: boolean };
  const deleteMutation = trpc.shop.delete.useMutation({
    onSuccess: () => { utils.shop.list.invalidate(); notify.success(t("Магазин удалён", "Do'kon o'chirildi")); },
    onError: (e) => notify.error(e.message),
  });

  const shops = data?.data ?? [];
  const totalCount = shops.length;
  const activeCount = shops.filter((s: any) => s.status === "active").length;
  const debtCount = shops.filter((s: any) => Number(s.debt ?? 0) > 0).length;
  const totalDebt = shops.reduce((s: number, sh: any) => s + Number(sh.debt ?? 0), 0);

  const handleDelete = async (id: number, name: string) => {
    const ok = await confirm({ title: t("Удалить магазин?", "Do'kon o'chirilsinmi?"), message: t(`«${name}» будет удалён.`, `«${name}» o'chiriladi.`), confirmText: t("Удалить", "O'chirish"), danger: true });
    if (ok) deleteMutation.mutate({ id });
  };

  const handleBulkDelete = async () => {
    const count = selected.size;
    if (count === 0) return;
    const ok = await confirm({ title: t(`Удалить ${count} магазинов?`, `${count} ta do'kon o'chirilsinmi?`), message: t("Данные будут удалены безвозвратно.", "Ma'lumotlar qaytarib bo'lmaydigan tarzda o'chiriladi."), confirmText: t("Удалить", "O'chirish"), danger: true });
    if (ok) { for (const id of selected) await deleteMutation.mutateAsync({ id }); setSelected(new Set()); }
  };

  const allVisibleIds = shops.map((s: any) => s.id as number);
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every(id => selected.has(id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {dialog}
      <PageHeader
        title={t("Магазины", "Do'konlar")}
        subtitle={t("Управление точками продаж", "Sotish nuqtalarini boshqarish")}
        actions={
          <>
            <button style={btnSecondary}><FileDown size={14} /> Excel</button>
            <button style={btnSecondary}><Upload size={14} /> {t("Импорт", "Import")}</button>
            <button onClick={() => navigate("/shops/new")} style={btnPrimary}><Plus size={14} /> {t("Добавить", "Qo'shish")}</button>
          </>
        }
      />

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
        <KpiCard label={t("ВСЕГО МАГАЗИНОВ", "JAMI DO'KON")} value={String(totalCount)} icon={<Store size={18} color="#818cf8" />} gradient="rgba(129,140,248,.10)" />
        <KpiCard label={t("АКТИВНЫЕ", "FAOL")} value={String(activeCount)} icon={<Users size={18} color="#4ade80" />} gradient="rgba(74,222,128,.10)" />
        <KpiCard label={t("С ДОЛГОМ", "QARZ BILAN")} value={String(debtCount)} icon={<AlertCircle size={18} color="#fbbf24" />} gradient="rgba(251,191,36,.10)" />
        <KpiCard label={t("ОБЩИЙ ДОЛГ", "UMUMIY QARZ")} value={fmt(totalDebt)} icon={<DollarSign size={18} color="#f87171" />} gradient="rgba(248,113,113,.10)" />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #9ca3af)" }} />
          <input placeholder={t("Поиск магазинов...", "Do'kon qidirish...")} value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: "36px" }} className="input-field" />
        </div>
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

      {/* Shop list */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {isLoading ? (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>...</div>
        ) : shops.length === 0 ? (
          <Card><p style={{ textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)", padding: "32px 0" }}>{t("Нет магазинов", "Do'kon yo'q")}</p></Card>
        ) : shops.map((s: any) => (
          <Card key={s.id} onClick={() => navigate(`/shops/${s.id}`)} style={{ display: "flex", alignItems: "center", gap: "16px", padding: "16px 20px" }}>
            <button onClick={e => { e.stopPropagation(); setSelected(prev => { const next = new Set(prev); if (next.has(s.id)) next.delete(s.id); else next.add(s.id); return next; }); }} style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}>
              {selected.has(s.id) ? <CheckSquare size={18} color="var(--color-primary, #818cf8)" /> : <Square size={18} color="var(--color-text-tertiary, #9ca3af)" />}
            </button>
            <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: "var(--color-surface-light, #f3f4f6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Store size={20} color="var(--color-text-tertiary, #9ca3af)" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary, #111827)", margin: 0 }}>{s.name}</p>
              <p style={{ fontSize: "12px", color: "var(--color-text-tertiary, #9ca3af)", margin: "2px 0 0" }}>{s.ownerName ?? ""} · {s.city ?? ""}</p>
            </div>
            <span style={{ padding: "3px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, background: s.status === "active" ? "rgba(74,222,128,.10)" : "rgba(248,113,113,.10)", color: s.status === "active" ? "#4ade80" : "#f87171", flexShrink: 0 }}>
              {s.status === "active" ? t("Активен", "Faol") : t("Неактивен", "Nofaol")}
            </span>
            {Number(s.debt ?? 0) > 0 && (
              <span style={{ fontSize: "12px", color: "var(--color-danger, #f87171)", fontWeight: 500, flexShrink: 0 }}>₽ {fmt(s.debt)}</span>
            )}
            <ChevronRight size={14} color="var(--color-text-tertiary, #9ca3af)" />
          </Card>
        ))}
      </div>
    </div>
  );
}
