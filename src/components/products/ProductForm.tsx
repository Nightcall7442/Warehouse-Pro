import { useRef, useState } from "react";
import { Package, Camera, X, Loader2 } from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { notify } from "@/lib/toast";
import { COLORS, SHADOW, F, UNITS } from "./constants";

export interface ProductFormProps {
  onSave: (d: Record<string, unknown>) => void;
  onCancel: () => void;
  isPending: boolean;
  lang: string;
}

export function ProductForm({ onSave, onCancel, isPending, lang }: ProductFormProps) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [d, setD] = useState({ code: "", barcode: "", name: "", category: "", costPrice: "", unitPrice: "", unit: "pcs", unitWeight: "", reorderPoint: "10.00", description: "" });
  const [photo, setPhoto] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const handlePhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (file.size > 2 * 1024 * 1024) { notify.error("Макс. 2 МБ"); return; }
    const r = new FileReader(); r.onload = () => setPhoto(r.result as string); r.readAsDataURL(file);
  };
  return (
    <div style={{
      background: COLORS.surface, borderRadius: "24px", padding: "24px",
      boxShadow: SHADOW, animation: "slideUp 0.5s ease forwards",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
          {t("Новый товар", "Yangi mahsulot")}
        </h2>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
          <X size={18} style={{ color: COLORS.textSecondary }} />
        </button>
      </div>
      <div style={{ display: "flex", gap: "16px" }}>
        <div style={{ flexShrink: 0 }}>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handlePhoto} />
          <div style={{
            width: "80px", height: "80px", borderRadius: "16px", overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", position: "relative",
            background: "rgba(75,108,246,.08)",
            border: "1px solid var(--color-border, #f0f3f8)",
          }} onClick={() => fileRef.current?.click()}>
            {photo ? <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Package size={28} style={{ color: COLORS.primary }} />}
            <div style={{
              position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)",
              opacity: 0, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: "4px",
              transition: "opacity 0.2s", borderRadius: "16px",
            }}>
              <Camera size={16} color="#fff" />
              <span style={{ color: "#fff", fontSize: "9px" }}>{t("Фото", "Rasm")}</span>
            </div>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px", flex: 1 }}>
          <input className="neo-input" placeholder={t("Код *", "Kod *")} value={d.code} onChange={e => setD({ ...d, code: e.target.value })} />
          <input className="neo-input" placeholder={t("Штрих-код (необязательно)", "Shtrix-kod (ixtiyoriy)")} value={d.barcode} onChange={e => setD({ ...d, barcode: e.target.value })} />
          <input className="neo-input" placeholder={t("Название *", "Nomi *")} value={d.name} onChange={e => setD({ ...d, name: e.target.value })} />
          <input className="neo-input" placeholder={t("Категория", "Kategoriya")} value={d.category} onChange={e => setD({ ...d, category: e.target.value })} />
          <PremiumSelect value={d.unit} onChange={v => setD({ ...d, unit: v })}
            options={UNITS.map(u => ({ value: u.value, label: lang === "uz" ? u.uz : u.ru }))}
            width="100%" />
          <input className="neo-input font-data" placeholder={t("Себестоимость", "Tannarx")} type="number" step="0.01" value={d.costPrice} onChange={e => setD({ ...d, costPrice: e.target.value })} />
          <input className="neo-input font-data" placeholder={t("Цена продажи *", "Sotish narxi *")} type="number" step="0.01" value={d.unitPrice} onChange={e => setD({ ...d, unitPrice: e.target.value })} />
          <input className="neo-input font-data" placeholder={t("Масса 1 ед. в кг (ящик=8)", "1 dona vazni, kg")} type="number" step="0.001" value={d.unitWeight} onChange={e => setD({ ...d, unitWeight: e.target.value })} />
          <input className="neo-input font-data" placeholder={t("Порог дозаказа", "Qayta buyurtma chegarasi")} type="number" value={d.reorderPoint} onChange={e => setD({ ...d, reorderPoint: e.target.value })} />
          <input className="neo-input sm:col-span-2" placeholder={t("Описание", "Tavsif")} value={d.description} onChange={e => setD({ ...d, description: e.target.value })} />
        </div>
      </div>
      <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
        <button onClick={() => d.code && d.name && d.unitPrice && onSave({ ...d, photoUrl: photo ?? undefined })} disabled={isPending}
          className="neo-btn-primary flex-1 sm:flex-none flex items-center justify-center gap-2">
          {isPending && <Loader2 size={14} className="animate-spin" />}{t("Сохранить", "Saqlash")}
        </button>
        <button onClick={onCancel} className="neo-btn flex-1 sm:flex-none">{t("Отмена", "Bekor qilish")}</button>
      </div>
    </div>
  );
}
