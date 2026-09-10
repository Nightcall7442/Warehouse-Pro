import { useState } from "react";
import { CalendarClock, AlertTriangle, Check, X } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useTranslate } from "@/i18n";
import { OPEN_ORDER_STATUSES } from "@contracts/constants";
import { toLocalInput, promiseState } from "@/lib/promised-delivery";

/* ═══════════════════════════════════════════════════════════════════════════
   Обещанный срок доставки.

   ── Почему это отдельный блок, а не строка в сетке ──────────────────────────

   Потому что его не только смотрят, но и МЕНЯЮТ, и меняет тот же человек,
   который обещание дал: агент звонит магазину и переносит на понедельник. В
   сетке «покупатель / агент / оплата / доставка» лежат факты, которые никто
   не правит с этого экрана.

   ── Чего здесь принципиально нет ────────────────────────────────────────────

   Значения по умолчанию. Пустой срок значит «не обещали», и это законный
   ответ: подставь сюда «завтра» — и система начнёт считать срыв по сроку,
   которого никто не называл.
   ═══════════════════════════════════════════════════════════════════════════ */

interface Props {
  orderId: number;
  /** Обещанный срок или null, если срок не называли. */
  promisedDeliveryAt: Date | string | null;
  /** Статус заказа: по закрытому обещание уже не переносят. */
  status: string;
  /** Когда довезли — нужно, чтобы отличить «довезли вовремя» от «позже». */
  deliveredAt?: Date | string | null;
  /**
   * Вправе ли смотрящий менять срок.
   *
   * Решает вызывающий, потому что правило у него уже есть: свой заказ у
   * полевого, любой — у офиса. Сервер проверяет то же самое сам; здесь это
   * только про то, показывать кнопку или нет.
   */
  canEdit: boolean;
}

export function PromisedDelivery({ orderId, promisedDeliveryAt, status, deliveredAt, canEdit }: Props) {
  const t = useTranslate();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(() => toLocalInput(promisedDeliveryAt));

  const open = (OPEN_ORDER_STATUSES as readonly string[]).includes(status);
  const state = promiseState(promisedDeliveryAt, status, deliveredAt);

  const save = trpc.order.setPromisedDelivery.useMutation({
    onSuccess: () => {
      setEditing(false);
      utils.order.getById.invalidate({ id: orderId });
      notify.success(t("Срок сохранён", "Muddat saqlandi"));
    },
    onError: e => notify.error(e.message),
  });

  const submit = (raw: string) => {
    save.mutate({
      orderId,
      // Пустое поле — снятое обещание, а не «оставить как было»: иначе
      // ошибочно поставленный срок нечем было бы убрать.
      promisedDeliveryAt: raw ? new Date(raw).toISOString() : null,
    });
  };

  return (
    <div className="neo-card-sm" style={{ padding: "12px 14px" }}>
      <p className="font-label text-secondary text-[10px] tracking-wider mb-1.5 flex items-center gap-1">
        <CalendarClock size={12} /> {t("ОБЕЩАННЫЙ СРОК", "VA'DA QILINGAN MUDDAT")}
      </p>

      {editing ? (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="datetime-local"
            className="neo-input"
            value={value}
            onChange={e => setValue(e.target.value)}
            style={{ flex: "1 1 200px" }}
          />
          <button
            type="button"
            className="neo-btn-primary"
            disabled={save.isPending}
            onClick={() => submit(value)}
            style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "6px 12px" }}
          >
            <Check size={13} /> {t("Сохранить", "Saqlash")}
          </button>
          <button
            type="button"
            className="neo-btn"
            disabled={save.isPending}
            onClick={() => { setValue(toLocalInput(promisedDeliveryAt)); setEditing(false); }}
            style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "6px 12px" }}
          >
            <X size={13} /> {t("Отмена", "Bekor")}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "baseline" }}>
          <span className="text-sm text-primary">
            {state.kind === "none"
              ? t("Срок не называли", "Muddat aytilmagan")
              : new Date(promisedDeliveryAt as string | Date).toLocaleString("ru")}
          </span>

          {state.kind === "late" && (
            <span className="text-xs text-danger font-medium" style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
              <AlertTriangle size={11} /> {t("Просрочен", "Muddati o'tgan")}
            </span>
          )}
          {state.kind === "late_delivered" && (
            <span className="text-xs text-secondary">
              {t("Доставлен позже обещанного", "Va'dadan kech yetkazilgan")}
            </span>
          )}

          {canEdit && open && (
            <button
              type="button"
              className="neo-btn"
              onClick={() => setEditing(true)}
              style={{ padding: "4px 10px", fontSize: "12px" }}
            >
              {state.kind === "none" ? t("Поставить", "Belgilash") : t("Перенести", "Ko'chirish")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
