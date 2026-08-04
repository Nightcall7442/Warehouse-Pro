import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Package, Download, Printer, X, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { printLoadingList, type LoadingListData } from "@/lib/documents";
import { useTranslate } from "@/i18n";
import { F, COLORS, PillButton } from "./theme";
import { formatQty } from "@/lib/format";

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

// Fixed, non-configurable defaults — no settings panel: grouped by product,
// with barcodes and weight included, the combination operators reach for
// almost every time.
const LIST_OPTIONS = { includeBarcodes: true, includeWeight: true, includeTotalWeight: true, includeRouteMap: false };

export function LoadingListModal({ open, onOpenChange, orderIds, onDone }: Props) {
  const t = useTranslate();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LoadingListData | null>(null);
  const [listFormat, setListFormat] = useState<"aggregated" | "byRoute">("aggregated");

  const createMutation = trpc.order.createLoadingList.useMutation();

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const res = await createMutation.mutateAsync({
        orderIds,
        format: listFormat,
        options: LIST_OPTIONS,
      });
      setResult(res as LoadingListData);
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
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
    printLoadingList(result, listFormat);
    onDone();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col" style={{ fontFamily: F.body }}>
        <DialogHeader>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <DialogTitle style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 700, color: COLORS.textPrimary, display: "flex", alignItems: "center", gap: "8px" }}>
              <Package size={18} />
              {t("Загрузочный лист", "Yuklash varaqi")}
            </DialogTitle>
            <div style={{ display: "flex", borderRadius: "9999px", overflow: "hidden", border: `1px solid ${COLORS.border}` }}>
              {(["aggregated", "byRoute"] as const).map(fmt => (
                <button key={fmt} type="button" onClick={() => setListFormat(fmt)}
                  style={{
                    padding: "6px 14px", fontSize: "12px", fontWeight: 600, fontFamily: F.body, border: "none", cursor: "pointer",
                    background: listFormat === fmt ? COLORS.primary : COLORS.surface,
                    color: listFormat === fmt ? "#fff" : COLORS.textSecondary,
                    transition: "all 0.2s",
                  }}>
                  {fmt === "aggregated" ? t("Сводный", "Yig'ma") : t("По маршруту", "Marshrut bo'yicha")}
                </button>
              ))}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Order count */}
          <div style={{ fontSize: "13px", color: COLORS.textTertiary }}>
            <span>{t("Выбрано заказов", "Tanlangan buyurtmalar")}: <b style={{ color: COLORS.textPrimary }}>{orderIds.length}</b></span>
          </div>

          <div style={{ height: "1px", background: COLORS.border }} />

          {/* Preview */}
          {loading && !result ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "24px 0", justifyContent: "center", color: COLORS.textTertiary, fontSize: "13px" }}>
              <Loader2 size={14} className="animate-spin" />
              {t("Формируется...", "Tayyorlanmoqda...")}
            </div>
          ) : result && (
            <div style={{ borderRadius: "12px", border: `1px solid ${COLORS.border}`, padding: "12px", background: COLORS.surfaceLight }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                <span style={sectionLabelStyle}>{t("Предпросмотр", "Oldindan ko'rish")}</span>
                <span style={{
                  fontFamily: F.body, fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "9999px",
                  border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary,
                }}>
                  {result.listNumber}
                </span>
              </div>
              <ScrollArea className="h-48">
                <div style={{ fontSize: "12px", color: COLORS.textPrimary, display: "flex", flexDirection: "column", gap: "4px" }}>
                  <div><b>{t("Заказов", "Buyurtma")}:</b> {result.totalOrders}</div>
                  <div><b>{t("Позиций", "Pozitsiya")}:</b> {result.totalItems}</div>
                  <div><b>{t("Вес", "Og'irlik")}:</b> {formatQty(result.totalWeight)} кг</div>
                  <div style={{ height: "1px", background: COLORS.border, margin: "8px 0" }} />
                  {result.items.map((item, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>{item.productName}</span>
                      <span style={{ fontWeight: 600 }}>{formatQty(item.totalQty)} {item.unit}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          <PillButton tone="neutral" onClick={() => onOpenChange(false)}>
            <X size={16} />{t("Отмена", "Bekor qilish")}
          </PillButton>
          <PillButton tone="neutral" onClick={handlePrint} disabled={!result}>
            <Download size={16} />{t("Скачать PDF", "PDF yuklab olish")}
          </PillButton>
          <PillButton tone="primary" onClick={handlePrint} disabled={!result}>
            <Printer size={16} />{t("Печать", "Chop etish")}
          </PillButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
