import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createAlert,
  getRecentAlerts,
  clearAlerts,
  checkSyncHealth,
  configureAlerts,
  getAlertConfig,
} from "../onec-monitor";

vi.mock("../logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

beforeEach(() => {
  clearAlerts();
  configureAlerts({ enabled: false, webhookUrl: undefined });
});

describe("Alert Management", () => {
  it("creates alert with timestamp", () => {
    const alert = createAlert({
      type: "sync_failed",
      severity: "critical",
      message: "Test alert",
      tenantId: 1,
    });

    expect(alert).toHaveProperty("timestamp");
    expect(alert.type).toBe("sync_failed");
    expect(alert.severity).toBe("critical");
    expect(alert.message).toBe("Test alert");
    expect(alert.tenantId).toBe(1);
  });

  it("stores alerts in memory", () => {
    createAlert({
      type: "sync_failed",
      severity: "warning",
      message: "Alert 1",
    });

    createAlert({
      type: "bridge_unavailable",
      severity: "critical",
      message: "Alert 2",
    });

    const alerts = getRecentAlerts();
    expect(alerts).toHaveLength(2);
    expect(alerts.some((a) => a.message === "Alert 1")).toBe(true);
    expect(alerts.some((a) => a.message === "Alert 2")).toBe(true);
  });

  it("limits stored alerts", () => {
    for (let i = 0; i < 150; i++) {
      createAlert({
        type: "sync_failed",
        severity: "warning",
        message: `Alert ${i}`,
      });
    }

    const alerts = getRecentAlerts();
    expect(alerts.length).toBeLessThanOrEqual(100);
  });

  it("clears all alerts", () => {
    createAlert({
      type: "sync_failed",
      severity: "warning",
      message: "Alert",
    });

    clearAlerts();
    expect(getRecentAlerts()).toHaveLength(0);
  });

  it("returns limited alerts", () => {
    for (let i = 0; i < 5; i++) {
      createAlert({
        type: "sync_failed",
        severity: "warning",
        message: `Alert ${i}`,
      });
    }

    expect(getRecentAlerts(3)).toHaveLength(3);
  });
});

describe("Health Check", () => {
  it("returns healthy when no syncs", () => {
    const result = checkSyncHealth("product", "from1c", 0, 0);
    expect(result.healthy).toBe(true);
    expect(result.alert).toBeUndefined();
  });

  it("returns healthy for low error rate", () => {
    const result = checkSyncHealth("product", "from1c", 1, 100);
    expect(result.healthy).toBe(true);
  });

  it("returns warning for elevated error rate", () => {
    const result = checkSyncHealth("product", "from1c", 30, 100);
    expect(result.healthy).toBe(true);
    expect(result.alert).toBeDefined();
    expect(result.alert!.severity).toBe("warning");
  });

  it("returns critical for high error rate", () => {
    const result = checkSyncHealth("product", "from1c", 60, 100);
    expect(result.healthy).toBe(false);
    expect(result.alert).toBeDefined();
    expect(result.alert!.severity).toBe("critical");
  });

  it("ignores low total syncs", () => {
    const result = checkSyncHealth("product", "from1c", 5, 8);
    expect(result.healthy).toBe(true);
    expect(result.alert).toBeUndefined();
  });
});

describe("Configuration", () => {
  it("updates config", () => {
    configureAlerts({ enabled: true, webhookUrl: "https://hook.example.com" });
    const config = getAlertConfig();
    expect(config.enabled).toBe(true);
    expect(config.webhookUrl).toBe("https://hook.example.com");
  });

  it("returns copy of config", () => {
    const config1 = getAlertConfig();
    config1.enabled = true;
    const config2 = getAlertConfig();
    expect(config2.enabled).toBe(false);
  });
});
