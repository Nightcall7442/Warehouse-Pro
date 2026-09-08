import { useCallback, useMemo, useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { exportToExcel } from "@/lib/excel";
import { ExcelImport } from "@/components/ExcelImport";
import { useNavigate } from "react-router";
import { FileDown, Upload, Plus, Wallet } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { labelled, ACTIVE_STATUS_LABEL } from "@/lib/entity-labels";
import { canOperate } from "@/lib/permissions";
import type { AppRouter } from "../../api/router";
import type { inferRouterOutputs } from "@trpc/server";

/** Магазин ровно в том виде, в каком его отдаёт shop.list. */
type ShopListRow = inferRouterOutputs<AppRouter>["shop"]["list"]["data"][number];
import {
  ShopForm, ShopStats, ShopFilters, TerritoriesGrid, ShopList, SelectionBar, CityBreadcrumb,
} from "@/components/shops";
import { TerritoryManager } from "@/components/shops/TerritoryManager";
import type { ShopKpiStats } from "@/components/shops/ShopStats";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { DebtorsPanel } from "@/components/debts/DebtorsPanel";
import { COLORS } from "@/components/shops/constants";

import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useUrlState, urlString, urlMaybeString, urlNumber, urlPage, urlBool, urlEnum } from "@/hooks/useUrlState";

