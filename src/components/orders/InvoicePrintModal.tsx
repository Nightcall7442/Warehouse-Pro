import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Printer, Download, X, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, AlertTriangle } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { notify } from "@/lib/toast";
import { printBatchInvoices, type BatchOrderData, type BatchPrintOptions, type CompanyInfo } from "@/lib/documents";
import { useTranslate } from "@/i18n";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderIds: number[];
  onDone: () => void;
}

export function InvoicePrintModal({ open, onOpenChange, orderIds, onDone }: Props) {
  const t = useTranslate();
  const { user } = useAuth();
  const isCEO = user?.role === "ceo" || user?.role === "superadmin";

  const [format, setFormat] = useState<"a4" | "a5" | "thermal">("a4");
  const [includeQrCode, setIncludeQrCode] = useState(true);
  const [includeBarcodes, setIncludeBarcodes] = useState(false);
  const [includeCostPrice, setIncludeCostPrice] = useState(false);
  const [includeSignature, setIncludeSignature] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [pageBreakPerOrder, setPageBreakPerOrder] = useState(false);
  const [sortBy, setSortBy] = useState<"orderNumber" | "shop" | "agentRoute">("orderNumber");
  const [previewIdx, setPreviewIdx] = useState(0);
  const [zoom, setZoom] = useState(75);
  const [loading, setLoading] = useState(false);

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
    setLoading(true);
    try {
      const res = await batchMutation.mutateAsync({
        orderIds,
        format,
        options: { includeQrCode, includeBarcodes, includeCostPrice, includeSignature, includeNotes, pageBreakPerOrder, sortBy },
      });
      setResult(res as { orders: BatchOrderData[] });
      notify.success(t("Накладные готовы", "Накладlar tayyor"));
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Ошибка генерации");
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    if (!result) return;
    const opts: BatchPrintOptions = { includeQrCode, includeBarcodes, includeCostPrice, includeSignature, includeNotes, pageBreakPerOrder, sortBy };
    printBatchInvoices(result.orders, opts, company, currency);
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
    if (order.items.length === 0) problems.push(t("Пустой заказ", "Bo'sh buyurtma"));
    return problems;
  };

  const totalSum = useMemo(() => {
    if (!result) return 0;
    return result.orders.reduce((s, o) => s + Number(o.total), 0);
  }, [result]);

  const totalItems = useMemo(() => {
    if (!result) return 0;
    return result.orders.reduce((s, o) => s + o.items.length, 0);
  }, [result]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-display text-lg">
            {t("Подготовка к печати накладных", "Nakladlarni chop etishga tayyorgarlik")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Summary Table */}
          <div>
            <h3 className="font-label text-sm mb-2">{t("Выбранные заказы", "Tanlangan buyurtmalar")}</h3>
            <ScrollArea className="h-48 rounded-lg border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="p-2 text-left font-label">#</th>
                    <th className="p-2 text-left font-label">{t("Заказ", "Buyurtma")}</th>
                    <th className="p-2 text-left font-label">{t("Магазин", "Do'kon")}</th>
                    <th className="p-2 text-left font-label">{t("Агент", "Agent")}</th>
                    <th className="p-2 text-right font-label">{t("Сумма", "Summa")}</th>
                    <th className="p-2 text-center font-label">{t("Статус", "Holat")}</th>
                    <th className="p-2 text-left font-label">{t("Проблема", "Muammo")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result ? result.orders.map((o, i) => {
                    const problems = getProblems(o);
                    return (
                      <tr key={o.id} className="border-t">
                        <td className="p-2 text-muted-foreground">{i + 1}</td>
                        <td className="p-2 font-data font-medium">{o.orderNumber}</td>
                        <td className="p-2">{o.shopName ?? "—"}</td>
                        <td className="p-2 text-muted-foreground">{o.agentName ?? "—"}</td>
                        <td className="p-2 text-right font-data">{Number(o.total).toLocaleString("ru")} {currency}</td>
                        <td className="p-2 text-center">
                          <Badge variant={o.status === "delivered" ? "success" : o.status === "cancelled" || o.status === "returned" ? "destructive" : o.status === "processing" || o.status === "shipped" ? "warning" : "default"}>
                            {o.status}
                          </Badge>
                        </td>
                        <td className="p-2">
                          {problems.length > 0 && (
                            <span className="flex items-center gap-1 text-warning text-xs">
                              <AlertTriangle className="h-3 w-3" />
                              {problems.join(", ")}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  }) : orderIds.map((id, i) => (
                    <tr key={id} className="border-t">
                      <td className="p-2 text-muted-foreground">{i + 1}</td>
                      <td className="p-2 text-muted-foreground" colSpan={6}>{t("Загрузка...", "Yuklanmoqda...")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
            {result && (
              <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                <span>{t("Всего", "Jami")}: <b>{result.orders.length}</b> {t("заказов", "buyurtma")}</span>
                <span>{t("Сумма", "Summa")}: <b>{totalSum.toLocaleString("ru")} {currency}</b></span>
                <span>{t("Позиций", "Pozitsiya")}: <b>{totalItems}</b></span>
              </div>
            )}
          </div>

          <Separator />

          {/* Settings */}
          <div className="grid grid-cols-3 gap-6">
            <div>
              <Label className="font-label text-xs mb-2 block">{t("Формат", "Format")}</Label>
              <RadioGroup value={format} onValueChange={v => setFormat(v as typeof format)}>
                <div className="flex items-center space-x-2"><RadioGroupItem value="a4" id="a4" /><Label htmlFor="a4" className="text-sm">A4 {t("Стандартная", "Standart")}</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="a5" id="a5" /><Label htmlFor="a5" className="text-sm">A5 {t("Компактная", "Kompakt")}</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="thermal" id="thermal" /><Label htmlFor="thermal" className="text-sm">80mm {t("Термопринтер", "Termoprinter")}</Label></div>
              </RadioGroup>
            </div>
            <div>
              <Label className="font-label text-xs mb-2 block">{t("Содержимое", "Mazmun")}</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2"><Checkbox checked={includeQrCode} onCheckedChange={v => setIncludeQrCode(!!v)} id="qr" /><Label htmlFor="qr" className="text-sm">QR-{t("код", "kod")}</Label></div>
                <div className="flex items-center space-x-2"><Checkbox checked={includeBarcodes} onCheckedChange={v => setIncludeBarcodes(!!v)} id="bc" /><Label htmlFor="bc" className="text-sm">{t("Штрихкоды товаров", "Tovar shtrixkodlari")}</Label></div>
                {isCEO && <div className="flex items-center space-x-2"><Checkbox checked={includeCostPrice} onCheckedChange={v => setIncludeCostPrice(!!v)} id="cost" /><Label htmlFor="cost" className="text-sm">{t("Цена закупки", "Xarid narxi")}</Label></div>}
                <div className="flex items-center space-x-2"><Checkbox checked={includeSignature} onCheckedChange={v => setIncludeSignature(!!v)} id="sig" /><Label htmlFor="sig" className="text-sm">{t("Подпись и печать", "Imzo va muhr")}</Label></div>
                <div className="flex items-center space-x-2"><Checkbox checked={includeNotes} onCheckedChange={v => setIncludeNotes(!!v)} id="notes" /><Label htmlFor="notes" className="text-sm">{t("Комментарий", "Izoh")}</Label></div>
              </div>
            </div>
            <div>
              <Label className="font-label text-xs mb-2 block">{t("Группировка", "Guruhlash")}</Label>
              <RadioGroup value={pageBreakPerOrder ? "perPage" : "continuous"} onValueChange={v => setPageBreakPerOrder(v === "perPage")}>
                <div className="flex items-center space-x-2"><RadioGroupItem value="perPage" id="perPage" /><Label htmlFor="perPage" className="text-sm">{t("На отдельной странице", "Alohida sahifada")}</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="continuous" id="continuous" /><Label htmlFor="continuous" className="text-sm">{t("Непрерывный лист", "Uzluksiz varaq")}</Label></div>
              </RadioGroup>
              <Label className="font-label text-xs mt-3 mb-2 block">{t("Сортировка", "Saralash")}</Label>
              <RadioGroup value={sortBy} onValueChange={v => setSortBy(v as typeof sortBy)}>
                <div className="flex items-center space-x-2"><RadioGroupItem value="orderNumber" id="sortNum" /><Label htmlFor="sortNum" className="text-sm">{t("По номеру", "Raqam bo'yicha")}</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="shop" id="sortShop" /><Label htmlFor="sortShop" className="text-sm">{t("По магазину", "Do'kon bo'yicha")}</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="agentRoute" id="sortAgent" /><Label htmlFor="sortAgent" className="text-sm">{t("По маршруту", "Marshrut bo'yicha")}</Label></div>
              </RadioGroup>
            </div>
          </div>

          {/* Preview placeholder */}
          {result && (
            <div className="border rounded-lg p-3 bg-muted/30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground">{t("Предпросмотр", "Oldindan ko'rish")} ({previewIdx + 1}/{result.orders.length})</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon-sm" onClick={() => setPreviewIdx(Math.max(0, previewIdx - 1))} disabled={previewIdx === 0}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => setPreviewIdx(Math.min(result.orders.length - 1, previewIdx + 1))} disabled={previewIdx >= result.orders.length - 1}><ChevronRight className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => setZoom(Math.max(25, zoom - 25))}><ZoomOut className="h-4 w-4" /></Button>
                  <span className="text-xs w-10 text-center">{zoom}%</span>
                  <Button variant="ghost" size="icon-sm" onClick={() => setZoom(Math.min(150, zoom + 25))}><ZoomIn className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="bg-white rounded border overflow-auto" style={{ height: 300, transform: `scale(${zoom / 100})`, transformOrigin: "top left" }}>
                <div className="p-4 text-xs">
                  <div className="font-bold text-sm mb-1">{result.orders[previewIdx]?.orderNumber}</div>
                  <div className="text-muted-foreground">{result.orders[previewIdx]?.shopName}</div>
                  <div className="mt-2">{t("Товаров", "Tovar")}: {result.orders[previewIdx]?.items.length}</div>
                  <div>{t("Итого", "Jami")}: {Number(result.orders[previewIdx]?.total).toLocaleString("ru")} {currency}</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-1" />{t("Отмена", "Bekor qilish")}
          </Button>
          {!result ? (
            <Button onClick={handleGenerate} disabled={loading || orderIds.length === 0}>
              {loading ? t("Генерация...", "Yaratilmoqda...") : t("Сгенерировать", "Yaratish")}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleSavePDF}>
                <Download className="h-4 w-4 mr-1" />{t("Сохранить PDF", "PDF saqlash")}
              </Button>
              <Button onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-1" />{t("Отправить на принтер", "Printerga yuborish")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
