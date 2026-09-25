/**
 * Сканер — найти товар по штрих-коду, заказать его или поставить в печать этикеток.
 *
 * Вид — «Сканировать» мобилки v8 (Warehouse-Pro-Mobile, app/(tabs)/barcode.tsx):
 * на телефоне камера открывается сразу, найденный товар — карточкой с ценой,
 * остатком и «Заказать этот товар»; «Сканировать снова» — одной кнопкой.
 * Владелец, 25.09.2026: «все сделай абсолютно».
 *
 * «Заказать» кладёт товар в корзину каталога и открывает мастер заказа с ней
 * (lib/catalog-cart.ts). Раньше кнопка вела на /orders/new?productCode=…,
 * а мастер этот параметр не читал: заказ открывался пустым, товар терялся.
 */
import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { useNavigate } from "react-router";
import { notify } from "@/lib/toast";
import { addToCart } from "@/lib/catalog-cart";
import { printLabels as printLabelSheet } from "@/lib/documents";
import { unitShort } from "@/lib/units";
import { Scan, Package, Plus, Printer, Search, AlertTriangle, RefreshCw, ShoppingCart } from "lucide-react";

type Found = {
  id: number; name: string; code: string; barcode: string | null; unitPrice: string;
  unit: string | null; available: string | null; reorderPoint?: string | null; unitWeight?: string | number | null;
};

