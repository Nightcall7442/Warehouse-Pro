import { CheckCircle2, AlertTriangle } from "lucide-react";
import { COLORS, F, SHADOW } from "./theme";
import { Badge } from "./Badge";

interface ServerData {
  status?: string;
}

interface DatabaseData {
  connected?: boolean;
}

interface SystemStatusBannerProps {
  server: ServerData;
  database: DatabaseData;
  timestamp?: string | number;
}

export function SystemStatusBanner({ server, database, timestamp }: SystemStatusBannerProps) {
  const serverOk = server.status === "ok";
  const dbOk = database.connected;

  return (
    <div style={{
      padding: "16px", borderRadius: "16px", display: "flex", alignItems: "center", gap: "12px",
      background: serverOk && dbOk ? "rgba(74,222,128,.08)" : "rgba(251,191,36,.08)",
      border: `1px solid ${serverOk && dbOk ? "rgba(74,222,128,.15)" : "rgba(251,191,36,.15)"}`,
      boxShadow: SHADOW, animation: "slideUp 0.5s ease forwards",
    }}>
      {serverOk && dbOk ? <CheckCircle2 size={20} style={{ color: COLORS.success }} /> : <AlertTriangle size={20} style={{ color: COLORS.warning }} />}
      <div style={{ flex: 1 }}>
        <span style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 700, color: COLORS.textPrimary }}>{serverOk && dbOk ? "Все системы в норме" : "Обнаружены проблемы"}</span>
        <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
          <Badge status={server.status ?? "ok"} label={`API: ${server.status}`} />
          <Badge status={dbOk ? "connected" : "disconnected"} label={`БД: ${dbOk ? "OK" : "FAIL"}`} />
        </div>
      </div>
      <div style={{ fontSize: "12px", color: COLORS.textTertiary, fontFamily: F.body }}>{timestamp && new Date(timestamp).toLocaleTimeString("ru")}</div>
    </div>
  );
}
