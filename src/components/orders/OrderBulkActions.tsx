import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Printer, Package, RefreshCw, UserPlus, FileDown, X, AlertTriangle } from "lucide-react";
import { useTranslate } from "@/i18n";

interface Props {
  selectedCount: number;
  maxSelection?: number;
  onClearSelection: () => void;
  onPrintInvoices: () => void;
  onCreateLoadingList: () => void;
  onChangeStatus: (status: string) => void;
  onAssignAgent: (agentId: number) => void;
  onExportExcel: () => void;
  agents?: Array<{ id: number; name: string }>;
  validStatusTransitions?: string[];
}

const STATUS_LABELS: Record<string, { ru: string; uz: string }> = {
  processing:         { ru: "В обработку",      uz: "Jarayonga" },
  shipped:            { ru: "Отгрузить",         uz: "Yuklash" },
  pending:            { ru: "В ожидание",        uz: "Kutishga" },
  delivered:          { ru: "Доставлен",         uz: "Yetkazildi" },
  cancelled:          { ru: "Отменить",          uz: "Bekor qilish" },
  returned:           { ru: "Возврат",           uz: "Qaytarish" },
  partially_returned: { ru: "Возврат частично", uz: "Qisman qaytarish" },
};

export function OrderBulkActions({
  selectedCount, maxSelection = 50, onClearSelection,
  onPrintInvoices, onCreateLoadingList, onChangeStatus, onAssignAgent, onExportExcel,
  agents, validStatusTransitions = ["processing", "shipped", "delivered", "cancelled", "returned", "partially_returned"],
}: Props) {
  const t = useTranslate();

  if (selectedCount === 0) return null;

  const overLimit = selectedCount > maxSelection;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-card border rounded-2xl shadow-lg">
        <Badge variant="secondary" className="font-data">{selectedCount}</Badge>
        <span className="text-sm text-muted-foreground">{t("выбрано", "tanlangan")}</span>

        <Separator orientation="vertical" className="h-6 mx-1" />

        {overLimit ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t("Макс. 50", "Maks. 50")}
              </span>
            </TooltipTrigger>
            <TooltipContent>{t("Максимум 50 заказов за раз. Выберите меньше.", "Bir vaqtda 50 tadan ortiq buyurtma. Kamroq tanlang.")}</TooltipContent>
          </Tooltip>
        ) : (
          <>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onPrintInvoices}>
              <Printer className="h-3.5 w-3.5" />
              {t("Накладные", "Naklad")} ({selectedCount})
            </Button>

            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onCreateLoadingList}>
              <Package className="h-3.5 w-3.5" />
              {t("Загруз. лист", "Yuklash varaqi")}
            </Button>

            <Select onValueChange={onChangeStatus}>
              <SelectTrigger className="h-8 w-auto text-xs gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                <SelectValue placeholder={t("Статус", "Holat")} />
              </SelectTrigger>
              <SelectContent>
                {validStatusTransitions.map(s => (
                  <SelectItem key={s} value={s} className="text-xs">
                    {t(STATUS_LABELS[s]?.ru ?? s, STATUS_LABELS[s]?.uz ?? s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {agents && agents.length > 0 && (
              <Select onValueChange={v => onAssignAgent(Number(v))}>
                <SelectTrigger className="h-8 w-auto text-xs gap-1.5">
                  <UserPlus className="h-3.5 w-3.5" />
                  <SelectValue placeholder={t("Агент", "Agent")} />
                </SelectTrigger>
                <SelectContent>
                  {agents.map(a => (
                    <SelectItem key={a.id} value={String(a.id)} className="text-xs">
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={onExportExcel}>
              <FileDown className="h-3.5 w-3.5" />
              Excel
            </Button>
          </>
        )}

        <Separator orientation="vertical" className="h-6 mx-1" />

        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground" onClick={onClearSelection}>
          <X className="h-3.5 w-3.5" />
          {t("Снять", "Bekor")}
        </Button>
      </div>
    </div>
  );
}
