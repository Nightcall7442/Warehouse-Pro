import { useState, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { exportToExcel, formatUsersForExport } from "@/lib/excel";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  Search, UserPlus, Loader2, Power, KeyRound, X, FileDown,
  Users as UsersIcon, UserCheck, UserX, ArrowUpRight, ArrowDownRight, Minus,
} from "lucide-react";
import { format } from "date-fns";
import { PremiumSelect } from "@/components/PremiumSelect";

/* ── Premium design tokens ─────────────────────────────────────────────────── */
const F = {
  display: "'DM Sans', -apple-system, sans-serif",
  body: "'DM Sans', -apple-system, sans-serif",
};
const COLORS = {
  primary: "#4b6cf6",
  success: "#34c473",
  warning: "#e8a830",
  danger: "#e85050",
  surface: "var(--color-surface, #ffffff)",
  surfaceLight: "var(--color-surface-light, #f0f3f8)",
  textPrimary: "var(--color-text-primary, #2b3450)",
  textSecondary: "var(--color-text-secondary, #6a7290)",
  textTertiary: "var(--color-text-tertiary, #98a0b8)",
  border: "var(--color-border, #f0f3f8)",
};
const SHADOW = "var(--shadow-sm, 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04))";

/* ── KPI Card ──────────────────────────────────────────────────────────────── */
function KpiCard({
  label, value, delta, icon, gradient, delay,
}: {
  label: string; value: string; delta: number | null;
  icon: React.ReactNode; gradient: string; delay: number;
}) {
  const isPositive = delta !== null && delta > 0;
  const isNegative = delta !== null && delta < 0;
  return (
    <div className="kpi-hero" style={{
      borderRadius: "24px", padding: "24px",
      position: "relative", overflow: "hidden",
      animation: `slideUp ${0.5 + delay}s ease forwards`,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
        <span style={{ fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary }}>
          {label}
        </span>
        <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: gradient, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon}
        </div>
      </div>
      <div style={{ fontFamily: F.display, fontSize: "32px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, letterSpacing: "-0.03em" }}>
        {value}
      </div>
      {delta !== null && (
        <div style={{
          display: "flex", alignItems: "center", gap: "4px", marginTop: "10px",
          fontSize: "12px", fontWeight: 600, fontFamily: F.body,
          color: isPositive ? "#34c473" : isNegative ? "#e85050" : COLORS.textTertiary,
        }}>
          {isPositive ? <ArrowUpRight size={14} /> : isNegative ? <ArrowDownRight size={14} /> : <Minus size={14} />}
          {Math.abs(delta).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

/* ── Table styles ──────────────────────────────────────────────────────────── */
const thStyle: React.CSSProperties = {
  fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.08em", color: COLORS.textTertiary, padding: "12px 16px",
  borderBottom: `1px solid ${COLORS.border}`, textAlign: "left",
};
const tdStyle: React.CSSProperties = {
  padding: "14px 16px", borderBottom: `1px solid ${COLORS.border}`,
  fontSize: "14px", fontFamily: F.body, color: COLORS.textPrimary,
};

/* ── Role config ───────────────────────────────────────────────────────────── */
const ROLE_COLORS: Record<string, string> = {
  ceo:          "bg-primary/15 text-primary border-primary/30",
  operator:     "bg-info/15 text-info border-info/30",
  agent:        "bg-success/15 text-success border-success/30",
  supervisor:   "bg-warning/15 text-warning border-warning/30",
  merchandiser: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  courier:      "bg-orange-500/15 text-orange-400 border-orange-500/30",
};

const ROLE_LABELS: Record<string, { ru: string; uz: string }> = {
  ceo:          { ru: "CEO",            uz: "CEO"            },
  operator:     { ru: "Оператор",       uz: "Operator"       },
  agent:        { ru: "Агент",          uz: "Agent"          },
  supervisor:   { ru: "Супервайзер",    uz: "Supervisor"     },
  merchandiser: { ru: "Мерчандайзер",   uz: "Merchandayzer"  },
  courier:      { ru: "Доставщик",      uz: "Yetkazib beruvchi" },
};

/* ── Invite Form ───────────────────────────────────────────────────────────── */
function InviteForm({ onDone, lang }: { onDone: () => void; lang: "ru" | "uz" }) {
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const [d, setD] = useState({ name: "", email: "", password: "", role: "agent" });
  const [showPw, setShowPw] = useState(false);

  const createUser = trpc.tenant.inviteUser.useMutation({
    onSuccess: () => {
      notify.success(t("Пользователь создан", "Foydalanuvchi yaratildi"));
      onDone();
    },
    onError: (e) => notify.error(e.message),
  });

  const handleSubmit = () => {
    if (!d.name || !d.email || !d.password) {
      notify.error(t("Заполните все поля", "Barcha maydonlarni to'ldiring"));
      return;
    }
    if (d.password.length < 8) {
      notify.error(t("Пароль минимум 8 символов", "Parol kamida 8 ta belgi"));
      return;
    }
    createUser.mutate({
      name: d.name,
      email: d.email,
      password: d.password,
      role: d.role as "operator" | "agent" | "supervisor" | "merchandiser",
    });
  };

  return (
    <div style={{
      background: COLORS.surface, borderRadius: "24px", padding: "24px",
      boxShadow: SHADOW, display: "flex", flexDirection: "column", gap: "16px",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
          {t("Создать пользователя", "Foydalanuvchi yaratish")}
        </h2>
        <button onClick={onDone} className="btn-ghost p-1.5"><X size={18} /></button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            {t("ИМЯ *", "ISM *")}
          </label>
          <input
            type="text"
            className="neo-input w-full"
            placeholder={t("Иван Иванов", "Ism Familiya")}
            value={d.name}
            onChange={e => setD(p => ({ ...p, name: e.target.value }))}
            autoFocus
          />
        </div>
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            EMAIL *
          </label>
          <input
            type="email"
            className="neo-input w-full"
            placeholder="agent@company.com"
            value={d.email}
            onChange={e => setD(p => ({ ...p, email: e.target.value }))}
          />
        </div>
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            {t("ПАРОЛЬ *", "PAROL *")}
          </label>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              className="neo-input w-full pr-10"
              placeholder="Минимум 8 символов"
              value={d.password}
              onChange={e => setD(p => ({ ...p, password: e.target.value }))}
              minLength={8}
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-tertiary hover:text-secondary"
            >
              {showPw ? "👁" : "👁‍🗨"}
            </button>
          </div>
        </div>
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            {t("РОЛЬ *", "LAVOZIM *")}
          </label>
          <PremiumSelect value={d.role}
            onChange={v => setD(p => ({ ...p, role: v }))}
            options={Object.entries(ROLE_LABELS).filter(([k]) => k !== "ceo").map(([k, v]) => ({ value: k, label: lang === "uz" ? v.uz : v.ru }))}
            width="100%" />
        </div>
      </div>

      <p style={{ fontSize: "12px", color: COLORS.textTertiary, fontFamily: F.body }}>
        {t(
          "Пользователь сможет войти сразу с указанным паролем",
          "Foydalanuvchi darhol kiritilgan parol bilan kirishi mumkin"
        )}
      </p>

      <button
        onClick={handleSubmit}
        disabled={createUser.isPending || !d.email || !d.name || !d.password}
        className="neo-btn-primary flex items-center gap-2 disabled:opacity-40"
      >
        {createUser.isPending && <Loader2 size={14} className="animate-spin" />}
        {t("Создать пользователя", "Foydalanuvchi yaratish")}
      </button>
    </div>
  );
}

/* ── Reset Password Modal ──────────────────────────────────────────────────── */
function ResetPasswordModal({ userId, userName, onClose, lang }: {
  userId: number; userName: string; onClose: () => void; lang: "ru" | "uz";
}) {
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const [pw, setPw] = useState("");
  const reset = trpc.user.resetPassword.useMutation({
    onSuccess: () => {
      notify.success(t(`Пароль изменён для ${userName}`, `${userName} uchun parol o'zgartirildi`));
      onClose();
    },
    onError: (e) => notify.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(4px)" }}>
      <div style={{
        background: COLORS.surface, borderRadius: "24px", padding: "24px",
        boxShadow: "0 24px 48px rgba(0,0,0,0.18)", width: "100%", maxWidth: "400px",
        display: "flex", flexDirection: "column", gap: "16px",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
            {t("Сброс пароля", "Parolni tiklash")} — {userName}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={18} /></button>
        </div>
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            {t("НОВЫЙ ПАРОЛЬ (мин. 8 символов)", "YANGI PAROL (kamida 8 ta belgi)")}
          </label>
          <input
            type="password"
            className="neo-input w-full"
            placeholder="••••••••"
            value={pw}
            onChange={e => setPw(e.target.value)}
            autoFocus
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => pw.length >= 8 && reset.mutate({ id: userId, newPassword: pw })}
            disabled={reset.isPending || pw.length < 8}
            className="neo-btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {reset.isPending && <Loader2 size={14} className="animate-spin" />}
            {t("Сохранить", "Saqlash")}
          </button>
          <button onClick={onClose} className="neo-btn flex-1">
            {t("Отмена", "Bekor")}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main ──────────────────────────────────────────────────────────────────── */
export default function Users() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [resetUser, setResetUser] = useState<{ id: number; name: string } | null>(null);
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  const { data, isLoading } = trpc.user.list.useQuery({
    page, pageSize: 25,
    search: search || undefined,
    role: role || undefined,
  }) as { data: any; isLoading: boolean };
  const utils = trpc.useUtils();
  const { confirm, dialog } = useConfirm();

  const updateUser = trpc.user.update.useMutation({
    onSuccess: () => { utils.user.list.invalidate(); notify.success(t("Пользователь обновлён", "Foydalanuvchi yangilandi")); },
    onError: (e) => notify.error(e.message),
  });

  const deactivate = trpc.user.deactivate.useMutation({
    onSuccess: () => { utils.user.list.invalidate(); notify.success(t("Пользователь деактивирован", "Foydalanuvchi deaktiv qilindi")); },
    onError: (e) => notify.error(e.message),
  });

  const handleDeactivate = async (id: number, name: string) => {
    const ok = await confirm({
      title: t(`Деактивировать ${name}?`, `${name}ni o'chirish?`),
      message: t(
        "Пользователь потеряет доступ к системе. Можно восстановить позже.",
        "Foydalanuvchi tizimga kirishdan mahrum bo'ladi. Keyinroq tiklash mumkin."
      ),
      confirmText: t("Деактивировать", "O'chirish"),
      danger: true,
    });
    if (ok) deactivate.mutate({ id });
  };

  /* ── Derived stats ─────────────────────────────────────────────────────── */
  const stats = useMemo(() => {
    const list = data?.data ?? [];
    return {
      total: data?.total ?? 0,
      active: list.filter((u: any) => u.status === "active").length,
      inactive: list.filter((u: any) => u.status !== "active").length,
    };
  }, [data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {dialog}
      {resetUser && (
        <ResetPasswordModal
          userId={resetUser.id}
          userName={resetUser.name}
          onClose={() => setResetUser(null)}
          lang={lang}
        />
      )}

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: F.display, fontSize: "24px", fontWeight: 700, color: COLORS.textPrimary, letterSpacing: "-0.025em", margin: 0 }}>
            {t("Пользователи", "Foydalanuvchilar")}
          </h1>
          {data && (
            <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: "4px 0 0", fontFamily: F.body }}>
              {data.total} {t("пользователей", "ta foydalanuvchi")}
            </p>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={() => data?.data && exportToExcel(formatUsersForExport(data.data), "users-export", "Пользователи", t("Список пользователей", "Foydalanuvchilar ro'yxati"))}
            style={{
              display: "flex", alignItems: "center", gap: "6px", padding: "8px 14px",
              fontSize: "13px", fontWeight: 500, fontFamily: F.body, borderRadius: "10px",
              border: `1px solid ${COLORS.border}`, cursor: "pointer",
              background: COLORS.surface, color: COLORS.textSecondary,
            }}>
            <FileDown size={14} /> Excel
          </button>
          <button
            onClick={() => setShowInvite(v => !v)}
            className="neo-btn-primary flex items-center gap-2"
          >
            <UserPlus size={16} />
            <span className="hidden sm:inline">{t("Создать", "Yaratish")}</span>
          </button>
        </div>
      </div>

      {/* ── KPI Cards ────────────────────────────────────────────────────── */}
      {!isLoading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
          <KpiCard
            label={t("ВСЕГО", "JAMI")}
            value={String(stats.total)}
            delta={null}
            icon={<UsersIcon size={20} color="#fff" />}
            gradient="linear-gradient(135deg, #4b6cf6, #4b6cf6)"
            delay={0}
          />
          <KpiCard
            label={t("АКТИВНЫЕ", "FAOLLAR")}
            value={String(stats.active)}
            delta={null}
            icon={<UserCheck size={20} color="#fff" />}
            gradient="linear-gradient(135deg, #16a34a, #22c47a)"
            delay={0.05}
          />
          <KpiCard
            label={t("НЕАКТИВНЫЕ", "NOFAOLLAR")}
            value={String(stats.inactive)}
            delta={null}
            icon={<UserX size={20} color="#fff" />}
            gradient="linear-gradient(135deg, #e85050, #e85050)"
            delay={0.1}
          />
        </div>
      )}

      {/* ── Invite Form ──────────────────────────────────────────────────── */}
      {showInvite && (
        <InviteForm
          lang={lang}
          onDone={() => { setShowInvite(false); utils.user.list.invalidate(); }}
        />
      )}

      {/* ── Filters ──────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
        background: COLORS.surface, borderRadius: "16px", padding: "16px 20px",
        boxShadow: SHADOW,
      }}>
        <div style={{ position: "relative", flex: "1 1 180px", maxWidth: "320px" }}>
          <Search size={15} style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: COLORS.textSecondary }} />
          <input
            className="neo-input w-full"
            style={{ paddingLeft: "36px" }}
            placeholder={t("Поиск пользователей…", "Foydalanuvchi qidirish…")}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <PremiumSelect value={role} onChange={v => setRole(v)}
          options={[{ value: "", label: t("Все роли", "Barcha lavozimlar") }, ...Object.entries(ROLE_LABELS).map(([k, v]) => ({ value: k, label: lang === "uz" ? v.uz : v.ru }))]}
          width="200px" />
      </div>

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div style={{
        background: COLORS.surface, borderRadius: "24px", padding: "0",
        boxShadow: SHADOW, overflow: "hidden",
      }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
            <thead>
              <tr>
                {[
                  t("ИМЯ", "ISM"),
                  t("EMAIL", "EMAIL"),
                  t("РОЛЬ", "LAVOZIM"),
                  t("СТАТУС", "HOLAT"),
                  t("ПОСЛЕДНИЙ ВХОД", "SO'NGGI KIRISH"),
                  "",
                ].map((h, i) => (
                  <th key={i} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6} style={{ padding: "14px 16px" }}>
                        <div style={{ height: "16px", borderRadius: "6px", background: COLORS.surfaceLight, animation: `slideUp ${0.4 + i * 0.05}s ease forwards` }} />
                      </td>
                    </tr>
                  ))
                : data?.data.length === 0
                ? (
                  <tr>
                    <td colSpan={6} style={{ ...tdStyle, textAlign: "center", padding: "48px 16px", color: COLORS.textSecondary, fontSize: "14px" }}>
                      {t("Пользователи не найдены", "Foydalanuvchilar topilmadi")}
                    </td>
                  </tr>
                )
                : data?.data.map((u: any) => (
                    <tr key={u.id} style={{ transition: "background 0.15s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(75,108,246,0.02)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      {/* Имя */}
                      <td style={tdStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                          <div style={{
                            width: "32px", height: "32px", borderRadius: "10px", flexShrink: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: "12px", fontWeight: 700,
                            background: "rgba(75,108,246,.12)",
                            color: "#4b6cf6",
                          }}>
                            {u.name?.[0]?.toUpperCase()}
                          </div>
                          <span style={{ fontSize: "14px", fontWeight: 500, fontFamily: F.body }}>{u.name}</span>
                        </div>
                      </td>
                      {/* Email */}
                      <td style={{ ...tdStyle, color: COLORS.textSecondary }}>{u.email}</td>
                      {/* Роль */}
                      <td style={tdStyle}>
                        <span className={`status-badge ${ROLE_COLORS[u.role] ?? ""}`}>
                          {ROLE_LABELS[u.role]?.[lang] ?? u.role}
                        </span>
                      </td>
                      {/* Статус */}
                      <td style={tdStyle}>
                        <span className={`status-badge ${
                          u.status === "active"
                            ? "bg-success/15 text-success border-success/30"
                            : "bg-danger/15 text-danger border-danger/30"
                        }`}>
                          {u.status === "active"
                            ? t("Активен", "Faol")
                            : t("Неактивен", "Faol emas")}
                        </span>
                      </td>
                      {/* Последний вход */}
                      <td style={{ ...tdStyle, fontSize: "13px", color: COLORS.textSecondary }}>
                        {u.lastSignInAt
                          ? format(new Date(u.lastSignInAt), "dd.MM.yyyy HH:mm")
                          : t("Не входил", "Kirmagan")}
                      </td>
                      {/* Действия */}
                      <td style={tdStyle}>
                        <div style={{ display: "flex", gap: "4px" }}>
                          <button
                            title={t("Сбросить пароль", "Parolni tiklash")}
                            onClick={() => setResetUser({ id: u.id, name: u.name })}
                            className="neo-btn p-1.5"
                          >
                            <KeyRound size={14} />
                          </button>
                          {u.status === "active" ? (
                            <button
                              title={t("Деактивировать", "O'chirish")}
                              onClick={() => handleDeactivate(u.id, u.name)}
                              className="neo-btn p-1.5 text-danger"
                              style={{ borderColor: "rgba(232,80,80,.30)" }}
                            >
                              <Power size={14} />
                            </button>
                          ) : (
                            <button
                              title={t("Активировать", "Faollashtirish")}
                              onClick={() => updateUser.mutate({ id: u.id, status: "active" })}
                              className="neo-btn p-1.5 text-success"
                              style={{ borderColor: "rgba(74,222,128,.30)" }}
                            >
                              <Power size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination ────────────────────────────────────────────────────── */}
      {data && data.total > 25 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "13px", color: COLORS.textSecondary, fontFamily: F.body }}>
            {data.total} {t("всего", "jami")}
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="neo-btn py-1 px-3 text-sm disabled:opacity-40"
            >
              {t("Назад", "Orqaga")}
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page * 25 >= data.total}
              className="neo-btn py-1 px-3 text-sm disabled:opacity-40"
            >
              {t("Далее", "Keyingi")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
