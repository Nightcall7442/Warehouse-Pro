import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { Warehouse } from "lucide-react";

export default function Home() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading) return;
    if (!user) { navigate("/login"); return; }
    if (user.role === "superadmin") navigate("/super-admin");
    else if (user.role === "supervisor") navigate("/supervisor");
    else if (user.role === "agent" || user.role === "merchandiser") navigate("/agent");
    else navigate("/dashboard");
  }, [user, isLoading, navigate]);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "50vh" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "linear-gradient(135deg, var(--color-primary, #818cf8), #6366f1)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "16px", boxShadow: "0 2px 8px rgba(129,140,248,.25)" }}>
          <Warehouse size={22} color="#fff" />
        </div>
        <div style={{ width: "24px", height: "24px", border: "3px solid var(--color-primary, #818cf8)", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite", margin: "0 auto" }} />
      </div>
    </div>
  );
}
