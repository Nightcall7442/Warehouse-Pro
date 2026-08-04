import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Calendar, Bookmark, Save } from "lucide-react";
import { useTranslate } from "@/i18n";
import { F, COLORS } from "./theme";

export interface ActiveFilters {
  datePreset?: string;
  status?: string;
  paymentMethod?: string;
  paymentStatus?: string;
}

interface Props {
  filters: ActiveFilters;
  onChange: (filters: ActiveFilters) => void;
  savedFilters?: Array<{ id: number; name: string; filterConfig: unknown }>;
  onSave?: (name: string, config: ActiveFilters) => void;
  onDelete?: (id: number) => void;
  onLoad?: (config: ActiveFilters) => void;
}

const DATE_PRESETS = [
  { value: "today", labelRu: "Сегодня", labelUz: "Bugun" },
  { value: "yesterday", labelRu: "Вчера", labelUz: "Kecha" },
  { value: "week", labelRu: "Эта неделя", labelUz: "Bu hafta" },
  { value: "month", labelRu: "Этот месяц", labelUz: "Bu oy" },
];

const STATUS_CHIPS = [
  { value: "new", labelRu: "Новые", labelUz: "Yangi", color: "#5b6d8a" },
  { value: "processing", labelRu: "В обработке", labelUz: "Jarayonda", color: "#d4973a" },
  { value: "shipped", labelRu: "Отгружены", labelUz: "Yuklangan", color: "#9b59b6" },
  { value: "delivered", labelRu: "Доставлены", labelUz: "Yetkazildi", color: "#34c473" },
  { value: "cancelled", labelRu: "Отменённые", labelUz: "Bekor qilingan", color: "#d45050" },
];

const PAYMENT_CHIPS = [
  { value: "cash", labelRu: "Наличные", labelUz: "Naqd" },
  { value: "card", labelRu: "Карта", labelUz: "Karta" },
  { value: "transfer", labelRu: "Перевод", labelUz: "O'tkazma" },
  { value: "debt", labelRu: "В долг", labelUz: "Qarzga" },
];

function chipStyle(active: boolean, activeColor?: string): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: "4px",
    height: "28px", padding: "0 12px", borderRadius: "9999px",
    fontFamily: F.body, fontSize: "12px", fontWeight: 600,
    cursor: "pointer", whiteSpace: "nowrap",
    background: active ? `${activeColor ?? COLORS.primary}15` : COLORS.surface,
    color: active ? (activeColor ?? COLORS.primary) : COLORS.textSecondary,
    border: `1px solid ${active ? `${activeColor ?? COLORS.primary}30` : COLORS.border}`,
  };
}

