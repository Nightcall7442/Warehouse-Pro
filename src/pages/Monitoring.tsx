import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { Activity, Server, Database, Clock, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { CardDots, Card, KpiCard, PageHeader, SectionTitle, btnSecondary } from "@/components/DashboardLayout";

const F = { display: "'DM Sans', -apple-system, sans-serif", body: "'DM Sans', -apple-system, sans-serif" };

export default function Monitoring() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data: status, isLoading, refetch } = trpc.system.status.useQuery();
  const { data: errors } = trpc.system.errors.useQuery();

  const serverOk = status?.server === "ok";
  const dbOk = status?.database === "ok";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <PageHeader
        title={t("Мониторинг", "Monitoring")}
        subtitle={t("Состояние системы", "Tizim holati")}
        actions={<button onClick={() => refetch()} style={btnSecondary}><RefreshCw size={13} /> {t("Обновить", "Yangilash")}</button>}
      />

      {/* Status Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: serverOk ? "rgba(74,222,128,.10)" : "rgba(248,113,113,.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Server size={18} color={serverOk ? "#4ade80" : "#f87171"} />
            </div>
            <div>
              <p style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", margin: 0 }}>{t("СЕРВЕР", "SERVER")}</p>
              <p style={{ fontSize: "18px", fontWeight: 700, color: serverOk ? "#4ade80" : "#f87171", margin: "4px 0 0", fontFamily: F.display }}>{serverOk ? "OK" : "ERROR"}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: dbOk ? "rgba(74,222,128,.10)" : "rgba(248,113,113,.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Database size={18} color={dbOk ? "#4ade80" : "#f87171"} />
            </div>
            <div>
              <p style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", margin: 0 }}>{t("БАЗА ДАННЫХ", "MA'LUMOTLAR bazasi")}</p>
              <p style={{ fontSize: "18px", fontWeight: 700, color: dbOk ? "#4ade80" : "#f87171", margin: "4px 0 0", fontFamily: F.display }}>{dbOk ? "OK" : "ERROR"}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: "rgba(129,140,248,.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Activity size={18} color="#818cf8" />
            </div>
            <div>
              <p style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #9ca3af)", margin: 0 }}>{t("UPTIME", "ISHLASH VAQTI")}</p>
              <p style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-text-primary, #111827)", margin: "4px 0 0", fontFamily: F.display }}>{status?.uptime ?? "—"}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Recent Errors */}
      <Card>
        <SectionTitle title={t("Последние ошибки", "So'nggi xatolar")} />
        <div style={{ marginTop: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
          {(!errors || errors.length === 0) ? (
            <p style={{ textAlign: "center", color: "var(--color-text-tertiary, #9ca3af)", padding: "24px 0", fontSize: "13px" }}>{t("Ошибок нет", "Xatolar yo'q")}</p>
          ) : (
            (errors as any[]).slice(0, 10).map((e: any, i: number) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderRadius: "10px", background: "var(--color-surface-light, #f8f9fb)" }}>
                <AlertTriangle size={14} color="var(--color-warning, #fbbf24)" />
                <span style={{ fontSize: "12px", color: "var(--color-text-secondary, #6b7280)", flex: 1 }}>{e.message ?? "—"}</span>
                <span style={{ fontSize: "11px", color: "var(--color-text-tertiary, #9ca3af)" }}>{e.createdAt ? new Date(e.createdAt).toLocaleString() : ""}</span>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
