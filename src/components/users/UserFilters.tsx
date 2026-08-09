import { Search } from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";
import { COLORS, SHADOW, ROLE_LABELS, type Lang } from "./types";

interface UserFiltersProps {
  search: string;
  role: string;
  lang: Lang;
  onSearchChange: (value: string) => void;
  onRoleChange: (value: string) => void;
}

export function UserFilters({ search, role, lang, onSearchChange, onRoleChange }: UserFiltersProps) {
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
      background: COLORS.surface, borderRadius: "16px", padding: "16px 20px",
      boxShadow: SHADOW,
    }}>
      <div style={{ position: "relative", flex: "1 1 180px", maxWidth: "320px" }}>
        <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: COLORS.textSecondary }} />
        <input
          className="neo-input w-full"
          style={{ paddingLeft: "36px" }}
          placeholder={t("Поиск пользователей…", "Foydalanuvchi qidirish…")}
          value={search}
          onChange={e => onSearchChange(e.target.value)}
        />
      </div>
      <PremiumSelect value={role} onChange={onRoleChange}
        options={[{ value: "", label: t("Все роли", "Barcha lavozimlar") }, ...Object.entries(ROLE_LABELS).map(([k, v]) => ({ value: k, label: lang === "uz" ? v.uz : v.ru }))]}
        width="200px" />
    </div>
  );
}
