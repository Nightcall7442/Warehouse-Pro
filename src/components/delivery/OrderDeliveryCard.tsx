import { useState } from "react";
import { CalendarClock, Truck } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { errorText } from "@/lib/error-text";
import { useInvalidateOrderCaches } from "@/hooks/useOrderCacheSync";
import { DeliveryProof, type DeliveryEventView } from "./DeliveryProof";
import { RescheduleDialog } from "./DeliveryDialogs";
import { TrackingLinkButton } from "./TrackingLinkButton";
import { ddmm } from "./plan-days";

/*
  Блок «Доставка» в карточке заказа: попытки и подтверждение, перенос дня
  офисом и ссылка для магазина.

  Перенос из офиса — тому, у кого заказ уже у курьера: магазин позвонил в
  офис «привезите в пятницу», и офис ставит день, не дёргая курьера. Сервер
  пускает директора и оператора с правом «править заказы».
*/

/** Сколько после доставки работает ссылка «где мой заказ» — как на сервере (services/tracking.ts). */
const TRACK_DAYS_AFTER_DELIVERY = 3;
const CLOSED = ["pending", "cancelled", "returned"];

export interface OrderDeliveryView {
  id: number;
  orderNumber: string;
  status: string;
  deliveryStatus: string | null;
  deliveredAt: Date | string | null;
  deletedAt?: Date | string | null;
  courierId: number | null;
  plannedDeliveryDate?: string | null;
  deliveryResult?: string | null;
  deliveryNotes?: string | null;
  deliveryEvents?: readonly DeliveryEventView[];
  shopName?: string | null;
}

export function OrderDeliveryCard({ order, canReschedule, asOf }: {
  order: OrderDeliveryView;
  /** Директор или оператор. */
  canReschedule: boolean;
  /** Когда получены данные — «сейчас» для окна ссылки (отрисовка не зовёт Date.now). */
  asOf: number;
}) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const invalidateOrderCaches = useInvalidateOrderCaches();
  const [rescheduling, setRescheduling] = useState(false);
  const officeReschedule = trpc.courier.officeReschedule.useMutation({
    onSuccess: (_r, vars) => {
      invalidateOrderCaches();
      setRescheduling(false);
      notify.success(t(`День доставки: ${ddmm(vars.date)}. Курьер получит уведомление`, `Yetkazish kuni: ${ddmm(vars.date)}. Kuryerga xabar boradi`));
    },
    onError: (e) => notify.error(errorText(e)),
  });

  const open = !order.deletedAt && !CLOSED.includes(order.status) && order.status !== "delivered";
  const inRun = open && !!order.courierId && (order.deliveryStatus === "assigned" || order.deliveryStatus === "out_for_delivery");
  const deliveredAt = order.deliveredAt ? new Date(order.deliveredAt).getTime() : null;
  const linkAllowed = !order.deletedAt && !CLOSED.includes(order.status)
    && (deliveredAt == null || asOf - deliveredAt <= TRACK_DAYS_AFTER_DELIVERY * 86_400_000);
  const events = order.deliveryEvents ?? [];
  const hasProof = events.length > 0 || !!order.deliveryResult || !!order.deliveryNotes || (open && !!order.plannedDeliveryDate);

  if (!hasProof && !linkAllowed && !(canReschedule && inRun)) return null;

  return (
    <div className="neo-card p-4 space-y-3" data-testid="order-delivery">
      <p className="font-label text-secondary text-xs tracking-wider flex items-center gap-2 uppercase">
        <Truck size={14} /> {t("Доставка", "Yetkazish")}
      </p>
      <DeliveryProof
        events={events}
        deliveryResult={order.deliveryResult}
        deliveryNotes={order.deliveryNotes}
        plannedDeliveryDate={order.plannedDeliveryDate}
        open={open}
      />
      {canReschedule && inRun && (
        <button type="button" onClick={() => setRescheduling(true)} className="neo-btn tap flex items-center gap-1.5 text-sm w-full justify-center"
          style={{ minHeight: 40 }} data-testid="office-reschedule">
          <CalendarClock size={14} />{t("Назначить день доставки", "Yetkazish kunini belgilash")}
        </button>
      )}
      {linkAllowed && <TrackingLinkButton orderId={order.id} />}
      {rescheduling && (
        <RescheduleDialog
          mode="office"
          orderNumber={order.orderNumber}
          shopName={order.shopName}
          current={order.plannedDeliveryDate}
          busy={officeReschedule.isPending}
          onCancel={() => setRescheduling(false)}
          onConfirm={(c) => officeReschedule.mutate({ orderId: order.id, ...c })}
        />
      )}
    </div>
  );
}
