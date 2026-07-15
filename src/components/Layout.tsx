import { memo, useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useNotifications";
import { NAV_ITEMS } from "@/const";
import { GlobalSearch } from "@/components/GlobalSearch";
import { TrialBanner } from "@/components/TrialBanner";
import { OfflineQueueBadge } from "@/components/OfflineQueueBadge";
import { useTheme } from "@/hooks/useTheme";
import { useLang } from "@/i18n";
import { trpc } from "@/providers/trpc";
import {
  LayoutDashboard, Store, Package, ClipboardList, Truck,
  Warehouse, BarChart3, Users, Settings, PlusCircle, MapPin,
  Calendar, LogOut, X, Moon, Sun, WifiOff, Scan, Activity,
  TrendingUp, CreditCard, ChevronLeft, Bell, Zap,
} from "lucide-react";

const iconMap: Record<string, any> = {
  LayoutDashboard, Store, Package, ClipboardList, Truck,
  Warehouse, BarChart3, Users, Settings, PlusCircle, MapPin,
  Calendar, WifiOff, Scan, Activity, TrendingUp, CreditCard, Zap,
};

const PAGE_META: Record<string, { title: string; parent?: string; parentPath?: string }> = {
  "/":                  { title: "Главная" },
  "/super-admin":       { title: "Super Admin" },
  "/monitoring":        { title: "Мониторинг" },
  "/reports":           { title: "Отчёты" },
  "/shops":             { title: "Магазины" },
  "/products":          { title: "Товары" },
  "/orders":            { title: "Заказы" },
  "/orders/new":        { title: "Новый заказ", parent: "Заказы", parentPath: "/orders" },
  "/warehouse":         { title: "Склад" },
  "/warehouse-reports": { title: "Отчёты склада" },
  "/audit-log":         { title: "Аудит-лог" },
  "/arrivals":          { title: "Приходы" },
  "/pnl":               { title: "P&L" },
  "/users":             { title: "Пользователи" },
  "/billing":           { title: "Биллинг" },
  "/settings":          { title: "Настройки" },
  "/agent":             { title: "Мой день" },
  "/agent/shops":       { title: "Мои магазины" },
  "/agent/gps":         { title: "GPS", parent: "Мой день", parentPath: "/agent" },
  "/agent/plans":       { title: "Визиты" },
  "/deliveries":        { title: "Доставки" },
  "/supervisor":        { title: "Слежение" },
  "/supervisor/plans":  { title: "Планы", parent: "Слежение", parentPath: "/supervisor" },
  "/barcode":           { title: "Сканер" },
  "/offline-orders":    { title: "Офлайн" },
};

function usePageMeta() {
  const location = useLocation();
  if (PAGE_META[location.pathname]) return PAGE_META[location.pathname];
  const base = "/" + location.pathname.split("/")[1];
  const detail = PAGE_META[base];
  if (detail) return { title: detail.title, parent: detail.title, parentPath: base };
  return { title: "Warehouse Pro" };
}

// ── Desktop sidebar ───────────────────────────────────────────────────────────
const Sidebar = memo(function Sidebar({ onClose, unreadCount = 0 }: { onClose?: () => void; unreadCount?: number }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { lang, setLang, t } = useLang();
  const location = useLocation();
  const navigate = useNavigate();
  const role     = user?.role ?? "agent";
  const items    = NAV_ITEMS[role] ?? [];

  return (
    <div className="flex flex-col h-full sidebar-collapse-transition" style={{ background: "transparent" }}>
      {/* Logo */}
      <div className="flex items-center px-5 gap-3" style={{ height: "64px" }}>
        <div className="w-10 h-10 rounded-[14px] flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, var(--color-primary, #4b6cf6), var(--color-primary-hover, #3a5be5))", boxShadow: "var(--shadow-sm)" }}>
          <Warehouse size={18} color="#fff" />
        </div>
        <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary, #2d3748)", letterSpacing: "-0.02em" }}>Warehouse Pro</span>
        {onClose && (
          <button onClick={onClose} className="ml-auto md:hidden neo-btn-icon" style={{ width: "36px", height: "36px" }}>
            <X size={18} />
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-4 py-3">
        <GlobalSearch />
      </div>

      {/* User info */}
      <div className="px-4 py-3">
        <div className="neo-card-sm" style={{ padding: "14px" }}>
          <div className="flex items-center gap-3">
            <div
              className="avatar-premium flex-shrink-0"
              style={{ background: "var(--color-primary-subtle, rgba(75,108,246,.12))", color: "var(--color-primary, #4b6cf6)" }}
            >
              {(user?.name ?? "U")[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #2d3748)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name ?? "User"}</p>
              <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-primary, #4b6cf6)" }}>{role}</span>
            </div>
          </div>
          {user?.email && (
            <p style={{ fontSize: "11px", color: "var(--color-text-tertiary, #8b9bb4)", margin: "8px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</p>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 overflow-y-auto premium-scrollbar">
        {items.map(item => {
          const Icon     = iconMap[item.icon];
          const isActive = location.pathname === item.path ||
            (item.path !== "/" && location.pathname.startsWith(item.path));
          return (
            <button
              key={item.path}
              onClick={() => { navigate(item.path); onClose?.(); }}
              className={`sidebar-nav-item ${isActive ? "active" : ""}`}
            >
              {Icon && <Icon size={18} strokeWidth={isActive ? 2.5 : 1.5} />}
              <span>{t(item.labelKey)}</span>
            </button>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="p-4 space-y-2 mt-auto" style={{ borderTop: "1px solid var(--color-border-subtle, #d1d9e6)" }}>
        <button
          onClick={() => { navigate("/notifications"); onClose?.(); }}
          className="sidebar-nav-item w-full"
        >
          <div className="relative">
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] rounded-full text-white text-[9px] font-bold flex items-center justify-center px-1" style={{ background: "var(--color-danger, #e85050)", boxShadow: "var(--shadow-xs)" }}>
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </div>
          {t("nav.notifications")}
        </button>

        <div className="flex gap-2 mb-1 p-1 rounded-[12px]" style={{ background: "var(--color-surface)", boxShadow: "var(--shadow-pressed)" }}>
          {(["ru", "uz"] as const).map(l => (
            <button key={l} onClick={() => setLang(l)} className={`lang-btn ${lang === l ? "active" : ""}`}>
              {l === "ru" ? "РУС" : "UZB"}
            </button>
          ))}
        </div>
        <button onClick={toggle} className="neo-btn w-full flex items-center justify-center gap-2 text-xs">
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
          <span>{theme === "dark" ? "Светлая тема" : "Тёмная тема"}</span>
        </button>
        <button onClick={logout} className="neo-btn w-full flex items-center justify-center gap-2 text-xs" style={{ color: "var(--color-danger, #e85050)" }}>
          <LogOut size={14} />
          {t("nav.logout")}
        </button>
      </div>
    </div>
  );
});

// ── Mobile header ─────────────────────────────────────────────────────────────
const MobileHeader = memo(function MobileHeader({ onMenuClick, unreadCount }: { onMenuClick: () => void; unreadCount: number }) {
  const navigate = useNavigate();
  const meta     = usePageMeta();
  const hasParent = !!meta.parent;

  return (
    <header className="md:hidden h-[56px] flex items-center px-2 sticky top-0 z-40 gap-1 mobile-header-premium">
      {hasParent ? (
        <button onClick={() => navigate(meta.parentPath!)} className="btn-ghost p-2 flex items-center gap-1">
          <ChevronLeft size={20} />
        </button>
      ) : (
        <button onClick={onMenuClick} className="btn-ghost p-2" aria-label="Меню">
          <div className="flex flex-col gap-[5px]">
            <span className="block w-[18px] h-[1.5px] rounded" style={{ background: "var(--color-text-primary, #2b3450)" }} />
            <span className="block w-[18px] h-[1.5px] rounded" style={{ background: "var(--color-text-primary, #2b3450)" }} />
            <span className="block w-[14px] h-[1.5px] rounded" style={{ background: "var(--color-text-primary, #2b3450)" }} />
          </div>
        </button>
      )}

      <div className="flex-1 flex flex-col items-center">
        <span style={{ fontSize: "15px", fontWeight: 600, color: "var(--color-text-primary, #2b3450)", letterSpacing: "-0.01em" }}>
          {meta.title}
        </span>
        {hasParent && (
          <span style={{ fontSize: "11px", color: "var(--color-text-tertiary, #98a0b8)" }}>{meta.parent}</span>
        )}
      </div>

      <OfflineQueueBadge />

      <button onClick={() => navigate("/notifications")} className="btn-ghost p-2 relative">
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full text-white text-[10px] font-bold flex items-center justify-center px-1 shadow-sm" style={{ background: "var(--color-danger, #e85050)" }}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
    </header>
  );
});

// ── Mobile bottom navigation ──────────────────────────────────────────────────
const BOTTOM_NAV: Record<string, Array<{ ru: string; uz: string; path: string; icon: string; exact?: boolean }>> = {
  superadmin: [
    { ru: "Платформа", uz: "Platforma", path: "/super-admin", icon: "Zap", exact: true },
  ],
  ceo: [
    { ru: "Главная",   uz: "Bosh",      path: "/",          icon: "LayoutDashboard", exact: true },
    { ru: "Заказы",    uz: "Buyurtma",  path: "/orders",    icon: "ClipboardList" },
    { ru: "Магазины",  uz: "Do'konlar", path: "/shops",     icon: "Store" },
    { ru: "Склад",     uz: "Ombor",     path: "/warehouse", icon: "Warehouse" },
    { ru: "Отчёты",    uz: "Hisobot",   path: "/reports",   icon: "BarChart3" },
  ],
  operator: [
    { ru: "Главная",  uz: "Bosh",      path: "/",          icon: "LayoutDashboard", exact: true },
    { ru: "Заказы",   uz: "Buyurtma",  path: "/orders",    icon: "ClipboardList" },
    { ru: "Магазины", uz: "Do'konlar", path: "/shops",     icon: "Store" },
    { ru: "Приходы",  uz: "Kirimlar",  path: "/arrivals",  icon: "Truck" },
    { ru: "Склад",    uz: "Ombor",     path: "/warehouse", icon: "Warehouse" },
  ],
  agent: [
    { ru: "День",     uz: "Kun",       path: "/agent",          icon: "LayoutDashboard", exact: true },
    { ru: "Магазины", uz: "Do'konlar", path: "/agent/shops",    icon: "Store" },
    { ru: "Заказ",    uz: "Buyurtma",  path: "/orders/new",     icon: "PlusCircle" },
    { ru: "Сканер",   uz: "Skaner",    path: "/barcode",        icon: "Scan" },
    { ru: "Офлайн",   uz: "Oflayn",    path: "/offline-orders", icon: "WifiOff" },
  ],
  supervisor: [
    { ru: "Карта",    uz: "Xarita",    path: "/supervisor",       icon: "MapPin", exact: true },
    { ru: "Планы",    uz: "Rejalar",   path: "/supervisor/plans", icon: "Calendar" },
    { ru: "Отчёты",   uz: "Hisobot",   path: "/reports",          icon: "BarChart3" },
    { ru: "Настройки",uz: "Sozlamalar",path: "/settings",         icon: "Settings" },
  ],
  merchandiser: [
    { ru: "День",     uz: "Kun",       path: "/agent",       icon: "LayoutDashboard", exact: true },
    { ru: "Магазины", uz: "Do'konlar", path: "/agent/shops", icon: "Store" },
    { ru: "Настройки",uz: "Sozlamalar",path: "/settings",    icon: "Settings" },
  ],
};

const BottomNav = memo(function BottomNav() {
  const { user }  = useAuth();
  const { lang }  = useLang();
  const location  = useLocation();
  const navigate  = useNavigate();
  const role      = user?.role ?? "agent";
  const items     = BOTTOM_NAV[role] ?? [];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bottom-nav-premium" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex h-[60px]">
        {items.map(item => {
          const Icon     = iconMap[item.icon];
          const isActive = item.exact
            ? location.pathname === item.path
            : location.pathname === item.path || location.pathname.startsWith(item.path + "/");
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="flex-1 flex flex-col items-center justify-center gap-[3px] relative"
              style={{ color: isActive ? "var(--color-primary, #4b6cf6)" : "var(--color-text-tertiary, #98a0b8)" }}
            >
              {isActive && (
                <span className="absolute top-1.5 left-1/2 -translate-x-1/2 w-5 h-[3px] rounded-full" style={{ background: "var(--color-primary, #4b6cf6)" }} />
              )}
              {Icon && <Icon size={22} />}
              <span style={{ fontSize: "10px", fontWeight: 500, letterSpacing: "-0.01em" }}>
                {lang === "uz" ? item.uz : item.ru}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
});

// ── Mobile drawer ─────────────────────────────────────────────────────────────
const MobileDrawer = memo(function MobileDrawer({ open, onClose, unreadCount }: { open: boolean; onClose: () => void; unreadCount: number }) {
  return open ? (
    <div className="fixed inset-0 z-50 flex md:hidden">
      <div className="absolute inset-0 glass-overlay" onClick={onClose} />
      <div className="relative w-[280px] h-full animate-slide-in sidebar-collapse-transition">
        <Sidebar onClose={onClose} unreadCount={unreadCount} />
      </div>
    </div>
  ) : null;
});

// ── Root layout ───────────────────────────────────────────────────────────────
export default function Layout({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { user, isLoading }         = useAuth();
  const navigate                    = useNavigate();
  const location                    = useLocation();
  const { unreadCount }             = useNotifications();

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const { data: sub } = trpc.stripe.getSubscription.useQuery(undefined, {
    enabled: !!user && !["superadmin", "supervisor", "merchandiser"].includes(user.role),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (isLoading || window.__LOGGING_OUT) return;
    if (!user && location.pathname !== "/login") {
      navigate("/login", { replace: true });
    }
  }, [user, isLoading, navigate, location.pathname]);

  useEffect(() => {
    if (user?.role === "superadmin" || user?.role === "supervisor" || user?.role === "merchandiser") return;
    if (sub && !sub.isActive && sub.status !== "trialing") {
      navigate("/subscription-blocked", { replace: true });
    }
  }, [sub, navigate, user]);

  if (isLoading || !user) return null;

  return (
    <div className="min-h-screen">
      <MobileHeader onMenuClick={openDrawer} unreadCount={unreadCount} />
      <MobileDrawer open={drawerOpen} onClose={closeDrawer} unreadCount={unreadCount} />

      <div className="md:ml-[280px]">
        {user?.role !== "superadmin" && user?.role !== "supervisor" && user?.role !== "merchandiser" && <TrialBanner />}
      </div>

      {/* Floating sidebar — neumorphic card */}
      <aside className="hidden md:block fixed left-[16px] top-[16px] bottom-[16px] w-[248px] z-40 rounded-[24px] overflow-hidden neo-card" style={{ padding: 0, display: "flex", flexDirection: "column" }}>
        <Sidebar unreadCount={unreadCount} />
      </aside>

      <main className="md:ml-[280px] min-h-screen">
        <div key={location.pathname} className="p-5 md:p-6 pb-[84px] md:pb-6 animate-fade-up">
          {children}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
