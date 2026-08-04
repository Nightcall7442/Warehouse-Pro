import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Printer, Download, X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, AlertTriangle, Loader2, Wallet } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { printBatchInvoices, type BatchOrderData, type BatchPrintOptions, type CompanyInfo } from "@/lib/documents";
import { useTranslate } from "@/i18n";
import { F, COLORS, StatusBadge, PillButton } from "./theme";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderIds: number[];
  onDone: () => void;
}

const sectionLabelStyle: React.CSSProperties = {
  fontFamily: F.body, fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em",
  textTransform: "uppercase", color: COLORS.textTertiary, marginBottom: "8px", display: "block",
};

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col" style={{ fontFamily: F.body }}>
        <DialogHeader>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <DialogTitle style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 700, color: COLORS.textPrimary }}>
              {t("Печать накладных", "Nakladlarni chop etish")}
            </DialogTitle>
            <div style={{ display: "flex", borderRadius: "9999px", overflow: "hidden", border: `1px solid ${COLORS.border}` }}>
              {(["simple", "ttn"] as const).map(dt => (
                <button key={dt} type="button" onClick={() => setDocType(dt)}
                  style={{
                    padding: "6px 14px", fontSize: "12px", fontWeight: 600, fontFamily: F.body, border: "none", cursor: "pointer",
                    background: docType === dt ? COLORS.primary : COLORS.surface,
                    color: docType === dt ? "#fff" : COLORS.textSecondary,
                    transition: "all 0.2s",
                  }}>
                  {dt === "simple" ? t("Простая", "Oddiy") : t("ТТН", "TTN")}
                </button>
              ))}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Summary Table */}
          <div>
            <span style={sectionLabelStyle}>{t("Выбранные заказы", "Tanlangan buyurtmalar")}</span>
            <ScrollArea className="h-48" style={{ borderRadius: "12px", border: `1px solid ${COLORS.border}` }}>
              <table style={{ width: "100%", fontSize: "12px", fontFamily: F.body }}>
                <thead style={{ position: "sticky", top: 0, background: COLORS.surfaceLight }}>
                  <tr>
                    {[
                      ["#", "left"], [t("Заказ", "Buyurtma"), "left"], [t("Магазин", "Do'kon"), "left"],
                      [t("Агент", "Agent"), "left"], [t("Сумма", "Summa"), "right"], [t("Статус", "Holat"), "center"],
                      [t("Проблема", "Muammo"), "left"],
                    ].map(([label, align], i) => (
                      <th key={i} style={{
                        padding: "8px", textAlign: align as "left" | "right" | "center",
                        fontSize: "10px", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase",
                        color: COLORS.textTertiary,
                      }}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result ? result.orders.map((o, i) => {
                    const problems = getProblems(o);
                    return (
                      <tr key={o.id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                        <td style={{ padding: "8px", color: COLORS.textTertiary }}>{i + 1}</td>
                        <td style={{ padding: "8px", fontWeight: 600, color: COLORS.textPrimary }}>{o.orderNumber}</td>
                        <td style={{ padding: "8px", color: COLORS.textPrimary }}>{o.shopName ?? "—"}</td>
                        <td style={{ padding: "8px", color: COLORS.textTertiary }}>{o.agentName ?? "—"}</td>
                        <td style={{ padding: "8px", textAlign: "right", fontWeight: 600, color: COLORS.textPrimary }}>{Number(o.total).toLocaleString("ru")} {currency}</td>
                        <td style={{ padding: "8px", textAlign: "center" }}>
                          <StatusBadge status={o.status} lang="ru" />
                        </td>
                        <td style={{ padding: "8px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                            {problems.length > 0 && (
                              <span style={{ display: "flex", alignItems: "center", gap: "4px", color: COLORS.warning, fontSize: "11px" }}>
                                <AlertTriangle size={12} />
                                {problems.join(", ")}
                              </span>
                            )}
                            {o.shopDebtAmount > 0 && (
                              <span style={{ display: "flex", alignItems: "center", gap: "4px", color: COLORS.danger, fontSize: "11px", fontWeight: 600 }}>
                                <Wallet size={12} />
                                {t("Долг", "Qarz")}: {o.shopDebtAmount.toLocaleString("ru")} {currency}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  }) : orderIds.map((id, i) => (
                    <tr key={id} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                      <td style={{ padding: "8px", color: COLORS.textTertiary }}>{i + 1}</td>
                      <td style={{ padding: "8px", color: COLORS.textTertiary, display: "flex", alignItems: "center", gap: "6px" }} colSpan={6}>
                        <Loader2 size={12} className="animate-spin" />
                        {t("Формируется...", "Tayyorlanmoqda...")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
            {result && (
              <div style={{ display: "flex", gap: "16px", marginTop: "8px", fontSize: "12px", color: COLORS.textTertiary }}>
                <span>{t("Всего", "Jami")}: <b style={{ color: COLORS.textPrimary }}>{result.orders.length}</b> {t("заказов", "buyurtma")}</span>
                <span>{t("Сумма", "Summa")}: <b style={{ color: COLORS.textPrimary }}>{totalSum.toLocaleString("ru")} {currency}</b></span>
                <span>{t("Позиций", "Pozitsiya")}: <b style={{ color: COLORS.textPrimary }}>{totalItems}</b></span>
              </div>
            )}
          </div>

          <div style={{ height: "1px", background: COLORS.border }} />

          {/* Preview */}
          {result && (
            <div style={{ borderRadius: "12px", border: `1px solid ${COLORS.border}`, padding: "12px", background: COLORS.surfaceLight }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={{ fontSize: "11px", color: COLORS.textTertiary }}>{t("Предпросмотр", "Oldindan ko'rish")} ({previewIdx + 1}/{result.orders.length})</span>
                <div style={{ display: "flex", alignItems: "center", gap: "2px" }}>
                  <button type="button" onClick={() => setPreviewIdx(Math.max(0, previewIdx - 1))} disabled={previewIdx === 0} style={{ background: "transparent", border: "none", cursor: previewIdx === 0 ? "default" : "pointer", opacity: previewIdx === 0 ? 0.4 : 1, padding: "4px", color: COLORS.textSecondary }}><ChevronLeft size={16} /></button>
                  <button type="button" onClick={() => setPreviewIdx(Math.min(result.orders.length - 1, previewIdx + 1))} disabled={previewIdx >= result.orders.length - 1} style={{ background: "transparent", border: "none", cursor: previewIdx >= result.orders.length - 1 ? "default" : "pointer", opacity: previewIdx >= result.orders.length - 1 ? 0.4 : 1, padding: "4px", color: COLORS.textSecondary }}><ChevronRight size={16} /></button>
                  <button type="button" onClick={() => setZoom(Math.max(25, zoom - 25))} style={{ background: "transparent", border: "none", cursor: "pointer", padding: "4px", color: COLORS.textSecondary }}><ZoomOut size={16} /></button>
                  <span style={{ fontSize: "11px", width: "40px", textAlign: "center", color: COLORS.textTertiary }}>{zoom}%</span>
                  <button type="button" onClick={() => setZoom(Math.min(150, zoom + 25))} style={{ background: "transparent", border: "none", cursor: "pointer", padding: "4px", color: COLORS.textSecondary }}><ZoomIn size={16} /></button>
                </div>
              </div>
              <div style={{ background: "#fff", borderRadius: "8px", border: `1px solid ${COLORS.border}`, overflow: "auto", height: 300, transform: `scale(${zoom / 100})`, transformOrigin: "top left" }}>
                <div style={{ padding: "16px", fontSize: "12px" }}>
                  <div style={{ fontWeight: 700, fontSize: "13px", marginBottom: "4px", color: "#1a1a1a" }}>{result.orders[previewIdx]?.orderNumber}</div>
                  <div style={{ color: "#666" }}>{result.orders[previewIdx]?.shopName}</div>
                  {(result.orders[previewIdx]?.shopDebtAmount ?? 0) > 0 && (
                    <div style={{
                      display: "flex", alignItems: "center", gap: "4px", marginTop: "6px", padding: "4px 8px",
                      background: "#dc262610", border: "1px solid #dc262640", borderRadius: "6px",
                      color: "#dc2626", fontWeight: 700, width: "fit-content",
                    }}>
                      <Wallet size={12} />
                      {t("Долг", "Qarz")}: {result.orders[previewIdx]!.shopDebtAmount.toLocaleString("ru")} {currency}
                    </div>
                  )}
                  <div style={{ marginTop: "8px", color: "#1a1a1a" }}>{t("Товаров", "Tovar")}: {result.orders[previewIdx]?.items.length}</div>
                  <div style={{ color: "#1a1a1a" }}>{t("Итого", "Jami")}: {Number(result.orders[previewIdx]?.total).toLocaleString("ru")} {currency}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <PillButton tone="neutral" onClick={() => onOpenChange(false)}>
            <X size={16} />{t("Отмена", "Bekor qilish")}
          </PillButton>
          <PillButton tone="neutral" onClick={handleSavePDF} disabled={!result}>
            <Download size={16} />{t("Сохранить PDF", "PDF saqlash")}
          </PillButton>
          <PillButton tone="primary" onClick={handlePrint} disabled={!result}>
            <Printer size={16} />{t("Печать", "Chop etish")}
          </PillButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