export default function BarcodePage() {
  const phone = useIsMobile();
  // На телефоне камера — сразу, как в мобилке: за этим экран и открывают.
  const [scanning, setScanning]     = useState(phone);
  const [searchCode, setSearchCode] = useState("");
  const [scanned, setScanned]       = useState<string | null>(null);
  const [labelQueue, setLabelQueue] = useState<
    Array<{ id: number; name: string; code: string; barcode: string | null; unitPrice: string }>
  >([]);
  const { fmt, currency } = useCurrency();
  const { lang }          = useLang();
  const { user }          = useAuth();
  const navigate          = useNavigate();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const sells = user?.role !== "merchandiser";

  const { data: products, isLoading } = trpc.product.list.useQuery(
    { search: searchCode, pageSize: 10 },
    { enabled: searchCode.length > 1 }
  );
  const list = (products?.data ?? []) as Found[];
  // Отсканированный код — точным совпадением: поиск по подстроке нашёл бы и соседей.
  const found = scanned ? list.find(p => p.barcode === scanned || p.code === scanned) ?? (list.length === 1 ? list[0] : undefined) : undefined;

  const handleScan = (code: string) => {
    setScanning(false);
    setScanned(code);
    setSearchCode(code);
  };

  const put = (p: Found) => {
    if (!user) return false;
    addToCart(user.id, {
      productId: p.id, productName: p.name, unitPrice: p.unitPrice, available: p.available ?? "0",
      unit: p.unit ?? "pcs", unitWeight: Number(p.unitWeight ?? 0),
    }, 1);
    return true;
  };
  const order = (p: Found) => { if (put(p)) navigate("/orders/new?fromCart=1"); };

  const addToLabelQueue = (product: (typeof labelQueue)[number]) => {
    if (!labelQueue.find((p) => p.id === product.id)) {
      setLabelQueue(q => [...q, product]);
    }
  };

  // Тот же шаблон этикетки, что и у прихода (lib/documents.printLabels).
  const printLabels = () => printLabelSheet(labelQueue.map(p => ({
    name: p.name, code: p.code ?? "", barcode: p.barcode ?? null, price: p.unitPrice ?? "0", currency,
  })));

  const card: React.CSSProperties = { background: "var(--color-surface)", boxShadow: "var(--shadow-raised)", borderRadius: 20 };

  return (
    <div className="space-y-4 max-w-lg mx-auto" data-testid="barcode-page">
      {scanning && (
        <BarcodeScanner
          onScan={handleScan}
          onClose={() => setScanning(false)}
          label={t("Наведите камеру на штрих-код", "Kamerani shtrix-kodga qarating")}
        />
      )}

      <h1 className="hidden md:block font-display text-2xl font-bold text-primary tracking-tight">
        {t("Штрих-коды", "Shtrix-kod")}
      </h1>

      {/* ── Найденный товар — как нижняя плашка сканера в мобилке ── */}
      {scanned && (isLoading ? (
        <div className="flex items-center justify-center gap-3" style={{ ...card, padding: 20 }}>
          <RefreshCw size={16} className="animate-spin" color="var(--color-primary-text)" />
          <span style={{ fontSize: 15, color: "var(--color-text-secondary)" }}>{t("Поиск товара…", "Mahsulot qidirilmoqda…")}</span>
        </div>
      ) : found ? (
        <div className="space-y-2.5" data-testid="barcode-found">
          <div className="flex items-center gap-3.5" style={{ ...card, padding: 16 }}>
            <div className="flex-1 min-w-0">
              <p className="truncate" style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>{found.name}</p>
              <p className="font-data" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-primary-text)", margin: "2px 0 0" }}>{fmt(found.unitPrice)}/{unitShort(found.unit ?? undefined, lang)}</p>
              <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>{t("Остаток", "Qoldiq")}: {Number(found.available ?? 0).toFixed(0)} {unitShort(found.unit ?? undefined, lang)}</p>
            </div>
            {sells && (
              <button type="button" aria-label={t("В заказ", "Buyurtmaga")} onClick={() => { if (put(found)) notify.success(t("Добавлено в заказ", "Buyurtmaga qo'shildi")); }}
                className="flex items-center justify-center flex-shrink-0" style={{ width: 48, height: 48, borderRadius: 14, background: "var(--color-primary)", color: "var(--color-on-primary)" }}>
                <Plus size={20} />
              </button>
            )}
          </div>
          {sells && (
            <button type="button" onClick={() => order(found)} data-testid="barcode-order" className="w-full flex items-center justify-center gap-2.5"
              style={{ minHeight: 52, borderRadius: 16, background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 15, fontWeight: 600 }}>
              <ShoppingCart size={18} />{t("Заказать этот товар", "Shu mahsulotni buyurtma qilish")}
            </button>
          )}
        </div>
      ) : (
        <div className="text-center" style={{ ...card, padding: 20 }}>
          <AlertTriangle size={24} className="mx-auto mb-2" color="var(--color-warning-text)" />
          <p style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>{t("Товар не найден", "Mahsulot topilmadi")}</p>
          <p className="font-data" style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: "4px 0 0" }}>{t("Штрих-код", "Shtrix-kod")}: {scanned}</p>
        </div>
      ))}

      {/* Скан: «снова» после находки, «камерой» — в начале */}
      <button
        onClick={() => setScanning(true)}
        className="w-full flex items-center justify-center gap-2"
        style={scanned
          ? { ...card, minHeight: 52, fontSize: 15, fontWeight: 500, color: "var(--color-text-primary)" }
          : { minHeight: 64, borderRadius: 20, background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 15, fontWeight: 600 }}
      >
        {scanned ? <RefreshCw size={18} /> : <Scan size={22} />}
        {scanned ? t("Сканировать снова", "Qayta skanerlash") : t("Сканировать камерой", "Kamera bilan skanerlash")}
      </button>

      {/* Поиск руками — когда код не читается */}
      <label className="flex items-center gap-2 px-4" style={{ background: "var(--color-field)", borderRadius: 16, height: 48, boxShadow: "var(--shadow-pressed)" }}>
        <Search size={16} color="var(--color-text-tertiary)" className="flex-shrink-0" />
        <input
          className="flex-1 min-w-0 bg-transparent outline-none font-data"
          style={{ fontSize: 15, color: "var(--color-text-primary)" }}
          placeholder={t("Поиск по коду или названию…", "Kod bo'yicha qidirish…")}
          value={searchCode}
          onChange={e => { setSearchCode(e.target.value); setScanned(null); }}
        />
      </label>

      {/* Результаты ручного поиска */}
      {!scanned && searchCode.length > 1 && (
        <div className="overflow-hidden" style={card}>
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2].map(i => <div key={i} className="h-10 rounded-xl animate-pulse" style={{ background: "var(--color-surface-light)" }} />)}
            </div>
          ) : list.length === 0 ? (
            <div className="p-6 text-center">
              <AlertTriangle size={24} className="mx-auto mb-2" color="var(--color-warning-text)" />
              <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: 0 }}>{t("Товар не найден", "Mahsulot topilmadi")}</p>
            </div>
          ) : list.map((p, i) => (
            <div key={p.id} className="p-4 flex items-center gap-3" style={{ borderTop: i === 0 ? "none" : "1px solid var(--color-border-subtle)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: "var(--color-primary-subtle)" }}>
                <Package size={18} color="var(--color-primary-text)" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate" style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", margin: 0 }}>{p.name}</p>
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  <span className="font-data" style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>{p.code}</span>
                  <span className="font-data" style={{ fontSize: 13, color: "var(--color-primary-text)" }}>{fmt(p.unitPrice)}/{unitShort(p.unit ?? undefined, lang)}</span>
                  <span className="font-data" style={{ fontSize: 12, color: Number(p.available ?? 0) < Number(p.reorderPoint ?? 0) ? "var(--color-danger-text)" : "var(--color-success-text)" }}>
                    {Number(p.available ?? 0).toFixed(0)} {unitShort(p.unit ?? undefined, lang)}
                  </span>
                </div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {sells && (
                  <button onClick={() => order(p)} className="neo-btn-primary py-1.5 px-2 text-xs flex items-center gap-1" title={t("Добавить в заказ", "Buyurtma qo'shish")}>
                    <Plus size={13} />{t("Заказ", "Buyurtma")}
                  </button>
                )}
                <button onClick={() => addToLabelQueue(p)} className="neo-btn py-1.5 px-2 text-xs" title={t("Добавить этикетку", "Yorliq qo'shish")} aria-label={t("Добавить этикетку", "Yorliq qo'shish")}>
                  <Printer size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Очередь этикеток */}
      {labelQueue.length > 0 && (
        <div className="p-4 space-y-3" style={card}>
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text-primary)" }}>
              {t("Очередь на печать", "Yorliqlar")} ({labelQueue.length})
            </span>
            <button onClick={printLabels} className="neo-btn-primary py-1.5 px-3 text-sm flex items-center gap-1.5">
              <Printer size={14} />
              {t("Печать этикеток", "Chop etish")}
            </button>
          </div>
          <div className="space-y-1.5">
            {labelQueue.map((p, i: number) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span style={{ color: "var(--color-text-primary)" }}>{p.name}</span>
                <div className="flex items-center gap-2">
                  <span className="font-data text-xs" style={{ color: "var(--color-text-secondary)" }}>{p.code}</span>
                  <button onClick={() => setLabelQueue(q => q.filter((_, j) => j !== i))} className="text-xs hover:underline" style={{ color: "var(--color-danger-text)" }} aria-label={t("Убрать", "Olib tashlash")}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="p-4 space-y-1" style={card}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>{t("Поддерживаемые форматы", "Qo'llab-quvvatlanadigan formatlar")}</p>
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>EAN-13, EAN-8, Code 128, Code 39, QR, UPC-A, UPC-E</p>
        <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "4px 0 0" }}>
          {t("Работает в Chrome 83+, Edge 83+, Android Chrome, Safari iOS 17.4+", "Chrome 83+, Edge 83+, Android Chrome, Safari iOS 17.4+ da ishlaydi")}
        </p>
      </div>
    </div>
  );
}
