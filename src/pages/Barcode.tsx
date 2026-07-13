/**
 * Barcode page — scan products for quick stock lookup + label printing.
 * Also supports scanning to find a product and add it to a new order.
 */
import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { useNavigate } from "react-router";
import { printElement } from "@/lib/print";
import { Scan, Package, Plus, Printer, Search, AlertTriangle } from "lucide-react";

function LabelSheet({ products }: { products: Array<{ name: string; code: string; price: string; currency: string }> }) {
  return (
    <div id="label-print-area" className="hidden">
      <style>{`
        @media print {
          #label-print-area { display: block !important; }
          body > *:not(#label-print-area) { display: none; }
        }
        .label-grid { display: flex; flex-wrap: wrap; gap: 4mm; padding: 5mm; }
        .label {
          width: 50mm; height: 30mm; border: 0.5px solid #ccc;
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; font-family: Arial, sans-serif;
          padding: 2mm; box-sizing: border-box; page-break-inside: avoid;
        }
        .label-name  { font-size: 8pt; font-weight: bold; text-align: center; }
        .label-code  { font-size: 7pt; color: #555; margin: 1mm 0; }
        .label-price { font-size: 11pt; font-weight: bold; }
      `}</style>
      <div className="label-grid">
        {products.map((p, i) => (
          <div key={i} className="label">
            <div className="label-name">{p.name}</div>
            <div className="label-code">Код: {p.code}</div>
            <div className="label-price">{Number(p.price).toLocaleString("ru-RU")} {p.currency}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BarcodePage() {
  const [scanning, setScanning]     = useState(false);
  const [searchCode, setSearchCode] = useState("");
  const [labelQueue, setLabelQueue] = useState<any[]>([]);
  const { fmt, currency } = useCurrency();
  const { lang }          = useLang();
  const navigate          = useNavigate();

  const { data: products, isLoading } = trpc.product.list.useQuery(
    { search: searchCode, pageSize: 10 },
    { enabled: searchCode.length > 1 }
  ) as { data: any; isLoading: boolean };

  const handleScan = (code: string) => {
    setScanning(false);
    setSearchCode(code);
  };

  const addToLabelQueue = (product: any) => {
    if (!labelQueue.find((p: any) => p.id === product.id)) {
      setLabelQueue(q => [...q, product]);
    }
  };

  const printLabels = () => {
    printElement("label-print-area", "Этикетки");
  };

  return (
    <div className="space-y-5 max-w-lg mx-auto">
      {scanning && (
        <BarcodeScanner
          onScan={handleScan}
          onClose={() => setScanning(false)}
          label={lang === "uz" ? "Mahsulot skanerini o'qish" : "Сканировать товар"}
        />
      )}

      <LabelSheet products={labelQueue.map((p: any) => ({
        name:     p.name,
        code:     p.code ?? "",
        price:    p.unitPrice ?? "0",
        currency,
      }))}/>

      <h1 className="font-display text-2xl font-bold text-text-primary tracking-tight">
        {lang === "uz" ? "Shtrix-kod" : "Штрих-коды"}
      </h1>

      {/* Scan button */}
      <button
        onClick={() => setScanning(true)}
        className="neo-btn-primary w-full py-5 flex flex-col items-center gap-2 text-base"
      >
        <Scan size={28}/>
        <span className="font-label tracking-wider">
          {lang === "uz" ? "KAMERANI SKANERLASH" : "СКАНИРОВАТЬ КАМЕРОЙ"}
        </span>
      </button>

      {/* Manual search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"/>
        <input
          className="neo-input pl-10 w-full font-data"
          placeholder={lang === "uz" ? "Kod bo'yicha qidirish…" : "Поиск по коду или названию…"}
          value={searchCode}
          onChange={e => setSearchCode(e.target.value)}
        />
      </div>

      {/* Product result */}
      {searchCode.length > 1 && (
        <div className="neo-card overflow-hidden">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1,2].map(i => <div key={i} className="h-10 bg-surface-light animate-pulse rounded"/>)}
            </div>
          ) : products?.data.length === 0 ? (
            <div className="p-6 text-center">
              <AlertTriangle size={24} className="mx-auto text-warning mb-2"/>
              <p className="text-text-secondary text-sm">
                {lang === "uz" ? "Mahsulot topilmadi" : "Товар не найден"}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {products?.data.map((p: any) => (
                <div key={p.id} className="p-4 flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                    <Package size={18} className="text-primary"/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-text-primary text-sm truncate">{p.name}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="font-data text-xs text-text-secondary">{p.code}</span>
                      <span className="font-data text-sm text-primary">{fmt(p.unitPrice)}/кг</span>
                      <span className={`text-xs font-data ${Number(p.available ?? 0) < Number(p.reorderPoint ?? 0) ? "text-danger" : "text-success"}`}>
                        {Number(p.available ?? 0).toFixed(0)} кг
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => navigate(`/orders/new?productCode=${p.code}`)}
                      className="neo-btn-primary py-1.5 px-2 text-xs flex items-center gap-1"
                      title={lang === "uz" ? "Buyurtma qo'shish" : "Добавить в заказ"}
                    >
                      <Plus size={13}/>
                      {lang === "uz" ? "Buyurtma" : "Заказ"}
                    </button>
                    <button
                      onClick={() => addToLabelQueue(p)}
                      className="neo-btn py-1.5 px-2 text-xs"
                      title={lang === "uz" ? "Yorliq qo'shish" : "Добавить этикетку"}
                    >
                      <Printer size={13}/>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Label queue */}
      {labelQueue.length > 0 && (
        <div className="neo-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-label text-primary tracking-wider text-xs">
              {lang === "uz" ? "YORLIQLAR" : "ОЧЕРЕДЬ НА ПЕЧАТЬ"} ({labelQueue.length})
            </span>
            <button
              onClick={printLabels}
              className="neo-btn-primary py-1.5 px-3 text-sm flex items-center gap-1.5"
            >
              <Printer size={14}/>
              {lang === "uz" ? "Chop etish" : "Печать этикеток"}
            </button>
          </div>
          <div className="space-y-1.5">
            {labelQueue.map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-text-primary">{p.name}</span>
                <div className="flex items-center gap-2">
                  <span className="font-data text-text-secondary text-xs">{p.code}</span>
                  <button
                    onClick={() => setLabelQueue(q => q.filter((_, j) => j !== i))}
                    className="text-danger text-xs hover:underline"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className="neo-card p-4 text-sm text-text-secondary space-y-1">
        <p className="font-medium text-text-primary">
          {lang === "uz" ? "Qo'llab-quvvatlanadigan formatlar" : "Поддерживаемые форматы"}
        </p>
        <p>EAN-13, EAN-8, Code 128, Code 39, QR, UPC-A, UPC-E</p>
        <p className="text-xs mt-1">
          {lang === "uz"
            ? "Chrome 83+, Edge 83+, Android Chrome, Safari iOS 17.4+ da ishlaydi"
            : "Работает в Chrome 83+, Edge 83+, Android Chrome, Safari iOS 17.4+"}
        </p>
      </div>
    </div>
  );
}
