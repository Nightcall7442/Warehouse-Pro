import { useRef, useState, useCallback } from "react";
import { notify } from "@/lib/toast";
import { Store, Camera, Loader2, X, MapPin } from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { F, COLORS, SHADOW } from "./constants";

export interface ShopFormData { name: string; ownerName: string; phone: string; address: string; city: string; district: string; agentId: number | undefined; territoryId: number | undefined; notes: string; photoUrl?: string; telegramLink?: string; gpsLat?: string; gpsLng?: string; }
export interface AgentOption { id: number; name: string; }
export interface TerritoryOption { id: number; name: string; color?: string | null; }

export function ShopForm({ onSave, onCancel, isPending, lang, agents, territories = [] }: {
  onSave: (d: ShopFormData) => void; onCancel: () => void; isPending: boolean; lang: string; agents: AgentOption[]; territories?: TerritoryOption[];
}) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [d, setD] = useState({ name: "", ownerName: "", phone: "", address: "", city: "", district: "", agentId: "", territoryId: "", notes: "" });
  const [telegramLink, setTelegramLink] = useState("");
  const [parsedGps, setParsedGps] = useState<{ lat: number; lng: number } | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const parseGpsFromLink = useCallback(function parseLink(link: string): void {
    if (!link.trim()) { setParsedGps(null); return; }
    // Try to parse GPS from various URL formats
    try {
      const url = new URL(link.trim());
      // Google Maps: ?q=lat,lng
      const q = url.searchParams.get("q") || url.searchParams.get("query");
      if (q) {
        const parts = q.split(",").map(Number);
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && Math.abs(parts[0]) <= 90 && Math.abs(parts[1]) <= 180) {
          setParsedGps({ lat: parts[0], lng: parts[1] });
          return;
        }
      }
      // Yandex Maps: ?pt=lng,lat
      const pt = url.searchParams.get("pt");
      if (pt) {
        const parts = pt.split(",").map(Number);
        if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && Math.abs(parts[1]) <= 90 && Math.abs(parts[0]) <= 180) {
          setParsedGps({ lat: parts[1], lng: parts[0] });
          return;
        }
      }
      // Telegram share: ?url=<encoded>
      const innerUrl = url.searchParams.get("url");
      if (innerUrl) {
        parseLink(decodeURIComponent(innerUrl));
        return;
      }
      // Google Maps @lat,lng in path
      const atMatch = link.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
      if (atMatch) {
        const lat = parseFloat(atMatch[1]);
        const lng = parseFloat(atMatch[2]);
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          setParsedGps({ lat, lng });
          return;
        }
      }
    } catch {
      // Not a valid URL — try regex
      const fallback = link.match(/(-?\d+\.\d{4,})\s*[,;]\s*(-?\d+\.\d{4,})/);
      if (fallback) {
        const lat = parseFloat(fallback[1]);
        const lng = parseFloat(fallback[2]);
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          setParsedGps({ lat, lng });
          return;
        }
      }
    }
    setParsedGps(null);
  }, []);
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
            background: "color-mix(in srgb, var(--color-primary) 8%, transparent)",
          }} onClick={() => fileRef.current?.click()}>
            {photo ? <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Store size={28} style={{ color: COLORS.primaryText }} />}
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
          <div style={{ gridColumn: "span 2", position: "relative" }}>
            <input className="neo-input" placeholder={t("Telegram ссылка (для GPS)", "Telegram havolasi (GPS uchun)")} value={telegramLink}
              onChange={e => { setTelegramLink(e.target.value); parseGpsFromLink(e.target.value); }}
              style={{ paddingRight: parsedGps ? "32px" : undefined }} />
            {parsedGps && (
              <div style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: "4px" }}>
                <MapPin size={14} style={{ color: COLORS.success }} />
                <span style={{ fontSize: "10px", color: COLORS.success }}>{parsedGps.lat.toFixed(4)}, {parsedGps.lng.toFixed(4)}</span>
              </div>
            )}
          </div>
          {agents.length > 0 && (
            <PremiumSelect value={d.agentId} onChange={v => setD({ ...d, agentId: v })}
              options={[{ value: "", label: t("— Агент —", "— Agent —") }, ...(agents ?? []).map((a: AgentOption) => ({ value: String(a.id), label: String(a.name) }))]}
              width="100%" />
          )}
          {territories.length > 0 && (
            <PremiumSelect value={d.territoryId} onChange={v => setD({ ...d, territoryId: v })}
              options={[{ value: "", label: t("— Территория —", "— Territoriya —") }, ...territories.map((ter: TerritoryOption) => ({ value: String(ter.id), label: ter.name }))]}
              width="100%" />
          )}
          <textarea className="neo-input resize-none" style={{ gridColumn: "span 2" }} rows={2} placeholder={t("Заметки", "Izoh")} value={d.notes} onChange={e => setD({ ...d, notes: e.target.value })} />
        </div>
      </div>
      <div style={{ display: "flex", gap: "12px", marginTop: "20px" }}>
        <button onClick={() => d.name && onSave({ ...d, agentId: d.agentId ? Number(d.agentId) : undefined, territoryId: d.territoryId ? Number(d.territoryId) : undefined, photoUrl: photo ?? undefined, telegramLink: telegramLink || undefined, gpsLat: parsedGps ? String(parsedGps.lat) : undefined, gpsLng: parsedGps ? String(parsedGps.lng) : undefined } as ShopFormData)}
          disabled={isPending} className="neo-btn-primary flex-1 sm:flex-none flex items-center justify-center gap-2">
          {isPending && <Loader2 size={14} className="animate-spin" />}{t("Сохранить", "Saqlash")}
        </button>
        <button onClick={onCancel} className="neo-btn flex-1 sm:flex-none">{t("Отмена", "Bekor qilish")}</button>
      </div>
    </div>
  );
}
