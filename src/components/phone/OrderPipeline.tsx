import { Check, CheckCircle2, FileText, Loader2, PauseCircle, RotateCcw, Truck, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLang } from "@/i18n";
import { orderStatusWord } from "./tones";
import { CARD } from "./tones";

/*
  Путь заказа — PipelineBanner мобилки v8 (Warehouse-Pro-Mobile,
  src/components/order/OrderInfo.tsx): где заказ сейчас на пути «новый → в
  работе → отгружен → доставлен». Ждущий офиса и отменённый — отдельными
  плашками: у них нет места на этом пути, и честнее сказать об этом прямо.
*/
const STEP: Record<string, number> = { new: 0, processing: 1, shipped: 2, delivered: 3, pending: 0 };
const ICON: Record<string, LucideIcon> = { new: FileText, processing: Loader2, shipped: Truck, delivered: CheckCircle2 };
const TONE: Record<string, { fill: string; text: string }> = {
  new:        { fill: "var(--color-info)",    text: "var(--color-info-text)" },
  processing: { fill: "var(--color-warning)", text: "var(--color-warning-text)" },
  shipped:    { fill: "var(--color-info)",    text: "var(--color-info-text)" },
  delivered:  { fill: "var(--color-success)", text: "var(--color-success-text)" },
};

export function OrderPipeline({ status, holdReason }: { status: string; holdReason?: string | null }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  if (status === "pending" || status === "cancelled" || status === "returned") {
    const cfg = status === "pending"
      ? { icon: PauseCircle, fill: "var(--color-warning)", text: "var(--color-warning-text)", title: t("Ждёт подтверждения офиса", "Ofis tasdig'ini kutmoqda"),
          sub: holdReason || t("Офис проверит заказ и подтвердит или отклонит. До этого срок доставки не обещайте.", "Ofis buyurtmani tekshirib tasdiqlaydi yoki rad etadi. Ungacha yetkazish muddatini va'da qilmang.") }
      : status === "cancelled"
      ? { icon: XCircle, fill: "var(--color-danger)", text: "var(--color-danger-text)", title: t("Заказ отменён", "Buyurtma bekor qilingan"), sub: t("Этот заказ был отменён и не обрабатывается", "Bu buyurtma bekor qilingan va bajarilmaydi") }
      : { icon: RotateCcw, fill: "var(--color-danger)", text: "var(--color-danger-text)", title: t("Заказ возвращён", "Buyurtma qaytarilgan"), sub: t("Товар вернулся на склад", "Tovar omborga qaytdi") };
    return (
      <div className="flex items-center gap-4" style={{ ...CARD, borderRadius: 20, padding: 20, border: `1px solid color-mix(in srgb, ${cfg.fill} 25%, transparent)` }} data-testid="order-pipeline">
        <span className="flex items-center justify-center flex-shrink-0" style={{ width: 56, height: 56, borderRadius: 16, background: `color-mix(in srgb, ${cfg.fill} 14%, transparent)` }}>
          <cfg.icon size={28} color={cfg.text} />
        </span>
        <div className="min-w-0">
          <p style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>{cfg.title}</p>
          <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: "4px 0 0" }}>{cfg.sub}</p>
        </div>
      </div>
    );
  }

  const step = STEP[status] ?? 0;
  const tone = TONE[status] ?? TONE.new;
  const Icon = ICON[status] ?? FileText;
  const steps = [t("Новый", "Yangi"), t("В работе", "Jarayonda"), t("Отгружен", "Yuklandi"), t("Доставлен", "Yetkazildi")];

  return (
    <div className="flex items-center gap-4" style={{ ...CARD, borderRadius: 20, padding: 20, border: `1px solid color-mix(in srgb, ${tone.fill} 18%, transparent)` }} data-testid="order-pipeline">
      <div className="flex-1 min-w-0">
        <p style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)", margin: "0 0 10px" }}>{orderStatusWord(status, lang)}</p>
        <div className="flex items-center flex-wrap gap-y-2">
          {steps.map((label, i) => {
            const done = i <= step;
            const active = i === step;
            return (
              <span key={label} className="flex items-center">
                <span className="flex items-center justify-center rounded-full flex-shrink-0"
                  style={{ width: 18, height: 18, background: done ? "var(--color-primary)" : "var(--color-surface-light)", boxShadow: done ? "none" : "var(--shadow-pressed)" }}>
                  {done && !active && <Check size={10} color="var(--color-on-primary)" strokeWidth={3} />}
                  {active && <span className="rounded-full" style={{ width: 6, height: 6, background: "var(--color-on-primary)", opacity: 0.6 }} />}
                </span>
                <span style={{ fontSize: 11, fontWeight: 500, margin: "0 4px", color: done ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}>{label}</span>
                {i < steps.length - 1 && <span style={{ width: 12, height: 2, borderRadius: 1, background: i < step ? "var(--color-primary)" : "var(--color-border)" }} />}
              </span>
            );
          })}
        </div>
      </div>
      <span className="flex items-center justify-center flex-shrink-0" style={{ width: 56, height: 56, borderRadius: 16, background: `color-mix(in srgb, ${tone.fill} 12%, transparent)` }}>
        <Icon size={30} color={tone.text} />
      </span>
    </div>
  );
}
