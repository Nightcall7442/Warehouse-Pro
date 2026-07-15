import { useRef, useState } from "react";
import { notify } from "@/lib/toast";
import { Store, Camera, Loader2, X } from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { F, COLORS, SHADOW } from "./constants";

export interface ShopFormData { name: string; ownerName: string; phone: string; address: string; city: string; district: string; agentId: number | undefined; notes: string; photoUrl?: string; }
export interface AgentOption { id: number; name: string; }

export function ShopForm({ onSave, onCancel, isPending, lang, agents }: {
  onSave: (d: ShopFormData) => void; onCancel: () => void; isPending: boolean; lang: string; agents: AgentOption[];
}) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [d, setD] = useState({ name: "", ownerName: "", phone: "", address: "", city: "", district: "", agentId: "", notes: "" });
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
      boxShadow: SHADOW,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <h2 style={{ fontFamily: F.display, fontSize: "18px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
          {t("Новый магазин", "Yangi do'kon")}
        </h2>
        <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}>
          <X size={18} style={{ color: COLORS.textSecondary }} />
        </button>
      </div>
      <div style={{ display: "flex", gap: "20px" }}>
        {/* Photo */}
        <div style={{ flexShrink: 0 }}>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
          <div style={{
            width: "80px", height: "80px", borderRadius: "16px", overflow: "hidden",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", position: "relative", border: `1px solid ${COLORS.border}`,
            background: "rgba(75,108,246,.08)",
          }} onClick={() => fileRef.current?.click()}>
            {photo ? <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Store size={28} style={{ color: COLORS.primary }} />}
            <div style={{
              position: "absolute", inset: 0, background: "rgba(0,0,0,0.4)",
              opacity: 0, display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", gap: "4px", borderRadius: "16px",
              transition: "opacity 0.2s",
            }} className="group-hover:opacity-100">
              <Camera size={16} color="#fff" /><span style={{ color: "#fff", fontSize: "9px" }}>{t("Фото", "Rasm")}</span>
            </div>
          </div>
          <p style={{ fontSize: "10px", color: COLORS.textSecondary, textAlign: "center", marginTop: "4px" }}>
            {t("Фото магазина", "Do'kon rasmi")}
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px", flex: 1 }}>
          <input className="neo-input" placeholder={t("Название *", "Nomi *")} value={d.name} onChange={e => setD({ ...d, name: e.target.value })} />
          <input className="neo-input" placeholder={t("Владелец", "Egasi")} value={d.ownerName} onChange={e => setD({ ...d, ownerName: e.target.value })} />
          <input className="neo-input" placeholder={t("Телефон", "Telefon")} value={d.phone} onChange={e => setD({ ...d, phone: e.target.value })} />
          <input className="neo-input" placeholder={t("Город", "Shahar")} value={d.city} onChange={e => setD({ ...d, city: e.target.value })} />
          <input className="neo-input" placeholder={t("Район", "Tuman")} value={d.district} onChange={e => setD({ ...d, district: e.target.value })} />
          <input className="neo-input" placeholder={t("Адрес", "Manzil")} value={d.address} onChange={e => setD({ ...d, address: e.target.value })} />
          {agents.length > 0 && (
            <PremiumSelect value={d.agentId} onChange={v => setD({ ...d, agentId: v })}
              options={[{ value: "", label: t("— Агент —", "— Agent —") }, ...(agents ?? []).map((a: AgentOption) => ({ value: String(a.id), label: String(a.name) }))]}
              width="100%" />
          )}
          <textarea className="neo-input resize-none" style={{ gridColumn: "span 2" }} rows={2} placeholder={t("Заметки", "Izoh")} value={d.notes} onChange={e => setD({ ...d, notes: e.target.value })} />
        </div>
      </div>
      <div style={{ display: "flex", gap: "12px", marginTop: "20px" }}>
        <button onClick={() => d.name && onSave({ ...d, agentId: d.agentId ? Number(d.agentId) : undefined, photoUrl: photo ?? undefined } as ShopFormData)}
          disabled={isPending} className="neo-btn-primary flex-1 sm:flex-none flex items-center justify-center gap-2">
          {isPending && <Loader2 size={14} className="animate-spin" />}{t("Сохранить", "Saqlash")}
        </button>
        <button onClick={onCancel} className="neo-btn flex-1 sm:flex-none">{t("Отмена", "Bekor qilish")}</button>
      </div>
    </div>
  );
}
