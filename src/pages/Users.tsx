import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { exportToExcel, formatUsersForExport } from "@/lib/excel";
import { useConfirm } from "@/components/ConfirmDialog";
import { Search, UserPlus, Loader2, Power, KeyRound, X, FileDown } from "lucide-react";
import { format } from "date-fns";
import { PremiumSelect } from "@/components/PremiumSelect";

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

// ── Форма приглашения ─────────────────────────────────────────────────────────
function InviteForm({ onDone, lang }: { onDone: () => void; lang: "ru" | "uz" }) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [d, setD] = useState({ email: "", role: "agent" });

  const invite = trpc.invite.send.useMutation({
    onSuccess: () => {
      notify.success(t("Приглашение отправлено", "Taklif yuborildi"));
      onDone();
    },
    onError: (e) => notify.error(e.message),
  });

  return (
    <div className="panel p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base text-text-primary">
          {t("Пригласить пользователя", "Foydalanuvchi taklif qilish")}
        </h2>
        <button onClick={onDone} className="btn-ghost p-1.5"><X size={18} /></button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">
            EMAIL *
          </label>
          <input
            type="email"
            className="input-field w-full"
            placeholder="agent@company.com"
            value={d.email}
            onChange={e => setD(p => ({ ...p, email: e.target.value }))}
            autoFocus
          />
        </div>
        <div>
          <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">
            {t("РОЛЬ *", "LAVOZIM *")}
          </label>
          <PremiumSelect value={d.role}
            onChange={v => setD(p => ({ ...p, role: v }))}
            options={Object.entries(ROLE_LABELS).filter(([k]) => k !== "ceo").map(([k, v]) => ({value:k,label:lang === "uz" ? v.uz : v.ru}))}
            width="100%" />
        </div>
      </div>

      <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
        {t(
          "Пользователь получит письмо со ссылкой для регистрации",
          "Foydalanuvchi ro'yxatdan o'tish havolasi bilan xat oladi"
        )}
      </p>

      <button
        onClick={() => d.email && invite.mutate({ email: d.email, role: d.role as "operator" | "agent" | "supervisor" | "merchandiser" | "courier" })}
        disabled={invite.isPending || !d.email}
        className="btn-primary flex items-center gap-2 disabled:opacity-40"
      >
        {invite.isPending && <Loader2 size={14} className="animate-spin" />}
        {t("Отправить приглашение", "Taklif yuborish")}
      </button>
    </div>
  );
}

