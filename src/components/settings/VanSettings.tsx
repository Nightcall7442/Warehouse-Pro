import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { useCurrency } from "@/hooks/useCurrency";
import { PremiumSelect } from "@/components/PremiumSelect";
import { FieldGroup, Field, FieldRow, SaveBar } from "./ui";
import { Truck, Plus, Pencil } from "lucide-react";

/*
  Ван-селлинг — тумблер и машины.

  Машина — это склад с водителем: грузится под его PIN, продаёт «с колёс»,
  вечером пересчитывается — недостача становится долгом водителя в кассе.
  Тариф Pro и Exclusive; пробный — всё. Basic видит тумблер и подсказку.
*/
export function VanSettings() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();
  const utils = trpc.useUtils();
  const status = trpc.van.status.useQuery();
  const vans = trpc.van.list.useQuery();
  const drivers = trpc.user.list.useQuery({ page: 1, pageSize: 200 });
  const refresh = () => { utils.van.status.invalidate(); utils.van.list.invalidate(); utils.warehouseMulti.list.invalidate(); };
  const setEnabled = trpc.van.setEnabled.useMutation({ onSuccess: (_, v) => { refresh(); notify.success(v.enabled ? t("Ван-селлинг включён", "Van-selling yoqildi") : t("Ван-селлинг выключен", "Van-selling o'chirildi")); }, onError: e => notify.error(e.message) });
  const save = trpc.van.save.useMutation({ onSuccess: () => { refresh(); setForm(null); notify.success(t("Машина сохранена", "Mashina saqlandi")); }, onError: e => notify.error(e.message) });

  const [form, setForm] = useState<{ id?: number; name: string; plate: string; driverId: string; status: "active" | "inactive" } | null>(null);
  const enabled = status.data?.enabled ?? false;
  const planAllows = status.data?.planAllows ?? true;
  const driverOptions = [{ value: "", label: t("— без водителя —", "— haydovchisiz —") }, ...(drivers.data?.data ?? [])
    .filter(u => ["courier", "agent", "supervisor"].includes(u.role) && u.status === "active")
    .map(u => ({ value: String(u.id), label: `${u.name} · ${u.role === "courier" ? t("курьер", "kuryer") : u.role === "agent" ? t("агент", "agent") : t("супервайзер", "supervayzer")}` }))];

  return (
    <div>
      <FieldGroup first title={t("Ван-селлинг", "Van-selling")}>
        <p className="text-sm text-secondary max-w-prose -mt-2 mb-4">
          {t("Машина — это склад с водителем. Утром её грузят под PIN водителя, днём он продаёт «с машины», вечером непроданное возвращается и машина пересчитывается: чего нет — долг водителя, как недостача по кассе.",
             "Mashina — haydovchili ombor. Ertalab haydovchi PIN-i bilan yuklanadi, kunduzi u «mashinadan» sotadi, kechqurun sotilmagani qaytariladi va mashina sanaladi: yo'q narsa — haydovchi qarzi, kassa kamomadi kabi.")}
        </p>
        <label className="flex items-center gap-3 text-sm text-primary" style={{ cursor: planAllows ? "pointer" : "not-allowed", opacity: planAllows ? 1 : 0.7 }}>
          <input type="checkbox" checked={enabled} disabled={!planAllows || setEnabled.isPending} data-testid="van-enabled"
            onChange={e => setEnabled.mutate({ enabled: e.target.checked })} style={{ width: "18px", height: "18px", accentColor: "var(--color-primary)" }} />
          <span>{t("Включить ван-селлинг", "Van-sellingni yoqish")}</span>
          {!planAllows && <span className="text-xs" style={{ color: "var(--color-warning-text)" }}>{t("Доступно на тарифах Pro и Exclusive", "Pro va Exclusive tariflarida")}</span>}
        </label>
        {enabled && (
          <p className="text-xs text-tertiary mt-2">{t("Машины появятся во вкладке «Машины» на складе, а в заказах — кнопка «С машины».", "Mashinalar omborda «Mashinalar» bo'limida, buyurtmalarda esa «Mashinadan» tugmasi paydo bo'ladi.")}</p>
        )}
      </FieldGroup>

      {enabled && (
        <FieldGroup title={t("Машины", "Mashinalar")}>
          <div className="space-y-2">
            {(vans.data ?? []).map(v => (
              <div key={v.id} className="flex flex-wrap items-center gap-3 p-3 rounded-xl text-sm" style={{ background: "var(--color-surface-light)", opacity: v.status === "active" ? 1 : 0.6 }} data-testid={`van-row-${v.id}`}>
                <Truck size={16} style={{ color: "var(--color-primary-text)" }} />
                <span className="font-semibold text-primary" style={{ minWidth: 140 }}>{v.name}{v.plate ? <span className="font-data text-tertiary"> · {v.plate}</span> : null}</span>
                <span className="text-secondary" style={{ flex: 1, minWidth: 140 }}>{v.driverName ?? t("без водителя", "haydovchisiz")}</span>
                <span className="font-data text-secondary">{v.units > 0 ? `${v.items} ${t("поз.", "poz.")} · ${fmt(v.value)}` : t("пусто", "bo'sh")}</span>
                <button type="button" className="neo-btn neo-btn-xs" aria-label={t("Редактировать машину", "Mashinani tahrirlash")} onClick={() => setForm({ id: v.id, name: v.name, plate: v.plate ?? "", driverId: v.driverId ? String(v.driverId) : "", status: v.status as "active" | "inactive" })}><Pencil size={12} /></button>
              </div>
            ))}
            {vans.data?.length === 0 && !form && <p className="text-sm text-tertiary">{t("Машин пока нет — заведите первую.", "Hali mashina yo'q — birinchisini qo'shing.")}</p>}
          </div>
          {form ? (
            <div className="mt-4">
              <FieldRow>
                <Field label={t("Название", "Nomi")}><input className="neo-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t("Газель 1", "Gazel 1")} data-testid="van-name" /></Field>
                <Field label={t("Госномер", "Davlat raqami")}><input className="neo-input font-data" value={form.plate} onChange={e => setForm({ ...form, plate: e.target.value })} placeholder="01 A 123 AA" /></Field>
                <Field label={t("Водитель", "Haydovchi")}><PremiumSelect value={form.driverId} onChange={v => setForm({ ...form, driverId: v })} options={driverOptions} width="100%" /></Field>
                {form.id && <Field label={t("Состояние", "Holat")}><PremiumSelect value={form.status} onChange={v => setForm({ ...form, status: v as "active" | "inactive" })} options={[{ value: "active", label: t("В работе", "Ishda") }, { value: "inactive", label: t("Выключена", "O'chirilgan") }]} width="100%" /></Field>}
              </FieldRow>
              <SaveBar onSave={() => save.mutate({ id: form.id, name: form.name, plate: form.plate || null, driverId: form.driverId ? Number(form.driverId) : null, status: form.id ? form.status : undefined })}
                isPending={save.isPending} disabled={!form.name.trim()} label={form.id ? t("Сохранить", "Saqlash") : t("Добавить машину", "Mashina qo'shish")}
                hint={t("Водитель подтверждает загрузку своим PIN — тем же, что при сдаче наличных; он заводит его в профиле.", "Haydovchi yuklashni PIN bilan tasdiqlaydi — naqd topshirishdagi bilan bir xil; uni profilda kiritadi.")} />
              <button type="button" className="neo-btn neo-btn-sm mt-2" onClick={() => setForm(null)}>{t("Отмена", "Bekor")}</button>
            </div>
          ) : (
            <button type="button" className="neo-btn mt-4" onClick={() => setForm({ name: "", plate: "", driverId: "", status: "active" })} data-testid="van-add"><Plus size={14} />{t("Добавить машину", "Mashina qo'shish")}</button>
          )}
        </FieldGroup>
      )}
    </div>
  );
}
