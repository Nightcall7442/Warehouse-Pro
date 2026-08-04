import { useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { COLORS, SHADOW, F, type Lang } from "./types";

interface Props {
  userId: number;
  userName: string;
  userEmail: string;
  lang: Lang;
  onClose: () => void;
  onDone: () => void;
}

export function TransferCredentialsModal({
  userId,
  userName,
  userEmail,
  lang,
  onClose,
  onDone,
}: Props) {
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const utils = trpc.useUtils();

  const [newEmail, setNewEmail] = useState(userEmail);
  const [newPassword, setNewPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [deactivateAfter, setDeactivateAfter] = useState(true);

  const transfer = trpc.user.transferCredentials.useMutation({
    onSuccess: () => {
      notify.success(
        t(
          `Учётные данные ${userName} обновлены`,
          `${userName} hisob ma'lumotlari yangilandi`
        )
      );
      utils.user.list.invalidate();
      onDone();
    },
    onError: (e) => notify.error(e.message),
  });

  const handleSubmit = () => {
    if (!newEmail || !newPassword) {
      notify.error(t("Заполните все поля", "Barcha maydonlarni to'ldiring"));
      return;
    }
    if (newPassword.length < 8) {
      notify.error(
        t("Пароль минимум 8 символов", "Parol kamida 8 ta belgi")
      );
      return;
    }
    transfer.mutate({
      id: userId,
      email: newEmail,
      password: newPassword,
      deactivate: deactivateAfter,
    });
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        style={{
          background: COLORS.surface,
          borderRadius: "24px",
          padding: "24px",
          boxShadow: "0 24px 48px rgba(0,0,0,0.18)",
          width: "100%",
          maxWidth: "440px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                background: "linear-gradient(135deg, var(--color-warning), #e8b86a)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ShieldCheck size={18} color="#fff" />
            </div>
            <div>
              <h2
                style={{
                  fontFamily: F.display,
                  fontSize: "15px",
                  fontWeight: 600,
                  color: COLORS.textPrimary,
                  margin: 0,
                }}
              >
                {t("Передача доступа", "Kirish huquqini o'tkazish")}
              </h2>
              <p
                style={{
                  fontSize: "12px",
                  color: COLORS.textTertiary,
                  margin: "2px 0 0",
                  fontFamily: F.body,
                }}
              >
                {userName}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-ghost p-1.5">
            <X size={18} />
          </button>
        </div>

        {/* Info banner */}
        <div
          style={{
            background: "rgba(212,151,58,0.08)",
            border: "1px solid rgba(212,151,58,0.2)",
            borderRadius: "12px",
            padding: "12px 14px",
            fontSize: "12px",
            color: COLORS.textSecondary,
            fontFamily: F.body,
            lineHeight: 1.5,
          }}
        >
          {t(
            "При увольнении сотрудника можно изменить логин и пароль, чтобы новый сотрудник унаследовал его клиентов и долги. История и данные сохраняются.",
            "Xodim ishdan ketganda login va parolni o'zgartirish mumkin, shunda yangi xodim uning mijozlari va qarzlarini meros qilib oladi. Tarix va saqlanadi."
          )}
        </div>

        {/* New Email */}
        <div>
          <label
            className="font-label text-[10px] text-secondary tracking-wider block mb-1.5"
          >
            {t("НОВЫЙ ЛОГИН (EMAIL)", "YANGI LOGIN (EMAIL)")}
          </label>
          <input
            type="email"
            className="neo-input w-full"
            placeholder="new-agent@company.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
        </div>

        {/* New Password */}
        <div>
          <label
            className="font-label text-[10px] text-secondary tracking-wider block mb-1.5"
          >
            {t("НОВЫЙ ПАРОЛЬ", "YANGI PAROL")}
          </label>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              className="neo-input w-full pr-10"
              placeholder={t("Минимум 8 символов", "Kamida 8 ta belgi")}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-tertiary hover:text-secondary"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px",
                display: "flex",
              }}
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Deactivate checkbox */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            cursor: "pointer",
            padding: "12px 14px",
            borderRadius: "12px",
            background: deactivateAfter
              ? "rgba(232,80,80,0.06)"
              : "transparent",
            border: `1px solid ${
              deactivateAfter
                ? "rgba(232,80,80,0.2)"
                : COLORS.border
            }`,
            transition: "all 0.15s",
          }}
        >
          <input
            type="checkbox"
            checked={deactivateAfter}
            onChange={(e) => setDeactivateAfter(e.target.checked)}
            style={{
              width: "16px",
              height: "16px",
              accentColor: COLORS.danger,
              cursor: "pointer",
            }}
          />
          <div>
            <span
              style={{
                fontSize: "13px",
                fontWeight: 500,
                color: COLORS.textPrimary,
                fontFamily: F.body,
              }}
            >
              {t(
                "Деактивировать после смены",
                "O'zgartirishdan keyin deaktiv qilish"
              )}
            </span>
            <p
              style={{
                fontSize: "11px",
                color: COLORS.textTertiary,
                margin: "2px 0 0",
                fontFamily: F.body,
              }}
            >
              {t(
                "Старый сотрудник потеряет доступ",
                "Eski xodim kirish huquqini yo'qotadi"
              )}
            </p>
          </div>
        </label>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={
              transfer.isPending || !newEmail || newPassword.length < 8
            }
            className="neo-btn-primary flex-1 flex items-center justify-center gap-2"
            style={{
              color: "#fff",
              opacity:
                transfer.isPending || !newEmail || newPassword.length < 8
                  ? 0.5
                  : 1,
            }}
          >
            {transfer.isPending && (
              <Loader2 size={14} className="animate-spin" />
            )}
            {t("Передать доступ", "Kirish huquqini o'tkazish")}
          </button>
          <button onClick={onClose} className="neo-btn flex-1">
            {t("Отмена", "Bekor")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
