import { useState } from "react";
import { CheckCircle2, ChevronRight, ChevronDown, AlertCircle, AlertTriangle, Info, Trash2 } from "lucide-react";
import { COLORS, F, statusColor, timeAgo } from "./theme";
import { Section } from "./Section";

interface GroupedError {
  key: string;
  message: string;
  path: string;
  code: string;
  statusCode: number;
  count: number;
  severity: "critical" | "warning" | "info";
  firstSeen: number;
  lastSeen: number;
  sampleId: string;
}

interface ErrorStatsData {
  last5m: number;
  last1h: number;
  total: number;
  byPath: Array<{ path: string; count: number }>;
}

interface ErrorTrendPoint {
  minute: string;
  count: number;
}

interface ErrorLogViewerProps {
  groupedErrors: GroupedError[];
  errorStats: ErrorStatsData | null | undefined;
  errorTrend: ErrorTrendPoint[] | undefined;
  onSelectError: (id: string) => void;
  onPurgeErrors?: () => void;
}

const SEVERITY_CONFIG = {
  critical: { color: COLORS.danger, bg: "rgba(232,80,80,.10)", icon: AlertCircle, label: "CRITICAL" },
  warning: { color: COLORS.warning, bg: "rgba(251,146,60,.10)", icon: AlertTriangle, label: "WARNING" },
  info: { color: COLORS.info, bg: "rgba(96,165,250,.10)", icon: Info, label: "INFO" },
};

