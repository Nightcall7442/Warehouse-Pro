import { useState } from "react";
import { AppModal, modalSectionLabel } from "@/components/ui/AppModal";
import { Printer, Loader2, ClipboardList } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { printLoadingList, type LoadingListData } from "@/lib/documents";
import { useTranslate, useLang } from "@/i18n";
import { formatQty } from "@/lib/format";
import { unitShort } from "@/lib/units";
import { useSellerCompany } from "@/hooks/useSellerCompany";

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
  // Погрузочный лист читает кладовщик: единица должна быть словом, а не
  // кодом из базы. Здесь печаталось «12 pcs».
  const { lang } = useLang();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LoadingListData | null>(null);
  const [listFormat, setListFormat] = useState<"aggregated" | "byRoute">("aggregated");

  const createMutation = trpc.order.createLoadingList.useMutation();
  const { company: seller, currency } = useSellerCompany();

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
      notify.error(e instanceof Error ? e.message : t("Ошибка", "Xatolik"));
    } finally {
      setLoading(false);
    }
  };

  /*
    Лист создаётся по кнопке, а не при открытии окна.

    Запрос уходил сразу при открытии: оператор выделял заказы, нажимал
    «Загруз. лист», смотрел — и передумывал, а лист уже был записан и держал
    заказы. Следующая попытка собрать их отвечала «закройте прежний лист».
    Ровно так у арендатора одиннадцать заказов застряли в ZL-20260908-JPXE.
    Теперь до «Сформировать» в базе ничего нет, и «Отмена» — просто отмена.
  */
  const close = () => { setResult(null); onOpenChange(false); };

  const handlePrint = () => {
    if (!result) return;
    printLoadingList({ ...result, companyName: seller.name || undefined }, listFormat, currency);
    onDone();
    close();
  };

  return (
    <AppModal
      open={open}
      onClose={close}
      title={t("Загрузочный лист", "Yuklash varaqi")}
      subtitle={`${t("Выбрано заказов", "Tanlangan buyurtmalar")}: ${orderIds.length}`}
      maxWidth={760}
      footer={result ? (
        <>
          <button type="button" onClick={handlePrint} className="neo-btn-primary flex-1 h-12 text-sm">
            <Printer size={16} />{t("Печать", "Chop etish")}
          </button>
          {/* Лист уже записан: закрыть без печати — не «отмена», он в «Погрузочных листах». */}
          <button type="button" onClick={() => { onDone(); close(); }} className="neo-btn flex-1 h-12 text-sm">
            {t("Готово, без печати", "Tayyor, chop etmasdan")}
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={handleGenerate} disabled={loading || orderIds.length === 0} className="neo-btn-primary flex-1 h-12 text-sm">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <ClipboardList size={16} />}
            {t("Сформировать лист", "Varaqa tuzish")}
          </button>
          <button type="button" onClick={close} disabled={loading} className="neo-btn flex-1 h-12 text-sm">
            {t("Отмена", "Bekor qilish")}
          </button>
        </>
      )}
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
        ) : !result ? (
          <p className="text-sm py-6" style={{ color: "var(--color-text-tertiary)" }}>
            {t("Лист ещё не создан: нажмите «Сформировать лист». Пока не нажали — заказы свободны.",
               "Varaqa hali tuzilmagan: «Varaqa tuzish» tugmasini bosing. Bosmaguningizcha buyurtmalar bo'sh.")}
          </p>
        ) : (
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
                    {formatQty(item.totalQty)} {unitShort(item.unit, lang)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/*
          Здесь стояла вторая кнопка, «Сохранить PDF», и делала ровно то же, что
          первая: открывала диалог печати. Человек жал её и решал, что
          скачивание сломано.
        
          Файл из этого окна берётся — в списке принтеров есть «Сохранить как
          PDF», и он даёт настоящий PDF с текстом, который ищется и
          выделяется. Об этом нигде не было сказано, поэтому сказано здесь.
        */}
        <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
          {t("Чтобы получить файл, выберите в окне печати принтер «Сохранить как PDF».",
             "Fayl olish uchun chop etish oynasida «PDF sifatida saqlash» printerini tanlang.")}
        </p>
      </div>
    </AppModal>
  );
}
