import { useRef, useState } from "react";
import { DecimalInput } from "@/components/ui/DecimalInput";
import { Package, Camera, X, Loader2 } from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { CategoryAutocomplete } from "./CategoryAutocomplete";
import { notify } from "@/lib/toast";
import { COLORS, SHADOW, F, UNITS, type Unit } from "./constants";

/**
 * То, что форма отдаёт наружу.
 *
 * Раньше здесь стоял Record<string, unknown>: страница товаров передавала это
 * прямо в product.create, и проверка типов там падала — из мешка неизвестного
 * не видно ни обязательных полей, ни того, что unit это перечисление.
 */
export type ProductDraft = {
  code:         string;
  barcode:      string;
  name:         string;
  category:     string;
  costPrice:    string;
  unitPrice:    string;
  unit:         Unit;
  unitWeight:   string;
  reorderPoint: string;
  description:  string;
  photoUrl?:    string;
};

export interface ProductFormProps {
  onSave: (d: ProductDraft) => void;
  onCancel: () => void;
  isPending: boolean;
  lang: string;
  categories?: string[];
}

function isUnit(v: string): v is Unit {
  return UNITS.some(u => u.value === v);
}

export function ProductForm({ onSave, onCancel, isPending, lang, categories = [] }: ProductFormProps) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [d, setD] = useState<Omit<ProductDraft, "photoUrl">>({ code: "", barcode: "", name: "", category: "", costPrice: "", unitPrice: "", unit: "pcs", unitWeight: "", reorderPoint: "10.00", description: "" });
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
            background: "color-mix(in srgb, var(--color-primary) 8%, transparent)",
            border: "1px solid var(--color-border, #d8d5cd)",
          }} onClick={() => fileRef.current?.click()}>
            {photo ? <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Package size={28} style={{ color: COLORS.primaryText }} />}
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
          <CategoryAutocomplete value={d.category} onChange={v => setD({ ...d, category: v })} categories={categories} placeholder={t("Категория", "Kategoriya")} />
          <PremiumSelect value={d.unit} onChange={v => setD({ ...d, unit: isUnit(v) ? v : d.unit })}
            options={UNITS.map(u => ({ value: u.value, label: lang === "uz" ? u.uz : u.ru }))}
            width="100%" />
          <DecimalInput className="neo-input font-data" placeholder={t("Себестоимость", "Tannarx")} value={d.costPrice} onValueChange={v => setD({ ...d, costPrice: v })} />
          <DecimalInput className="neo-input font-data" placeholder={t("Цена продажи *", "Sotish narxi *")} value={d.unitPrice} onValueChange={v => setD({ ...d, unitPrice: v })} />
          <DecimalInput className="neo-input font-data" placeholder={t("Масса 1 ед. в кг (ящик=8)", "1 dona vazni, kg")} value={d.unitWeight} onValueChange={v => setD({ ...d, unitWeight: v })} />
          <DecimalInput className="neo-input font-data" placeholder={t("Порог дозаказа", "Qayta buyurtma chegarasi")} value={d.reorderPoint} onValueChange={v => setD({ ...d, reorderPoint: v })} />
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
