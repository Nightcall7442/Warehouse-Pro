import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Calendar, Filter, Bookmark, Save } from "lucide-react";
import { useTranslate } from "@/i18n";

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
  { value: "new", labelRu: "Новые", labelUz: "Yangi", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  { value: "processing", labelRu: "В обработке", labelUz: "Jarayonda", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  { value: "shipped", labelRu: "Отгружены", labelUz: "Yuklangan", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  { value: "delivered", labelRu: "Доставлены", labelUz: "Yetkazildi", color: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  { value: "cancelled", labelRu: "Отменённые", labelUz: "Bekor qilingan", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
];

const PAYMENT_CHIPS = [
  { value: "cash", labelRu: "Наличные", labelUz: "Naqd" },
  { value: "card", labelRu: "Карта", labelUz: "Karta" },
  { value: "transfer", labelRu: "Перевод", labelUz: "O'tkazma" },
  { value: "debt", labelRu: "В долг", labelUz: "Qarzga" },
];

export function OrderFilterChips({ filters, onChange, savedFilters, onSave, onDelete, onLoad }: Props) {
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
    <div className="flex flex-wrap items-center gap-2 mb-3">
      {/* Date presets */}
      {DATE_PRESETS.map(p => (
        <Button
          key={p.value}
          variant={filters.datePreset === p.value ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs rounded-full"
          onClick={() => toggle("datePreset", p.value)}
        >
          <Calendar className="h-3 w-3 mr-1" />
          {t(p.labelRu, p.labelUz)}
        </Button>
      ))}

      <div className="w-px h-5 bg-border mx-1" />

      {/* Status chips */}
      {STATUS_CHIPS.map(s => (
        <Button
          key={s.value}
          variant="outline"
          size="sm"
          className={`h-7 text-xs rounded-full ${filters.status === s.value ? s.color : ""}`}
          onClick={() => toggle("status", s.value)}
        >
          {t(s.labelRu, s.labelUz)}
        </Button>
      ))}

      <div className="w-px h-5 bg-border mx-1" />

      {/* Payment chips */}
      {PAYMENT_CHIPS.map(p => (
        <Button
          key={p.value}
          variant={filters.paymentMethod === p.value ? "default" : "outline"}
          size="sm"
          className="h-7 text-xs rounded-full"
          onClick={() => toggle("paymentMethod", p.value)}
        >
          {t(p.labelRu, p.labelUz)}
        </Button>
      ))}

      {/* Active filter tags */}
      {activeCount > 0 && (
        <>
          <div className="w-px h-5 bg-border mx-1" />
          {filters.datePreset && (
            <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => remove("datePreset")}>
              {DATE_PRESETS.find(p => p.value === filters.datePreset)?.labelRu}
              <X className="h-3 w-3" />
            </Badge>
          )}
          {filters.status && (
            <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => remove("status")}>
              {STATUS_CHIPS.find(s => s.value === filters.status)?.labelRu}
              <X className="h-3 w-3" />
            </Badge>
          )}
          {filters.paymentMethod && (
            <Badge variant="secondary" className="gap-1 cursor-pointer" onClick={() => remove("paymentMethod")}>
              {PAYMENT_CHIPS.find(p => p.value === filters.paymentMethod)?.labelRu}
              <X className="h-3 w-3" />
            </Badge>
          )}
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clear}>
            {t("Сбросить", "Tozalash")}
          </Button>
        </>
      )}

      {/* Save filter */}
      <div className="ml-auto flex items-center gap-1">
        {savedFilters && savedFilters.length > 0 && (
          <Select onValueChange={v => {
            const f = savedFilters.find(sf => sf.id === Number(v));
            if (f && onLoad) onLoad(f.filterConfig as ActiveFilters);
          }}>
            <SelectTrigger className="h-7 w-auto text-xs">
              <Bookmark className="h-3 w-3 mr-1" />
              <SelectValue placeholder={t("Сохранённые", "Saqlangan")} />
            </SelectTrigger>
            <SelectContent>
              {savedFilters.map(f => (
                <SelectItem key={f.id} value={String(f.id)} className="text-xs">
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {activeCount > 0 && onSave && (
          <Popover open={saveOpen} onOpenChange={setSaveOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 text-xs">
                <Save className="h-3 w-3 mr-1" />
                {t("Сохранить", "Saqlash")}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-60" align="end">
              <div className="space-y-2">
                <input
                  className="w-full px-2 py-1 text-sm border rounded"
                  placeholder={t("Название фильтра", "Filter nomi")}
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                />
                <Button size="sm" className="w-full" onClick={() => {
                  if (saveName.trim()) {
                    onSave(saveName.trim(), filters);
                    setSaveName("");
                    setSaveOpen(false);
                  }
                }}>
                  {t("Сохранить", "Saqlash")}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
