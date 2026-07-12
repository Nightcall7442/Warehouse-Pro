import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { format } from "date-fns";
import { Search, Plus, Users as UsersIcon, Shield, Mail, Trash2 } from "lucide-react";
import { CardDots, Card, KpiCard, PageHeader, TableContainer, thStyle, tdStyle, btnPrimary, btnSecondary, btnDanger, inputStyle } from "@/components/DashboardLayout";

const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };

const ROLES: Record<string, { ru: string; uz: string; color: string }> = {
  superadmin: { ru: "Суперадмин", uz: "Superadmin", color: "#f87171" },
  ceo:        { ru: "CEO",         uz: "CEO",        color: "#a78bfa" },
  operator:   { ru: "Оператор",    uz: "Operator",   color: "#60a5fa" },
  agent:      { ru: "Агент",       uz: "Agent",      color: "#4ade80" },
  supervisor: { ru: "Супервайзер", uz: "Nazoratchi", color: "#fbbf24" },
  merchandiser: { ru: "Мерчандайзер", uz: "Merchandayzer", color: "#fb923c" },
  courier:    { ru: "Курьер",      uz: "Kuryer",     color: "#2dd4bf" },
};

export default function Users() {
  const [search, setSearch] = useState("");
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { confirm, dialog } = useConfirm();

  const { data, isLoading } = trpc.user.list.useQuery({ search }) as { data: any; isLoading: boolean };
  const users = data ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {dialog}
      <PageHeader
        title={t("Пользователи", "Foydalanuvchilar")}
        subtitle={`${users.length} ${t("всего", "jami")}`}
        actions={<button onClick={() => {}} style={btnPrimary}><Plus size={14} /> {t("Добавить", "Qo'shish")}</button>}
      />

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "16px" }}>
        <KpiCard label={t("ВСЕГО", "JAMI")} value={String(users.length)} icon={<UsersIcon size={18} color="#818cf8" />} gradient="rgba(129,140,248,.10)" />
        {Object.entries(ROLES).filter(([key]) => users.some((u: any) => u.role === key)).map(([key, role]) => (
          <KpiCard key={key} label={role.ru.toUpperCase()} value={String(users.filter((u: any) => u.role === key).length)} icon={<Shield size={18} color={role.color} />} gradient={`${role.color}18`} />
        ))}
      </div>

      {/* Filters */}
      <div style={{ position: "relative" }}>
        <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #9ca3af)" }} />
        <input placeholder={t("Поиск пользователей...", "Foydalanuvchi qidirish...")} value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: "36px" }} className="input-field" />
      </div>

      {/* Users Table */}
      <TableContainer>
        <table style={{ width: "100%", minWidth: "600px" }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("ПОЛЬЗОВАТЕЛЬ", "FOYDALANUVCHI")}</th>
              <th style={thStyle}>{t("РОЛЬ", "ROLE")}</th>
              <th style={thStyle}>{t("СОЗДАН", "YARATILGAN")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={3} style={{ padding: "32px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={3} style={{ padding: "48px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>{t("Нет пользователей", "Foydalanuvchi yo'q")}</td></tr>
            ) : users.map((u: any) => {
              const role = ROLES[u.role] ?? { ru: u.role, uz: u.role, color: "#9ca3af" };
              return (
                <tr key={u.id} style={{ transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-light, #f8f9fb)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: `${role.color}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <span style={{ fontSize: "14px", fontWeight: 700, color: role.color }}>{u.name?.[0]?.toUpperCase()}</span>
                      </div>
                      <div><p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary, #111827)", margin: 0 }}>{u.name}</p><p style={{ fontSize: "11px", color: "var(--color-text-tertiary, #9ca3af)", margin: 0 }}>{u.email}</p></div>
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <span style={{ display: "inline-flex", padding: "3px 10px", borderRadius: "20px", fontSize: "10px", fontWeight: 700, fontFamily: F.body, color: role.color, background: `${role.color}18`, letterSpacing: "0.04em" }}>
                      {role[lang as "ru" | "uz"]}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, fontSize: "11px", color: "var(--color-text-tertiary, #9ca3af)" }}>{u.createdAt ? format(new Date(u.createdAt), "dd.MM.yy") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableContainer>
    </div>
  );
}
