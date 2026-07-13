import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { format } from "date-fns";
import { Search, User, Package, ShoppingCart, Store, Settings, Shield, TrendingUp } from "lucide-react";
import { CardDots, Card, PageHeader, TableContainer, thStyle, tdStyle, inputStyle } from "@/components/DashboardLayout";

const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };

const EVENT_ICONS: Record<string, any> = {
  "user.created": User, "user.updated": User, "user.deleted": User,
  "product.created": Package, "product.updated": Package, "product.deleted": Package,
  "order.created": ShoppingCart, "order.updated": ShoppingCart, "order.completed": ShoppingCart,
  "shop.created": Store, "shop.updated": Store, "shop.deleted": Store,
  "stock.adjusted": TrendingUp, "settings.updated": Settings, "tenant.status_changed": Shield,
};

export default function AuditLog() {
  const [search, setSearch] = useState("");
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: logsData, isLoading } = trpc.audit.list.useQuery({ search }) as { data: any; isLoading: boolean };
  const logs = logsData?.data ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader title={t("Аудит-лог", "Audit log")} subtitle={`${logs.length} ${t("событий", "hodisa")}`} />

      <div style={{ position: "relative" }}>
        <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary, #9ca3af)" }} />
        <input placeholder={t("Поиск...", "Qidirish...")} value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: "36px" }} className="input-field" />
      </div>

      <TableContainer>
        <table style={{ width: "100%", minWidth: "600px" }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("СОБЫТИЕ", "HODISA")}</th>
              <th style={thStyle}>{t("ПОЛЬЗОВАТЕЛЬ", "FOYDALANUVCHI")}</th>
              <th style={thStyle}>{t("ДАТА", "SANA")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={3} style={{ padding: "32px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>...</td></tr>
            ) : (logs ?? []).length === 0 ? (
              <tr><td colSpan={3} style={{ padding: "48px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>{t("Нет событий", "Hodisa yo'q")}</td></tr>
            ) : (logs ?? []).map((log: any) => {
              const Icon = EVENT_ICONS[log.event] ?? Settings;
              return (
                <tr key={log.id} style={{ transition: "background 0.15s" }} onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-light, #f8f9fb)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "rgba(129,140,248,.10)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Icon size={14} color="var(--color-primary, #818cf8)" />
                      </div>
                      <div>
                        <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary, #111827)", margin: 0 }}>{log.event}</p>
                        {log.details && <p style={{ fontSize: "11px", color: "var(--color-text-tertiary, #9ca3af)", margin: "2px 0 0", fontFamily: "'DM Mono', monospace" }}>{JSON.stringify(log.details).slice(0, 60)}</p>}
                      </div>
                    </div>
                  </td>
                  <td style={{ ...tdStyle, fontSize: "12px", color: "var(--color-text-secondary, #6b7280)" }}>{log.userName ?? "—"}</td>
                  <td style={{ ...tdStyle, fontSize: "11px", color: "var(--color-text-tertiary, #9ca3af)" }}>{log.createdAt ? format(new Date(log.createdAt), "dd.MM.yy HH:mm") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableContainer>
    </div>
  );
}
