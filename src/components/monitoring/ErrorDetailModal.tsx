import { useEffect } from "react";
import { AlertCircle, XCircle } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { COLORS, F, statusColor, timeAgo } from "./theme";
import { CopyButton } from "./CopyButton";

interface ErrorDetailModalProps {
  errorId: string;
  onClose: () => void;
}

export function ErrorDetailModal({ errorId, onClose }: ErrorDetailModalProps) {
  const { data: error, isLoading } = trpc.system.errorDetail.useQuery({ id: errorId });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }} onClick={onClose}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }} />
      <div
        style={{
          position: "relative", width: "100%", maxWidth: "640px", maxHeight: "85vh",
          background: COLORS.surface, borderRadius: "24px", border: `1px solid ${COLORS.border}`,
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", overflow: "hidden", display: "flex", flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{
          padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{
              width: "40px", height: "40px", borderRadius: "12px",
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(232,80,80,.10)", color: COLORS.danger,
            }}>
              <AlertCircle size={20} />
            </div>
            <div>
              <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 700, color: COLORS.textPrimary }}>Детали ошибки</h2>
              <p style={{ fontSize: "11px", color: COLORS.textTertiary, fontFamily: F.body }}>{error?.id}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ padding: "8px", borderRadius: "8px", background: "none", border: "none", cursor: "pointer", color: COLORS.textSecondary }}>
            <XCircle size={20} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
          {isLoading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 0" }}>
              <div style={{ width: "24px", height: "24px", borderRadius: "50%", border: `2px solid ${COLORS.border}`, borderTopColor: COLORS.primary, animation: "spin 1s linear infinite" }} />
            </div>
          ) : !error ? (
            <div style={{ textAlign: "center", padding: "48px 0", color: COLORS.textTertiary }}>Ошибка не найдена</div>
          ) : (
            <>
              <div style={{ padding: "16px", borderRadius: "12px", background: COLORS.surfaceLight }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                  <span style={{ fontFamily: "monospace", fontSize: "24px", fontWeight: 900, color: statusColor(error.statusCode) }}>{error.statusCode}</span>
                  <span style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 600, color: COLORS.textPrimary }}>{error.code}</span>
                </div>
                <p style={{ fontSize: "13px", color: COLORS.textSecondary, fontFamily: F.body }}>{error.message}</p>
              </div>

              <div style={{ borderRadius: "12px", border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
                {[
                  ["Время", new Date(error.timestamp).toLocaleString("ru")],
                  ["Прошло", timeAgo(error.timestamp)],
                  ["Метод", error.method],
                  ["Путь", error.path],
                  ["Корреляция", error.correlationId ?? "—"],
                  ["IP", error.ip ?? "—"],
                  ["Пользователь", error.userId ? String(error.userId) : "—"],
                  ["Тенант", error.tenantId ? String(error.tenantId) : "—"],
                  ["Длительность", error.duration ? `${error.duration}мс` : "—"],
                ].map(([label, value], i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "10px 16px", fontSize: "13px", fontFamily: F.body,
                    background: i % 2 === 0 ? COLORS.surface : COLORS.surfaceLight,
                    borderTop: i > 0 ? `1px solid ${COLORS.border}` : undefined,
                  }}>
                    <span style={{ fontWeight: 500, color: COLORS.textSecondary }}>{label}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontFamily: "monospace", fontSize: "12px", color: COLORS.textPrimary }}>{value}</span>
                      {value !== "—" && <CopyButton text={String(value)} />}
                    </div>
                  </div>
                ))}
              </div>

              {error.stack && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                    <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>Stack Trace</span>
                    <CopyButton text={error.stack} />
                  </div>
                  <pre style={{
                    padding: "16px", borderRadius: "12px", fontSize: "12px", fontFamily: "monospace",
                    lineHeight: 1.6, overflowX: "auto", background: COLORS.surfaceLight,
                    color: COLORS.textSecondary, border: `1px solid ${COLORS.border}`,
                  }}>
                    {error.stack}
                  </pre>
                </div>
              )}

              {error.meta && Object.keys(error.meta).length > 0 && (
                <div>
                  <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>Meta</span>
                  <pre style={{
                    marginTop: "8px", padding: "16px", borderRadius: "12px", fontSize: "12px",
                    fontFamily: "monospace", overflowX: "auto", background: COLORS.surfaceLight,
                    color: COLORS.textSecondary, border: `1px solid ${COLORS.border}`,
                  }}>
                    {JSON.stringify(error.meta, null, 2)}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
