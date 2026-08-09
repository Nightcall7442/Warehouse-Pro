import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";

const ROLE_HOME: Record<string, string> = {
  superadmin:   "/super-admin",
  ceo:          "/dashboard",
  operator:     "/dashboard",
  supervisor:   "/supervisor",
  agent:        "/agent",
  merchandiser: "/agent",
  // Курьера здесь не было, и он проваливался в общий fallback на /dashboard —
  // экран директора с выручкой и долгами, у которого нет RoleGuard. Его
  // рабочий раздел — список доставок.
  courier:      "/deliveries",
};

export default function Home() {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading || !user) return;
    const dest = ROLE_HOME[user.role] ?? "/dashboard";
    navigate(dest, { replace: true });
  }, [user, isLoading, navigate]);

  return null;
}
