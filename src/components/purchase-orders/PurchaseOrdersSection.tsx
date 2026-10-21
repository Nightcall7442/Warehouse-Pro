import { useState } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, ChevronRight, Plus, FileDown } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { exportToExcel, formatPurchaseOrdersForExport } from "@/lib/excel";
import { notify } from "@/lib/toast";
import { errorText } from "@/lib/error-text";
import { useLang } from "@/i18n";
import { useCan } from "@/hooks/useCan";
import { useScrollTopOnChange } from "@/hooks/useScrollTopOnChange";
import { PURCHASE_ORDER_STATUS_LABEL } from "@/lib/entity-labels";
import { PremiumSelect } from "@/components/PremiumSelect";
import { QueryErrorFallback } from "@/components/QueryErrorFallback";
import { F, COLORS, SHADOW, money } from "@/components/counterparties/constants";
import { PurchaseOrderStatusBadge, type PurchaseOrderStatus } from "./PurchaseOrderStatusBadge";
import { dayText } from "./day-text";

const PAGE_SIZE = 25;
const STATUSES = Object.keys(PURCHASE_ORDER_STATUS_LABEL) as PurchaseOrderStatus[];

/**
 * Вкладка «Заказы поставщикам» на странице «Приходы».
 *
 * Заказ — то, что ждём: что, сколько и почём. Долга он не создаёт (ADR 0013),
 * поэтому «ожидаемые платежи» здесь — прогноз по неполученному остатку
 * открытых заказов, по валютам, а не сумма в «Контрагентах».
 */
