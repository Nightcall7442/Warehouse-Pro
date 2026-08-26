import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { Loader2, Warehouse, Plus, Star, Pencil, MapPin } from "lucide-react";

export function WarehouseSettings() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const utils = trpc.useUtils();

  const { data: warehouses, isLoading } = trpc.warehouseMulti.list.useQuery();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ name: "", address: "", city: "" });

  const createWarehouse = trpc.warehouseMulti.create.useMutation({
    onSuccess: () => {
      utils.warehouseMulti.list.invalidate();
      setShowForm(false);
      setForm({ name: "", address: "", city: "" });
      notify.success(t("Склад добавлен", "Omborxona qo'shildi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const updateWarehouse = trpc.warehouseMulti.update.useMutation({
    onSuccess: () => {
      utils.warehouseMulti.list.invalidate();
      setEditId(null);
      setForm({ name: "", address: "", city: "" });
      notify.success(t("Склад обновлён", "Omborxona yangilandi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const setDefault = trpc.warehouseMulti.setDefault.useMutation({
    onSuccess: () => {
      utils.warehouseMulti.list.invalidate();
      notify.success(t("Склад по умолчанию установлен", "Standart omborxona o'rnatildi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const handleSubmit = () => {
    if (editId) {
      updateWarehouse.mutate({ id: editId, ...form });
    } else {
      createWarehouse.mutate(form);
    }
  };

  const handleEdit = (wh: { id: number; name: string; address: string | null; city: string | null }) => {
    setEditId(wh.id);
    // Both columns are nullable; the form inputs and the update mutation both want a string.
    setForm({ name: wh.name, address: wh.address ?? "", city: wh.city ?? "" });
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditId(null);
    setForm({ name: "", address: "", city: "" });
  };

  if (isLoading) return <div className="h-32 bg-surface-light animate-pulse rounded-xl" />;

  return (
    <div className="space-y-4">
      {/* Warehouse list */}
      {warehouses && warehouses.length > 0 && (
        <div className="space-y-2">
          {warehouses.map((wh) => (
            <div key={wh.id} className="flex items-center gap-3 px-4 py-3 rounded-lg"
              style={{
                background: wh.isDefault ? "color-mix(in srgb, var(--color-primary) 8%, transparent)" : "var(--color-surface-light, #f6f4f0)",
                border: `1px solid ${wh.isDefault ? "color-mix(in srgb, var(--color-primary) 20%, transparent)" : "var(--color-border, #d8d5cd)"}`,
              }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: wh.isDefault ? "color-mix(in srgb, var(--color-primary) 15%, transparent)" : "var(--color-surface, #efedea)" }}>
                <Warehouse size={16} className={wh.isDefault ? "text-primary" : "text-secondary"} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-primary truncate">{wh.name}</p>
                  {wh.isDefault && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded"
                      style={{ background: "var(--color-primary)", color: "var(--color-on-primary)" }}>
                      {t("Основной", "Asosiy")}
                    </span>
                  )}
                </div>
                {(wh.address || wh.city) && (
                  <p className="text-xs text-secondary mt-0.5 truncate flex items-center gap-1">
                    <MapPin size={11} className="flex-shrink-0 opacity-60" />
                    {[wh.address, wh.city].filter(Boolean).join(", ")}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {!wh.isDefault && (
                  <button onClick={() => setDefault.mutate({ id: wh.id })}
                    disabled={setDefault.isPending}
                    className="neo-btn w-9 h-9 p-0 disabled:opacity-40"
                    aria-label={t("Сделать основным складом", "Asosiy ombor qilish")}
                    title={t("Сделать основным", "Asosiy qilish")}>
                    <Star size={14} />
                  </button>
                )}
                <button onClick={() => handleEdit(wh)}
                  className="neo-btn w-9 h-9 p-0"
                  aria-label={t("Редактировать склад", "Omborxonani tahrirlash")}
                  title={t("Редактировать", "Tahrirlash")}>
                  <Pencil size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {warehouses && warehouses.length === 0 && !showForm && (
        <div className="text-center py-8">
          <Warehouse size={32} className="mx-auto text-secondary opacity-40 mb-3" />
          <p className="text-sm text-secondary">{t("Склады не добавлены", "Omborxonalar qo'shilmagan")}</p>
        </div>
      )}

      {/* Add / Edit form */}
      {showForm && (
        <div className="p-4 rounded-lg space-y-3" style={{ background: "var(--color-surface-light, #f6f4f0)", border: "1px solid var(--color-border, #d8d5cd)" }}>
          <p className="text-sm font-semibold text-primary">
            {editId ? t("Редактировать склад", "Omborxonani tahrirlash") : t("Новый склад", "Yangi omborxona")}
          </p>
          <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
            <div>
              <label className="block text-[13px] font-medium text-secondary mb-1.5">
                {t("Название", "Nomi")}
              </label>
              <input className="neo-input w-full" value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder={t("Например: Основной склад", "Masalan: Asosiy omborxona")} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-secondary mb-1.5">
                {t("Адрес", "Manzil")}
              </label>
              <input className="neo-input w-full" value={form.address}
                onChange={e => setForm({ ...form, address: e.target.value })}
                placeholder={t("Улица, дом", "Ko'cha, uy")} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-secondary mb-1.5">
                {t("Город", "Shahar")}
              </label>
              <input className="neo-input w-full" value={form.city}
                onChange={e => setForm({ ...form, city: e.target.value })}
                placeholder={t("Ташкент", "Toshkent")} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleSubmit}
              disabled={!form.name || createWarehouse.isPending || updateWarehouse.isPending}
              className="neo-btn-primary flex items-center gap-2 text-sm disabled:opacity-40">
              {(createWarehouse.isPending || updateWarehouse.isPending) && <Loader2 size={13} className="animate-spin" />}
              {editId ? t("Сохранить", "Saqlash") : t("Добавить", "Qo'shish")}
            </button>
            <button onClick={handleCancel} className="neo-btn text-sm">
              {t("Отмена", "Bekor qilish")}
            </button>
          </div>
        </div>
      )}

      {/* Add button */}
      {!showForm && (
        <button onClick={() => setShowForm(true)}
          className="neo-btn flex items-center gap-2 text-sm">
          <Plus size={14} />
          {t("Добавить склад", "Omborxona qo'shish")}
        </button>
      )}
    </div>
  );
}
