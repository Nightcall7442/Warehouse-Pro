// Simple in-memory metrics for 1C sync

interface Metric {
  name: string;
  labels: Record<string, string>;
  value: number;
  timestamp: Date;
}

const metrics: Metric[] = [];

export function recordMetric(name: string, labels: Record<string, string>, value: number) {
  metrics.push({ name, labels, value, timestamp: new Date() });
  // Keep only last 1000 metrics
  if (metrics.length > 1000) {
    metrics.splice(0, metrics.length - 1000);
  }
}

export function getMetrics(name?: string): Metric[] {
  if (name) {
    return metrics.filter(m => m.name === name);
  }
  return metrics;
}

export function getMetricsSummary() {
  const summary: Record<string, { count: number; lastValue: number; lastTimestamp: Date }> = {};
  
  for (const m of metrics) {
    const key = m.name;
    if (!summary[key]) {
      summary[key] = { count: 0, lastValue: 0, lastTimestamp: m.timestamp };
    }
    summary[key].count++;
    summary[key].lastValue = m.value;
    if (m.timestamp > summary[key].lastTimestamp) {
      summary[key].lastTimestamp = m.timestamp;
    }
  }
  
  return summary;
}

// 1C-specific metrics
export function record1CSync(entityType: string, direction: string, duration: number, success: boolean) {
  recordMetric('1c_sync_duration', { entityType, direction, success: String(success) }, duration);
  recordMetric('1c_sync_total', { entityType, direction, success: String(success) }, 1);
}