export function ErrorLogViewer({ groupedErrors, errorStats, errorTrend, onSelectError, onPurgeErrors }: ErrorLogViewerProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const criticalCount = groupedErrors.filter(e => e.severity === "critical").length;
  const warningCount = groupedErrors.filter(e => e.severity === "warning").length;

  return (
    <Section
      title={`Ошибки${groupedErrors.length ? ` (${groupedErrors.length} типов)` : ""}`}
      icon={AlertCircle}
      delay={0.4}
      actions={
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {criticalCount > 0 && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "4px",
              padding: "3px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: 700,
              background: "rgba(232,80,80,.10)", color: COLORS.danger,
            }}>
              <AlertCircle size={10} /> {criticalCount} critical
            </span>
          )}
          {warningCount > 0 && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "4px",
              padding: "3px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: 700,
              background: "rgba(251,146,60,.10)", color: COLORS.warning,
            }}>
              <AlertTriangle size={10} /> {warningCount} warning
            </span>
          )}
          {onPurgeErrors && (
            <button onClick={onPurgeErrors} style={{
              display: "flex", alignItems: "center", gap: "4px", padding: "4px 8px",
              borderRadius: "6px", fontSize: "10px", fontWeight: 600, cursor: "pointer",
              background: COLORS.surfaceLight, color: COLORS.textTertiary, border: `1px solid ${COLORS.border}`,
            }}>
              <Trash2 size={10} /> Очистить
            </button>
          )}
        </div>
      }
    >
      {/* Stats bar */}
      {errorStats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "16px" }}>
          <div style={{ padding: "12px", borderRadius: "12px", textAlign: "center", background: COLORS.surfaceLight }}>
            <div style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: COLORS.danger }}>{errorStats.last5m}</div>
            <div style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>За 5 мин</div>
          </div>
          <div style={{ padding: "12px", borderRadius: "12px", textAlign: "center", background: COLORS.surfaceLight }}>
            <div style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: COLORS.warning }}>{errorStats.last1h}</div>
            <div style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>За час</div>
          </div>
          <div style={{ padding: "12px", borderRadius: "12px", textAlign: "center", background: COLORS.surfaceLight }}>
            <div style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: COLORS.textPrimary }}>{errorStats.total}</div>
            <div style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>Всего</div>
          </div>
        </div>
      )}

      {/* Error trend mini-chart */}
      {errorTrend && errorTrend.length > 0 && (
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px", color: COLORS.textTertiary }}>
            Ошибки по минутам (последний час)
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "48px", padding: "0 4px" }}>
            {errorTrend.map((point, i) => {
              const max = Math.max(...errorTrend.map(p => p.count), 1);
              const h = Math.max(2, (point.count / max) * 48);
              return (
                <div key={i} title={`${point.minute}: ${point.count} ошибок`} style={{
                  flex: 1, height: `${h}px`, borderRadius: "2px 2px 0 0",
                  background: point.count > 10 ? COLORS.danger : point.count > 0 ? COLORS.warning : COLORS.border,
                  opacity: point.count > 0 ? 1 : 0.3, transition: "height 0.3s",
                }} />
              );
            })}
          </div>
        </div>
      )}

      {/* Top error paths */}
      {errorStats && errorStats.byPath.length > 0 && (
        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px", color: COLORS.textTertiary }}>Топ путей с ошибками</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            {errorStats.byPath.slice(0, 5).map((p) => (
              <div key={p.path} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontFamily: F.body,
                background: COLORS.surfaceLight,
              }}>
                <span style={{ fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", color: COLORS.textSecondary }}>{p.path}</span>
                <span style={{ fontFamily: F.display, fontWeight: 700, color: COLORS.danger }}>{p.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grouped error list */}
      <div style={{ overflowX: "auto" }}>
        {groupedErrors.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: COLORS.textTertiary }}>
            <CheckCircle2 size={32} style={{ margin: "0 auto 8px", opacity: 0.3 }} />
            <p style={{ fontSize: "13px", fontFamily: F.body }}>Ошибок не обнаружено</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {groupedErrors.map((err) => {
              const sev = SEVERITY_CONFIG[err.severity];
              const SevIcon = sev.icon;
              const isExpanded = expandedKey === err.key;

              return (
                <div key={err.key} style={{
                  borderRadius: "10px", border: `1px solid ${COLORS.border}`,
                  background: COLORS.surface, overflow: "hidden",
                }}>
                  {/* Header row */}
                  <div
                    onClick={() => setExpandedKey(isExpanded ? null : err.key)}
                    style={{
                      display: "flex", alignItems: "center", gap: "10px",
                      padding: "10px 14px", cursor: "pointer", transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.surfaceLight)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {/* Severity badge */}
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: "3px",
                      padding: "2px 6px", borderRadius: "4px", fontSize: "9px", fontWeight: 700,
                      background: sev.bg, color: sev.color, minWidth: "52px", justifyContent: "center",
                    }}>
                      <SevIcon size={9} /> {sev.label}
                    </span>

                    {/* Count */}
                    <span style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      minWidth: "28px", height: "20px", borderRadius: "4px", fontSize: "11px", fontWeight: 700,
                      background: sev.bg, color: sev.color,
                    }}>
                      {err.count}x
                    </span>

                    {/* Status code */}
                    <span style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: "32px", height: "20px", borderRadius: "4px", fontSize: "10px", fontWeight: 700,
                      background: statusColor(err.statusCode) + "15", color: statusColor(err.statusCode),
                    }}>
                      {err.statusCode}
                    </span>

                    {/* Message */}
                    <span style={{
                      flex: 1, fontSize: "12px", fontFamily: F.body, color: COLORS.textPrimary,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {err.message}
                    </span>

                    {/* Path */}
                    <span style={{
                      fontFamily: "monospace", fontSize: "11px", color: COLORS.textTertiary,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "200px",
                    }}>
                      {err.path}
                    </span>

                    {/* Last seen */}
                    <span style={{ fontSize: "10px", color: COLORS.textTertiary, whiteSpace: "nowrap" }}>
                      {timeAgo(err.lastSeen)}
                    </span>

                    {isExpanded ? <ChevronDown size={14} style={{ color: COLORS.textTertiary }} /> : <ChevronRight size={14} style={{ color: COLORS.textTertiary }} />}
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div style={{
                      padding: "10px 14px", borderTop: `1px solid ${COLORS.border}`,
                      background: COLORS.surfaceLight, fontSize: "11px", fontFamily: F.body,
                    }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                        <div><span style={{ color: COLORS.textTertiary }}>Код:</span> <span style={{ fontFamily: "monospace", color: COLORS.textSecondary }}>{err.code}</span></div>
                        <div><span style={{ color: COLORS.textTertiary }}>Первый раз:</span> <span style={{ color: COLORS.textSecondary }}>{timeAgo(err.firstSeen)}</span></div>
                        <div><span style={{ color: COLORS.textTertiary }}>Последний:</span> <span style={{ color: COLORS.textSecondary }}>{timeAgo(err.lastSeen)}</span></div>
                        <div><span style={{ color: COLORS.textTertiary }}>Повторений:</span> <span style={{ fontWeight: 700, color: sev.color }}>{err.count}</span></div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); onSelectError(err.sampleId); }}
                        style={{
                          display: "flex", alignItems: "center", gap: "4px", padding: "5px 10px",
                          borderRadius: "6px", fontSize: "11px", fontWeight: 600, cursor: "pointer",
                          background: "rgba(75,108,246,.10)", color: COLORS.primary,
                          border: `1px solid rgba(75,108,246,.20)`,
                        }}
                      >
                        <ChevronRight size={12} /> Полный стектрейс
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Section>
  );
}
