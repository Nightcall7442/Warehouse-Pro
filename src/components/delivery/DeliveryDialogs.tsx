import { useId, useMemo, useRef, useState } from "react";
import { CalendarClock, XCircle } from "lucide-react";
import { useLang } from "@/i18n";
import { bizToday } from "@/lib/business-time";
import {
  DELIVERY_FAIL_NOTE_MAX, RESCHEDULE_MAX_DAYS, deliveryFailInputError, type DeliveryFailReason,
} from "@contracts/delivery-fail-reason";
import { DeliverySheet, ReasonChips } from "./DeliverySheet";
import { planDayChoices, planDayLabel, addDays } from "./plan-days";

/*
  «Не доставлено» и «Перенести» — два разных ответа на «почему не довёз».

  Срыв снимает заказ с курьера и возвращает его в офис: дальше решают там.
  Перенос оставляет заказ за курьером на названный день — магазин сам просил
  «привезите в пятницу», и офису тут делать нечего. Поэтому «Просили
  привезти в другой день» в окне срыва подсказывает перенос, а не молча
  срывает заказ.
*/

export interface FailChoice { reasonCode: DeliveryFailReason; note?: string }
export interface RescheduleChoice { date: string; reasonCode?: DeliveryFailReason; note?: string }

function noteHint(problem: ReturnType<typeof deliveryFailInputError>, t: (ru: string, uz: string) => string): string | null {
  if (problem === "note_required") return t("Для «Другое» напишите коротко, что случилось", "«Boshqa» uchun nima bo'lganini qisqa yozing");
  if (problem === "note_too_long") return t(`Не длиннее ${DELIVERY_FAIL_NOTE_MAX} знаков`, `${DELIVERY_FAIL_NOTE_MAX} belgidan oshmasin`);
  return null;
}

function NoteField({ id, value, onChange, required, inputRef }: {
  id: string; value: string; onChange: (v: string) => void; required: boolean;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  return (
    <div style={{ marginTop: 12 }}>
      <label htmlFor={id} className="font-label text-[10px] text-secondary mb-1.5 block">
        {required ? t("Что случилось", "Nima bo'ldi") : t("Пояснение (необязательно)", "Izoh (ixtiyoriy)")}
      </label>
      <textarea id={id} ref={inputRef} value={value} onChange={e => onChange(e.target.value)} rows={2}
        maxLength={DELIVERY_FAIL_NOTE_MAX + 50}
        placeholder={t("Коротко: закрыто до 14:00, шлагбаум…", "Qisqa: 14:00 gacha yopiq, shlagbaum…")}
        className="neo-input w-full" style={{ resize: "none" }} data-testid="delivery-note" />
    </div>
  );
}

/** «Не доставлено» — причина обязательна, для «Другое» — и слова. */
export function FailReasonDialog({ orderNumber, shopName, busy = false, onCancel, onConfirm, onReschedule }: {
  orderNumber?: string | null;
  shopName?: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (choice: FailChoice) => void;
  /** Есть — «Просили в другой день» предлагает перенос вместо срыва. */
  onReschedule?: () => void;
}) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const id = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState<DeliveryFailReason | null>(null);
  const [note, setNote] = useState("");

  const problem = reason ? deliveryFailInputError(reason, note) : null;
  const ready = reason !== null && problem === null && !busy;
  const hint = reason === null
    ? t("Выберите причину — без неё отметку не поставить", "Sababni tanlang — usiz belgilab bo'lmaydi")
    : noteHint(problem, t);

  const pick = (r: DeliveryFailReason) => {
    setReason(r);
    if (r === "other") setTimeout(() => noteRef.current?.focus(), 0);
  };
  const submit = () => {
    if (!ready || !reason) return;
    const text = note.trim();
    onConfirm(text ? { reasonCode: reason, note: text } : { reasonCode: reason });
  };

  return (
    <DeliverySheet
      title={t("Почему не доставлено?", "Nega yetkazilmadi?")}
      subtitle={[orderNumber, shopName].filter(Boolean).join(" · ")}
      dirty={note.trim().length > 0}
      onClose={onCancel}
      testId="fail-reason-dialog"
      footer={<>
        <button type="button" onClick={submit} disabled={!ready} aria-disabled={!ready}
          className="neo-btn-primary tap flex-1 flex items-center justify-center gap-1.5 disabled:opacity-40"
          style={{ minHeight: 48, minWidth: 180 }} data-testid="fail-reason-confirm">
          <XCircle size={16} />{busy ? t("Отправка...", "Yuborilmoqda...") : t("Отметить «Не доставлено»", "«Yetkazilmadi» deb belgilash")}
        </button>
      </>}
    >
      <ReasonChips value={reason} onChange={pick} lang={lang} />
      {reason !== null && (
        <NoteField id={`${id}-note`} value={note} onChange={setNote} required={reason === "other"} inputRef={noteRef} />
      )}
      {reason === "asked_reschedule" && onReschedule && (
        <div className="flex items-center gap-2 flex-wrap" role="note"
          style={{ marginTop: 12, padding: "10px 12px", borderRadius: 12, background: "var(--color-info-subtle)", color: "var(--color-info-text)", fontSize: 13 }}>
          <span className="flex-1 min-w-0">{t("Заказ можно оставить за собой и привезти в названный день.", "Buyurtmani o'zingizda qoldirib, aytilgan kuni olib borishingiz mumkin.")}</span>
          <button type="button" onClick={onReschedule} className="neo-btn tap flex items-center gap-1.5"
            style={{ minHeight: 40, padding: "0 12px" }} data-testid="fail-to-reschedule">
            <CalendarClock size={14} />{t("Перенести", "Ko'chirish")}
          </button>
        </div>
      )}
      {hint && <p role="status" style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "12px 0 0" }} data-testid="fail-reason-hint">{hint}</p>}
    </DeliverySheet>
  );
}

