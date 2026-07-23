import { useCallback, useMemo, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { exportToExcel, formatShopsForExport } from "@/lib/excel";
import { ExcelImport } from "@/components/ExcelImport";
import { useNavigate } from "react-router";
import { Store, FileDown, Upload, Plus } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  ShopForm, ShopStats, ShopFilters, TerritoriesGrid, ShopList, SelectionBar, CityBreadcrumb,
} from "@/components/shops";
import type { ShopKpiStats } from "@/components/shops/ShopStats";
import type { ShopCardData } from "@/components/shops/ShopCard";
import { COLORS, SHADOW } from "@/components/shops/constants";

export default function Shops() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const navigate = useNavigate();
  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [city, setCity] = useState<string | undefined>(undefined);
  const [district, setDistrict] = useState<string | undefined>(undefined);
  const [agentFilter, setAgentFilter] = useState<string | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<"territories" | "list">("territories");

  const { data, isLoading } = trpc.shop.list.useQuery({ page, pageSize: 25, search: search || undefined, city, district, agentId: agentFilter ? Number(agentFilter) : undefined }) as { data: any; isLoading: boolean };
  const { data: allShopsData } = trpc.shop.list.useQuery({ page: 1, pageSize: 5000 }) as { data: any };
  const { data: cities } = trpc.shop.cities.useQuery();
  const { data: districts } = trpc.shop.districts.useQuery({ city });
  const { data: territories } = trpc.shop.territories.useQuery() as { data: any };
  const { data: usersData } = trpc.user.list.useQuery({ page: 1, pageSize: 100 });
  const agents = useMemo(() => (usersData?.data ?? []).filter((u: { role: string }) => u.role === "agent"), [usersData?.data]);
  const utils = trpc.useUtils();

  const createMutation = trpc.shop.create.useMutation({
    onSuccess: () => { utils.shop.list.invalidate(); utils.shop.cities.invalidate(); setShowForm(false); notify.success("Магазин добавлен"); },
    onError: (e) => notify.error(e.message),
  });
  const deleteMutation = trpc.shop.delete.useMutation({
    onSuccess: () => { utils.shop.list.invalidate(); setSelected(new Set()); notify.success("Магазины удалены"); },
    onError: (e) => notify.error(e.message),
  });
  const { confirm, dialog } = useConfirm();

  const kpiStats = useMemo<ShopKpiStats>(() => {
    const shops = data?.data ?? [];
    const total = data?.total ?? 0;
    const activeCount = shops.filter((s: any) => s.status === "active").length;
    const debtCount = shops.filter((s: any) => Number(s.debt ?? 0) > 0).length;
    const totalDebt = shops.reduce((sum: number, s: any) => sum + Number(s.debt ?? 0), 0);
    return { total, activeCount, debtCount, totalDebt };
  }, [data]);

  const allVisibleIds = useMemo(() => (data?.data ?? []).map((s: any) => s.id as number), [data]);
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
      title: t(`Удалить ${count} магазинов?`, `${count} ta do'kon o'chirilsinmi?`),
      message: t("Данные будут удалены безвозвратно.", "Ma'lumotlar qaytarib bo'lmaydigan tarzda o'chiriladi."),
      confirmText: t("Удалить", "O'chirish"),
      danger: true,
    });
    if (ok) {
      for (const id of selected) {
        await deleteMutation.mutateAsync({ id });
      }
    }
  };

  const resetFilters = useCallback(async () => {
    setCity(undefined);
    setDistrict(undefined);
    setSearch("");
    setPage(1);
  }, []);

  if (isLoading && !data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ height: "28px", width: "200px", borderRadius: "8px", background: COLORS.surfaceLight, marginBottom: "8px" }} />
            <div style={{ height: "16px", width: "260px", borderRadius: "6px", background: COLORS.surfaceLight }} />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ height: "140px", borderRadius: "24px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease forwards` }} />
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ height: "96px", borderRadius: "24px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease forwards` }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {dialog}
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: "'DM Sans', -apple-system, sans-serif", fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.025em", margin: 0 }}>
            {t("Магазины", "Do'konlar")}
          </h1>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: "4px 0 0" }}>
            {t("Управление точками продаж", "Savdo nuqtalarini boshqarish")}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={async () => {
            const allShops = allShopsData?.data ?? [];
            if (!allShops.length) return;
            // Group by territory
            const grouped = new Map<string, any[]>();
            for (const s of allShops) {
              const territory = s.district || s.city || "Другие";
              if (!grouped.has(territory)) grouped.set(territory, []);
              grouped.get(territory)!.push(s);
            }
            // Build rows with territory headers
            const rows: Record<string, unknown>[] = [];
            for (const [territory, shops] of Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b, "ru"))) {
              rows.push({ "=== ТЕРРИТОРИЯ ===": territory });
              for (const s of shops) {
                rows.push({
                  "Название": s.name ?? "",
                  "Владелец": s.ownerName ?? "",
                  "Телефон": s.phone ?? "",
                  "Город": s.city ?? "",
                  "Район": s.district ?? "",
                  "Адрес": s.address ?? "",
                  "Агент": s.agentName ?? "",
                  "Долг": Number(s.debt ?? 0).toFixed(0),
                  "Статус": s.status ?? "",
                });
              }
              rows.push({});
            }
            await exportToExcel(rows, `shops-all`, "Магазины", `Магазины по территориям`);
          }}
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
              fontSize: "13px", fontWeight: 500, borderRadius: "10px",
              border: `1px solid ${COLORS.border}`, cursor: "pointer",
              background: COLORS.surface, color: COLORS.textSecondary,
            }}>
            <FileDown size={14} /> Excel
          </button>
          <button onClick={() => setShowImport(v => !v)} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
            fontSize: "13px", fontWeight: 500, borderRadius: "10px",
            border: `1px solid ${COLORS.border}`, cursor: "pointer",
            background: COLORS.surface, color: COLORS.textSecondary,
          }}>
            <Upload size={14} /><span className="hidden sm:inline">{t("Импорт", "Import")}</span>
          </button>
          <button onClick={() => setShowForm(!showForm)} className="neo-btn-primary flex items-center gap-2">
            <Plus size={16} /><span className="hidden sm:inline">{t("Добавить", "Qo'shish")}</span>
          </button>
        </div>
      </div>

      {showForm && <ShopForm isPending={createMutation.isPending} lang={lang} agents={agents} onSave={d => createMutation.mutate(d)} onCancel={() => setShowForm(false)} />}

      {showImport && <ExcelImport type="shops" onDone={() => { setShowImport(false); utils.shop.list.invalidate(); }} onCancel={() => setShowImport(false)} />}

      <ShopStats stats={kpiStats} lang={lang} fmt={fmt} />

      <ShopFilters
        lang={lang} search={search} setSearch={setSearch}
        viewMode={viewMode} setViewMode={setViewMode}
        agentFilter={agentFilter} setAgentFilter={setAgentFilter}
        city={city} district={district} agents={agents}
        setPage={setPage} resetFilters={resetFilters}
      />

      {/* Territories grid */}
      {viewMode === "territories" && !city && !district && (
        <TerritoriesGrid
          territories={territories ?? []}
          totalShops={data?.total ?? 0}
          lang={lang} fmt={fmt}
          onSelectAll={() => setViewMode("list")}
          onSelectTerritory={(c, d) => { setCity(c); setDistrict(d); setViewMode("list"); setPage(1); }}
        />
      )}

      {(viewMode === "list" || city || district) && (
        <>
          {(city || district) && (
            <CityBreadcrumb city={city} district={district} total={data?.total ?? 0} lang={lang} />
          )}

          {selected.size > 0 && (
            <SelectionBar count={selected.size} lang={lang} onReset={() => setSelected(new Set())} onBulkDelete={handleBulkDelete} isDeleting={deleteMutation.isPending} />
          )}

          <ShopList
            data={data?.data} isLoading={isLoading} lang={lang} fmt={fmt}
            selected={selected} allSelected={allSelected}
            onSelectAll={toggleSelectAll} onToggleSelect={toggleSelect}
            onBulkDelete={handleBulkDelete} onNavigate={id => navigate(`/shops/${id}?fromPage=${page}${search ? `&search=${encodeURIComponent(search)}` : ""}${city ? `&city=${encodeURIComponent(city)}` : ""}${district ? `&district=${encodeURIComponent(district)}` : ""}`)}
            isDeleting={deleteMutation.isPending} page={page} setPage={setPage}
            total={data?.total ?? 0} city={city} district={district} t={t}
          />
        </>
      )}
    </div>
  );
}
