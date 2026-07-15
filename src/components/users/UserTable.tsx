import { COLORS, SHADOW, thStyle, type User, type Lang } from "./types";
import { UserRow } from "./UserRow";

interface UserTableProps {
  users: User[];
  isLoading: boolean;
  page: number;
  total: number;
  lang: Lang;
  onResetPassword: (id: number, name: string) => void;
  onDeactivate: (id: number, name: string) => void;
  onReactivate: (id: number) => void;
  onPageChange: (page: number) => void;
}

export function UserTable({ users, isLoading, page, total, lang, onResetPassword, onDeactivate, onReactivate, onPageChange }: UserTableProps) {
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  return (
    <>
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
                : users.length === 0
                ? (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", padding: "48px 16px", color: COLORS.textSecondary, fontSize: "14px", fontFamily: "var(--font-body, 'DM Sans', -apple-system, sans-serif)" }}>
                      {t("Пользователи не найдены", "Foydalanuvchilar topilmadi")}
                    </td>
                  </tr>
                )
                : users.map(u => (
                    <UserRow
                      key={u.id}
                      user={u}
                      lang={lang}
                      onResetPassword={onResetPassword}
                      onDeactivate={onDeactivate}
                      onReactivate={onReactivate}
                    />
                  ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > 25 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: "13px", color: COLORS.textSecondary }}>
            {total} {t("всего", "jami")}
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page === 1}
              className="neo-btn py-1 px-3 text-sm disabled:opacity-40"
            >
              {t("Назад", "Orqaga")}
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page * 25 >= total}
              className="neo-btn py-1 px-3 text-sm disabled:opacity-40"
            >
              {t("Далее", "Keyingi")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
