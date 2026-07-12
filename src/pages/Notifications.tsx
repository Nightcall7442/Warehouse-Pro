import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { Bell, AlertTriangle, TrendingUp, TrendingDown, Check } from "lucide-react";
import { CardDots, Card, PageHeader, btnSecondary } from "@/components/DashboardLayout";

export default function Notifications() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: notifications, isLoading } = trpc.notification.list.useQuery() as { data: any; isLoading: boolean };
  const markRead = trpc.notification.markRead.useMutation();
  const markAllRead = trpc.notification.markAllRead.useMutation();

  const items = notifications ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader
        title={t("Уведомления", "Bildirishnomalar")}
        subtitle={`${items.filter((n: any) => !n.readAt).length} ${t("непрочитанных", "o'qilmagan")}`}
        actions={items.some((n: any) => !n.readAt) ? <button onClick={() => markAllRead.mutate()} style={btnSecondary}><Check size={14} /> {t("Прочитать все", "Hammasini o'qish")}</button> : undefined}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {isLoading ? (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)" }}>...</div>
        ) : items.length === 0 ? (
          <Card><p style={{ textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)", padding: "32px 0" }}>{t("Нет уведомлений", "Bildirishnoma yo'q")}</p></Card>
        ) : items.map((n: any) => {
          const icon = n.type === "danger" ? <AlertTriangle size={16} color="#f87171" /> : n.type === "warning" ? <TrendingDown size={16} color="#fbbf24" /> : <TrendingUp size={16} color="#4ade80" />;
          return (
            <Card key={n.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 18px", opacity: n.readAt ? 0.6 : 1, cursor: "pointer" }} onClick={() => { if (!n.readAt) markRead.mutate({ id: n.id }); }}>
              <div style={{ width: "32px", height: "32px", borderRadius: "10px", background: "var(--color-surface-light, #f3f4f6)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {icon}
              </div>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary, #111827)", margin: 0 }}>{n.title}</p>
                <p style={{ fontSize: "11px", color: "var(--color-text-tertiary, #9ca3af)", margin: "2px 0 0" }}>{n.message}</p>
              </div>
              {!n.readAt && <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--color-primary, #818cf8)", flexShrink: 0 }} />}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
