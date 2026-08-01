import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Package, Download, Printer, X, AlertTriangle } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { printLoadingList, type LoadingListData } from "@/lib/documents";
import { useTranslate } from "@/i18n";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderIds: number[];
  onDone: () => void;
}

export function LoadingListModal({ open, onOpenChange, orderIds, onDone }: Props) {
  const t = useTranslate();
  const [format, setFormat] = useState<"aggregated" | "byOrder" | "byRoute">("aggregated");
  const [includeBarcodes, setIncludeBarcodes] = useState(true);
  const [includeWeight, setIncludeWeight] = useState(true);
  const [includeTotalWeight, setIncludeTotalWeight] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LoadingListData | null>(null);

  const createMutation = trpc.order.createLoadingList.useMutation();

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const res = await createMutation.mutateAsync({
        orderIds,
        format,
        options: { includeBarcodes, includeWeight, includeTotalWeight, includeRouteMap: false },
      });
      setResult(res as LoadingListData);
      notify.success(t("Загрузочный лист создан", "Yuklash varaqi yaratildi"));
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    if (!result) return;
    printLoadingList(result, format);
    onDone();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display text-lg flex items-center gap-2">
            <Package className="h-5 w-5" />
            {t("Создание загрузочного листа", "Yuklash varaqi yaratish")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Order count */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>{t("Выбрано заказов", "Tanlangan buyurtmalar")}: <b className="text-foreground">{orderIds.length}</b></span>
          </div>

          <Separator />

          {/* Format selection */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <Label className="font-label text-xs mb-2 block">{t("Группировка", "Guruhlash")}</Label>
              <RadioGroup value={format} onValueChange={v => setFormat(v as typeof format)}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="aggregated" id="agg" />
                  <Label htmlFor="agg" className="text-sm">{t("По товарам (агрегировано)", "Tovarlar bo'yicha (birlashtirilgan)")}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="byOrder" id="byOrd" />
                  <Label htmlFor="byOrd" className="text-sm">{t("По заказам (детально)", "Buyurtmalar bo'yicha (batafsil)")}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="byRoute" id="byRt" />
                  <Label htmlFor="byRt" className="text-sm">{t("По маршруту агента", "Agent marshruti bo'yicha")}</Label>
                </div>
              </RadioGroup>
            </div>
            <div>
              <Label className="font-label text-xs mb-2 block">{t("Настройки", "Sozlamalar")}</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2"><Checkbox checked={includeBarcodes} onCheckedChange={v => setIncludeBarcodes(!!v)} id="bc" /><Label htmlFor="bc" className="text-sm">{t("Штрихкоды", "Shtrixkodlar")}</Label></div>
                <div className="flex items-center space-x-2"><Checkbox checked={includeWeight} onCheckedChange={v => setIncludeWeight(!!v)} id="wt" /><Label htmlFor="wt" className="text-sm">{t("Вес позиций", "Pozitsiya og'irligi")}</Label></div>
                <div className="flex items-center space-x-2"><Checkbox checked={includeTotalWeight} onCheckedChange={v => setIncludeTotalWeight(!!v)} id="twt" /><Label htmlFor="twt" className="text-sm">{t("Общий вес", "Umumiy og'irlik")}</Label></div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Preview */}
          {result && (
            <div className="border rounded-lg p-3 bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-label">{t("Предпросмотр", "Oldindan ko'rish")}</span>
                <Badge variant="outline">{result.listNumber}</Badge>
              </div>
              <ScrollArea className="h-48">
                <div className="text-xs space-y-1">
                  <div><b>{t("Заказов", "Buyurtma")}:</b> {result.totalOrders}</div>
                  <div><b>{t("Позиций", "Pozitsiya")}:</b> {result.totalItems}</div>
                  <div><b>{t("Вес", "Og'irlik")}:</b> {result.totalWeight.toFixed(1)} кг</div>
                  <Separator className="my-2" />
                  {format === "aggregated" && result.items.map((item, i) => (
                    <div key={i} className="flex justify-between">
                      <span>{item.productName}</span>
                      <span className="font-data">{Number(item.totalQty).toFixed(2)} {item.unit}</span>
                    </div>
                  ))}
                  {format === "byOrder" && result.orders.map((order) => (
                    <div key={order.id} className="flex justify-between">
                      <span>{order.orderNumber} → {order.shopName}</span>
                      <span className="font-data">{Number(order.total).toLocaleString("ru")} сум</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-1" />{t("Отмена", "Bekor qilish")}
          </Button>
          {!result ? (
            <Button onClick={handleGenerate} disabled={loading || orderIds.length === 0}>
              {loading ? t("Создание...", "Yaratilmoqda...") : t("Создать лист", "Varaq yaratish")}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handlePrint}>
                <Download className="h-4 w-4 mr-1" />{t("Скачать PDF", "PDF yuklab olish")}
              </Button>
              <Button onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-1" />{t("Печать", "Chop etish")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