/**
 * «Перенести на…» — день доставки.
 *
 * Курьер — с завтра (сегодня он и так везёт), офис — и на сегодня: вернуть
 * перенесённый заказ в сегодняшний развоз. Оба — не дальше
 * RESCHEDULE_MAX_DAYS: дальше это уже новый заказ, а не перенос.
 */
export function RescheduleDialog({ mode, orderNumber, shopName, current, busy = false, onCancel, onConfirm }: {
  mode: "courier" | "office";
  orderNumber?: string | null;
  shopName?: string | null;
  /** Уже назначенный день — чтобы офис видел, что меняет. */
  current?: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (choice: RescheduleChoice) => void;
}) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const id = useId();
  // Сегодня — один раз на открытие окна: окно, открытое в 23:59, не должно
  // сдвигать кнопки под пальцем.
  const [today] = useState(() => bizToday());
  const from = mode === "courier" ? 1 : 0;
  const first = addDays(today, from);
  const last = addDays(today, RESCHEDULE_MAX_DAYS);
  const chips = useMemo(() => planDayChoices(today, from, from + 6), [today, from]);
  const [date, setDate] = useState<string>(mode === "courier" ? first : "");
  const [reason, setReason] = useState<DeliveryFailReason | null>(mode === "courier" ? "asked_reschedule" : null);
  const [note, setNote] = useState("");

  const dayOk = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= first && date <= last;
  const problem = deliveryFailInputError(reason, note);
  const ready = dayOk && problem === null && !busy;
  const hint = !dayOk
    ? (mode === "courier"
      ? t(`Выберите день: с завтра и не дальше ${RESCHEDULE_MAX_DAYS} дней`, `Kunni tanlang: ertadan boshlab, ${RESCHEDULE_MAX_DAYS} kundan oshmasin`)
      : t(`Выберите день: с сегодня и не дальше ${RESCHEDULE_MAX_DAYS} дней`, `Kunni tanlang: bugundan boshlab, ${RESCHEDULE_MAX_DAYS} kundan oshmasin`))
    : noteHint(problem, t);

  const submit = () => {
    if (!ready) return;
    const text = note.trim();
    onConfirm({ date, ...(reason ? { reasonCode: reason } : {}), ...(text ? { note: text } : {}) });
  };

  return (
    <DeliverySheet
      title={t("Перенести доставку", "Yetkazishni ko'chirish")}
      subtitle={[orderNumber, shopName, current ? t(`сейчас: ${planDayLabel(current, today, "ru")}`, `hozir: ${planDayLabel(current, today, "uz")}`) : null].filter(Boolean).join(" · ")}
      dirty={note.trim().length > 0}
      onClose={onCancel}
      testId="reschedule-dialog"
      footer={<>
        <button type="button" onClick={submit} disabled={!ready} aria-disabled={!ready}
          className="neo-btn-primary tap flex-1 flex items-center justify-center gap-1.5 disabled:opacity-40"
          style={{ minHeight: 48, minWidth: 180 }} data-testid="reschedule-confirm">
          <CalendarClock size={16} />
          {busy ? t("Отправка...", "Yuborilmoqda...") : dayOk ? t(`Перенести на ${planDayLabel(date, today, "ru")}`, `${planDayLabel(date, today, "uz")} ga ko'chirish`) : t("Перенести", "Ko'chirish")}
        </button>
      </>}
    >
      <span className="font-label text-[10px] text-secondary mb-1.5 block">{t("На какой день", "Qaysi kunga")}</span>
      <div role="radiogroup" aria-label={t("День", "Kun")} className="flex flex-wrap gap-2">
        {chips.map(d => {
          const on = d === date;
          return (
            <button key={d} type="button" role="radio" aria-checked={on} onClick={() => setDate(d)}
              className="neo-btn tap" data-testid={`reschedule-day-${d}`}
              style={{ minHeight: 44, padding: "0 14px", borderRadius: 12, fontSize: 13, fontWeight: 600,
                       color: on ? "var(--color-primary-text)" : "var(--color-text-primary)",
                       background: on ? "color-mix(in srgb, var(--color-primary) 14%, var(--color-surface))" : undefined }}>
              {planDayLabel(d, today, lang)}
            </button>
          );
        })}
      </div>
      <label htmlFor={`${id}-date`} className="font-label text-[10px] text-secondary mt-3 mb-1.5 block">{t("Или другой день", "Yoki boshqa kun")}</label>
      <input id={`${id}-date`} type="date" min={first} max={last} value={date} onChange={e => setDate(e.target.value)}
        className="neo-input w-full sm:w-56" data-testid="reschedule-date" />

      <span className="font-label text-[10px] text-secondary mt-4 mb-1.5 block">
        {mode === "courier" ? t("Почему", "Nega") : t("Почему (необязательно)", "Nega (ixtiyoriy)")}
      </span>
      <ReasonChips value={reason} onChange={setReason} lang={lang} testPrefix="reschedule-reason" />
      <NoteField id={`${id}-note`} value={note} onChange={setNote} required={reason === "other"} />
      {hint && <p role="status" style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "12px 0 0" }} data-testid="reschedule-hint">{hint}</p>}
    </DeliverySheet>
  );
}
