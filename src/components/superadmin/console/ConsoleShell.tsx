import { memo, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ArrowLeft, Bell, LogOut, Moon, Search, Sun } from "lucide-react";
import { AppBrand } from "@/components/brand/AppBrand";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { useNotifications } from "@/hooks/useNotifications";
import { FixedLang } from "@/i18n";
import { CONSOLE_NAV, CONSOLE_TABS, activeSection, activeTab, consolePageKey, consoleTitle } from "./nav";
import { OrgSearchBar, OrgSearchPalette } from "./OrgSearch";
import { openOrgSearch } from "./org-search-events";
import { useConsoleBadges } from "./badges";

/* ═══════════════════════════════════════════════════════════════════════════
   Оболочка консоли платформы — для роли superadmin вместо общего Layout.

   ── Что было ────────────────────────────────────────────────────────────────

   Суперадмин жил в оболочке склада: «Справка» с книгой дистрибьютора,
   переключатель «РУС/UZB», поиск по товарам и заказам, которых у него нет,
   и меню из двух пунктов — «Super Admin» и «Мониторинг». Всё остальное
   лежало стопкой на одной странице.

   ── Что теперь ──────────────────────────────────────────────────────────────

   Компьютер — колонка разделов слева (у каждого свой адрес), сверху поиск
   организации и колокольчик; внизу колонки — кто вошёл, тема и выход.
   Телефон — шапка с заголовком, поиском и колокольчиком, внизу вкладки
   «Обзор», «Организации», «Обращения», «Ещё».

   Только по-русски (владелец, 01.10.2026): язык закреплён FixedLang и не
   зависит от сохранённого в браузере. «Справки» нет — книга для
   дистрибьютора, владельцу платформы она не нужна.

   Колокольчик оставлен: суперадмину приходят тревоги Alertmanager
   (api/webhooks/alertmanager.ts пишет уведомление каждому суперадмину).
   ═══════════════════════════════════════════════════════════════════════════ */


function Badge({ n, testId }: { n: number; testId?: string }) {
  if (n <= 0) return null;
  return (
    <span data-testid={testId} className="flex items-center justify-center" style={{
      minWidth: 20, height: 20, padding: "0 6px", borderRadius: 999, fontSize: 11, fontWeight: 800,
      background: "var(--color-danger-strong, var(--color-danger))", color: "#fff", fontVariantNumeric: "tabular-nums",
    }}>{n > 99 ? "99+" : n}</span>
  );
}

const Sidebar = memo(function Sidebar() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const badges = useConsoleBadges();
  const current = activeSection(location.pathname);
  const onProfile = location.pathname.startsWith("/settings");
  const totpOn = Boolean((user as { totpEnabledAt?: unknown } | null)?.totpEnabledAt);

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--color-surface)" }}>
      <div className="flex items-center gap-3" style={{ height: 72, padding: "0 20px" }}>
        <AppBrand size={34} className="flex-shrink-0" />
      </div>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-tertiary)", margin: "4px 28px 6px" }}>
        Консоль платформы
      </p>

      <nav aria-label="Разделы консоли" className="flex-1 overflow-y-auto premium-scrollbar" data-testid="console-nav">
        {CONSOLE_NAV.map(s => {
          const on = current === s.key;
          const n = s.key === "support" ? badges.support : s.key === "leads" ? badges.leads : 0;
          return (
            <button key={s.key} type="button" onClick={() => navigate(s.path)} aria-current={on ? "page" : undefined}
              className={`sidebar-nav-item ${on ? "active" : ""}`} style={{ minHeight: 44, fontSize: 14 }} data-testid={`console-nav-${s.key}`}>
              <s.icon size={18} strokeWidth={on ? 2.4 : 1.7} />
              <span className="flex-1">{s.label}</span>
              <Badge n={n} testId={`console-badge-${s.key}`} />
            </button>
          );
        })}
      </nav>

      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Кто вошёл — карточкой-ссылкой в свой профиль: логин, пароль, вход с кодом. */}
        <Link to="/settings?section=profile" data-testid="console-account"
          className="flex items-center gap-3" aria-current={onProfile ? "page" : undefined}
          style={{ padding: 12, borderRadius: 16, textDecoration: "none", minHeight: 44,
            background: onProfile ? "var(--color-primary-subtle)" : "var(--color-surface-light)", boxShadow: "var(--shadow-pressed)" }}>
          <span className="flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, borderRadius: 12, background: "var(--color-primary-subtle)", color: "var(--color-primary-text)", fontWeight: 800 }}>
            {(user?.name ?? "В").trim()[0]?.toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate" style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-text-primary)" }}>{user?.name ?? "Владелец платформы"}</span>
            <span className="block truncate" style={{ fontSize: 11.5, color: "var(--color-text-tertiary)" }}>{user?.email}</span>
            {/* Без второго фактора закрыты удаление организаций, выгрузка базы и
                уборка журнала — сказать здесь, а не в момент отказа. */}
            {!totpOn && <span className="block" data-testid="console-totp-off" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--color-warning-text)", marginTop: 2, lineHeight: 1.3 }}>Вход с кодом из приложения выключен</span>}
          </span>
        </Link>
        <div className="flex gap-2">
          <button type="button" onClick={toggle} className="neo-btn flex-1" style={{ minHeight: 44, padding: "0 10px", fontSize: 12.5 }} data-testid="console-theme">
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            {theme === "dark" ? "Светлая" : "Тёмная"}
          </button>
          <button type="button" onClick={logout} className="neo-btn flex-1" style={{ minHeight: 44, padding: "0 10px", fontSize: 12.5, color: "var(--color-danger-text)" }} data-testid="console-logout">
            <LogOut size={15} /> Выйти
          </button>
        </div>
      </div>
    </div>
  );
});