// ── Модальное окно сброса пароля ──────────────────────────────────────────────
function ResetPasswordModal({ userId, userName, onClose, lang }: {
  userId: number; userName: string; onClose: () => void; lang: "ru" | "uz";
}) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
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
      <div className="relative panel p-6 w-full max-w-sm space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base text-text-primary">
            {t("Сброс пароля", "Parolni tiklash")} — {userName}
          </h2>
          <button onClick={onClose} className="btn-ghost p-1.5"><X size={18} /></button>
        </div>
        <div>
          <label className="font-label text-[10px] text-text-secondary tracking-wider block mb-1.5">
            {t("НОВЫЙ ПАРОЛЬ (мин. 8 символов)", "YANGI PAROL (kamida 8 ta belgi)")}
          </label>
          <input
            type="password"
            className="input-field w-full"
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
            className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {reset.isPending && <Loader2 size={14} className="animate-spin" />}
            {t("Сохранить", "Saqlash")}
          </button>
          <button onClick={onClose} className="btn-secondary flex-1">
            {t("Отмена", "Bekor")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Главная страница ──────────────────────────────────────────────────────────
export default function Users() {
  const [page,   setPage]   = useState(1);
  const [search, setSearch] = useState("");
  const [role,   setRole]   = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [resetUser,  setResetUser]  = useState<{ id: number; name: string } | null>(null);
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;

  const { data, isLoading } = trpc.user.list.useQuery({
    page, pageSize: 25,
    search: search || undefined,
    role:   role   || undefined,
  }) as { data: any; isLoading: boolean };
  const utils              = trpc.useUtils();
  const { confirm, dialog } = useConfirm();

  const updateUser = trpc.user.update.useMutation({
    onSuccess: () => { utils.user.list.invalidate(); notify.success(t("Пользователь обновлён", "Foydalanuvchi yangilandi")); },
    onError:   (e) => notify.error(e.message),
  });

  const deactivate = trpc.user.deactivate.useMutation({
    onSuccess: () => { utils.user.list.invalidate(); notify.success(t("Пользователь деактивирован", "Foydalanuvchi deaktiv qilindi")); },
    onError:   (e) => notify.error(e.message),
  });

  const handleDeactivate = async (id: number, name: string) => {
    const ok = await confirm({
      title:       t(`Деактивировать ${name}?`, `${name}ni o'chirish?`),
      message:     t(
        "Пользователь потеряет доступ к системе. Можно восстановить позже.",
        "Foydalanuvchi tizimga kirishdan mahrum bo'ladi. Keyinroq tiklash mumkin."
      ),
      confirmText: t("Деактивировать", "O'chirish"),
      danger:      true,
    });
    if (ok) deactivate.mutate({ id });
  };

  const TABLE_HEADERS = [
    t("ИМЯ",          "ISM"),
    t("EMAIL",        "EMAIL"),
    t("РОЛЬ",         "LAVOZIM"),
    t("СТАТУС",       "HOLAT"),
    t("ПОСЛЕДНИЙ ВХОД","SO'NGGI KIRISH"),
    "",
  ];

  return (
    <div className="space-y-4 animate-fade-up">
      {dialog}
      {resetUser && (
        <ResetPasswordModal
          userId={resetUser.id}
          userName={resetUser.name}
          onClose={() => setResetUser(null)}
          lang={lang}
        />
      )}

      {/* Заголовок */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary tracking-tight">
            {t("Пользователи", "Foydalanuvchilar")}
          </h1>
          {data && (
            <p className="text-xs mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
              {data.total} {t("пользователей", "ta foydalanuvchi")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => data?.data && exportToExcel(formatUsersForExport(data.data), "users-export", "Пользователи", t("Список пользователей", "Foydalanuvchilar ro'yxati"))}
            className="btn-secondary flex items-center gap-2 text-sm py-2 px-4">
            <FileDown size={15} /> Excel
          </button>
          <button
            onClick={() => setShowInvite(v => !v)}
            className="btn-primary flex items-center gap-2"
          >
            <UserPlus size={16} />
            <span className="hidden sm:inline">{t("Пригласить", "Taklif qilish")}</span>
          </button>
        </div>
      </div>

      {/* Форма приглашения */}
      {showInvite && (
        <InviteForm
          lang={lang}
          onDone={() => { setShowInvite(false); utils.user.list.invalidate(); }}
        />
      )}

      {/* Фильтры */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            className="input-field pl-9 w-full"
            placeholder={t("Поиск пользователей…", "Foydalanuvchi qidirish…")}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <PremiumSelect value={role} onChange={v => setRole(v)}
          options={[{value:"",label:t("Все роли", "Barcha lavozimlar")},...Object.entries(ROLE_LABELS).map(([k,v])=>({value:k,label:lang==="uz"?v.uz:v.ru}))]}
          width="200px" />
      </div>

      {/* Таблица */}
      <div className="panel overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              {TABLE_HEADERS.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6}>
                      <div className="h-4 bg-surface-light animate-pulse rounded" />
                    </td>
                  </tr>
                ))
              : data?.data.length === 0
              ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-text-secondary text-sm">
                    {t("Пользователи не найдены", "Foydalanuvchilar topilmadi")}
                  </td>
                </tr>
              )
              : data?.data.map((u: any) => (
                  <tr key={u.id}>
                    {/* Имя */}
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold"
                          style={{ background: "color-mix(in srgb, var(--color-primary) 12%, transparent)", color: "var(--color-primary)" }}
                        >
                          {u.name?.[0]?.toUpperCase()}
                        </div>
                        <span className="text-sm font-medium text-text-primary">{u.name}</span>
                      </div>
                    </td>
                    {/* Email */}
                    <td className="text-text-secondary">{u.email}</td>
                    {/* Роль */}
                    <td>
                      <span className={`status-badge ${ROLE_COLORS[u.role] ?? ""}`}>
                        {ROLE_LABELS[u.role]?.[lang] ?? u.role}
                      </span>
                    </td>
                    {/* Статус */}
                    <td>
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
                    <td className="text-text-secondary text-xs font-data">
                      {u.lastSignInAt
                        ? format(new Date(u.lastSignInAt), "dd.MM.yyyy HH:mm")
                        : t("Не входил", "Kirmagan")}
                    </td>
                    {/* Действия */}
                    <td>
                      <div className="flex gap-1">
                        <button
                          title={t("Сбросить пароль", "Parolni tiklash")}
                          onClick={() => setResetUser({ id: u.id, name: u.name })}
                          className="btn-secondary p-1.5"
                        >
                          <KeyRound size={14} />
                        </button>
                        {u.status === "active" ? (
                          <button
                            title={t("Деактивировать", "O'chirish")}
                            onClick={() => handleDeactivate(u.id, u.name)}
                            className="btn-secondary p-1.5 text-danger"
                            style={{ borderColor: "color-mix(in srgb, var(--color-danger) 30%, transparent)" }}
                          >
                            <Power size={14} />
                          </button>
                        ) : (
                          <button
                            title={t("Активировать", "Faollashtirish")}
                            onClick={() => updateUser.mutate({ id: u.id, status: "active" })}
                            className="btn-secondary p-1.5 text-success"
                            style={{ borderColor: "color-mix(in srgb, var(--color-success) 30%, transparent)" }}
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

      {/* Пагинация */}
      {data && data.total > 25 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-secondary">
            {data.total} {t("всего", "jami")}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="btn-secondary py-1 px-3 text-sm disabled:opacity-40"
            >
              {t("Назад", "Orqaga")}
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page * 25 >= data.total}
              className="btn-secondary py-1 px-3 text-sm disabled:opacity-40"
            >
              {t("Далее", "Keyingi")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
