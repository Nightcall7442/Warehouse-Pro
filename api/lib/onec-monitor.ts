import { logger } from "./logger";

export interface AlertConfig {
  enabled: boolean;
  webhookUrl?: string;
  emailRecipients?: string[];
  maxRetries?: number;
}

export interface SyncAlert {
  type: "sync_failed" | "sync_stuck" | "bridge_unavailable" | "high_error_rate";
  severity: "warning" | "critical";
  message: string;
  tenantId?: number;
  entityType?: string;
  details?: Record<string, unknown>;
  timestamp: Date;
}

const alerts: SyncAlert[] = [];
const MAX_ALERTS = 100;

let config: AlertConfig = {
  enabled: process.env.ONEC_ALERTS_ENABLED === "true",
  webhookUrl: process.env.ONEC_ALERT_WEBHOOK_URL,
  maxRetries: 3,
};

export function configureAlerts(newConfig: Partial<AlertConfig>) {
  config = { ...config, ...newConfig };
}

export function getAlertConfig(): AlertConfig {
  return { ...config };
}

export function createAlert(alert: Omit<SyncAlert, "timestamp">): SyncAlert {
  const fullAlert: SyncAlert = { ...alert, timestamp: new Date() };
  alerts.push(fullAlert);

  if (alerts.length > MAX_ALERTS) {
    alerts.splice(0, alerts.length - MAX_ALERTS);
  }

  if (config.enabled) {
    logger.warn(`1C Alert: ${alert.type}`, {
      severity: alert.severity,
      message: alert.message,
      tenantId: alert.tenantId,
      entityType: alert.entityType,
    });

    if (alert.severity === "critical") {
      sendWebhook(fullAlert);
    }
  }

  return fullAlert;
}

export function getRecentAlerts(limit?: number): SyncAlert[] {
  const sorted = [...alerts].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return limit ? sorted.slice(0, limit) : sorted;
}

export function clearAlerts(): void {
  alerts.length = 0;
}

async function sendWebhook(alert: SyncAlert): Promise<void> {
  if (!config.webhookUrl) return;

  try {
    await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `[${alert.severity.toUpperCase()}] 1C ${alert.type}: ${alert.message}`,
        alert,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    logger.error("Failed to send 1C alert webhook", { error: String(e) });
  }
}

export function checkSyncHealth(
  entityType: string,
  direction: string,
  errorCount: number,
  totalSyncs: number
): { healthy: boolean; alert?: SyncAlert } {
  if (totalSyncs === 0) {
    return { healthy: true };
  }

  const errorRate = errorCount / totalSyncs;

  if (errorRate > 0.5 && totalSyncs >= 10) {
    const alert = createAlert({
      type: "high_error_rate",
      severity: "critical",
      message: `High error rate for ${entityType} ${direction}: ${(errorRate * 100).toFixed(1)}%`,
      entityType,
      details: { errorCount, totalSyncs, errorRate },
    });
    return { healthy: false, alert };
  }

  if (errorRate > 0.2 && totalSyncs >= 10) {
    const alert = createAlert({
      type: "high_error_rate",
      severity: "warning",
      message: `Elevated error rate for ${entityType} ${direction}: ${(errorRate * 100).toFixed(1)}%`,
      entityType,
      details: { errorCount, totalSyncs, errorRate },
    });
    return { healthy: true, alert };
  }

  return { healthy: true };
}
