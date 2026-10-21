import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { formatQty } from "@/lib/format";
import { COLORS } from "@/components/users/types";
import { UNBATCHED, dayText } from "./transfer-text";

/**
 * Партии товара на складе-отправителе — выбрать, какие везти.
 *
 * Без выбора дверь берёт по FEFO и просрочку не трогает. Выбор нужен там,
 * где FEFO не то: увезти сгоревшую партию на склад списания, отдать
 * получателю позднюю партию, оставив раннюю у себя. Просроченная партия
 * здесь выбирается — продать её всё равно нельзя, а вывезти можно.
 * Количество строки — сумма выбранного.
 */
export function TransferBatchPicker({ productId, warehouseId, picks, onChange }: {
  productId: number;
  warehouseId: number;
  picks: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const q = trpc.warehouseReports.productBatches.useQuery({ productId, warehouseId });

  if (q.isLoading) return <div className="text-xs" style={{ color: COLORS.textTertiary }}>{t("Загружаем партии…", "Partiyalar yuklanmoqda…")}</div>;
  const batches = (q.data?.batches ?? []) as Array<{ batchId: number; batchNumber: string | null; expiresAt: unknown; quantity: number; daysLeft: number | null }>;
  const untracked = Number(q.data?.untracked ?? 0);
  if (batches.length === 0 && untracked <= 0) {
    return <div className="text-xs" style={{ color: COLORS.textTertiary }}>{t("На складе-отправителе этого товара нет", "Jo'natuvchi omborda bu mahsulot yo'q")}</div>;
  }

  const row = (key: string, label: React.ReactNode, has: number, expired: boolean) => {
    const over = Number(picks[key] ?? 0) > has;
    return (
      <div key={key} className="flex items-center justify-between gap-3 py-1" data-testid={`pick-row-${productId}-${key}`}>
        <span className="text-xs" style={{ color: expired ? "var(--color-danger-text)" : COLORS.textSecondary }}>
          {label} · {t("в партии", "partiyada")} {formatQty(has)}
          {expired && <> · {t("просрочена", "muddati o'tgan")}</>}
        </span>
        <DecimalInput className="neo-input font-data" style={{ width: 110, ...(over ? { borderColor: "var(--color-danger)" } : {}) }}
          value={picks[key] ?? ""} placeholder="—" data-testid={`pick-${productId}-${key}`}
          onValueChange={v => onChange({ ...picks, [key]: v })} />
      </div>
    );
  };

  return (
    <div className="rounded-xl px-3 py-2" style={{ border: `1px solid ${COLORS.border}` }} data-testid={`transfer-picker-${productId}`}>
      {batches.map(b => row(
        String(b.batchId),
        <>{b.batchNumber ?? t("без номера", "raqamsiz")}{b.expiresAt ? ` · ${t("до", "gacha")} ${dayText(b.expiresAt)}` : ` · ${t("без срока", "muddatsiz")}`}</>,
        Number(b.quantity),
        b.daysLeft != null && b.daysLeft < 0,
      ))}
      {untracked > 0 && row(UNBATCHED, t("без партии", "partiyasiz"), untracked, false)}
    </div>
  );
}
