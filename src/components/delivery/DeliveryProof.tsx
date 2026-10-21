import { CalendarClock, CheckCircle2, MapPin, PenLine, User, XCircle } from "lucide-react";
import { useLang } from "@/i18n";
import { bizDateTimeText } from "@/lib/business-time";
import { deliveryFailText, type DeliveryFailReason } from "@contracts/delivery-fail-reason";
import { signaturePolylines } from "@contracts/delivery-proof";
import { ddmm } from "./plan-days";
import { mapLink } from "./links";

/*
  «Доставка» в карточке заказа — попытки по порядку и подтверждение вручения.

  Раньше в карточке был только курьер по имени. Как закрыта доставка
  (оплачено, частичный возврат), что курьер написал, сколько раз ездил, с
  какой причиной возвращался и на какой день переносил — писалось, но не
  показывалось нигде, и спор с магазином «не привозили» офис вёл по памяти
  курьера.

  Фото — ссылками на /api/photos/delivery/<попытка>/<номер>: карточка
  получает только их число. Подпись — числами, и рисуется здесь ломаной из
  этих чисел (contracts/delivery-proof.ts: signaturePolylines).
*/

export interface DeliveryEventView {
  id: number;
  kind: "delivered" | "failed" | "rescheduled";
  courierName?: string | null;
  reasonCode?: DeliveryFailReason | null;
  note?: string | null;
  rescheduledTo?: string | null;
  recipientName?: string | null;
  signature?: { w: number; h: number; strokes: number[][] } | null;
  photoCount?: number | null;
  lat?: string | number | null;
  lng?: string | number | null;
  recordedAt: Date | string;
}

const RESULT_LABEL: Record<string, { ru: string; uz: string }> = {
  paid:             { ru: "Оплачен",          uz: "To'langan" },
  partial_paid:     { ru: "Частично оплачен", uz: "Qisman to'langan" },
  returned:         { ru: "Возврат",          uz: "Qaytarildi" },
  partial_returned: { ru: "Частичный возврат", uz: "Qisman qaytarildi" },
};

/** Подпись из чисел — ломаная в SVG, без единой строки из базы в разметке. */
export function SignatureSvg({ signature, height = 72 }: { signature: DeliveryEventView["signature"]; height?: number }) {
  const { lang } = useLang();
  const parsed = signaturePolylines(signature);
  if (!parsed) return null;
  const stroke = Math.max(parsed.w, parsed.h) / 160;
  return (
    <svg viewBox={`0 0 ${parsed.w} ${parsed.h}`} role="img" aria-label={lang === "uz" ? "Qabul qiluvchining imzosi" : "Подпись получателя"}
      style={{ height, width: "auto", maxWidth: "100%", color: "var(--color-text-primary)", background: "var(--color-surface-light)", borderRadius: 8 }}
      data-testid="delivery-signature">
      {parsed.lines.map((points, i) => (
        <polyline key={i} points={points} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

export function DeliveryProof({ events, deliveryResult, deliveryNotes, plannedDeliveryDate, open }: {
  events: readonly DeliveryEventView[];
  deliveryResult?: string | null;
  deliveryNotes?: string | null;
  plannedDeliveryDate?: string | null;
  /** Заказ ещё в работе — тогда показывается назначенный день. */
  open: boolean;
}) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const locale = lang === "uz" ? "uz-UZ" : "ru-RU";
  const result = deliveryResult ? RESULT_LABEL[deliveryResult] : null;
  if (events.length === 0 && !result && !deliveryNotes && !(open && plannedDeliveryDate)) return null;

  return (
    <div className="space-y-3" data-testid="delivery-proof">
      {open && plannedDeliveryDate && (
        <p className="flex items-center gap-1.5 text-sm" style={{ color: "var(--color-info-text)" }} data-testid="delivery-planned">
          <CalendarClock size={14} />{t(`Доставка запланирована на ${ddmm(plannedDeliveryDate)}`, `Yetkazish ${ddmm(plannedDeliveryDate)} ga rejalashtirilgan`)}
        </p>
      )}
      {(result || deliveryNotes) && (
        <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          {result && <b style={{ color: "var(--color-text-primary)" }}>{lang === "uz" ? result.uz : result.ru}</b>}
          {result && deliveryNotes ? " · " : ""}
          {deliveryNotes}
        </p>
      )}
      {events.length > 0 && (
        <ol className="space-y-2" aria-label={t("Попытки доставки", "Yetkazish urinishlari")}>
          {events.map(ev => {
            const at = bizDateTimeText(ev.recordedAt, locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
            const where = mapLink(ev.lat, ev.lng);
            const photos = Math.max(0, Math.min(10, Number(ev.photoCount) || 0));
            const tone = ev.kind === "delivered" ? "var(--color-success-text)" : ev.kind === "failed" ? "var(--color-danger-text)" : "var(--color-info-text)";
            const Icon = ev.kind === "delivered" ? CheckCircle2 : ev.kind === "failed" ? XCircle : CalendarClock;
            const title = ev.kind === "delivered" ? t("Доставлен", "Yetkazildi")
              : ev.kind === "failed" ? t("Не доставлен", "Yetkazilmadi")
              : ev.rescheduledTo ? t(`Перенесён на ${ddmm(ev.rescheduledTo)}`, `${ddmm(ev.rescheduledTo)} ga ko'chirildi`) : t("Перенесён", "Ko'chirildi");
            return (
              <li key={ev.id} className="rounded-xl p-3" style={{ border: "1px solid var(--color-border-subtle)" }} data-testid={`delivery-event-${ev.kind}`}>
                <div className="flex items-start gap-2">
                  <Icon size={16} style={{ color: tone, flexShrink: 0, marginTop: 2 }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: tone }}>{title}</p>
                    <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                      {at}{ev.courierName ? ` · ${ev.courierName}` : ""}
                    </p>
                    {ev.kind !== "delivered" && (ev.reasonCode || ev.note) && (
                      <p className="text-sm mt-1" style={{ color: "var(--color-text-secondary)" }}>{deliveryFailText(ev.reasonCode ?? null, ev.note, lang)}</p>
                    )}
                    {ev.kind === "delivered" && ev.recipientName && (
                      <p className="text-sm mt-1 flex items-center gap-1" style={{ color: "var(--color-text-secondary)" }}>
                        <User size={12} />{t("Принял", "Qabul qildi")}: {ev.recipientName}
                      </p>
                    )}
                    {ev.kind === "delivered" && ev.signature && (
                      <div className="mt-2">
                        <span className="flex items-center gap-1 text-[11px] mb-1" style={{ color: "var(--color-text-tertiary)" }}><PenLine size={11} />{t("Подпись", "Imzo")}</span>
                        <SignatureSvg signature={ev.signature} />
                      </div>
                    )}
                    {photos > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {Array.from({ length: photos }, (_, n) => (
                          <a key={n} href={`/api/photos/delivery/${ev.id}/${n}`} target="_blank" rel="noopener noreferrer" data-testid="delivery-photo">
                            <img src={`/api/photos/delivery/${ev.id}/${n}`} alt={t(`Фото ${n + 1}`, `Rasm ${n + 1}`)} loading="lazy"
                              className="rounded-lg object-cover" style={{ width: 72, height: 72, background: "var(--color-surface-light)" }} />
                          </a>
                        ))}
                      </div>
                    )}
                    {where && (
                      <a href={where} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs mt-2"
                        style={{ color: "var(--color-primary-text)" }} data-testid="delivery-event-map">
                        <MapPin size={12} />{t("Где отмечено", "Qayerda belgilangan")}
                      </a>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
