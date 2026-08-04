import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Printer, Package, RefreshCw, UserPlus, Truck, FileDown, X, AlertTriangle, CheckSquare, MoreHorizontal, Banknote } from "lucide-react";
import { useTranslate } from "@/i18n";
import { F, COLORS, STATUS, PillButton } from "./theme";

interface Props {
  selectedCount: number;
  maxSelection?: number;
  onClearSelection: () => void;
  onPrintInvoices: () => void;
  onCreateLoadingList: () => void;
  onChangeStatus: (status: string) => void;
  onComplete: () => void;
  onCompleteWithPayment: () => void;
  onAssignAgent: (agentId: number) => void;
  onAssignCourier: (courierId: number) => void;
  onExportExcel: () => void;
  agents?: Array<{ id: number; name: string }>;
  couriers?: Array<{ id: number; name: string }>;
  validStatusTransitions?: string[];
}

const selectTriggerStyle: React.CSSProperties = {
  height: "40px", padding: "0 14px", fontFamily: F.body, fontSize: "13px", fontWeight: 600,
  borderRadius: "12px", border: `1px solid ${COLORS.border}`,
  background: COLORS.surface, color: COLORS.textPrimary,
  display: "flex", alignItems: "center", gap: "6px",
  minWidth: "130px",
};

const moreSelectTriggerStyle: React.CSSProperties = {
  ...selectTriggerStyle, minWidth: 0, width: "100%",
};

export function OrderBulkActions({
  selectedCount, maxSelection = 50, onClearSelection,
  onPrintInvoices, onCreateLoadingList, onChangeStatus, onComplete, onCompleteWithPayment, onAssignAgent, onAssignCourier, onExportExcel,
  agents, couriers, validStatusTransitions = ["processing", "shipped", "delivered", "cancelled", "returned"],
}: Props) {
  const t = useTranslate();
  const [moreOpen, setMoreOpen] = useState(false);

  if (selectedCount === 0) return null;

  const overLimit = selectedCount > maxSelection;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4">
      <div style={{
        display: "flex", alignItems: "center", gap: "12px",
        padding: "14px 24px",
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: "20px",
        boxShadow: "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08)",
      }}>
        {/* Selection count */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{
            width: "36px", height: "36px", borderRadius: "10px",
            background: `linear-gradient(135deg, ${COLORS.primary}, var(--color-primary-hover))`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <CheckSquare size={18} color="#fff" />
          </div>
          <div>
            <div style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 700, lineHeight: 1, color: COLORS.textPrimary }}>{selectedCount}</div>
            <div style={{ fontFamily: F.body, fontSize: "11px", color: COLORS.textTertiary }}>{t("выбрано", "tanlangan")}</div>
          </div>
        </div>

        <div style={{ width: "1px", height: "40px", background: COLORS.border }} />

        {overLimit ? (
          <div style={{ display: "flex", alignItems: "center", gap: "6px", color: COLORS.danger, fontFamily: F.body, fontSize: "13px" }}>
            <AlertTriangle size={16} />
            <span>{t("Макс. 50 заказов", "Maks. 50 ta buyurtma")}</span>
          </div>
        ) : (
          <>
            {/* The actions operators reach for most stay in the bar.
                Everything less frequent (assignment, export) lives behind
                "Ещё". Complete-without-payment and complete-with-payment sit
                side by side, color-coded so the two are never confused at a
                glance: red for "no money recorded", green for "fully paid". */}
            <PillButton tone="danger" onClick={onComplete}>
              <CheckSquare size={16} />
              {t("Выполнить", "Bajarish")}
            </PillButton>

            <PillButton tone="success" onClick={onCompleteWithPayment}>
              <Banknote size={16} />
              {t("Выполнить с оплатой", "To'lov bilan bajarish")}
            </PillButton>

            <PillButton tone="neutral" onClick={onPrintInvoices}>
              <Printer size={16} />
              {t("Накладные", "Nakladlar")}
            </PillButton>

            <PillButton tone="neutral" onClick={onCreateLoadingList}>
              <Package size={16} />
              {t("Загруз. лист", "Yuklash varaqi")}
            </PillButton>

            {/* Status Change */}
            <Select onValueChange={onChangeStatus}>
              <SelectTrigger style={{ ...selectTriggerStyle, minWidth: "140px" }}>
                <RefreshCw size={15} />
                <SelectValue placeholder={t("Изменить статус", "Holatni o'zgartirish")} />
              </SelectTrigger>
              <SelectContent>
                {validStatusTransitions.map(s => (
                  <SelectItem key={s} value={s} style={{ fontSize: "13px" }}>
                    {t(STATUS[s]?.ru ?? s, STATUS[s]?.uz ?? s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Overflow — assignment and export, used less often than the four above */}
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: "40px", height: "40px", borderRadius: "12px",
                    border: `1px solid ${COLORS.border}`, cursor: "pointer",
                    background: moreOpen ? COLORS.surfaceLight : COLORS.surface, color: COLORS.textSecondary,
                  }}
                >
                  <MoreHorizontal size={18} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={10} style={{
                width: "220px", padding: "10px", borderRadius: "14px",
                background: COLORS.surface, border: `1px solid ${COLORS.border}`,
                boxShadow: "0 8px 32px rgba(0,0,0,0.12)", fontFamily: F.body,
                display: "flex", flexDirection: "column", gap: "8px",
              }}>
                <span style={{
                  fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase",
                  color: COLORS.textTertiary, padding: "0 2px",
                }}>
                  {t("Ещё", "Yana")}
                </span>

                {agents && agents.length > 0 && (
                  <Select onValueChange={v => { onAssignAgent(Number(v)); setMoreOpen(false); }}>
                    <SelectTrigger style={moreSelectTriggerStyle}>
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

                {couriers && couriers.length > 0 && (
                  <Select onValueChange={v => { onAssignCourier(Number(v)); setMoreOpen(false); }}>
                    <SelectTrigger style={moreSelectTriggerStyle}>
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

                <PillButton tone="neutral" onClick={() => { onExportExcel(); setMoreOpen(false); }}>
                  <FileDown size={15} />
                  Excel
                </PillButton>
              </PopoverContent>
            </Popover>
          </>
        )}

        <div style={{ width: "1px", height: "40px", background: COLORS.border }} />

        <PillButton tone="ghost" onClick={onClearSelection}>
          <X size={16} />
          {t("Снять", "Bekor")}
        </PillButton>
      </div>
    </div>
  );
}
