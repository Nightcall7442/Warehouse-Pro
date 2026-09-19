import { useCallback, useMemo, useState } from "react";
import { useCan } from "@/hooks/useCan";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/providers/trpc";
import { useWarehouse } from "@/providers/WarehouseContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLang, useTranslate } from "@/i18n";
import { format } from "date-fns";
import {
  AlertTriangle, Package, FileDown, Trash2, Loader2, Boxes, Banknote, Clock,
  ShoppingCart, Layers, TrendingUp, Columns3, ArrowLeftRight, ClipboardCheck, SlidersHorizontal,
} from "lucide-react";
import { exportToExcel, formatWarehouseForExport, formatStockValuationForExport, formatDeadStockForExport, formatReorderForExport } from "@/lib/excel";
import { useCurrency } from "@/hooks/useCurrency";
import { notify } from "@/lib/toast";
import { AdjustModal, unitLabel, toKg } from "@/components/warehouse";
import { useConfirm } from "@/components/ConfirmDialog";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { formatQty } from "@/lib/format";
import { colorMix } from "@/lib/color-mix";
import { SearchInput } from "@/components/SearchInput";
import { PremiumSelect } from "@/components/PremiumSelect";
import { KpiCard } from "@/components/reports/ReportKpiCards";
// Те же токены, что у страницы заказов: у отчётов нет warningText/onPrimary.
import { F, COLORS, SHADOW } from "@/components/orders/theme-tokens";
import { StockTransfers } from "@/components/warehouse/StockTransfers";
import { WarehouseCompare } from "@/components/warehouse/WarehouseCompare";
import { StockCounts } from "@/components/warehouse/StockCounts";
import { DemandForecast } from "@/components/warehouse/DemandForecast";

// warehouseMulti.getStock is raw SQL behind db.execute, so tRPC infers its rows
// as `unknown` — these two mirror the SELECT lists in that procedure. Decimal
// columns arrive from mysql2 as strings, COUNT() as numbers.
type StockRow = {
  id: number;
  productId: number;
  currentStock: string;
  reserved: string;
  available: string;
  productName: string;
  productCode: string;
  category: string | null;
  unit: "kg" | "l" | "pcs" | "box" | "pack" | "m" | "block";
  unitWeight: string;
  unitPrice: string;
  // blanked by the procedure for roles that may not see the buying price
  costPrice: string | undefined;
  reorderPoint: string;
};

type StockSummary = {
  totalSKUs: number;
  totalWeight: string;
  lowStockCount: number;
};

type Tab = "stock" | "reorder" | "deadstock" | "forecast" | "compare" | "transfers" | "counts";

/** Порог — тот же, что у сервера (lowStockCondition): свободный остаток не выше порога, порог задан. */
const isLow = (r: StockRow) => Number(r.reorderPoint ?? 0) > 0 && Number(r.available ?? 0) <= Number(r.reorderPoint ?? 0);

/** Карточка-обёртка таблицы — та же, что у заказов: поверхность, радиус 24, мягкая тень. */
const TABLE_CARD: React.CSSProperties = { background: COLORS.surface, borderRadius: "24px", overflow: "hidden", boxShadow: SHADOW };
/** Карточка фильтров — та же, что у заказов и товаров. */
const FILTER_CARD: React.CSSProperties = { background: COLORS.surface, borderRadius: "16px", padding: "14px 18px", boxShadow: SHADOW, display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" };

/**
 * Пустое состояние вкладки — одно на три списка. Значок в бледном круге
 * успешного цвета: «пусто» здесь — хорошая новость.
 */
function EmptyTab({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div style={{ ...TABLE_CARD, padding: "56px 24px", textAlign: "center" }}>
      <div style={{ width: "56px", height: "56px", borderRadius: "50%", margin: "0 auto 14px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--kpi-green-track)", color: COLORS.successText }}>
        {icon}
      </div>
      <p style={{ fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary, margin: 0, fontFamily: F.display }}>{title}</p>
      <p style={{ fontSize: "12px", color: COLORS.textTertiary, margin: "4px 0 0" }}>{hint}</p>
    </div>
  );
}

/** Ряд-заглушка таблицы, пока грузится список. */
function SkeletonRows({ cols, n }: { cols: number; n: number }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <tr key={i}><td colSpan={cols}>
          <div className="animate-pulse" style={{ height: "18px", borderRadius: "8px", background: COLORS.surfaceLight }} />
        </td></tr>
      ))}
    </>
  );
}

/** Подпись срочности: «12 дн» красным, жёлтым или обычным. */
function DaysBadge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: "999px", fontSize: "12px", fontWeight: 600, background: colorMix(color, 10), color, fontVariantNumeric: "tabular-nums" }}>
      {children}
    </span>
  );
}

