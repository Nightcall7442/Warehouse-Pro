import { AlertTriangle, X } from "lucide-react";
import { useLang } from "@/i18n";

interface LowStockModalProps {
  lowCount: number;
  reorderSuggestions: Array<{
    productName: string;
    productCode: string;
    currentStock: number;
    reorderPoint: number;
  }>;
  onClose: () => void;
}

export function LowStockModal({ lowCount, reorderSuggestions, onClose }: LowStockModalProps) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const filteredItems = reorderSuggestions.filter(
    (r) => Number(r.currentStock ?? 0) < Number(r.reorderPoint ?? 0) && Number(r.reorderPoint ?? 0) > 0
  );

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div className="relative w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-3xl p-6" style={{ background: "var(--color-surface, #ffffff)", boxShadow: "0 25px 80px -12px rgba(0,0,0,0.35)" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #e85050, #e85050)" }}>
              <AlertTriangle size={18} color="#fff" />
            </div>
            <div>
              <h2 className="text-lg font-bold" style={{ color: "var(--color-text-primary, #2b3450)", fontFamily: "'DM Sans', sans-serif" }}>
                {t("Товары ниже порога", "Chegaradan past mahsulotlar")}
              </h2>
              <p className="text-xs" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                {lowCount} {t("товаров требуют пополнения", "ta mahsulot to'ldirish talab qiladi")}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "var(--color-surface-light, #f0f3f8)", border: "none", cursor: "pointer", color: "var(--color-text-secondary, #6a7290)" }}>
            <X size={16} />
          </button>
        </div>
        <div className="space-y-2">
          {filteredItems.map((item, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
              <div className="w-2 h-8 rounded-full flex-shrink-0" style={{ background: "linear-gradient(180deg, #e85050, #e85050)" }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--color-text-primary, #2b3450)" }}>{item.productName}</p>
                <p className="text-xs" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>{item.productCode}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold" style={{ color: "#e85050" }}>{Number(item.currentStock ?? 0).toFixed(1)}</p>
                <p className="text-xs" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>{t("порог", "chegara")}: {Number(item.reorderPoint ?? 0).toFixed(0)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
