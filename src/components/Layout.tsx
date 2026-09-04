import { memo, useState, useEffect, useCallback, useMemo } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useNotifications";
import { NAV_ITEMS, pickActivePath } from "@/const";
import { GlobalSearch } from "@/components/GlobalSearch";
import { TrialBanner } from "@/components/TrialBanner";
import { OfflineQueueBadge } from "@/components/OfflineQueueBadge";
import { useTheme } from "@/hooks/useTheme";
import { useLang } from "@/i18n";
import { useWarehouse } from "@/providers/WarehouseContext";
import { trpc } from "@/providers/trpc";
import {
  LayoutDashboard, Store, Package, ClipboardList, Truck,
  Warehouse, BarChart3, Users, Settings, PlusCircle, MapPin,
  Calendar, LogOut, X, Moon, Sun, WifiOff, Scan, Activity,
  TrendingUp, CreditCard, ChevronLeft, Bell, Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";

const iconMap: Record<string, LucideIcon> = {
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
  "/catalog":           { title: "Каталог" },
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
  const { selectedId, setSelectedId, warehouses, isLoading: whLoading } = useWarehouse();
  const location = useLocation();
  const navigate = useNavigate();
  const role     = user?.role ?? "agent";
  const items    = NAV_ITEMS[role] ?? [];
  const showWarehouseSelector = role === "ceo" || role === "operator";

  return (
    <div className="flex flex-col h-full sidebar-collapse-transition" style={{ background: "var(--color-surface, #efedea)" }}>
      {/* Logo.

          Тот же приём, что у MobileHeader выше: высота растёт на
          safe-area-inset-top вместо паддинга поверх жёсткой высоты. Этот блок
          используется дважды — в мобильном выдвижном меню, где панель стоит
          от самого верха экрана (fixed inset-0), и в неподвижной боковой
          панели на десктопе, у которой сверху и так есть отступ 16px. На
          десктопе inset-top всегда 0, так что там ничего не меняется; правка
          нужна только мобильному меню, где без неё крестик закрытия в
          установленном PWA утыкается под вырез или Dynamic Island — тапнуть
          по нему получается не с первого раза. */}
      <div
        className="flex items-center px-5 gap-3"
        style={{ height: "calc(64px + env(safe-area-inset-top, 0px))", paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <LogoMark size={36} className="flex-shrink-0" decorative />
        <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary, #2b2a28)", letterSpacing: "-0.02em" }}>Warehouse Pro</span>
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
              style={{ background: "var(--color-primary-subtle)", color: "var(--color-primary)" }}
            >
              {(user?.name ?? "U")[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary, #2b2a28)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.name ?? "User"}</p>
              <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-primary-text)" }}>{role}</span>
            </div>
          </div>
          {user?.email && (
            <p style={{ fontSize: "11px", color: "var(--color-text-tertiary, #6b6760)", margin: "8px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</p>
          )}
        </div>
      </div>

      {/* Warehouse selector */}
      {showWarehouseSelector && warehouses.length > 0 && (
        <div className="px-4 pb-2">
          <label className="block" style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-tertiary, #6b6760)", marginBottom: "6px" }}>
            {t("nav.warehouse")}
          </label>
          <PremiumSelect
            value={selectedId != null ? String(selectedId) : ""}
            onChange={v => setSelectedId(Number(v))}
            disabled={whLoading}
            aria-label={t("nav.warehouse")}
            width="100%"
            placeholder={t("warehouse.allWarehouses")}
            options={[
              { value: "", label: t("warehouse.allWarehouses") },
              ...warehouses.map(w => ({ value: String(w.id), label: `${w.name}${w.isDefault ? " ★" : ""}` })),
            ]}
          />
        </div>
      )}

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
      <div className="p-4 space-y-2 mt-auto" style={{ borderTop: "1px solid var(--color-border-subtle, #e0ddd7)" }}>
        <button
          onClick={() => { navigate("/notifications"); onClose?.(); }}
          className="sidebar-nav-item w-full"
        >
          <div className="relative">
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-[16px] rounded-full text-white text-[9px] font-bold flex items-center justify-center px-1" style={{ background: "var(--color-danger-strong)", boxShadow: "var(--shadow-xs)" }}>
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
        <button onClick={logout} className="neo-btn w-full flex items-center justify-center gap-2 text-xs" style={{ color: "var(--color-danger-text)" }}>
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

  /*
   * Высота растёт на safe-area-inset-top, а не просто получает padding-top:
   * с жёсткой высотой (box-sizing: border-box из preflight) паддинг сверху
   * отъедал бы место у иконок, а на iPhone с вырезом или Dynamic Island
   * (inset доходит до 59px) содержимое сплющилось бы почти в ноль. Тот же
   * приём, что и у отступа под нижнюю навигацию несколькими строками ниже
   * (calc(60px+env(safe-area-inset-bottom,0px))) — только сверху.
   *
   * Без этого шапка пряталась под часами и вырезом iPhone, но только в
   * установленном PWA (display: standalone): apple-mobile-web-app-status-bar-style
   * стоит black-translucent, а это режим, где страница рисуется ПОД строкой
   * состояния. В обычной вкладке Safari браузер сам добавляет свою полосу
   * сверху, и бага не видно — отсюда путаница «в браузере нормально, в
   * установленном приложении криво». Агентов бьёт сильнее прочих ролей:
   * именно их подталкивают ставить приложение на экран ради офлайн-режима
   * (см. InstallPrompt.tsx), то есть именно они чаще всего в standalone.
   */
  return (
    <header className="md:hidden flex items-center px-2 sticky top-0 z-40 gap-1 mobile-header-premium h-[calc(56px+env(safe-area-inset-top,0px))] pt-[env(safe-area-inset-top,0px)]">
      {hasParent ? (
        <button onClick={() => navigate(meta.parentPath!)} className="btn-ghost p-2 flex items-center gap-1">
          <ChevronLeft size={20} />
        </button>
      ) : (
        <button onClick={onMenuClick} className="btn-ghost p-2" aria-label="Меню">
          <div className="flex flex-col gap-[5px]">
            <span className="block w-[18px] h-[1.5px] rounded" style={{ background: "var(--color-text-primary, #2b2a28)" }} />
            <span className="block w-[18px] h-[1.5px] rounded" style={{ background: "var(--color-text-primary, #2b2a28)" }} />
            <span className="block w-[14px] h-[1.5px] rounded" style={{ background: "var(--color-text-primary, #2b2a28)" }} />
          </div>
        </button>
      )}

      <div className="flex-1 flex flex-col items-center">
        <span style={{ fontSize: "15px", fontWeight: 600, color: "var(--color-text-primary, #2b2a28)", letterSpacing: "-0.01em" }}>
          {meta.title}
        </span>
        {hasParent && (
          <span style={{ fontSize: "11px", color: "var(--color-text-tertiary, #6b6760)" }}>{meta.parent}</span>
        )}
      </div>

      <OfflineQueueBadge />

      <button onClick={() => navigate("/notifications")} className="btn-ghost p-2 relative">
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full text-white text-[10px] font-bold flex items-center justify-center px-1 shadow-sm" style={{ background: "var(--color-danger-strong)" }}>
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
    { ru: "KPI",       uz: "KPI",       path: "/agent/kpi",  icon: "BarChart3" },
    { ru: "Заказы",    uz: "Buyurtma",  path: "/orders",    icon: "ClipboardList" },
    { ru: "Магазины",  uz: "Do'konlar", path: "/shops",     icon: "Store" },
    { ru: "Склад",     uz: "Ombor",     path: "/warehouse", icon: "Warehouse" },
    { ru: "Отчёты",    uz: "Hisobot",   path: "/reports",   icon: "BarChart3" },
  ],
  operator: [
    { ru: "Главная",  uz: "Bosh",      path: "/",          icon: "LayoutDashboard", exact: true },
    { ru: "KPI",      uz: "KPI",       path: "/agent/kpi",  icon: "BarChart3" },
    { ru: "Заказы",   uz: "Buyurtma",  path: "/orders",    icon: "ClipboardList" },
    { ru: "Магазины", uz: "Do'konlar", path: "/shops",     icon: "Store" },
    { ru: "Приходы",  uz: "Kirimlar",  path: "/arrivals",  icon: "Truck" },
    { ru: "Склад",    uz: "Ombor",     path: "/warehouse", icon: "Warehouse" },
  ],
  // Панель агента повторяет мобильное приложение: там у него Главная,
  // Магазины, Каталог, Заказы, Профиль (app/(tabs)/_layout.tsx в репозитории
  // Warehouse-Pro-Mobile). «Каталога» и списка своих заказов в вебе не было ни
  // в панели, ни в боковом меню: цены и остатки агент мог посмотреть только
  // начав оформлять заказ, а увидеть уже оформленные — вообще никак. KPI убран
  // по просьбе владельца; экран остаётся доступен по /agent/kpi и по ссылке из
  // бокового меню.
  //
  // «Мои заказы» ведут на общий /orders, и это безопасно: OrderService.list
  // сам сужает выборку до своих заказов для всех, кроме ceo, operator,
  // supervisor и superadmin (api/services/order.ts), а на самой странице
  // удаление, массовые действия и фильтры по агентам уже закрыты проверкой
  // isOperatorOrCeo. То есть агент видит там только своё и без чужих кнопок.
  //
  // «Сканер» уступил ему место и переехал в боковое меню: в мобильном
  // приложении штрихкод тоже не вкладка, а вызывается с экрана заказа.
  agent: [
    { ru: "День",       uz: "Kun",        path: "/agent",          icon: "LayoutDashboard", exact: true },
    { ru: "Магазины",   uz: "Do'konlar",  path: "/agent/shops",    icon: "Store" },
    { ru: "Каталог",    uz: "Katalog",    path: "/catalog",        icon: "Package" },
    { ru: "Заказ",      uz: "Buyurtma",   path: "/orders/new",     icon: "PlusCircle" },
    { ru: "Мои заказы", uz: "Buyurtmalar", path: "/orders",        icon: "ClipboardList" },
    { ru: "Офлайн",     uz: "Oflayn",     path: "/offline-orders", icon: "WifiOff" },
  ],
  supervisor: [
    { ru: "KPI",       uz: "KPI",       path: "/agent/kpi",       icon: "BarChart3" },
    { ru: "Карта",     uz: "Xarita",    path: "/supervisor",       icon: "MapPin", exact: true },
    { ru: "Планы",     uz: "Rejalar",   path: "/supervisor/plans", icon: "Calendar" },
    { ru: "Отчёты",    uz: "Hisobot",   path: "/reports",          icon: "BarChart3" },
    { ru: "Настройки", uz: "Sozlamalar",path: "/settings",         icon: "Settings" },
  ],
  merchandiser: [
    { ru: "День",     uz: "Kun",       path: "/agent",       icon: "LayoutDashboard", exact: true },
    { ru: "Магазины", uz: "Do'konlar", path: "/agent/shops", icon: "Store" },
    { ru: "Настройки",uz: "Sozlamalar",path: "/settings",    icon: "Settings" },
  ],
  // Доставщика тут не было вовсе. Панель при этом всё равно рисовалась — с
  // пустым списком: внизу экрана оставалась глухая полоса в 60 точек, которая
  // закрывала содержимое и никуда не вела. Пункты те же, что в боковом меню
  // (src/const.ts), чтобы на телефоне и на большом экране было одно и то же.
  courier: [
    { ru: "Доставки",  uz: "Yetkazish",  path: "/deliveries", icon: "Truck", exact: true },
    { ru: "KPI",       uz: "KPI",        path: "/agent/kpi",  icon: "BarChart3" },
    { ru: "Настройки", uz: "Sozlamalar", path: "/settings",   icon: "Settings" },
  ],
};

// Одна и та же пустая ссылка на все отрисовки: «?? []» каждый раз создавал бы
// новый массив, и useMemo ниже пересчитывался бы вхолостую при каждом рендере.
const NO_ITEMS: (typeof BOTTOM_NAV)[string] = [];

const BottomNav = memo(function BottomNav() {
  const { user }  = useAuth();
  const { lang }  = useLang();
  const location  = useLocation();
  const navigate  = useNavigate();
  const role      = user?.role ?? "agent";
  const items     = BOTTOM_NAV[role] ?? NO_ITEMS;

  /*
    Горит ровно один пункт — тот, чей путь совпал ДЛИННЕЕ прочих.

    Раньше каждый пункт решал за себя: «мой путь или всё, что под ним». У
    агента внизу два соседних пункта — «Заказ» (/orders/new) и «Мои заказы»
    (/orders) — и на экране нового заказа под это правило подходили оба:
    горели вместе, две одинаковых подсветки рядом, обе со словом «заказ».
    После разбивки мастера на страницы (/orders/new/items, /orders/new/review)
    «Мои заказы» светились подряд все три шага.

    Длиннейшее совпадение закрывает это раз и навсегда: пункт-потомок сам
    перебивает родителя, и будущим пунктам отдельных пометок не понадобится.
  */
  const activePath = useMemo(() => pickActivePath(items, location.pathname), [items, location.pathname]);

  // Роль без пунктов не получает и полосы. Раньше пустая панель всё равно
  // занимала низ экрана и перекрывала содержимое — на телефоне это последняя
  // строка списка, до которой нельзя дотянуться.
  if (items.length === 0) return null;

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bottom-nav-premium" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <div className="flex h-[60px]">
        {items.map(item => {
          const Icon     = iconMap[item.icon];
          const isActive = item.path === activePath;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="flex-1 flex flex-col items-center justify-center gap-[3px] relative"
              style={{ color: isActive ? "var(--color-primary-text)" : "var(--color-text-tertiary, #6b6760)" }}
            >
              {isActive && (
                <span className="absolute top-1.5 left-1/2 -translate-x-1/2 w-5 h-[3px] rounded-full" style={{ background: "var(--color-primary)" }} />
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
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [open]);

  return open ? (
    <div className="fixed inset-0 z-50 flex md:hidden">
      <div className="absolute inset-0 glass-overlay" onClick={onClose} />
      <div className="relative w-[280px] h-full animate-slide-in sidebar-collapse-transition" style={{ background: "var(--color-surface, #efedea)" }}>
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
    enabled: !!user && user.role !== "superadmin",
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (isLoading || window.__LOGGING_OUT) return;
    if (!user && location.pathname !== "/login") {
      navigate("/login", { replace: true });
    }
  }, [user, isLoading, navigate, location.pathname]);

  // NOTE: This is a client-side check only and can be bypassed. The real fix
  // requires server-side subscription gating on all API endpoints (see Bug 1 fix
  // in api/lib/feature-gating.ts).
  useEffect(() => {
    if (user?.role === "superadmin") return;
    if (sub && !sub.isActive && sub.status !== "trialing") {
      navigate("/subscription-blocked", { replace: true });
    }
  }, [sub, navigate, user]);

  if (isLoading || !user) return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: "var(--color-primary)" }} />
    </div>
  );

  return (
    <div className="min-h-screen">
      <MobileHeader onMenuClick={openDrawer} unreadCount={unreadCount} />
      <MobileDrawer open={drawerOpen} onClose={closeDrawer} unreadCount={unreadCount} />

      <div className="md:ml-[280px]">
        {user?.role !== "superadmin" && <TrialBanner />}
      </div>

      {/* Floating sidebar — neumorphic card */}
      <aside className="hidden md:flex fixed left-[16px] top-[16px] bottom-[16px] w-[248px] z-40 rounded-[24px] overflow-hidden neo-card neo-card-static flex-col" style={{ padding: 0 }}>
        <Sidebar unreadCount={unreadCount} />
      </aside>

      <main className="md:ml-[280px] min-h-screen">
        <div key={location.pathname} className="p-5 md:p-6 pb-[calc(60px+env(safe-area-inset-bottom,0px))] md:pb-6 animate-fade-up">
          {children}
        </div>
      </main>

      <BottomNav />
    </div>
  );
}