// ── Main warehouse page ───────────────────────────────────────────────────────
/*
  Страница собрана по той же схеме, что «Заказы» и «Отчёты»: заголовок с
  действиями справа → четыре плитки одной формы → лента разделов → карточка
  фильтров → карточка таблицы. До этого здесь было пять плиток разной высоты,
  лента на всю ширину со счётчиками, красная полоса «ниже порога» поверх
  таблицы (третье место с тем же числом) и поиск, висящий сам по себе.

  Плитки «Ниже порога» и «Без продаж» — вход в соответствующий раздел, а не
  просто число: отсюда и пропала полоса с кнопкой «Показать», и отдельное окно
  «мало стока» — в разделе «Дозаказ» тот же список, только с рекомендацией,
  сколько заказать.
*/
export default function Warehouse() {
  const { fmt } = useCurrency();
  const { lang } = useLang();
  const isMobile = useIsMobile();
  const t = useTranslate();
  const { confirm, dialog } = useConfirm();
  /*
    Склад — с этой страницы, а не из бокового меню (там селектора больше нет).
    При одном складе выбора не видно вовсе; при нескольких — фишки под
    заголовком, и они же управляют показателями, списком и правкой остатка.
  */
  const { selectedId: warehouseId, setSelectedId, warehouses, multi } = useWarehouse();

  // Строка живёт в SearchInput: страница на 700+ строк не должна
  // перерисовываться на каждую набранную букву.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // `unit` is captured for the adjust dialog, which today renders quantities
  // without a unit label — AdjustModal takes no unit prop yet.
  const [adjusting, setAdjusting] = useState<{ id: number; name: string; stock: number; unit: string; unitWeight: number } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("stock");
  const [deadStockDays, setDeadStockDays] = useState(30);
  // Фильтры таблицы остатков — на клиенте: список и так приходит целиком.
  const [category, setCategory] = useState("");
  const [lowOnly, setLowOnly] = useState(false);

  const { data, isLoading, isLoadingError, refetch } = trpc.warehouseMulti.getStock.useQuery({ warehouseId: warehouseId ?? undefined, search: debouncedSearch || undefined, pageSize: 10000 }, {
    // Прошлый список остаётся на экране, пока грузится новый: без этого
    // смена запроса обнуляет data, и страница падает в скелетон на каждый
    // ввод — именно это и выглядело как перезагрузка.
    placeholderData: keepPreviousData,
  });
  // Показатели — по выбранному складу, как и список: иначе «стоимость склада»
  // складывала все склады, а «остатки» показывали один.
  const whArg = multi ? { warehouseId: warehouseId ?? undefined } : {};
  const { data: valuation, isLoading: valLoading } = trpc.warehouse.valuation.useQuery(whArg);
  const { data: reorderSuggestions } = trpc.warehouse.reorderSuggestions.useQuery(whArg);
  const { data: deadStockItems, isLoading: deadStockLoading } = trpc.warehouse.deadStock.useQuery({ days: deadStockDays, ...whArg });
  const utils = trpc.useUtils();

  /*
    Ручная правка остатков и удаление товара — то, что арендатор чаще всего
    закрывает оператору: списать «на бумаге» лишний мешок можно одним нажатием.
  */
  const can = useCan();
  const canAdjust = can("warehouse.adjust");
  const canDeleteProduct = can("products.manage");

  const handleAdjust = useCallback((item: { id: number; name: string; stock: number; unit: string; unitWeight: number }) => {
    setAdjusting(item);
  }, []);

  const deleteMutation = trpc.product.delete.useMutation({
    onSuccess: () => {
      utils.warehouseMulti.getStock.invalidate();
      notify.success(t("Товар удалён", "Mahsulot o'chirildi"));
    },
    onError: (e) => notify.error(e.message),
  });

  /**
   * Удаление товара — с подтверждением.
   *
   * Кнопка с корзиной стоит вплотную к «Скорректировать», и промах по ней
   * стоил дорого: товар исчезал из каталога, из остатков и из подбора в
   * заказах, а отмены нет. Подтверждения при этом не было вовсе, хотя рядом,
   * у «Удалить ВСЕ», оно есть, и на странице товаров та же процедура им
   * защищена — то есть правило в продукте принято, здесь его просто забыли.
   *
   * Название товара в вопросе не для красоты: оно единственное, по чему видно,
   * что рука попала не в ту строку.
   */
  const handleDelete = useCallback(async (id: number, name?: string) => {
    const ok = await confirm({
      title: t("Удалить товар?", "Mahsulotni o'chirish?"),
      message: name
        ? t(`«${name}» исчезнет из каталога и остатков. Это нельзя отменить.`,
             `«${name}» katalog va qoldiqlardan yo'qoladi. Buni qaytarib bo'lmaydi.`)
        : t("Товар исчезнет из каталога и остатков. Это нельзя отменить.",
             "Mahsulot katalog va qoldiqlardan yo'qoladi. Buni qaytarib bo'lmaydi."),
      danger: true,
      confirmText: t("Удалить", "O'chirish"),
    });
    if (ok) deleteMutation.mutate({ id });
  }, [confirm, deleteMutation, t]);

  const adjustMutation = trpc.warehouse.adjustStock.useMutation({
    onSuccess: () => {
      utils.warehouseMulti.getStock.invalidate();
      setAdjusting(null);
      notify.success(t("Сток обновлён", "Stok yangilandi"));
    },
    onError: (e) => notify.error(e.message),
  });

  /*
    Строки остатков для товаров, у которых их нет. Товар получает строку при
    создании, так что это починка старых каталогов, а не ежедневное действие —
    ей место в пустом состоянии и в подвале таблицы, а не среди главных кнопок.
  */
  const backfillMutation = trpc.warehouse.backfillStock.useMutation({
    onSuccess: (result) => {
      utils.warehouseMulti.getStock.invalidate();
      if (result.created > 0) {
        notify.success(t(`Создано ${result.created} строк стока`, `${result.created} ta stok satiri yaratildi`));
      } else {
        notify.success(t("Все товары уже имеют строки стока", "Barcha mahsulotlar allaqachon stokka ega"));
      }
    },
    onError: (e) => notify.error(e.message),
  });

  const stockAll = data?.data as StockRow[] | undefined;
  const summary = data?.summary as StockSummary | undefined;

  // Категории — из самих строк: отдельного справочника странице не нужно.
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of stockAll ?? []) if (r.category) set.add(r.category);
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }, [stockAll]);

  const stock = useMemo(() => {
    if (!stockAll) return stockAll;
    if (!category && !lowOnly) return stockAll;
    return stockAll.filter(r => (!category || r.category === category) && (!lowOnly || isLow(r)));
  }, [stockAll, category, lowOnly]);

  /*
    Окно строк. Сервер отдаёт до 10 000 позиций, и все они рисовались разом:
    у арендатора с большим каталогом таблица собиралась секунды, а прокрутка
    дёргалась. Первые две сотни — сразу, дальше по кнопке; новый поиск
    начинает с начала.
  */
  const PAGE = 200;
  // Окно сбрасывается на новый поиск/склад/фильтр прямо при отрисовке — без эффекта.
  const windowKey = `${debouncedSearch}|${warehouseId ?? ""}|${category}|${lowOnly ? 1 : 0}`;
  const [win, setWin] = useState({ key: windowKey, rows: PAGE });
  if (win.key !== windowKey) setWin({ key: windowKey, rows: PAGE });
  const visibleRows = win.key === windowKey ? win.rows : PAGE;
  const setVisibleRows = (f: (v: number) => number) => setWin(w => ({ key: windowKey, rows: f(w.rows) }));
  const shown = stock?.slice(0, visibleRows);
  const hidden = Math.max(0, (stock?.length ?? 0) - visibleRows);
  const lowCount = Number(summary?.lowStockCount ?? 0);
  const deadCount = deadStockItems?.length ?? 0;
  const deadValue = (deadStockItems ?? []).reduce((acc, r) => acc + Number(r.value ?? 0), 0);
  const costValue = Number(valuation?.totalCostValue ?? 0);
  const totalKg = Number(summary?.totalWeight ?? 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 });

  /*
    Склады и перемещения в пути — для вкладки «Перемещения».

    Список складов нужен и самой вкладке (имена вместо номеров в маршруте), и
    счётчику на ней. Оба запроса лёгкие: складов у арендатора единицы.
  */
  const pendingQ = trpc.warehouseMulti.listTransfers.useQuery({ status: "pending", limit: 100 }, { enabled: multi });
  const pendingTransfers = pendingQ.data?.length ?? 0;

  /*
    Лента разделов — тот же .range-pills, что на «Отчётах» и главной. Счётчик
    стоит только там, где число зовёт что-то сделать: ниже порога, без
    продаж, в пути. У «Прогноза» и «Инвентаризации» счётчика нет — это не
    список дел.
  */
  const tabs = useMemo(() => [
    { key: "stock" as const, label: t("Остатки", "Qoldiqlar"), icon: <Layers size={15} />, count: 0, warn: false },
    // «Дозаказ» отвечает «что УЖЕ ниже порога» — состояние на сегодня.
    { key: "reorder" as const, label: t("Дозаказ", "Qayta buyurtma"), icon: <ShoppingCart size={15} />, count: reorderSuggestions?.length ?? 0, warn: true },
    { key: "deadstock" as const, label: t("Мёртвый сток", "O'lik stok"), icon: <Clock size={15} />, count: deadCount, warn: false },
    // «Прогноз» — другой вопрос: КОГДА кончится и сколько заказать с учётом доставки.
    { key: "forecast" as const, label: t("Прогноз", "Prognoz"), icon: <TrendingUp size={15} />, count: 0, warn: false },
    // Сравнение и перемещения — только когда складов больше одного: одному
    // складу не с чем сравниваться и некуда перемещать.
    ...(multi ? [
      { key: "compare" as const, label: t("Сравнение", "Taqqoslash"), icon: <Columns3 size={15} />, count: 0, warn: false },
      { key: "transfers" as const, label: t("Перемещения", "Ko'chirishlar"), icon: <ArrowLeftRight size={15} />, count: pendingTransfers, warn: false },
    ] : []),
    // Инвентаризация — документ: снимок, счёт (в т. ч. сканером), применение разом.
    ...(canAdjust ? [{ key: "counts" as const, label: t("Инвентаризация", "Inventarizatsiya"), icon: <ClipboardCheck size={15} />, count: 0, warn: false }] : []),
  ], [deadCount, reorderSuggestions, pendingTransfers, multi, canAdjust, t]);

  if (isLoadingError) return <QueryErrorFallback onRetry={refetch} />;

  const excel = (
    activeTab === "stock" ? (
      <>
        <button type="button" className="neo-btn neo-btn-sm tap"
          onClick={async () => await exportToExcel(formatWarehouseForExport(stock ?? []), "warehouse-stock", "Склад", t("Остатки склада", "Ombor qoldiqlari"))}>
          <FileDown size={14} /> Excel
        </button>
        {/* Оценка — с себестоимостью; строки без неё приходят у ролей, которым закупочную цену не показывают. */}
        {stock?.some(r => r.costPrice !== undefined) && (
          <button type="button" className="neo-btn neo-btn-sm tap"
            onClick={async () => await exportToExcel(formatStockValuationForExport(stock ?? []), "stock-valuation", "Оценка склада", t("Оценка стоимости склада", "Ombor qiymati"))}>
            <Banknote size={14} /> {t("Оценка", "Qiymat")}
          </button>
        )}
      </>
    ) : activeTab === "deadstock" ? (
      <button type="button" className="neo-btn neo-btn-sm tap"
        onClick={async () => await exportToExcel(formatDeadStockForExport(deadStockItems ?? []), "dead-stock", "Мёртвый сток", t("Мёртвый сток — товары без продаж", "O'lik stok — sotilmasdan mahsulotlar"))}>
        <FileDown size={14} /> Excel
      </button>
    ) : activeTab === "reorder" ? (
      <button type="button" className="neo-btn neo-btn-sm tap"
        onClick={async () => await exportToExcel(formatReorderForExport(reorderSuggestions ?? []), "reorder-suggestions", "Дозаказ", t("Рекомендации по дозаказу", "Qayta buyurtma tavsiyalari"))}>
        <FileDown size={14} /> Excel
      </button>
    ) : null
  );

  const backfillButton = (kind: "button" | "link") => (
    <button type="button" onClick={() => backfillMutation.mutate()} disabled={backfillMutation.isPending} data-testid="stock-backfill"
      className={kind === "button" ? "neo-btn neo-btn-sm tap" : "tap"}
      style={kind === "link" ? { display: "inline-flex", alignItems: "center", gap: "5px", border: "none", background: "transparent", cursor: "pointer", padding: "4px 6px", fontSize: "12px", fontFamily: F.body, color: COLORS.textTertiary } : undefined}>
      {backfillMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Package size={13} />}
      {t("Завести строки остатков", "Qoldiq satrlarini yaratish")}
    </button>
  );

  const adjustArgs = (item: StockRow) => ({ id: item.productId, name: item.productName ?? "", stock: Number(item.currentStock ?? 0), unit: item.unit ?? "pcs", unitWeight: Number(item.unitWeight ?? 0) });

  return (
    <>
    <div className="space-y-5 animate-fade-up">
      <div key="adjust-modal">
        {adjusting && (
          <AdjustModal
            productId={adjusting.id}
            productName={adjusting.name}
            currentStock={adjusting.stock}
            unitWeight={adjusting.unitWeight}
            warehouseId={warehouseId ?? undefined}
            onSave={d => adjustMutation.mutate(d as Parameters<typeof adjustMutation.mutate>[0])}
            onClose={() => setAdjusting(null)}
            isPending={adjustMutation.isPending}
          />
        )}
      </div>

      {/* ─── Header ─── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.025em", margin: 0 }}>
            {t("Склад", "Ombor")}
          </h1>
          <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: "4px 0 0" }}>
            {t("Остатки, дозаказ и движение товара", "Qoldiqlar, qayta buyurtma va tovar harakati")}
          </p>
          {multi && activeTab !== "compare" && activeTab !== "transfers" && (
            <div className="flex flex-wrap gap-2 mt-3" role="tablist" aria-label={t("Склад", "Ombor")} data-testid="warehouse-chips">
              {warehouses.map(w => {
                const active = w.id === warehouseId;
                return (
                  <button key={w.id} type="button" role="tab" aria-selected={active} onClick={() => setSelectedId(w.id)}
                    className="tap text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
                    style={{
                      background: active ? "var(--color-primary)" : "var(--color-surface-light)",
                      color: active ? "var(--color-on-primary)" : "var(--color-text-secondary)",
                    }}>
                    {w.name}{w.isDefault ? " ★" : ""}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {/* Справа — только выгрузки текущего раздела; документы (инвентаризация,
            перемещение) заводятся в своих разделах, где видно, что уже есть. */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          {excel}
        </div>
      </div>

      {/* ─── KPI: четыре плитки одной формы, две из них — вход в раздел ─── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          tone="blue"
          label={t("ПОЗИЦИЙ", "POZITSIYALAR")}
          value={summary ? String(summary.totalSKUs) : "—"}
          icon={<Boxes size={17} />}
          note={summary ? `${totalKg} ${t("кг на складе", "kg omborda")}` : t("считаем…", "hisoblanmoqda…")}
        />
        <KpiCard
          tone="green"
          label={t("СТОИМОСТЬ ОСТАТКОВ", "QOLDIQ QIYMATI")}
          value={valLoading ? "—" : fmt(costValue, true)}
          icon={<Banknote size={17} />}
          note={valLoading ? t("по себестоимости", "tannarx bo'yicha") : `${t("по себестоимости", "tannarx bo'yicha")} · ${fmt(costValue.toFixed(0))}`}
        />
        <KpiCard
          tone={lowCount > 0 ? "red" : "green"}
          label={t("НИЖЕ ПОРОГА", "CHEGARADAN PAST")}
          value={summary ? String(lowCount) : "—"}
          icon={<AlertTriangle size={17} />}
          note={lowCount > 0 ? t("к списку дозаказа →", "qayta buyurtma ro'yxatiga →") : t("все товары выше порога", "barcha mahsulotlar chegaradan yuqori")}
          onClick={lowCount > 0 ? () => setActiveTab("reorder") : undefined}
        />
        <KpiCard
          tone={deadCount > 0 ? "amber" : "green"}
          label={`${t("БЕЗ ПРОДАЖ", "SOTUVSIZ")} · ${deadStockDays} ${t("ДН", "KUN")}`}
          value={deadStockItems ? String(deadCount) : "—"}
          icon={<Clock size={17} />}
          note={deadCount > 0 ? `${fmt(deadValue, true)} · ${t("к списку →", "ro'yxatga →")}` : t("всё продаётся", "hammasi sotilmoqda")}
          onClick={deadCount > 0 ? () => setActiveTab("deadstock") : undefined}
        />
      </div>

      {/* ─── Tabs ─── */}
      <div role="tablist" className="range-pills" style={{ flexWrap: "wrap" }}>
        {tabs.map(tab => (
          <button key={tab.key} type="button" role="tab" aria-selected={activeTab === tab.key} onClick={() => setActiveTab(tab.key)}
            className={"range-pill tap" + (activeTab === tab.key ? " active" : "")}
            style={{ display: "flex", alignItems: "center", gap: "7px", whiteSpace: "nowrap" }}>
            {tab.icon}
            {tab.label}
            {tab.count > 0 && (
              <span className="font-data" style={{ fontSize: "11px", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: tab.warn ? COLORS.dangerText : COLORS.textTertiary }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── STOCK TAB ───────────────────────────────────────────────────────── */}
      {activeTab === "stock" && (
        <>
          {/* Фильтры — карточкой, как у заказов и товаров. */}
          <div style={FILTER_CARD}>
            <SearchInput
              placeholder={t("Поиск товаров…", "Mahsulot qidirish…")}
              onSearch={setDebouncedSearch}
              style={{ flex: "1 1 200px" }}
            />
            {categories.length > 1 && (
              <PremiumSelect value={category} onChange={setCategory} width="180px"
                aria-label={t("Категория", "Kategoriya")}
                options={[{ value: "", label: t("Все категории", "Barcha kategoriyalar") }, ...categories.map(c => ({ value: c, label: c }))]} />
            )}
            <button type="button" onClick={() => setLowOnly(v => !v)} aria-pressed={lowOnly} className="neo-btn neo-btn-sm tap" data-testid="stock-low-only"
              style={{ gap: "6px", color: lowOnly ? COLORS.onPrimary : lowCount > 0 ? COLORS.dangerText : COLORS.textSecondary, background: lowOnly ? COLORS.danger : undefined }}>
              <AlertTriangle size={13} />
              {t("Ниже порога", "Chegaradan past")}
              {lowCount > 0 && <span className="font-data" style={{ fontWeight: 700 }}>{lowCount}</span>}
            </button>
          </div>

          {/* Table */}
          {isMobile ? (
            <div className="space-y-3">
              {isLoading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-28 rounded-2xl animate-pulse" style={{ background: COLORS.surfaceLight }} />
                  ))
                : shown?.map((item) => {
                    const low = isLow(item);
                    return (
                      <div key={item.id} style={{ ...TABLE_CARD, borderRadius: "16px", display: "flex" }}>
                        {low && <div style={{ width: "4px", flexShrink: 0, background: COLORS.danger }} />}
                        <div style={{ flex: 1, padding: "16px" }}>
                          <div className="flex items-center justify-between mb-3 gap-2">
                            <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
                              {low && <AlertTriangle size={14} color={COLORS.dangerText} />}
                              <p className="text-sm font-semibold truncate" style={{ color: COLORS.textPrimary }}>{item.productName}</p>
                            </div>
                            <div className="flex items-center gap-1" style={{ flexShrink: 0 }}>
                              {canAdjust && <button type="button" onClick={() => handleAdjust(adjustArgs(item))} className="neo-btn neo-btn-xs tap" style={{ color: COLORS.primaryText }}>
                                {t("Скорр.", "Tuzatish")}
                              </button>}
                              {canDeleteProduct && <button type="button" onClick={() => handleDelete(item.productId, item.productName ?? undefined)}
                                disabled={deleteMutation.isPending} aria-label={t("Удалить товар", "Mahsulotni o'chirish")}
                                className="neo-btn neo-btn-xs tap" style={{ color: COLORS.dangerText }}>
                                <Trash2 size={12} />
                              </button>}
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            {[
                              { label: t("Доступно", "Mavjud"), val: item.available, danger: low },
                              { label: t("Резерв", "Zahira"), val: item.reserved, danger: false },
                              { label: t("Всего", "Jami"), val: item.currentStock, danger: false },
                            ].map(col => (
                              <div key={col.label}>
                                <p className="text-lg font-bold" style={{ color: col.danger ? COLORS.dangerText : COLORS.textPrimary, fontFamily: F.display, fontVariantNumeric: "tabular-nums" }}>
                                  {formatQty(col.val)}
                                </p>
                                <p className="text-[10px] mt-0.5" style={{ color: COLORS.textTertiary }}>{col.label}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              {hidden > 0 && (
                <button type="button" className="neo-btn tap w-full" onClick={() => setVisibleRows(v => v + PAGE)} data-testid="stock-show-more-m">
                  {t(`Показать ещё ${Math.min(PAGE, hidden)} (осталось ${hidden})`, `Yana ${Math.min(PAGE, hidden)} ko'rsatish (qoldi ${hidden})`)}
                </button>
              )}
            </div>
          ) : (
            <div style={TABLE_CARD}>
              <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    {[t("ТОВАР","MAHSULOT"), t("КОД","KOD"), t("КАТЕГОРИЯ","KATEGORIYA"),
                      t("ДОСТУПНО","MAVJUD"), t("ВЕС","OG'IRLIK"), t("РЕЗЕРВ","ZAHIRA"), t("ВСЕГО","JAMI"),
                      t("ПОРОГ","CHEGARA"), ""].map((h, i) => (
                      <th key={h || "actions"} style={i >= 3 && i <= 7 ? { textAlign: "right" } : undefined}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? <SkeletonRows cols={9} n={6} />
                    : stock?.length === 0
                    ? <tr><td colSpan={9} style={{ textAlign: "center", padding: "48px 16px", color: COLORS.textTertiary, fontSize: "13px" }}>
                        {stockAll?.length === 0 && !debouncedSearch
                          ? <>
                              <div style={{ fontWeight: 600, color: COLORS.textPrimary }}>{t("Нет товаров на складе", "Omborda mahsulot yo'q")}</div>
                              <div style={{ marginTop: "4px" }}>{t("Товары каталога без строки остатка появятся здесь после одного нажатия.", "Qoldiq satrisiz katalog mahsulotlari bir bosishdan keyin shu yerda paydo bo'ladi.")}</div>
                              {canAdjust && <div style={{ marginTop: "14px" }}>{backfillButton("button")}</div>}
                            </>
                          : t("Ничего не найдено", "Hech narsa topilmadi")}
                      </td></tr>
                    : shown?.map((item) => {
                        const low = isLow(item);
                        const num: React.CSSProperties = { textAlign: "right", fontFamily: F.display, fontVariantNumeric: "tabular-nums" };
                        return (
                          <tr key={item.id} style={low ? { background: colorMix(COLORS.danger, 4) } : undefined}>
                            <td>
                              <div className="flex items-center gap-2.5">
                                {low && <AlertTriangle size={13} color={COLORS.dangerText} />}
                                <span style={{ fontWeight: 500 }}>{item.productName}</span>
                              </div>
                            </td>
                            <td style={{ fontSize: "12px", color: COLORS.textTertiary, fontFamily: F.display }}>{item.productCode}</td>
                            <td style={{ color: COLORS.textSecondary }}>{item.category ?? "—"}</td>
                            <td style={{ ...num, fontWeight: 700, color: low ? COLORS.dangerText : COLORS.textPrimary }}>{formatQty(item.available)}</td>
                            <td style={{ ...num, color: COLORS.textSecondary }}>{formatQty(toKg(item.available, item.unitWeight))} {t("кг", "kg")}</td>
                            <td style={{ ...num, color: COLORS.textSecondary }}>{formatQty(item.reserved)}</td>
                            <td style={num}>{formatQty(item.currentStock)}</td>
                            <td style={{ ...num, color: COLORS.textTertiary }}>{Number(item.reorderPoint) > 0 ? formatQty(item.reorderPoint, 0) : "—"}</td>
                            <td style={{ padding: "6px 12px" }}>
                              {/* Действия — тихие: тридцать красных квадратов в столбце перекрикивали сами числа. */}
                              <div className="flex items-center justify-end gap-1">
                                {canAdjust && <button type="button" onClick={() => handleAdjust(adjustArgs(item))}
                                  className="tap" title={t("Скорректировать остаток", "Qoldiqni tuzatish")}
                                  style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "6px 10px", borderRadius: "8px", border: "none", background: "transparent", cursor: "pointer", fontSize: "12px", fontWeight: 600, fontFamily: F.body, color: COLORS.primaryText }}>
                                  <SlidersHorizontal size={13} /> {t("Скорректировать", "Tuzatish")}
                                </button>}
                                {canDeleteProduct && <button type="button" onClick={() => handleDelete(item.productId, item.productName ?? undefined)}
                                  disabled={deleteMutation.isPending} className="tap" aria-label={t("Удалить товар", "Mahsulotni o'chirish")} title={t("Удалить товар", "Mahsulotni o'chirish")}
                                  style={{ display: "inline-flex", alignItems: "center", padding: "6px", borderRadius: "8px", border: "none", background: "transparent", cursor: "pointer", color: COLORS.textTertiary }}
                                  onMouseEnter={e => { e.currentTarget.style.color = COLORS.dangerText; }}
                                  onMouseLeave={e => { e.currentTarget.style.color = COLORS.textTertiary; }}>
                                  <Trash2 size={13} />
                                </button>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
              </div>
              {/* Подвал: сколько показано, «ещё», и починка старых каталогов — тихой ссылкой. */}
              {!isLoading && (stock?.length ?? 0) > 0 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", padding: "10px 16px", borderTop: `1px solid ${COLORS.border}`, fontSize: "12px", color: COLORS.textTertiary }}>
                  <span>
                    {hidden > 0
                      ? t(`Показано ${shown?.length ?? 0} из ${stock?.length ?? 0}`, `${shown?.length ?? 0} / ${stock?.length ?? 0} ko'rsatilgan`)
                      : `${stock?.length ?? 0} ${t("позиций", "pozitsiya")}`}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {canAdjust && backfillButton("link")}
                    {hidden > 0 && (
                      <button type="button" className="neo-btn neo-btn-sm tap" onClick={() => setVisibleRows(v => v + PAGE)} data-testid="stock-show-more">
                        {t(`Показать ещё ${Math.min(PAGE, hidden)}`, `Yana ${Math.min(PAGE, hidden)} ko'rsatish`)}
                      </button>
                    )}
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ── FORECAST / TRANSFERS / COMPARE / COUNTS ───────────────────────── */}
      {activeTab === "forecast" && <DemandForecast />}

      {activeTab === "transfers" && multi && (
        <StockTransfers warehouses={warehouses} canTransfer={canAdjust} />
      )}

      {activeTab === "compare" && multi && (
        <WarehouseCompare warehouses={warehouses} />
      )}

      {activeTab === "counts" && canAdjust && (
        <StockCounts warehouses={warehouses} />
      )}

      {/* ── DEAD STOCK TAB ─────────────────────────────────────────────────── */}
      {activeTab === "deadstock" && (
        <>
          <div style={FILTER_CARD}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: COLORS.textTertiary }}>
              {t("Без продаж более", "Sotilmasdan ko'proq")}:
            </span>
            <div className="range-pills" role="tablist">
              {[7, 14, 30, 60, 90].map(d => (
                <button key={d} type="button" role="tab" aria-selected={deadStockDays === d} onClick={() => setDeadStockDays(d)}
                  className={"range-pill tap" + (deadStockDays === d ? " active" : "")}>
                  {d} {t("дн", "kun")}
                </button>
              ))}
            </div>
            {deadCount > 0 && (
              <span style={{ marginLeft: "auto", fontSize: "12px", color: COLORS.textSecondary }}>
                {deadCount} {t("товаров", "mahsulot")} · <b style={{ color: COLORS.textPrimary }}>{fmt(deadValue.toFixed(0))}</b>
              </span>
            )}
          </div>

          {deadStockLoading ? (
            <div style={TABLE_CARD}><table className="data-table"><tbody><SkeletonRows cols={1} n={4} /></tbody></table></div>
          ) : !deadStockItems?.length ? (
            <EmptyTab icon={<Package size={24} />} title={t("Нет мёртвого стока", "O'lik stok yo'q")}
              hint={`${t("Все товары продаются в течение", "Barcha mahsulotlar sotilmoqda")} ${deadStockDays} ${t("дней", "kun")}.`} />
          ) : isMobile ? (
            <div className="space-y-3">
              {deadStockItems.map((item) => {
                const days = Number(item.daysSinceOrder ?? 99999);
                const badgeColor = days > 90 ? COLORS.dangerText : days > 30 ? COLORS.warningText : COLORS.textSecondary;
                return (
                  <div key={item.productId} style={{ ...TABLE_CARD, borderRadius: "16px", padding: "14px 16px" }}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-sm font-semibold truncate" style={{ color: COLORS.textPrimary }}>{item.productName}</span>
                      <DaysBadge color={badgeColor}>{days === 99999 ? t("Никогда", "Hech qachon") : `${days} ${t("дн", "kun")}`}</DaysBadge>
                    </div>
                    <div className="flex items-center justify-between text-xs" style={{ color: COLORS.textTertiary }}>
                      <span>{t("Остаток:", "Qoldiq:")} {formatQty(item.currentStock)}</span>
                      <span className="font-bold" style={{ color: COLORS.textPrimary, fontFamily: F.display }}>{fmt(Number(item.value ?? 0).toFixed(0))}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={TABLE_CARD}>
              <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    {[t("ТОВАР","MAHSULOT"), t("КОД","KOD"), t("КАТЕГОРИЯ","KATEGORIYA"), t("ОСТАТОК","QOLDIQ"), t("СТОИМОСТЬ","QIYMAT"), t("ПОСЛ. ЗАКАЗ","OXIRGI BUYURTMA"), t("ДНЕЙ БЕЗ ПРОДАЖ","SOTISHSIZ KUN")].map((h, i) => (
                      <th key={h} style={i === 3 || i === 4 ? { textAlign: "right" } : undefined}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deadStockItems.map((item) => {
                    const days = Number(item.daysSinceOrder ?? 99999);
                    const badgeColor = days > 90 ? COLORS.dangerText : days > 30 ? COLORS.warningText : COLORS.textSecondary;
                    const num: React.CSSProperties = { textAlign: "right", fontFamily: F.display, fontVariantNumeric: "tabular-nums" };
                    return (
                      <tr key={item.productId}>
                        <td style={{ fontWeight: 500 }}>{item.productName}</td>
                        <td style={{ fontSize: "12px", color: COLORS.textTertiary, fontFamily: F.display }}>{item.productCode}</td>
                        <td style={{ color: COLORS.textSecondary }}>{item.category ?? "—"}</td>
                        <td style={{ ...num, fontWeight: 700 }}>{formatQty(item.currentStock)}</td>
                        <td style={{ ...num, fontWeight: 700 }}>{fmt(Number(item.value ?? 0).toFixed(0))}</td>
                        <td style={{ fontSize: "12px", color: COLORS.textTertiary, fontFamily: F.display }}>
                          {item.lastOrderDate ? format(new Date(item.lastOrderDate), "dd.MM.yyyy") : t("Никогда", "Hech qachon")}
                        </td>
                        <td><DaysBadge color={badgeColor}>{days === 99999 ? "∞" : `${days} ${t("дн", "kun")}`}</DaysBadge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── REORDER TAB ────────────────────────────────────────────────────── */}
      {activeTab === "reorder" && (
        <>
          {!reorderSuggestions?.length ? (
            <EmptyTab icon={<ShoppingCart size={24} />} title={t("Все товары в наличии", "Barcha mahsulotlar mavjud")}
              hint={t("Нет товаров, требующих дозаказа", "Qayta buyurtma kerak bo'lgan mahsulot yo'q")} />
          ) : isMobile ? (
            <div className="space-y-3">
              {reorderSuggestions.map((item) => {
                const daysLeft = Number(item.daysUntilStockout ?? 999);
                const badgeColor = daysLeft <= 3 ? COLORS.dangerText : daysLeft <= 7 ? COLORS.warningText : COLORS.textSecondary;
                return (
                  <div key={item.productId} style={{ ...TABLE_CARD, borderRadius: "16px", display: "flex" }}>
                    <div style={{ width: "4px", flexShrink: 0, background: badgeColor }} />
                    <div style={{ flex: 1, padding: "14px 16px" }}>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-sm font-semibold truncate" style={{ color: COLORS.textPrimary }}>{item.productName}</span>
                        <DaysBadge color={badgeColor}>{daysLeft} {t("дн до конца", "kun qoldi")}</DaysBadge>
                      </div>
                      <div className="flex items-center justify-between text-xs" style={{ color: COLORS.textTertiary }}>
                        <span>{t("Остаток:", "Qoldiq:")} {formatQty(item.currentStock)} / {formatQty(item.reorderPoint, 0)} {unitLabel(item.unit ?? undefined, lang)}</span>
                        <span className="font-semibold" style={{ color: badgeColor }}>+{item.suggestedQty} {unitLabel(item.unit ?? undefined, lang)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={TABLE_CARD}>
              <div style={{ overflowX: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    {[t("ТОВАР","MAHSULOT"), t("ОСТАТОК","QOLDIQ"), t("ПОРОГ","CHEGARA"), t("ПРОДАЖИ/ДЕНЬ","SOTISH/KUN"), t("ДНЕЙ ДО КОНЦА","KUN QOLDI"), t("ЗАКАЗАТЬ","BUYURTMA BERISH"), t("СТОИМОСТЬ","NARX")].map((h, i) => (
                      <th key={h} style={i >= 1 && i !== 4 ? { textAlign: "right" } : undefined}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reorderSuggestions.map((item) => {
                    const daysLeft = Number(item.daysUntilStockout ?? 999);
                    const isUrgent = daysLeft <= 3;
                    const badgeColor = isUrgent ? COLORS.dangerText : daysLeft <= 7 ? COLORS.warningText : COLORS.textSecondary;
                    const u = unitLabel(item.unit ?? undefined, lang);
                    const num: React.CSSProperties = { textAlign: "right", fontFamily: F.display, fontVariantNumeric: "tabular-nums" };
                    return (
                      <tr key={item.productId} style={isUrgent ? { background: colorMix(COLORS.danger, 4) } : undefined}>
                        <td>
                          <div className="flex items-center gap-2">
                            {isUrgent && <AlertTriangle size={13} color={COLORS.dangerText} />}
                            <span style={{ fontWeight: 500 }}>{item.productName}</span>
                          </div>
                        </td>
                        <td style={{ ...num, fontWeight: 700, color: badgeColor }}>{formatQty(item.currentStock)} {u}</td>
                        <td style={{ ...num, color: COLORS.textTertiary }}>{formatQty(item.reorderPoint, 0)} {u}</td>
                        <td style={{ ...num, color: COLORS.textSecondary }}>{item.avgDailySales}</td>
                        <td><DaysBadge color={badgeColor}>{daysLeft} {t("дн", "kun")}</DaysBadge></td>
                        <td style={{ ...num, fontWeight: 700, color: COLORS.primaryText }}>+{item.suggestedQty} {u}</td>
                        <td style={{ ...num, fontWeight: 700 }}>{fmt(Number(item.suggestedCost ?? 0).toFixed(0))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", padding: "10px 16px", borderTop: `1px solid ${COLORS.border}`, fontSize: "12px", color: COLORS.textTertiary }}>
                <span>{reorderSuggestions.length} {t("товаров", "mahsulot")}</span>
                <span>{t("Общая стоимость дозаказа:", "Umumiy buyurtma qiymati:")} <b style={{ color: COLORS.textPrimary }}>{fmt(reorderSuggestions.reduce((acc, r) => acc + Number(r.suggestedCost ?? 0), 0).toFixed(0))}</b></span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
    {dialog}
    </>
  );
}
