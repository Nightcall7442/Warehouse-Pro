import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

interface Props {
  children: ReactNode;
  pageName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary] ${this.props.pageName ?? "Page"} crashed:`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          minHeight: "50vh", padding: "40px 20px", textAlign: "center",
        }}>
          <div style={{
            width: "64px", height: "64px", borderRadius: "20px",
            background: "rgba(232,80,80,0.1)", display: "flex",
            alignItems: "center", justifyContent: "center", marginBottom: "20px",
          }}>
            <AlertTriangle size={28} color="#d45050" />
          </div>
          <h2 style={{
            fontFamily: "'DM Sans', sans-serif", fontSize: "18px", fontWeight: 700,
            color: "var(--color-text-primary, #2b3450)", margin: "0 0 8px",
          }}>
            Что-то пошло не так
          </h2>
          <p style={{
            fontSize: "13px", color: "var(--color-text-secondary, #6a7290)",
            margin: "0 0 24px", maxWidth: "400px",
          }}>
            {this.props.pageName
              ? `Ошибка на странице «${this.props.pageName}». Попробуйте обновить.`
              : "Произошла непредвиденная ошибка. Попробуйте обновить страницу."}
          </p>
          {this.state.error && (
            <details style={{
              marginBottom: "20px", padding: "12px 16px", borderRadius: "10px",
              background: "var(--color-surface-light, #f0f3f8)", fontSize: "11px",
              color: "var(--color-text-tertiary, #98a0b8)", maxWidth: "500px",
              width: "100%", textAlign: "left", fontFamily: "monospace",
            }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                Технические детали
              </summary>
              <pre style={{ marginTop: "8px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {this.state.error.message}
                {"\n\n"}
                {this.state.error.stack}
              </pre>
            </details>
          )}
          <div style={{ display: "flex", gap: "12px" }}>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
              style={{
                display: "inline-flex", alignItems: "center", gap: "6px",
                padding: "10px 20px", fontSize: "13px", fontWeight: 600,
                fontFamily: "'DM Sans', sans-serif", borderRadius: "12px",
                border: "none", cursor: "pointer",
                background: "var(--color-primary, #5b6d8a)", color: "#fff",
                boxShadow: "0 2px 8px rgba(75,108,246,.25)",
              }}
            >
              <RefreshCw size={14} /> Обновить
            </button>
            <a href="/"
              style={{
                display: "inline-flex", alignItems: "center", gap: "6px",
                padding: "10px 20px", fontSize: "13px", fontWeight: 600,
                fontFamily: "'DM Sans', sans-serif", borderRadius: "12px",
                border: "1px solid var(--color-border, #f0f3f8)", cursor: "pointer",
                background: "var(--color-surface, #ffffff)",
                color: "var(--color-text-secondary, #6a7290)", textDecoration: "none",
              }}
            >
              <Home size={14} /> На главную
            </a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
