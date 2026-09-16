import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { useCurrency } from "@/hooks/useCurrency";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { FieldGroup, Field, FieldRow, SaveBar } from "./ui";
import { Boxes, Plus, Pencil } from "lucide-react";

/*
  Возвратная тара — тумблер и виды.

  Две правды: штуки и залог. Залог — свойство вида: ноль — фирма считает
  только штуками, больше нуля — штуки и деньги. Тара следует за товаром по
  всем движениям сама; руками — только приём пустой тары и списание
  невозвращённой в долг. Тариф Pro и Exclusive; пробный — всё.
*/
export function TareSettings() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { fmt } = useCurrency();
  const utils = trpc.useUtils();
  const status = trpc.tare.status.useQuery();
  const types = trpc.tare.types.useQuery();
  const refresh = () => { utils.tare.status.invalidate(); utils.tare.types.invalidate(); utils.tare.overview.invalidate(); };
  const setEnabled = trpc.tare.setEnabled.useMutation({ onSuccess: (_, v) => { refresh(); notify.success(v.enabled ? t("Учёт тары включён", "Idish hisobi yoqildi") : t("Учёт тары выключен", "Idish hisobi o'chirildi")); }, onError: e => notify.error(e.message) });
  const save = trpc.tare.saveType.useMutation({ onSuccess: () => { refresh(); setForm(null); notify.success(t("Вид тары сохранён", "Idish turi saqlandi")); }, onError: e => notify.error(e.message) });
  const [form, setForm] = useState<{ id?: number; name: string; deposit: string; isActive: boolean } | null>(null);
  const enabled = status.data?.enabled ?? false;
  const planAllows = status.data?.planAllows ?? true;

  return (
    <div>
      <FieldGroup first title={t("Возвратная тара", "Qaytariladigan idish")}>
        <p className="text-sm text-secondary max-w-prose -mt-2 mb-4">
          {t("Бутылки, ящики, кеги уходят магазину с товаром и должны вернуться. Тара следует за товаром сама: приход, загрузка машины, продажа, возврат, пересчёт. Отдельно — приём пустой тары от магазина и списание невозвращённой в долг.",
             "Butilka, yashik, keg tovar bilan do'konga ketadi va qaytishi kerak. Idish tovar ortidan o'zi yuradi: kirim, mashina yuklash, sotuv, qaytarish, sanash. Alohida — do'kondan bo'sh idishni qabul qilish va qaytarilmaganini qarzga yozish.")}
        </p>
        <label className="flex items-center gap-3 text-sm text-primary" style={{ cursor: planAllows ? "pointer" : "not-allowed", opacity: planAllows ? 1 : 0.7 }}>
          <input type="checkbox" checked={enabled} disabled={!planAllows || setEnabled.isPending} data-testid="tare-enabled"
            onChange={e => setEnabled.mutate({ enabled: e.target.checked })} style={{ width: "18px", height: "18px", accentColor: "var(--color-primary)" }} />
          <span>{t("Включить учёт тары", "Idish hisobini yoqish")}</span>
          {!planAllows && <span className="text-xs" style={{ color: "var(--color-warning-text)" }}>{t("Доступно на тарифах Pro и Exclusive", "Pro va Exclusive tariflarida")}</span>}
        </label>
      </FieldGroup>

      {enabled && (
        <FieldGroup title={t("Виды тары", "Idish turlari")}>
          <p className="text-xs text-tertiary -mt-2 mb-3">{t("Залог 0 — считаем только штуками. Больше нуля — штуки и деньги: невозвращённая тара списывается в долг магазина по залогу.", "Garov 0 — faqat dona hisoblanadi. Noldan katta — dona va pul: qaytarilmagan idish garov bo'yicha do'kon qarziga yoziladi.")}</p>
          <div className="space-y-2">
            {(types.data ?? []).map(x => (
              <div key={x.id} className="flex flex-wrap items-center gap-3 p-3 rounded-xl text-sm" style={{ background: "var(--color-surface-light)", opacity: x.isActive ? 1 : 0.6 }} data-testid={`tare-type-${x.id}`}>
                <Boxes size={16} style={{ color: "var(--color-primary-text)" }} />
                <span className="font-semibold text-primary" style={{ flex: 1, minWidth: 140 }}>{x.name}</span>
                <span className="font-data text-secondary">{x.depositPrice > 0 ? `${t("залог", "garov")} ${fmt(x.depositPrice)}` : t("только штуками", "faqat dona")}</span>
                <button type="button" className="neo-btn neo-btn-xs" aria-label={t("Редактировать вид тары", "Idish turini tahrirlash")} onClick={() => setForm({ id: x.id, name: x.name, deposit: String(x.depositPrice || ""), isActive: x.isActive })}><Pencil size={12} /></button>
              </div>
            ))}
            {types.data?.length === 0 && !form && <p className="text-sm text-tertiary">{t("Видов тары пока нет — заведите первый: «Бутылка 0,5», «Ящик», «Кег».", "Hali idish turi yo'q — birinchisini qo'shing: «Butilka 0,5», «Yashik», «Keg».")}</p>}
          </div>
          {form ? (
            <div className="mt-4">
              <FieldRow>
                <Field label={t("Название", "Nomi")}><input className="neo-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={t("Бутылка 0,5", "Butilka 0,5")} data-testid="tare-name" /></Field>
                <Field label={t("Залог за штуку (0 — только штуками)", "Bir dona garovi (0 — faqat dona)")}><DecimalInput className="neo-input font-data" value={form.deposit} onValueChange={v => setForm({ ...form, deposit: v })} placeholder="0" data-testid="tare-deposit" /></Field>
              </FieldRow>
              {form.id && <label className="flex items-center gap-2 text-sm mt-3"><input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} /> {t("В работе", "Ishda")}</label>}
              <SaveBar onSave={() => save.mutate({ id: form.id, name: form.name, depositPrice: Number(form.deposit) || 0, isActive: form.isActive })} isPending={save.isPending} disabled={!form.name.trim()} label={form.id ? t("Сохранить", "Saqlash") : t("Добавить вид", "Tur qo'shish")}
                hint={t("Тара назначается товару в его карточке: вид и сколько штук на единицу.", "Idish tovarga uning kartochkasida belgilanadi: turi va birlikka nechta.")} />
              <button type="button" className="neo-btn neo-btn-sm mt-2" onClick={() => setForm(null)}>{t("Отмена", "Bekor")}</button>
            </div>
          ) : (
            <button type="button" className="neo-btn mt-4" onClick={() => setForm({ name: "", deposit: "", isActive: true })} data-testid="tare-add"><Plus size={14} />{t("Добавить вид тары", "Idish turi qo'shish")}</button>
          )}
        </FieldGroup>
      )}
    </div>
  );
}