export function PurchaseOrdersSection() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const navigate = useNavigate();
  const [status, setStatus] = useState<PurchaseOrderStatus | "">("");
  const [supplierId, setSupplierId] = useState("");
  const [page, setPage] = useState(1);
  useScrollTopOnChange(page);
  // Заводит заказ тот, кто ведёт поставщиков; смотреть список может и без этого права.
  const can = useCan();
  const utils = trpc.useUtils();

  const filter = { status: status || undefined, supplierId: supplierId ? Number(supplierId) : undefined };
  const listQ = trpc.purchaseOrder.list.useQuery({ ...filter, page, pageSize: PAGE_SIZE });
  const suppliersQ = trpc.supplier.list.useQuery({ includeInactive: true });

  /*
    Выгрузка — по нажатию и под тем же фильтром, что на экране, а не
    страница в 25 строк: файл открывают, чтобы увидеть всё.
  */
  const [exporting, setExporting] = useState(false);
  const exportAll = async () => {
    setExporting(true);
    try {
      const all = await utils.purchaseOrder.list.fetch({ ...filter, page: 1, pageSize: 5000 });
      await exportToExcel(formatPurchaseOrdersForExport(all.data), "purchase-orders", "Заказы поставщикам", "Заказы поставщикам");
    } catch (e) {
      notify.error(errorText(e));
    } finally {
      setExporting(false);
    }
  };

  if (listQ.isLoadingError) return <QueryErrorFallback onRetry={listQ.refetch} />;

  const rows = listQ.data?.data ?? [];
  const summary = listQ.data?.summary ?? { pendingApproval: 0, open: 0, plannedUzs: 0, plannedUsd: 0 };
  const pages = Math.max(1, Math.ceil((listQ.data?.total ?? 0) / PAGE_SIZE));

  const th: React.CSSProperties = {
    fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
    letterSpacing: "0.08em", color: COLORS.textTertiary, padding: "12px 14px",
    borderBottom: `1px solid ${COLORS.border}`, textAlign: "left", whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "12px 14px", borderBottom: `1px solid ${COLORS.border}`,
    fontSize: "13px", fontFamily: F.body, color: COLORS.textPrimary,
  };
  const num: React.CSSProperties = { ...td, textAlign: "right", whiteSpace: "nowrap" };

  const tiles = [
    { key: "pending", label: t("Ждут согласования", "Kelishuvni kutmoqda"), value: String(summary.pendingApproval) },
    { key: "open", label: t("Открытые заказы", "Ochiq buyurtmalar"), value: String(summary.open) },
    {
      key: "planned",
      label: t("Ожидаемые платежи — прогноз", "Kutilayotgan to'lovlar — prognoz"),
      value: money(summary.plannedUzs, "UZS"),
      sub: summary.plannedUsd > 0 ? money(summary.plannedUsd, "USD") : undefined,
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
        {tiles.map(x => (
          <div key={x.key} className="kpi-hero" data-testid={`po-tile-${x.key}`} style={{ borderRadius: "20px", padding: "18px 20px" }}>
            <div style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>
              {x.label}
            </div>
            <div style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, marginTop: "10px" }}>{x.value}</div>
            {x.sub && <div style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary, marginTop: "4px" }}>{x.sub}</div>}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
        <PremiumSelect
          aria-label={t("Состояние заказа", "Buyurtma holati")}
          value={status}
          onChange={v => { setStatus(v as PurchaseOrderStatus | ""); setPage(1); }}
          options={[
            { value: "", label: t("Все заказы", "Barcha buyurtmalar") },
            ...STATUSES.map(s => ({ value: s, label: PURCHASE_ORDER_STATUS_LABEL[s][lang === "uz" ? "uz" : "ru"] })),
          ]}
          width="240px"
        />
        <PremiumSelect
          aria-label={t("Поставщик", "Yetkazib beruvchi")}
          value={supplierId}
          onChange={v => { setSupplierId(v); setPage(1); }}
          options={[
            { value: "", label: t("Все поставщики", "Barcha yetkazib beruvchilar") },
            ...(suppliersQ.data ?? []).map(s => ({ value: String(s.id), label: s.name })),
          ]}
          width="240px"
        />
        <span style={{ flex: 1 }} />
        <button onClick={() => void exportAll()} disabled={exporting} className="neo-btn" data-testid="purchase-orders-excel"
          style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px" }}>
          <FileDown size={14} /> Excel
        </button>
        {can("suppliers.manage") && (
          <button onClick={() => navigate("/purchase-orders/new")} className="neo-btn-primary" data-testid="purchase-orders-new"
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px" }}>
            <Plus size={15} /> {t("Новый заказ", "Yangi buyurtma")}
          </button>
        )}
      </div>

      <div style={{ background: COLORS.surface, borderRadius: "20px", boxShadow: SHADOW, overflowX: "auto" }}>
        {rows.length === 0 ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: COLORS.textSecondary, fontSize: "14px", fontFamily: F.body }} data-testid="po-empty">
            {listQ.isLoading ? t("Загрузка…", "Yuklanmoqda…") : t("Заказов поставщикам пока нет", "Yetkazib beruvchilarga buyurtmalar hali yo'q")}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "760px" }}>
            <thead>
              <tr>
                <th style={th}>{t("Номер", "Raqam")}</th>
                <th style={th}>{t("Поставщик", "Yetkazib beruvchi")}</th>
                <th style={th}>{t("Склад", "Ombor")}</th>
                <th style={th}>{t("Состояние", "Holat")}</th>
                <th style={th}>{t("Ждём", "Kutamiz")}</th>
                <th style={{ ...th, textAlign: "right" }}>{t("Сумма", "Summa")}</th>
                <th style={{ ...th, textAlign: "right" }}>{t("Не получено", "Olinmagan")}</th>
                <th style={th}>{t("Оплата ожидается", "To'lov kutilmoqda")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} data-testid={`po-row-${r.id}`} onClick={() => navigate(`/purchase-orders/${r.id}`)} style={{ cursor: "pointer" }}>
                  <td style={{ ...td, fontWeight: 700, color: COLORS.primaryText, whiteSpace: "nowrap" }}>{r.number}</td>
                  <td style={td}>{r.supplierName}</td>
                  <td style={td}>{r.warehouseName}</td>
                  <td style={td}><PurchaseOrderStatusBadge status={r.status} /></td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{dayText(r.expectedDate)}</td>
                  <td style={num}>{money(r.total, r.currency)}</td>
                  <td style={num}>{r.remaining > 0 ? money(r.remaining, r.currency) : "—"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{dayText(r.expectedPaymentDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "8px", fontSize: "13px", fontFamily: F.body, color: COLORS.textSecondary }}>
          <button className="neo-btn" disabled={page <= 1} onClick={() => setPage(p => p - 1)} aria-label={t("Назад", "Orqaga")}><ChevronLeft size={14} /></button>
          {page} / {pages}
          <button className="neo-btn" disabled={page >= pages} onClick={() => setPage(p => p + 1)} aria-label={t("Вперёд", "Oldinga")}><ChevronRight size={14} /></button>
        </div>
      )}
    </div>
  );
}
