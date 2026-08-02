import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Printer, Package, RefreshCw, UserPlus, Truck, FileDown, X, AlertTriangle, CheckSquare } from "lucide-react";
import { useTranslate } from "@/i18n";

interface Props {
  selectedCount: number;
  maxSelection?: number;
  onClearSelection: () => void;
  onPrintInvoices: () => void;
  onCreateLoadingList: () => void;
  onChangeStatus: (status: string) => void;
  onAssignAgent: (agentId: number) => void;
  onAssignCourier: (courierId: number) => void;
  onExportExcel: () => void;
  agents?: Array<{ id: number; name: string }>;
  couriers?: Array<{ id: number; name: string }>;
  validStatusTransitions?: string[];
}

const STATUS_LABELS: Record<string, { ru: string; uz: string }> = {
  new:                  { ru: "Новый",              uz: "Yangi" },
  processing:           { ru: "В обработку",        uz: "Jarayonga" },
  shipped:              { ru: "Отгрузить",          uz: "Yuklash" },
  pending:              { ru: "В ожидание",         uz: "Kutishga" },
  delivered:            { ru: "Доставлен",          uz: "Yetkazildi" },
  cancelled:            { ru: "Отменить",           uz: "Bekor qilish" },
  returned:             { ru: "Возврат",            uz: "Qaytarish" },
  partially_returned:   { ru: "Возврат частично",  uz: "Qisman qaytarish" },
  partial_return_kept:  { ru: "Возврат (магазин)",  uz: "Qaytarish (do'kon)" },
};

export function OrderBulkActions({
  selectedCount, maxSelection = 50, onClearSelection,
  onPrintInvoices, onCreateLoadingList, onChangeStatus, onAssignAgent, onAssignCourier, onExportExcel,
  agents, couriers, validStatusTransitions = ["processing", "shipped", "delivered", "cancelled", "returned", "partially_returned"],
}: Props) {
  const t = useTranslate();

  if (selectedCount === 0) return null;

  const overLimit = selectedCount > maxSelection;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4">
      <div style={{
        display: "flex", alignItems: "center", gap: "12px",
        padding: "14px 24px",
        background: "var(--color-surface, #fff)",
        border: "1px solid var(--color-border, #e0e0e0)",
        borderRadius: "20px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)",
      }}>
        {/* Selection count */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{
            width: "36px", height: "36px", borderRadius: "10px",
            background: "linear-gradient(135deg, #5b6d8a, #7b94f8)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <CheckSquare size={18} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: "18px", fontWeight: 700, fontFamily: "'DM Sans', sans-serif", lineHeight: 1 }}>{selectedCount}</div>
            <div style={{ fontSize: "11px", color: "#6a7290" }}>{t("выбрано", "tanlangan")}</div>
          </div>
        </div>

        <div style={{ width: "1px", height: "40px", background: "#e0e0e0" }} />

        {overLimit ? (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#d45050", fontSize: "13px" }}>
            <AlertTriangle size={16} />
            <span>{t("Макс. 50 заказов", "Maks. 50 ta buyurtma")}</span>
          </div>
        ) : (
          <>
            {/* Print Invoices */}
            <button onClick={onPrintInvoices} style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "10px 18px", fontSize: "13px", fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif",
              borderRadius: "12px", border: "1px solid #e0e0e0",
              background: "#fff", cursor: "pointer", color: "#2b3450",
              transition: "all 0.15s",
            }}>
              <Printer size={16} />
              {t("Накладные", "Nakladlar")}
            </button>

            {/* Loading List */}
            <button onClick={onCreateLoadingList} style={{
              display: "flex", alignItems: "center", gap: "8px",
              padding: "10px 18px", fontSize: "13px", fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif",
              borderRadius: "12px", border: "1px solid #e0e0e0",
              background: "#fff", cursor: "pointer", color: "#2b3450",
              transition: "all 0.15s",
            }}>
              <Package size={16} />
              {t("Загруз. лист", "Yuklash varaqi")}
            </button>

            {/* Status Change */}
            <Select onValueChange={onChangeStatus}>
              <SelectTrigger style={{
                height: "40px", padding: "0 14px", fontSize: "13px", fontWeight: 600,
                fontFamily: "'DM Sans', sans-serif",
                borderRadius: "12px", border: "1px solid #e0e0e0",
                background: "#fff", color: "#2b3450",
                display: "flex", alignItems: "center", gap: "6px",
                minWidth: "140px",
              }}>
                <RefreshCw size={15} />
                <SelectValue placeholder={t("Изменить статус", "Holatni o'zgartirish")} />
              </SelectTrigger>
              <SelectContent>
                {validStatusTransitions.map(s => (
                  <SelectItem key={s} value={s} style={{ fontSize: "13px" }}>
                    {t(STATUS_LABELS[s]?.ru ?? s, STATUS_LABELS[s]?.uz ?? s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Assign Agent */}
            {agents && agents.length > 0 && (
              <Select onValueChange={v => onAssignAgent(Number(v))}>
                <SelectTrigger style={{
                  height: "40px", padding: "0 14px", fontSize: "13px", fontWeight: 600,
                  fontFamily: "'DM Sans', sans-serif",
                  borderRadius: "12px", border: "1px solid #e0e0e0",
                  background: "#fff", color: "#2b3450",
                  display: "flex", alignItems: "center", gap: "6px",
                  minWidth: "130px",
                }}>
                  <UserPlus size={15} />
                  <SelectValue placeholder={t("Агент", "Agent")} />
                </SelectTrigger>
                <SelectContent>
                  {agents.map(a => (
                    <SelectItem key={a.id} value={String(a.id)} style={{ fontSize: "13px" }}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Assign Courier */}
            {couriers && couriers.length > 0 && (
              <Select onValueChange={v => onAssignCourier(Number(v))}>
                <SelectTrigger style={{
                  height: "40px", padding: "0 14px", fontSize: "13px", fontWeight: 600,
                  fontFamily: "'DM Sans', sans-serif",
                  borderRadius: "12px", border: "1px solid #e0e0e0",
                  background: "#fff", color: "#2b3450",
                  display: "flex", alignItems: "center", gap: "6px",
                  minWidth: "130px",
                }}>
                  <Truck size={15} />
                  <SelectValue placeholder={t("Курьер", "Kuryer")} />
                </SelectTrigger>
                <SelectContent>
                  {couriers.map(c => (
                    <SelectItem key={c.id} value={String(c.id)} style={{ fontSize: "13px" }}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {/* Export Excel */}
            <button onClick={onExportExcel} style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "10px 16px", fontSize: "13px", fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif",
              borderRadius: "12px", border: "1px solid #e0e0e0",
              background: "#fff", cursor: "pointer", color: "#2b3450",
            }}>
              <FileDown size={15} />
              Excel
            </button>
          </>
        )}

        <div style={{ width: "1px", height: "40px", background: "#e0e0e0" }} />

        {/* Clear selection */}
        <button onClick={onClearSelection} style={{
          display: "flex", alignItems: "center", gap: "6px",
          padding: "10px 14px", fontSize: "13px", fontWeight: 500,
          fontFamily: "'DM Sans', sans-serif",
          borderRadius: "12px", border: "none",
          background: "transparent", cursor: "pointer", color: "#6a7290",
        }}>
          <X size={16} />
          {t("Снять", "Bekor")}
        </button>
      </div>
    </div>
  );
}
