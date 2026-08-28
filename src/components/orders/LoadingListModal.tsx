import { useState, useEffect } from "react";
import { AppModal, modalSectionLabel } from "@/components/ui/AppModal";
import { Download, Printer, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { printLoadingList, type LoadingListData } from "@/lib/documents";
import { useTranslate } from "@/i18n";
import { formatQty } from "@/lib/format";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderIds: number[];
  onDone: () => void;
}

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

  // Запрос уходит сразу при открытии окна, с настройками по умолчанию.
  //
  // Сброс прошлого результата и сам запрос выполняются внутри асинхронной
  // функции, а не в теле эффекта: синхронный setState в эффекте заставляет
  // React сделать лишний проход отрисовки сразу после открытия. Порядок
  // действий тот же, что и раньше.
  useEffect(() => {
    if (!open || orderIds.length === 0) return;
    void (async () => {
      setResult(null);
      await handleGenerate();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orderIds.join(",")]);

  const handlePrint = () => {
    if (!result) return;
    printLoadingList(result, listFormat);
    onDone();
    onOpenChange(false);
  };

  return (
    <AppModal
      open={open}
      onClose={() => onOpenChange(false)}
      title={t("Загрузочный лист", "Yuklash varaqi")}
      subtitle={`${t("Выбрано заказов", "Tanlangan buyurtmalar")}: ${orderIds.length}`}
      maxWidth={760}
      footer={
        <>
          <button type="button" onClick={handlePrint} disabled={!result} className="neo-btn-primary flex-1 h-12 text-sm">
            <Printer size={16} />{t("Печать", "Chop etish")}
          </button>
          <button type="button" onClick={handlePrint} disabled={!result} className="neo-btn flex-1 h-12 text-sm">
            <Download size={16} />{t("Скачать PDF", "PDF yuklab olish")}
          </button>
          <button type="button" onClick={() => onOpenChange(false)} className="neo-btn flex-1 h-12 text-sm">
            {t("Отмена", "Bekor qilish")}
          </button>
        </>
      }
    >
      <div>
        <p className={modalSectionLabel}>{t("Формат", "Format")}</p>
        <div className="grid grid-cols-2 gap-3">
          {(["aggregated", "byRoute"] as const).map(fmt => (
            <button
              key={fmt}
              type="button"
              onClick={() => setListFormat(fmt)}
              className={listFormat === fmt ? "neo-btn-primary h-11 text-sm" : "neo-btn h-11 text-sm"}
            >
              {fmt === "aggregated" ? t("Сводный", "Yig'ma") : t("По маршруту", "Marshrut bo'yicha")}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <p className={modalSectionLabel} style={{ marginBottom: 0 }}>{t("Предпросмотр", "Oldindan ko'rish")}</p>
          {result && (
            <span className="text-xs font-semibold text-primary font-data">{result.listNumber}</span>
          )}
        </div>

        {loading && !result ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm" style={{ color: "var(--color-text-tertiary)" }}>
            <Loader2 size={15} className="animate-spin" />
            {t("Формируется…", "Tayyorlanmoqda…")}
          </div>
        ) : result && (
          <div className="neo-card-sm" style={{ padding: "16px" }}>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: t("Заказов", "Buyurtma"), value: String(result.totalOrders) },
                { label: t("Позиций", "Pozitsiya"), value: String(result.totalItems) },
                { label: t("Вес", "Og'irlik"), value: `${formatQty(result.totalWeight)} кг` },
              ].map(s => (
                <div key={s.label} className="px-3 py-2.5 rounded-xl" style={{ background: "var(--color-primary-subtle)" }}>
                  <div className="font-label text-[10px] tracking-wider uppercase" style={{ color: "var(--color-text-tertiary)" }}>{s.label}</div>
                  <div className="text-base font-bold text-primary font-data">{s.value}</div>
                </div>
              ))}
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 200 }}>
              {result.items.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-xs py-2"
                  style={{ borderTop: i === 0 ? undefined : "1px solid var(--color-border, #d8d5cd)" }}
                >
                  <span style={{ color: "var(--color-text-primary)" }}>{item.productName}</span>
                  <span className="font-semibold tabular-nums font-data" style={{ color: "var(--color-text-primary)" }}>
                    {formatQty(item.totalQty)} {item.unit}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppModal>
  );
}
