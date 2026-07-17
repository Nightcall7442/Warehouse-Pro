import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { useLang } from "@/i18n";
import { WifiOff, RefreshCw } from "lucide-react";
import { getPendingOrders } from "@/pages/OfflineOrders.helpers";

export function OfflineQueueBadge() {
  const [count, setCount] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const navigate = useNavigate();
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  // Load pending count
  useEffect(() => {
    const load = async () => {
      try {
        const orders = await getPendingOrders();
        setCount(orders.length);
      } catch { /* ignore */ }
    };
    load();
    const interval = setInterval(load, 5000); // Poll every 5s
    return () => clearInterval(interval);
  }, []);

  // Listen for online/offline
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Don't show if no pending orders and online
  if (count === 0 && online) return null;

  return (
    <button
      onClick={() => navigate("/offline-orders")}
      style={{
        display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px",
        borderRadius: "8px", border: "none", cursor: "pointer",
        background: online
          ? "var(--color-warning-subtle, rgba(232,168,48,0.12))"
          : "var(--color-danger-subtle, rgba(232,80,80,0.12))",
        color: online ? "var(--color-warning, #d4973a)" : "var(--color-danger, #d45050)",
        fontSize: "12px", fontWeight: 600, fontFamily: "'DM Sans', sans-serif",
        transition: "all 0.2s",
      }}
    >
      {online ? <RefreshCw size={12} /> : <WifiOff size={12} />}
      <span>{count}</span>
      <span style={{ fontSize: "10px", opacity: 0.8 }}>
        {online ? t("ожидает", "kutilmoqda") : t("офлайн", "oflayn")}
      </span>
    </button>
  );
}
