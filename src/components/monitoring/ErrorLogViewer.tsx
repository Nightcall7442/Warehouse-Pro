import { CheckCircle2, ChevronRight, AlertCircle } from "lucide-react";
import { COLORS, F, statusColor, timeAgo } from "./theme";
import { Section } from "./Section";

interface ErrorData {
  id: string;
  statusCode: number;
  code: string;
  message: string;
  path: string;
  timestamp: number;
}

interface ErrorStatsData {
  last5m: number;
  last1h: number;
  total: number;
  byPath: Array<{ path: string; count: number }>;
}

interface ErrorLogViewerProps {
  errors: ErrorData[];
  total: number;
  errorStats: ErrorStatsData | null | undefined;
  errorFilter: string;
  onFilterChange: (filter: string) => void;
  onSelectError: (id: string) => void;
}

const FILTER_OPTIONS = ["", "400", "401", "403", "404", "500"];

export function ErrorLogViewer({ errors, total, errorStats, errorFilter, onFilterChange, onSelectError }: ErrorLogViewerProps) {
  return (
    <Section
      title={`Журнал ошибок${total ? ` (${total})` : ""}`}
      icon={AlertCircle}
      delay={0.4}
      actions={
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            {FILTER_OPTIONS.map((code) => (
              <button
                key={code}
                onClick={() => onFilterChange(code)}
                style={{
                  padding: "4px 8px", borderRadius: "6px", fontSize: "10px", fontWeight: 600,
                  fontFamily: F.body, cursor: "pointer", transition: "all 0.2s",
                  background: errorFilter === code ? "rgba(75,108,246,.10)" : "transparent",
                  color: errorFilter === code ? COLORS.primary : COLORS.textTertiary,
                  border: `1px solid ${errorFilter === code ? "rgba(75,108,246,.20)" : COLORS.border}`,
                }}
              >
                {code || "Все"}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {/* Error stats bar */}
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

      {/* Error list */}
      <div style={{ overflowX: "auto" }}>
        {errors.length === 0 ? (
          <div style={{ textAlign: "center", padding: "32px 0", color: COLORS.textTertiary }}>
            <CheckCircle2 size={32} style={{ margin: "0 auto 8px", opacity: 0.3 }} />
            <p style={{ fontSize: "13px", fontFamily: F.body }}>Ошибок не обнаружено</p>
          </div>
        ) : (
          <table style={{ width: "100%", fontSize: "13px", fontFamily: F.body }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                {["Статус", "Код", "Сообщение", "Путь", "Время", ""].map((h) => (
                  <th key={h} style={{
                    fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
                    letterSpacing: "0.08em", padding: "12px 16px", textAlign: h === "Сообщение" || h === "Путь" ? "left" : h === "" ? "right" : "left",
                    color: COLORS.textTertiary,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {errors.map((err) => (
                <tr
                  key={err.id}
                  style={{ borderBottom: `1px solid ${COLORS.border}`, cursor: "pointer", transition: "background 0.15s" }}
                  onClick={() => onSelectError(err.id)}
                  onMouseEnter={(e) => (e.currentTarget.style.background = COLORS.surfaceLight)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ padding: "10px 16px" }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: "32px", height: "24px", borderRadius: "6px", fontSize: "10px", fontWeight: 700,
                      background: statusColor(err.statusCode) + "15", color: statusColor(err.statusCode),
                    }}>
                      {err.statusCode}
                    </span>
                  </td>
                  <td style={{ padding: "10px 16px" }}>
                    <span style={{ fontFamily: "monospace", fontSize: "12px", color: COLORS.textSecondary }}>{err.code}</span>
                  </td>
                  <td style={{ padding: "10px 16px", maxWidth: "300px" }}>
                    <span style={{ fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", color: COLORS.textPrimary }}>{err.message}</span>
                  </td>
                  <td style={{ padding: "10px 16px", maxWidth: "200px" }}>
                    <span style={{ fontFamily: "monospace", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block", color: COLORS.textTertiary }}>{err.path}</span>
                  </td>
                  <td style={{ padding: "10px 16px" }}>
                    <span style={{ fontSize: "11px", color: COLORS.textTertiary }}>{timeAgo(err.timestamp)}</span>
                  </td>
                  <td style={{ padding: "10px 16px", textAlign: "right" }}>
                    <ChevronRight size={14} style={{ color: COLORS.textTertiary }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Section>
  );
}