// Наборы допустимых значений объявлены вне компонента: иначе на каждой
// отрисовке это новый объект, и useCallback внутри хука пересобирался бы
// без нужды.
const SORT_CODEC = urlEnum(["newest", "debtDesc", "debtAsc"] as const, "newest");
const VIEW_CODEC = urlEnum(["territories", "list"] as const, "territories");
const ARCHIVED_CODEC = urlEnum(["hide", "only", "all"] as const, "hide");
export default function Shops() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const navigate = useNavigate();
  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);

  // Состояние списка живёт в адресе, а не в компоненте.
  //
  // Пока оно лежало в useState, уход в карточку магазина его стирал:
  // компонент размонтируется, возврат создаёт его заново с нуля. Отсюда и
  // жалоба «выбрал магазины с долгом, зашёл в магазин, нажал назад — и я в
  // общем списке». Ссылка в карточку руками переносила четыре значения из
  // девяти, про остальные пять забыли — долг был среди них.
  //
  // Теперь переносить нечего: адрес и есть состояние, а «назад» — обычный
  // шаг по истории. Заодно отфильтрованный список можно послать ссылкой.
  const [page, setPage] = useUrlState("page", 1, urlPage);
  const [search, setSearch] = useUrlState("search", "", urlString);
  // Поле ввода остаётся мгновенным, а в запрос уходит придержанное
  // значение: иначе каждая буква — это новый ключ запроса, у которого
  // ещё нет данных, и страница успевает смениться скелетоном.
  const debouncedSearch = useDebouncedValue(search);
  // Город и район — только чтение: на самой странице их никто не выставляет.
  // Так было и раньше, но незаметно: лежали они в useState, начинались с
  // undefined, и единственным, кто их трогал, был сброс фильтров — то есть
  // они не могли стать ничем, кроме undefined, и запрос всегда уходил без
  // них. Ссылка же в карточку магазина исправно переносила ?city=… — параметр,
  // который принимающая сторона не читала. Теперь читает: адрес и есть
  // состояние, и переход «показать магазины этого города» наконец работает.
  const [city] = useUrlState("city", undefined, urlMaybeString);
  const [district] = useUrlState("district", undefined, urlMaybeString);
  const [agentFilter, setAgentFilter] = useUrlState("agent", undefined, urlMaybeString);
  const [territoryFilter, setTerritoryFilter] = useUrlState("territory", undefined, urlNumber);
  const [onlyDebtors, setOnlyDebtors] = useUrlState("debtors", false, urlBool);
  const [sortBy, setSortBy] = useUrlState("sort", "newest", SORT_CODEC);
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showTerritoryManager, setShowTerritoryManager] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useUrlState("view", "territories", VIEW_CODEC);
  const [archived, setArchived] = useUrlState("archived", "hide", ARCHIVED_CODEC);

  const { data, isLoading, isLoadingError, refetch } = trpc.shop.list.useQuery({ page, pageSize: 25, search: debouncedSearch || undefined, city, district, agentId: agentFilter ? Number(agentFilter) : undefined, territoryId: territoryFilter, onlyDebtors: onlyDebtors || undefined, sortBy, archived }, {
    // Прошлый список остаётся на экране, пока грузится новый: без этого
    // смена запроса обнуляет data, и страница падает в скелетон на каждый
    // ввод — именно это и выглядело как перезагрузка.
    placeholderData: keepPreviousData,
  });
  const { data: territories } = trpc.shop.territories.useQuery();
  const { data: realTerritories } = trpc.territory.list.useQuery();
  /*
    agent.listAgents, а не user.list: полный список пользователей открыт
    только руководителю, и фильтр «по агенту» у супервайзера с оператором
    молча оставался пустым.
  */
  const { data: agentList } = trpc.agent.listAgents.useQuery();
  const agents = useMemo(() => agentList ?? [], [agentList]);

  // Заводить, править и удалять точки — дело оператора; супервайзер их
  // смотрит. Сервер думает так же (shop.create и соседи — operatorQuery).
  const { user } = useAuth();
  const canEdit = canOperate(user?.role);
  const utils = trpc.useUtils();

  const createMutation = trpc.shop.create.useMutation({
    onSuccess: () => { utils.shop.list.invalidate(); utils.shop.cities.invalidate(); setShowForm(false); notify.success("Магазин добавлен"); },
    onError: (e) => notify.error(e.message),
  });
  /*
    Убрать в архив — одним запросом на все отмеченные точки.

    Прежнее удаление шло циклом по одному вызову на магазин: двадцать точек —
    двадцать обращений, и при обрыве связи посередине часть оказывалась
    убранной, а часть нет, без всякого следа о том, где остановилось.
  */
  const archiveMutation = trpc.shop.archive.useMutation({
    onSuccess: (r) => {
      utils.shop.list.invalidate();
      setSelected(new Set());
      notify.success(
        r.withDebt > 0
          ? t(`В архиве: ${r.archived}. Долг ${fmt(r.debtTotal)} остаётся за точками и виден в дебиторке.`,
              `Arxivda: ${r.archived}. ${fmt(r.debtTotal)} qarz do'konlar zimmasida qoladi.`)
          : t(`В архиве: ${r.archived}`, `Arxivda: ${r.archived}`),
      );
    },
    onError: (e: { message: string }) => notify.error(e.message),
  });

  const restoreMutation = trpc.shop.restore.useMutation({
    onSuccess: () => {
      utils.shop.list.invalidate();
      setSelected(new Set());
      notify.success(t("Возвращено в работу", "Ishga qaytarildi"));
    },
    onError: (e: { message: string }) => notify.error(e.message),
  });
  const { confirm, dialog } = useConfirm();

  // Всё четыре числа приходят с сервера и считаются по всем магазинам, какие
  // попали под фильтры, — а не по видимой странице. Раньше «всего» было
  // серверным, а три остальных складывались из data, то есть из 25 строк: долг
  // по сети выходил долгом первой страницы и менялся при листании.
  const kpiStats = useMemo<ShopKpiStats>(() => ({
    total:       data?.total ?? 0,
    activeCount: data?.totals?.activeCount ?? 0,
    debtCount:   data?.totals?.debtCount ?? 0,
    totalDebt:   data?.totals?.totalDebt ?? 0,
  }), [data]);

  const archivedCount = data?.totals?.archivedCount ?? 0;

  const allVisibleIds = useMemo(() => (data?.data ?? []).map((s) => s.id as number), [data]);
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

  /*
    Подтверждение говорит, что произойдёт на самом деле.

    Стояло «Данные будут удалены безвозвратно» — и это была неправда дважды:
    у точки с заказами ничего не удалялось, а у точки без заказов удалялось
    вместе с адресом и фотографией. Теперь действие одно и обратимое, а про
    долг сказано отдельно: убрать должника с глаз — не то же самое, что
    простить ему деньги, и человек должен видеть это до нажатия, а не после.
  */
  const handleBulkArchive = async () => {
    const count = selected.size;
    if (count === 0) return;
    const debtors = (data?.data ?? []).filter(s => selected.has(s.id as number) && Number(s.debt ?? 0) > 0);
    const debtSum = debtors.reduce((sum, s) => sum + Number(s.debt ?? 0), 0);

    const ok = await confirm({
      title: t(`Убрать ${count} магазинов в архив?`, `${count} ta do'kon arxivga olinsinmi?`),
      message: [
        t("Точки пропадут из списков, планов визитов и карты. Заказы, оплаты и история остаются, вернуть можно в любой момент.",
          "Do'konlar ro'yxatlardan, tashrif rejalaridan va xaritadan yo'qoladi. Buyurtmalar, to'lovlar va tarix saqlanadi, istalgan vaqtda qaytarish mumkin."),
        debtors.length > 0
          ? t(`Среди них ${debtors.length} с долгом на ${fmt(debtSum)} — долг остаётся за ними и из дебиторки не уходит.`,
              `Ular orasida ${debtors.length} tasida ${fmt(debtSum)} qarz bor — qarz ularning zimmasida qoladi.`)
          : "",
      ].filter(Boolean).join(" "),
      confirmText: t("В архив", "Arxivga"),
    });
    if (ok) await archiveMutation.mutateAsync({ ids: [...selected] });
  };

  const handleBulkRestore = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    for (const id of ids) await restoreMutation.mutateAsync({ id });
  };

  // Сброс — это возврат к чистому адресу, а не семь отдельных сбросов.
  //
  // Пока фильтры лежали в useState, иначе и не написать. Теперь состояние —
  // это строка запроса, и «сбросить всё» значит «убрать её целиком»: одна
  // запись вместо семи, и ни один новый фильтр не забудут сюда дописать.
  // replace, а не push: сброс уточняет тот же экран, а не уводит на новый.
  const resetFilters = useCallback(async () => {
    navigate("/shops", { replace: true });
  }, [navigate]);

  if (isLoadingError) return <QueryErrorFallback onRetry={refetch} />;
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
            <div key={i} style={{ height: "140px", borderRadius: "24px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease` }} />
          ))}
        </div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ height: "96px", borderRadius: "24px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease` }} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div key="confirm-dialog">{dialog}</div>
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
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={async () => {
            // Fetch all shops via pagination
            // Магазин берётся тем типом, каким его отдаёт сервер. Приведение к
            // Record<string, unknown> появилось, когда вывод типов tRPC был
            // сломан; оно же прятало опечатку в имени поля — колонка в файле
            // молча выходила пустой.
            const allShops: ShopListRow[] = [];
            let page = 1;
            while (true) {
              const result = await utils.shop.list.fetch({ page, pageSize: 500, archived });
              if (!result?.data?.length) break;
              allShops.push(...result.data);
              if (allShops.length >= (result?.total ?? 0)) break;
              page++;
            }
            if (!allShops.length) {
              notify.error(t("Нет магазинов для экспорта", "Eksport uchun do'konlar yo'q"));
              return;
            }
            // Group by territory
            const grouped = new Map<string, typeof allShops>();
            for (const s of allShops) {
              const territory = s.district || s.city || t("Другие", "Boshqalar");
              if (!grouped.has(territory)) grouped.set(territory, []);
              grouped.get(territory)!.push(s);
            }
            // Build rows with consistent columns
            const rows: Record<string, string | number>[] = [];
            for (const [territory, shops] of Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b, "ru"))) {
              rows.push({ Территория: territory, Название: "", Владелец: "", Телефон: "", Город: "", Район: "", Адрес: "", Агент: "", Долг: "", Статус: "" });
              for (const shop of shops) {
                rows.push({
                  Территория: "",
                  Название: shop.name ?? "",
                  Владелец: shop.ownerName ?? "",
                  Телефон: shop.phone ?? "",
                  Город: shop.city ?? "",
                  Район: shop.district ?? "",
                  Адрес: shop.address ?? "",
                  Агент: shop.agentName ?? "",
                  Долг: Number(shop.debt ?? 0).toFixed(0),
                  Статус: labelled(ACTIVE_STATUS_LABEL, shop.status),
                });
              }
              rows.push({ Территория: "", Название: "", Владелец: "", Телефон: "", Город: "", Район: "", Адрес: "", Агент: "", Долг: "", Статус: "" });
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
          {canEdit && (<>
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
          </>)}
          {/* Территории супервайзеру открыты: territory.create и соседи —
              supervisorQuery, это его работа. */}
          <button onClick={() => setShowTerritoryManager(true)} style={{
            display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px", fontSize: "13px", fontWeight: 500, borderRadius: "10px",
            border: `1px solid ${COLORS.border}`, cursor: "pointer", background: COLORS.surface, color: COLORS.textSecondary,
          }}>
            {t("Территории", "Territoriyalar")}
          </button>
        </div>
      </div>

      <div key="shop-form">
        {canEdit && showForm && <ShopForm isPending={createMutation.isPending} lang={lang} agents={agents} territories={realTerritories ?? []} onSave={d => createMutation.mutate(d)} onCancel={() => setShowForm(false)} />}
      </div>

      <div key="shop-import">
        {canEdit && showImport && <ExcelImport type="shops" onDone={() => { setShowImport(false); utils.shop.list.invalidate(); }} onCancel={() => setShowImport(false)} />}
      </div>

      <ShopStats stats={kpiStats} lang={lang} fmt={fmt} />

      {/*
        Должники и их долги — здесь, а не только в отчётах.

        Забрать список должников файлом можно было исключительно в разделе
        отчётов, отдельной карточкой выгрузки. А смотрят на этот долг здесь: на
        странице магазинов он и стоит в каждой строке. Владелец сказал об этом
        прямо.

        Свёрнуто по умолчанию: страница про магазины целиком, а долг — вопрос,
        который задают не каждый раз. Развернул — и рядом же обе кнопки, файл и
        печать; оба берут ОДИН И ТОТ ЖЕ набор строк, чтобы бумага и файл не
        расходились.

        Часть общая с разделом «Долги» в отчётах: считать долг двумя способами
        эта система уже пробовала, и это стоило расхождений в деньгах.
      */}
      <details key="shop-debtors" className="neo-card" style={{ padding: "16px 20px" }}>
        <summary className="tap" style={{
          cursor: "pointer", listStyle: "none", display: "flex", alignItems: "center", gap: "8px",
          fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)",
        }}>
          <Wallet size={16} aria-hidden />
          {t("Должники и задолженность", "Qarzdorlar va qarzdorlik")}
        </summary>
        <div style={{ marginTop: "16px" }}>
          <DebtorsPanel t={t} lang={lang} limit={20} />
        </div>
      </details>

      <ShopFilters
        lang={lang} search={search} setSearch={setSearch}
        viewMode={viewMode} setViewMode={setViewMode}
        archived={archived} setArchived={setArchived} archivedCount={archivedCount}
        agentFilter={agentFilter} setAgentFilter={setAgentFilter}
        city={city} district={district} agents={agents}
        onlyDebtors={onlyDebtors} setOnlyDebtors={setOnlyDebtors}
        sortBy={sortBy} setSortBy={setSortBy}
        setPage={setPage} resetFilters={resetFilters}
      />

      {/* Territories grid */}
      <div key="territories-grid">
        {viewMode === "territories" && !territoryFilter && !onlyDebtors && (
          <TerritoriesGrid
            territories={territories ?? []}
            totalShops={data?.total ?? 0}
            lang={lang} fmt={fmt}
            onSelectAll={() => setViewMode("list")}
            onSelectTerritory={(territoryId) => { setTerritoryFilter(territoryId); setViewMode("list"); setPage(1); }}
          />
        )}
      </div>

      <div key="shop-list-view">
        {(viewMode === "list" || city || district || territoryFilter || onlyDebtors) && (
          <>
            {(city || district) && (
              <CityBreadcrumb city={city} district={district} total={data?.total ?? 0} lang={lang} />
            )}

            {canEdit && selected.size > 0 && (
              <SelectionBar
                count={selected.size} lang={lang}
                onReset={() => setSelected(new Set())}
                onBulkArchive={handleBulkArchive}
                onBulkRestore={handleBulkRestore}
                isBusy={archiveMutation.isPending || restoreMutation.isPending}
                inArchive={archived === "only"}
              />
            )}

            <ShopList
              data={data?.data} isLoading={isLoading} lang={lang} fmt={fmt}
              selectable={canEdit}
              selected={selected} allSelected={allSelected}
              onSelectAll={toggleSelectAll} onToggleSelect={toggleSelect}
              onNavigate={id => navigate(`/shops/${id}`)}
              page={page} setPage={setPage}
              total={data?.total ?? 0} city={city} district={district} t={t}
            />
          </>
        )}
      </div>

      <div key="territory-manager">
        {showTerritoryManager && <TerritoryManager lang={lang} onClose={() => setShowTerritoryManager(false)} />}
      </div>
    </div>
  );
}
