import { useLang } from "@/i18n";
import { formatQty } from "@/lib/format";
import { AppModal } from "@/components/ui/AppModal";

interface LowStockModalProps {
  lowCount: number;
  reorderSuggestions: Array<{
    productName: string | null;
    productCode: string | null;
    currentStock: number | string;
    reorderPoint: number | string | null;
  }>;
  onClose: () => void;
}

/**
 * Что стоит под порогом — списком.
 *
 * Порог считает сервер: `available <= reorderPoint` при `reorderPoint > 0`,
 * в одном запросе с плиткой «Мало стока». Здесь список рисуется как пришёл.
 *
 * Свой отбор тут уже стоял — `currentStock < reorderPoint` — и отвечал на
 * другой вопрос: строго меньше вместо «не больше», и общий остаток вместо
 * свободного. Товар ровно на пороге и товар с резервом из окна выпадали,
 * а плитка их считала: она говорила «5 ниже порога», окно показывало три,
 * а при одних резервах открывалось пустым.
 */
export function LowStockModal({ lowCount, reorderSuggestions, onClose }: LowStockModalProps) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  return (
    <AppModal
      open
      onClose={onClose}
      title={t("Товары ниже порога", "Chegaradan past mahsulotlar")}
      subtitle={`${lowCount} ${t("товаров требуют пополнения", "ta mahsulot to'ldirish talab qiladi")}`}
      maxWidth={720}
    >
      {reorderSuggestions.length === 0 ? (
        <p className="text-sm text-center" style={{ color: "var(--color-text-tertiary)" }}>
          {t("Порог пополнения не задан ни одному товару", "Hech bir mahsulotga to'ldirish chegarasi qo'yilmagan")}
        </p>
      ) : (
        <div className="space-y-2">
          {reorderSuggestions.map((item, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "var(--color-surface-light, #f6f4f0)" }}>
              <div className="w-2 h-8 rounded-full flex-shrink-0" style={{ background: "var(--color-danger)" }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--color-text-primary, #2b2a28)" }}>{item.productName}</p>
                <p className="text-xs" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{item.productCode}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold tabular-nums" style={{ color: "var(--color-danger-text)" }}>{formatQty(item.currentStock)}</p>
                <p className="text-xs tabular-nums" style={{ color: "var(--color-text-tertiary, #6b6760)" }}>{t("порог", "chegara")}: {formatQty(item.reorderPoint, 0)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppModal>
  );
}
