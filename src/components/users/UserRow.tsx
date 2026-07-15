import { format } from "date-fns";
import { KeyRound, Power } from "lucide-react";
import { tdStyle, COLORS, F, type User, type Lang } from "./types";
import { RoleBadge } from "./RoleBadge";

interface UserRowProps {
  user: User;
  lang: Lang;
  onResetPassword: (id: number, name: string) => void;
  onDeactivate: (id: number, name: string) => void;
  onReactivate: (id: number) => void;
}

export function UserRow({ user, lang, onResetPassword, onDeactivate, onReactivate }: UserRowProps) {
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  return (
    <tr
      style={{ transition: "background 0.15s" }}
      onMouseEnter={e => (e.currentTarget.style.background = "rgba(75,108,246,0.02)")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      {/* Name */}
      <td style={tdStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "32px", height: "32px", borderRadius: "10px", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "12px", fontWeight: 700,
            background: "rgba(75,108,246,.12)",
            color: "#4b6cf6",
          }}>
            {user.name?.[0]?.toUpperCase()}
          </div>
          <span style={{ fontSize: "14px", fontWeight: 500, fontFamily: F.body }}>{user.name}</span>
        </div>
      </td>
      {/* Email */}
      <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{user.email}</td>
      {/* Role */}
      <td style={tdStyle}>
        <RoleBadge role={user.role} lang={lang} />
      </td>
      {/* Status */}
      <td style={tdStyle}>
        <span className={`status-badge ${
          user.status === "active"
            ? "bg-success/15 text-success border-success/30"
            : "bg-danger/15 text-danger border-danger/30"
        }`}>
          {user.status === "active"
            ? t("Активен", "Faol")
            : t("Неактивен", "Faol emas")}
        </span>
      </td>
      {/* Last sign-in */}
      <td style={{ ...tdStyle, fontSize: "13px", color: COLORS.textSecondary }}>
        {user.lastSignInAt
          ? format(new Date(user.lastSignInAt), "dd.MM.yyyy HH:mm")
          : t("Не входил", "Kirmagan")}
      </td>
      {/* Actions */}
      <td style={tdStyle}>
        <div style={{ display: "flex", gap: "4px" }}>
          <button
            title={t("Сбросить пароль", "Parolni tiklash")}
            onClick={() => onResetPassword(user.id, user.name)}
            className="neo-btn p-1.5"
          >
            <KeyRound size={14} />
          </button>
          {user.status === "active" ? (
            <button
              title={t("Деактивировать", "O'chirish")}
              onClick={() => onDeactivate(user.id, user.name)}
              className="neo-btn p-1.5 text-danger"
              style={{ borderColor: "rgba(232,80,80,.30)" }}
            >
              <Power size={14} />
            </button>
          ) : (
            <button
              title={t("Активировать", "Faollashtirish")}
              onClick={() => onReactivate(user.id)}
              className="neo-btn p-1.5 text-success"
              style={{ borderColor: "rgba(74,222,128,.30)" }}
            >
              <Power size={14} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}
