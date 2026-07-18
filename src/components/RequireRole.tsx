/**
 * RequireRole — route-level role guard for frontend.
 * Wraps routes that should only be accessible to specific roles.
 * Redirects to "/" if the user's role is not in the allowed list.
 */
import { Navigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";

type Role = "superadmin" | "ceo" | "operator" | "agent" | "supervisor" | "merchandiser" | "courier";

interface RequireRoleProps {
  roles: Role[];
  children: React.ReactNode;
}

export function RequireRole({ roles, children }: RequireRoleProps) {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user || !roles.includes(user.role as Role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
