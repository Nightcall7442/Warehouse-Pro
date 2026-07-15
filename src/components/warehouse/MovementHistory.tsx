import { useState } from "react";
import { ChevronUp, ChevronDown, FileDown } from "lucide-react";
import { useLang } from "@/i18n";
import { format } from "date-fns";
import { trpc } from "@/providers/trpc";
import { exportToExcel, formatMovementsForExport } from "@/lib/excel";
import { MOVE_TYPE } from "./warehouse-utils";

export function MovementHistory({ productId, productName }: { productId: number; productName: string }) {
  const [open, setOpen] = useState(false);
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { data: movements } = trpc.warehouse.movements.useQuery({ productId }, { enabled: open });

  return (
    <div>
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3 text-xs transition-colors rounded-lg"
        style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
        <span>{open ? t("Скрыть историю", "Tarixni yashirish") : t("История движений", "Harakat tarixi")}</span>
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {open && (
        <div className="px-5 pb-4">
          <div className="flex justify-end mb-3">
            <button onClick={() => movements && exportToExcel(formatMovementsForExport(movements), `movements-${productName}`)}
              className="text-xs flex items-center gap-1.5 py-1.5 px-3 rounded-lg transition-colors"
              style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
              <FileDown size={12} /> Excel
            </button>
          </div>
          {!movements?.length ? (
            <p className="text-xs py-3" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
              {t("Движений нет", "Harakatlar yo'q")}
            </p>
          ) : (
            <div className="space-y-2">
              {movements.map(m => {
                const mt = MOVE_TYPE[m.type] ?? MOVE_TYPE.adjustment;
                const Icon = mt.icon;
                return (
                  <div key={m.id} className="flex items-start gap-3 py-3 px-4 rounded-xl"
                    style={{ background: "var(--color-surface-light, #f0f3f8)", boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: `${mt.color}15` }}>
                      <Icon size={14} style={{ color: mt.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium" style={{ color: "var(--color-text-primary, #2b3450)" }}>
                          {lang === "uz" ? mt.labelUz : mt.labelRu}
                        </span>
                        <span className="text-xs" style={{ color: "var(--color-text-tertiary, #98a0b8)", fontFamily: "'DM Sans', sans-serif" }}>
                          {m.createdAt ? format(new Date(m.createdAt), "dd.MM.yy HH:mm") : "—"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <span className="text-base font-bold" style={{ color: mt.color, fontFamily: "'DM Sans', sans-serif" }}>
                          {mt.sign}{Number(m.quantity).toFixed(2)} кг
                        </span>
                        {m.notes && <span className="text-xs truncate" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>{m.notes}</span>}
                      </div>
                      {m.referenceType && (
                        <span className="text-[10px] mt-0.5 inline-block px-2 py-0.5 rounded"
                          style={{ background: "var(--color-surface, #ffffff)", color: "var(--color-text-tertiary, #98a0b8)" }}>
                          {m.referenceType} #{m.referenceId}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