function BellButton({ size = 44 }: { size?: number }) {
  const navigate = useNavigate();
  const { unreadCount } = useNotifications();
  return (
    <button type="button" onClick={() => navigate("/notifications")} aria-label="Уведомления" data-testid="console-bell"
      className="neo-btn-icon relative flex-shrink-0" style={{ width: size, height: size, borderRadius: 14 }}>
      <Bell size={18} />
      {unreadCount > 0 && (
        <span className="absolute" style={{ top: -4, right: -4 }}><Badge n={unreadCount} /></span>
      )}
    </button>
  );
}

function DesktopTopBar() {
  return (
    <div className="hidden md:flex items-center gap-3" style={{ padding: "20px 24px 4px" }}>
      <div className="flex-1 min-w-0"><OrgSearchBar /></div>
      <BellButton />
    </div>
  );
}

function MobileHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { title, back } = consoleTitle(location.pathname);
  return (
    <header className="md:hidden sticky top-0 z-40 flex items-center gap-2.5 mobile-header-premium"
      style={{ height: "calc(60px + env(safe-area-inset-top, 0px))", paddingTop: "env(safe-area-inset-top, 0px)", paddingLeft: 16, paddingRight: 12 }}>
      {back && (
        <button type="button" onClick={() => navigate(back)} aria-label="Назад" className="neo-btn-icon flex-shrink-0" style={{ width: 44, height: 44, borderRadius: 14 }}>
          <ArrowLeft size={19} />
        </button>
      )}
      <p className="flex-1 min-w-0 truncate" style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--color-text-primary)", margin: 0 }}>{title}</p>
      <button type="button" onClick={openOrgSearch} aria-label="Найти организацию" data-testid="console-search-button"
        className="neo-btn-icon flex-shrink-0" style={{ width: 44, height: 44, borderRadius: 14 }}>
        <Search size={18} />
      </button>
      <BellButton />
    </header>
  );
}

function BottomTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const badges = useConsoleBadges();
  const on = activeTab(location.pathname);
  return (
    <nav aria-label="Разделы консоли" className="md:hidden fixed bottom-0 left-0 right-0 z-40 bottom-nav-premium" data-testid="console-tabs"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex" style={{ height: 64, padding: "4px 4px 0" }}>
        {CONSOLE_TABS.map(t => {
          const active = on === t.key;
          const n = t.key === "support" ? badges.support : t.key === "more" ? badges.leads : 0;
          return (
            <button key={t.key} type="button" onClick={() => navigate(t.path)} aria-current={active ? "page" : undefined} aria-label={t.label}
              data-testid={`console-tab-${t.key}`} className="flex-1 min-w-0 flex flex-col items-center justify-center active:opacity-60">
              <span className="relative flex items-center justify-center rounded-full" style={{ width: 56, height: 32, background: active ? "var(--color-primary-subtle)" : "transparent" }}>
                <t.icon size={22} strokeWidth={active ? 2.25 : 1.75} color={active ? "var(--color-primary-text)" : "var(--color-text-tertiary)"} />
                {n > 0 && <span className="absolute" style={{ top: -3, right: 2 }}><Badge n={n} testId={`console-tab-badge-${t.key}`} /></span>}
              </span>
              <span className="max-w-full truncate" style={{ fontSize: 11.5, lineHeight: "14px", marginTop: 3, fontWeight: active ? 700 : 500, color: active ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function ConsoleShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <FixedLang lang="ru">
      <div className="min-h-screen" data-testid="console-shell">
        <MobileHeader />
        <aside className="hidden md:flex fixed left-[16px] top-[16px] bottom-[16px] w-[248px] z-40 rounded-[24px] overflow-hidden neo-card neo-card-static flex-col" style={{ padding: 0 }}>
          <Sidebar />
        </aside>
        <main className="md:ml-[280px] min-h-screen">
          <DesktopTopBar />
          <div key={consolePageKey(location.pathname)} className="animate-fade-up console-page"
            style={{ maxWidth: 1360 }}>
            {children}
          </div>
        </main>
        <BottomTabs />
        <OrgSearchPalette />
      </div>
    </FixedLang>
  );
}
