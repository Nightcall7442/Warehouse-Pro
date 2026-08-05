import { useState, useMemo, useEffect } from "react";
import { AppModal, modalSectionLabel } from "@/components/ui/AppModal";
import { Printer, Download, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, AlertTriangle, Loader2, Wallet } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { printBatchInvoices, type BatchOrderData, type BatchPrintOptions, type CompanyInfo } from "@/lib/documents";
import { useTranslate } from "@/i18n";
import { StatusBadge } from "./theme";
import { colorMix } from "@/lib/color-mix";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderIds: number[];
  onDone: () => void;
}

// Fixed, non-configurable print options — no settings panel, always this
// compact default: A4, QR code, signature line, continuous sheet, sorted by
// order number. The debt block (buildDebtBlock in lib/documents) and notes
// print unconditionally whenever present, no toggle needed for either.
const PRINT_OPTIONS: BatchPrintOptions = {
  includeQrCode: true,
  includeBarcodes: false,
  includeCostPrice: false,
  includeSignature: true,
  includeNotes: true,
  pageBreakPerOrder: false,
  sortBy: "orderNumber",
};
const PRINT_FORMAT = "a4" as const;

export function InvoicePrintModal({ open, onOpenChange, orderIds, onDone }: Props) {
  const t = useTranslate();

  const [docType, setDocType] = useState<"simple" | "ttn">("simple");
  const [previewIdx, setPreviewIdx] = useState(0);
  const [zoom, setZoom] = useState(75);

  const settings = trpc.settings.get.useQuery();
  const batchMutation = trpc.order.batchPrintInvoices.useMutation();

  const company: CompanyInfo = useMemo(() => ({
    name: settings.data?.companyName ?? "Warehouse Pro",
    address: settings.data?.companyAddress ?? undefined,
    inn: settings.data?.companyInn ?? undefined,
    director: settings.data?.companyDirector ?? undefined,
    bank: settings.data?.companyBank ?? undefined,
    account: settings.data?.companyBankAccount ?? undefined,
    mfo: settings.data?.companyMfo ?? undefined,
  }), [settings.data]);

  const currency = settings.data?.currencySymbol ?? "сум";

  const [result, setResult] = useState<{ orders: BatchOrderData[] } | null>(null);

  const handleGenerate = async () => {
    try {
      const res = await batchMutation.mutateAsync({
        orderIds,
        format: PRINT_FORMAT,
        options: PRINT_OPTIONS,
      });
      setResult(res as { orders: BatchOrderData[] });
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Ошибка генерации");
    }
  };

  // Generate immediately with the fixed defaults when the modal opens.
  useEffect(() => {
    if (open && orderIds.length > 0) {
      setResult(null);
      handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderIds.join(",")]);

  const handlePrint = () => {
    if (!result) return;
    printBatchInvoices(result.orders, PRINT_OPTIONS, company, currency, docType);
    onDone();
    onOpenChange(false);
  };

  const handleSavePDF = () => {
    handlePrint(); // Same flow — browser print dialog with "Save as PDF"
    onDone();
    onOpenChange(false);
  };

  // Problem detection
  const getProblems = (order: BatchOrderData): string[] => {
    const problems: string[] = [];
    if (order.status === "cancelled") problems.push(t("Отменён", "Bekor qilingan"));
    if (order.status === "new") problems.push(t("Новый", "Yangi"));
    if (order.invoicePrintedAt) problems.push(t("Уже печатался", "Allaqachon chop etilgan"));
    if ((order.items ?? []).length === 0) problems.push(t("Пустой заказ", "Bo'sh buyurtma"));
    return problems;
  };

  const totalSum = useMemo(() => {
    if (!result) return 0;
    return result.orders.reduce((s, o) => s + Number(o.total), 0);
  }, [result]);

  const totalItems = useMemo(() => {
    if (!result) return 0;
    return result.orders.reduce((s, o) => s + (o.items ?? []).length, 0);
  }, [result]);

  const currentPreview = result?.orders[previewIdx];

  return (
    <AppModal
      open={open}
      onClose={() => onOpenChange(false)}
      title={t("Печать накладных", "Nakladlarni chop etish")}
      subtitle={`${t("Выбрано заказов", "Tanlangan buyurtmalar")}: ${orderIds.length}`}
      maxWidth={860}
      footer={
        <>
          <button type="button" onClick={handlePrint} disabled={!result} className="neo-btn-primary flex-1 h-12 text-sm">
            <Printer size={16} />{t("Печать", "Chop etish")}
          </button>
          <button type="button" onClick={handleSavePDF} disabled={!result} className="neo-btn flex-1 h-12 text-sm">
            <Download size={16} />{t("Сохранить PDF", "PDF saqlash")}
          </button>
          <button type="button" onClick={() => onOpenChange(false)} className="neo-btn flex-1 h-12 text-sm">
            {t("Отмена", "Bekor qilish")}
          </button>
        </>
      }
    >
      <div>
        <p className={modalSectionLabel}>{t("Тип документа", "Hujjat turi")}</p>
        <div className="grid grid-cols-2 gap-3">
          {(["simple", "ttn"] as const).map(dt => (
            <button
              key={dt}
              type="button"
              onClick={() => setDocType(dt)}
              className={docType === dt ? "neo-btn-primary h-11 text-sm" : "neo-btn h-11 text-sm"}
            >
              {dt === "simple" ? t("Простая", "Oddiy") : t("ТТН", "TTN")}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <p className={modalSectionLabel} style={{ marginBottom: 0 }}>{t("Выбранные заказы", "Tanlangan buyurtmalar")}</p>
          {result && (
            <span className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
              {t("Всего", "Jami")}: <b style={{ color: "var(--color-text-primary)" }}>{result.orders.length}</b>{" "}
              · {t("Сумма", "Summa")}: <b className="font-data" style={{ color: "var(--color-text-primary)" }}>{totalSum.toLocaleString("ru")} {currency}</b>{" "}
              · {t("Позиций", "Pozitsiya")}: <b style={{ color: "var(--color-text-primary)" }}>{totalItems}</b>
            </span>
          )}
        </div>

        <div
          className="overflow-y-auto"
          style={{ maxHeight: 220, borderRadius: "16px", border: "1px solid var(--color-border, #d8d5cd)" }}
        >
          <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
            <thead style={{ position: "sticky", top: 0, background: "var(--color-surface-light)" }}>
              <tr>
                {[
                  ["#", "left"], [t("Заказ", "Buyurtma"), "left"], [t("Магазин", "Do'kon"), "left"],
                  [t("Агент", "Agent"), "left"], [t("Сумма", "Summa"), "right"], [t("Статус", "Holat"), "center"],
                  [t("Проблема", "Muammo"), "left"],
                ].map(([label, align], i) => (
                  <th
                    key={i}
                    className="font-semibold px-3 py-2.5"
                    style={{
                      textAlign: align as "left" | "right" | "center",
                      fontSize: "10px", letterSpacing: "0.05em", textTransform: "uppercase",
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result ? result.orders.map((o, i) => {
                const problems = getProblems(o);
                return (
                  <tr key={o.id} style={{ borderTop: "1px solid var(--color-border, #d8d5cd)" }}>
                    <td className="px-3 py-2.5" style={{ color: "var(--color-text-tertiary)" }}>{i + 1}</td>
                    <td className="px-3 py-2.5 font-semibold" style={{ color: "var(--color-text-primary)" }}>{o.orderNumber}</td>
                    <td className="px-3 py-2.5" style={{ color: "var(--color-text-primary)" }}>{o.shopName ?? "—"}</td>
                    <td className="px-3 py-2.5" style={{ color: "var(--color-text-tertiary)" }}>{o.agentName ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums font-data" style={{ color: "var(--color-text-primary)" }}>
                      {Number(o.total).toLocaleString("ru")} {currency}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <StatusBadge status={o.status} lang="ru" />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col gap-0.5">
                        {problems.length > 0 && (
                          <span className="flex items-center gap-1" style={{ color: "var(--color-warning-text)", fontSize: "11px" }}>
                            <AlertTriangle size={12} />
                            {problems.join(", ")}
                          </span>
                        )}
                        {o.shopDebtAmount > 0 && (
                          <span className="flex items-center gap-1 font-semibold" style={{ color: "var(--color-danger-text)", fontSize: "11px" }}>
                            <Wallet size={12} />
                            {t("Долг", "Qarz")}: {o.shopDebtAmount.toLocaleString("ru")} {currency}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              }) : orderIds.map((id, i) => (
                <tr key={id} style={{ borderTop: "1px solid var(--color-border, #d8d5cd)" }}>
                  <td className="px-3 py-2.5" style={{ color: "var(--color-text-tertiary)" }}>{i + 1}</td>
                  <td className="px-3 py-2.5 flex items-center gap-1.5" colSpan={6} style={{ color: "var(--color-text-tertiary)" }}>
                    <Loader2 size={12} className="animate-spin" />
                    {t("Формируется...", "Tayyorlanmoqda...")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <p className={modalSectionLabel} style={{ marginBottom: 0 }}>
            {t("Предпросмотр", "Oldindan ko'rish")}{result ? ` (${previewIdx + 1}/${result.orders.length})` : ""}
          </p>
          {result && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPreviewIdx(Math.max(0, previewIdx - 1))}
                disabled={previewIdx === 0}
                aria-label={t("Предыдущий", "Oldingi")}
                className="neo-btn-icon"
                style={{ width: "28px", height: "28px", borderRadius: "8px" }}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                type="button"
                onClick={() => setPreviewIdx(Math.min(result.orders.length - 1, previewIdx + 1))}
                disabled={previewIdx >= result.orders.length - 1}
                aria-label={t("Следующий", "Keyingi")}
                className="neo-btn-icon"
                style={{ width: "28px", height: "28px", borderRadius: "8px" }}
              >
                <ChevronRight size={14} />
              </button>
              <button
                type="button"
                onClick={() => setZoom(Math.max(25, zoom - 25))}
                aria-label={t("Уменьшить", "Kichraytirish")}
                className="neo-btn-icon"
                style={{ width: "28px", height: "28px", borderRadius: "8px" }}
              >
                <ZoomOut size={14} />
              </button>
              <span className="text-[11px] w-10 text-center font-data" style={{ color: "var(--color-text-tertiary)" }}>{zoom}%</span>
              <button
                type="button"
                onClick={() => setZoom(Math.min(150, zoom + 25))}
                aria-label={t("Увеличить", "Kattalashtirish")}
                className="neo-btn-icon"
                style={{ width: "28px", height: "28px", borderRadius: "8px" }}
              >
                <ZoomIn size={14} />
              </button>
            </div>
          )}
        </div>

        {!result ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm" style={{ color: "var(--color-text-tertiary)" }}>
            <Loader2 size={15} className="animate-spin" />
            {t("Формируется…", "Tayyorlanmoqda…")}
          </div>
        ) : (
          <div className="neo-card-sm" style={{ padding: "12px" }}>
            {/* The preview simulates a printed page, so it intentionally keeps a
                fixed white "paper" ground regardless of app theme. */}
            <div
              className="overflow-auto"
              style={{
                background: "#fff", borderRadius: "8px", border: "1px solid var(--color-border, #d8d5cd)",
                height: 300, transform: `scale(${zoom / 100})`, transformOrigin: "top left",
              }}
            >
              <div style={{ padding: "16px", fontSize: "12px" }}>
                <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "4px", color: "#1a1a1a" }}>{currentPreview?.orderNumber}</div>
                <div style={{ color: "#666" }}>{currentPreview?.shopName}</div>
                {(currentPreview?.shopDebtAmount ?? 0) > 0 && (
                  <div
                    className="flex items-center gap-1 font-bold w-fit"
                    style={{
                      marginTop: "6px", padding: "4px 8px", borderRadius: "6px",
                      background: colorMix("var(--color-danger)", 10),
                      border: `1px solid ${colorMix("var(--color-danger)", 40)}`,
                      color: "var(--color-danger-text)",
                    }}
                  >
                    <Wallet size={12} />
                    {t("Долг", "Qarz")}: {currentPreview!.shopDebtAmount.toLocaleString("ru")} {currency}
                  </div>
                )}
                <div style={{ marginTop: "8px", color: "#1a1a1a" }}>{t("Товаров", "Tovar")}: {currentPreview?.items.length}</div>
                <div style={{ color: "#1a1a1a" }}>{t("Итого", "Jami")}: {Number(currentPreview?.total).toLocaleString("ru")} {currency}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppModal>
  );
}
