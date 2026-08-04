import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PremiumSelect } from "@/components/PremiumSelect";
import { Printer, Package, FileDown, X, AlertTriangle, CheckSquare, MoreHorizontal, Banknote } from "lucide-react";
import { useTranslate } from "@/i18n";
import { STATUS } from "./theme";

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
    // `left-1/2` leaves a fixed element only half the viewport to size itself
    // against, so without `w-max` the shrink-to-fit width collapses and the row
    // wraps into three lines on a desktop that has room for one.
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 w-max max-w-[calc(100vw-2rem)]">
      <div
        className="neo-card flex items-center gap-3 flex-wrap justify-center"
        style={{ padding: "12px 20px", borderRadius: "20px", boxShadow: "0 25px 80px -12px rgba(0,0,0,0.35)" }}
      >
        {/* Selection count */}
        <div className="flex items-center gap-2.5">
          <div
            className="flex items-center justify-center shrink-0"
            style={{
              width: "40px", height: "40px", borderRadius: "12px",
              background: "linear-gradient(135deg, var(--color-primary), var(--color-primary-hover, #4a5c78))",
              color: "#fff",
            }}
          >
            <CheckSquare size={18} />
          </div>
          <div>
            <div className="text-lg font-bold leading-none font-data" style={{ color: "var(--color-text-primary)" }}>{selectedCount}</div>
            <div className="text-[11px]" style={{ color: "var(--color-text-tertiary)" }}>{t("выбрано", "tanlangan")}</div>
          </div>
        </div>

        <div style={{ width: "1px", height: "36px", background: "var(--color-border, #f0f3f8)" }} />

        {overLimit ? (
          <div className="flex items-center gap-1.5 text-sm" style={{ color: "var(--color-danger-text)" }}>
            <AlertTriangle size={16} />
            <span>{t("Макс. 50 заказов", "Maks. 50 ta buyurtma")}</span>
          </div>
        ) : (
          <>
            {/* "Выполнить с оплатой" is the one that closes the money loop, so it
                carries the primary weight. Plain "Выполнить" leaves the order
                unpaid — it used to be painted red, which read as "destructive"
                next to a green sibling and made two similar actions look like
                a yes/no pair. It's an ordinary secondary action. */}
            <button type="button" onClick={onCompleteWithPayment} className="neo-btn-primary h-10">
              <Banknote size={16} />
              {t("Выполнить с оплатой", "To'lov bilan bajarish")}
            </button>

            <button type="button" onClick={onComplete} className="neo-btn h-10">
              <CheckSquare size={16} />
              {t("Выполнить", "Bajarish")}
            </button>

            <button type="button" onClick={onPrintInvoices} className="neo-btn h-10">
              <Printer size={16} />
              {t("Накладные", "Nakladlar")}
            </button>

            <button type="button" onClick={onCreateLoadingList} className="neo-btn h-10">
              <Package size={16} />
              {t("Загруз. лист", "Yuklash varaqi")}
            </button>

            <PremiumSelect
              value=""
              onChange={v => { if (v) onChangeStatus(v); }}
              aria-label={t("Изменить статус", "Holatni o'zgartirish")}
              options={[
                { value: "", label: t("Изменить статус", "Holatni o'zgartirish") },
                ...validStatusTransitions.map(s => ({ value: s, label: t(STATUS[s]?.ru ?? s, STATUS[s]?.uz ?? s) })),
              ]}
              width="180px"
            />

            {/* Overflow — assignment and export, used less often than the four above */}
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t("Ещё действия", "Yana amallar")}
                  className="neo-btn-icon"
                  style={{ width: "40px", height: "40px", borderRadius: "12px" }}
                >
                  <MoreHorizontal size={18} />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                sideOffset={10}
                className="neo-card"
                style={{ width: "240px", padding: "16px", borderRadius: "18px", display: "flex", flexDirection: "column", gap: "12px" }}
              >
                <span className="font-label text-[10px] tracking-wider uppercase" style={{ color: "var(--color-text-tertiary)" }}>
                  {t("Ещё", "Yana")}
                </span>

                {agents && agents.length > 0 && (
                  <PremiumSelect
                    value=""
                    onChange={v => { if (!v) return; onAssignAgent(Number(v)); setMoreOpen(false); }}
                    aria-label={t("Назначить агента", "Agent tayinlash")}
                    options={[
                      { value: "", label: t("Агент", "Agent") },
                      ...agents.map(a => ({ value: String(a.id), label: a.name })),
                    ]}
                    width="100%"
                  />
                )}

                {couriers && couriers.length > 0 && (
                  <PremiumSelect
                    value=""
                    onChange={v => { if (!v) return; onAssignCourier(Number(v)); setMoreOpen(false); }}
                    aria-label={t("Назначить курьера", "Kuryer tayinlash")}
                    options={[
                      { value: "", label: t("Курьер", "Kuryer") },
                      ...couriers.map(c => ({ value: String(c.id), label: c.name })),
                    ]}
                    width="100%"
                  />
                )}

                <button
                  type="button"
                  onClick={() => { onExportExcel(); setMoreOpen(false); }}
                  className="neo-btn w-full h-10"
                >
                  <FileDown size={15} />
                  Excel
                </button>
              </PopoverContent>
            </Popover>
          </>
        )}

        <div style={{ width: "1px", height: "36px", background: "var(--color-border, #f0f3f8)" }} />

        <button
          type="button"
          onClick={onClearSelection}
          aria-label={t("Снять выделение", "Tanlovni bekor qilish")}
          className="neo-btn-icon"
          style={{ width: "40px", height: "40px", borderRadius: "12px" }}
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
