import { useState } from "react";
import { Loader2 } from "lucide-react";
import { AppModal, modalFieldLabel } from "@/components/ui/AppModal";
import type { CounterpartyRow } from "./CounterpartyList";

export interface CounterpartyFormValues {
  name: string;
  contactName: string;
  phone: string;
  inn: string;
  address: string;
  notes: string;
}

/**
 * Заведение и правка контрагента.
 *
 * Обязательное поле ровно одно — название. Остальное (ИНН, адрес, контактное
 * лицо) в жизни узнают не в момент разгрузки машины, и требовать их сразу
 * значит заставить оператора выдумывать заглушки, которые потом никто не
 * исправит.
 */
export function CounterpartyForm({ open, initial, isPending, onSave, onClose }: {
  open: boolean;
  /** Заполнено — правка существующего, пусто — заведение нового. */
  initial?: CounterpartyRow | null;
  isPending: boolean;
  onSave: (values: CounterpartyFormValues) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<CounterpartyFormValues>({
    name:        initial?.name ?? "",
    contactName: initial?.contactName ?? "",
    phone:       initial?.phone ?? "",
    inn:         initial?.inn ?? "",
    address:     initial?.address ?? "",
    notes:       initial?.notes ?? "",
  });

  const set = (k: keyof CounterpartyFormValues) => (v: string) => setForm(p => ({ ...p, [k]: v }));
  const canSave = form.name.trim().length > 0 && !isPending;
  // Промах мимо окна не должен стирать набранное: dirty у AppModal как раз
  // для этого — закрыть можно крестиком или «Отменой», осознанно.
  const dirty = Object.values(form).some(v => v.trim() !== "");

  return (
    <AppModal
      open={open}
      onClose={onClose}
      dirty={dirty}
      maxWidth={560}
      title={initial ? "Правка контрагента" : "Новый контрагент"}
      subtitle={initial ? initial.name : "Поставщик, у которого закупается товар"}
      footer={
        <>
          <button
            data-testid="counterparty-save"
            onClick={() => canSave && onSave(form)}
            disabled={!canSave}
            className="neo-btn-primary flex-1 h-11 text-sm flex items-center justify-center gap-2"
            style={{ opacity: canSave ? 1 : 0.5 }}
          >
            {isPending && <Loader2 size={15} className="animate-spin" />}
            Сохранить
          </button>
          <button onClick={onClose} className="neo-btn flex-1 h-11 text-sm">Отмена</button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className={modalFieldLabel}>Название *</label>
          <input
            data-testid="counterparty-name"
            className="neo-input"
            style={{ width: "100%" }}
            placeholder="Например: Завод Ташкент"
            value={form.name}
            onChange={e => set("name")(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={modalFieldLabel}>Контактное лицо</label>
            <input className="neo-input" style={{ width: "100%" }} value={form.contactName} onChange={e => set("contactName")(e.target.value)} />
          </div>
          <div>
            <label className={modalFieldLabel}>Телефон</label>
            <input className="neo-input" style={{ width: "100%" }} placeholder="+998 90 123 45 67" value={form.phone} onChange={e => set("phone")(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={modalFieldLabel}>ИНН / СТИР</label>
            <input className="neo-input" style={{ width: "100%" }} value={form.inn} onChange={e => set("inn")(e.target.value)} />
          </div>
          <div>
            <label className={modalFieldLabel}>Адрес</label>
            <input className="neo-input" style={{ width: "100%" }} value={form.address} onChange={e => set("address")(e.target.value)} />
          </div>
        </div>
        <div>
          <label className={modalFieldLabel}>Примечания</label>
          <textarea
            className="neo-input"
            style={{ width: "100%", resize: "none", minHeight: 70 }}
            rows={3}
            value={form.notes}
            onChange={e => set("notes")(e.target.value)}
          />
        </div>
      </div>
    </AppModal>
  );
}