export function OrderFilterChips({ filters, onChange, savedFilters, onSave, onLoad }: Props) {
  const t = useTranslate();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");

  const activeCount = Object.values(filters).filter(Boolean).length;

  const toggle = (key: keyof ActiveFilters, value: string) => {
    onChange({ ...filters, [key]: filters[key] === value ? undefined : value });
  };

  const clear = () => onChange({});

  const remove = (key: keyof ActiveFilters) => {
    const next = { ...filters };
    delete next[key];
    onChange(next);
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
      {/* Date presets */}
      {DATE_PRESETS.map(p => (
        <button key={p.value} type="button" style={chipStyle(filters.datePreset === p.value)} onClick={() => toggle("datePreset", p.value)}>
          <Calendar size={12} />
          {t(p.labelRu, p.labelUz)}
        </button>
      ))}

      <div style={{ width: "1px", height: "20px", background: COLORS.border, margin: "0 4px" }} />

      {/* Status chips */}
      {STATUS_CHIPS.map(s => (
        <button key={s.value} type="button" style={chipStyle(filters.status === s.value, s.color)} onClick={() => toggle("status", s.value)}>
          {t(s.labelRu, s.labelUz)}
        </button>
      ))}

      <div style={{ width: "1px", height: "20px", background: COLORS.border, margin: "0 4px" }} />

      {/* Payment chips */}
      {PAYMENT_CHIPS.map(p => (
        <button key={p.value} type="button" style={chipStyle(filters.paymentMethod === p.value)} onClick={() => toggle("paymentMethod", p.value)}>
          {t(p.labelRu, p.labelUz)}
        </button>
      ))}

      {/* Active filter tags */}
      {activeCount > 0 && (
        <>
          <div style={{ width: "1px", height: "20px", background: COLORS.border, margin: "0 4px" }} />
          {filters.datePreset && (
            <span style={{ ...chipStyle(true), background: COLORS.surfaceLight, color: COLORS.textSecondary, border: `1px solid ${COLORS.border}` }} onClick={() => remove("datePreset")}>
              {DATE_PRESETS.find(p => p.value === filters.datePreset)?.labelRu}
              <X size={12} />
            </span>
          )}
          {filters.status && (
            <span style={{ ...chipStyle(true), background: COLORS.surfaceLight, color: COLORS.textSecondary, border: `1px solid ${COLORS.border}` }} onClick={() => remove("status")}>
              {STATUS_CHIPS.find(s => s.value === filters.status)?.labelRu}
              <X size={12} />
            </span>
          )}
          {filters.paymentMethod && (
            <span style={{ ...chipStyle(true), background: COLORS.surfaceLight, color: COLORS.textSecondary, border: `1px solid ${COLORS.border}` }} onClick={() => remove("paymentMethod")}>
              {PAYMENT_CHIPS.find(p => p.value === filters.paymentMethod)?.labelRu}
              <X size={12} />
            </span>
          )}
          <button type="button" onClick={clear} style={{ background: "transparent", border: "none", cursor: "pointer", fontFamily: F.body, fontSize: "12px", fontWeight: 600, color: COLORS.textTertiary, padding: "0 4px" }}>
            {t("Сбросить", "Tozalash")}
          </button>
        </>
      )}

      {/* Save filter */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "4px" }}>
        {savedFilters && savedFilters.length > 0 && (
          <Select onValueChange={v => {
            const f = savedFilters.find(sf => sf.id === Number(v));
            if (f && onLoad) onLoad(f.filterConfig as ActiveFilters);
          }}>
            <SelectTrigger style={{ height: "28px", width: "auto", fontFamily: F.body, fontSize: "12px", borderRadius: "9999px", border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary }}>
              <Bookmark size={12} />
              <SelectValue placeholder={t("Сохранённые", "Saqlangan")} />
            </SelectTrigger>
            <SelectContent>
              {savedFilters.map(f => (
                <SelectItem key={f.id} value={String(f.id)} style={{ fontSize: "12px" }}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {activeCount > 0 && onSave && (
          <Popover open={saveOpen} onOpenChange={setSaveOpen}>
            <PopoverTrigger asChild>
              <button type="button" style={{ display: "inline-flex", alignItems: "center", gap: "4px", height: "28px", padding: "0 10px", borderRadius: "9999px", background: "transparent", border: "none", cursor: "pointer", fontFamily: F.body, fontSize: "12px", fontWeight: 600, color: COLORS.textTertiary }}>
                <Save size={12} />
                {t("Сохранить", "Saqlash")}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-60" align="end" style={{ fontFamily: F.body }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <input
                  style={{ width: "100%", padding: "6px 8px", fontSize: "13px", border: `1px solid ${COLORS.border}`, borderRadius: "8px", fontFamily: F.body, color: COLORS.textPrimary }}
                  placeholder={t("Название фильтра", "Filter nomi")}
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (saveName.trim()) {
                      onSave(saveName.trim(), filters);
                      setSaveName("");
                      setSaveOpen(false);
                    }
                  }}
                  style={{
                    width: "100%", padding: "8px", borderRadius: "10px", border: "none",
                    background: `linear-gradient(135deg, ${COLORS.primary}, #7b94f8)`, color: "var(--color-on-primary, #fff)",
                    fontFamily: F.body, fontSize: "13px", fontWeight: 600, cursor: "pointer",
                  }}
                >
                  {t("Сохранить", "Saqlash")}
                </button>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
