import {
  LayoutDashboard, Building2, Inbox, LifeBuoy, Activity, FlaskConical, MoreHorizontal, Megaphone, ScrollText,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* ═══════════════════════════════════════════════════════════════════════════
   Разделы консоли платформы — у каждого свой адрес.

   Было: одна страница /super-admin стопкой из девяти секций и карточка
   организации, подменявшая её без своей ссылки. Чтобы дойти до списка
   организаций, листали мимо обращений, заявок и отчёта по тарифам; «назад» в
   браузере выбрасывал из карточки на прошлый сайт. Владелец, 01.10.2026:
   «вообще каша сейчас, нужна профессиональная панель».
   ═══════════════════════════════════════════════════════════════════════════ */

export type ConsoleSection = {
  key: "overview" | "orgs" | "leads" | "support" | "announcements" | "journal" | "system" | "sandboxes";
  label: string;
  path: string;
  icon: LucideIcon;
};

export const CONSOLE_BASE = "/super-admin";

export const CONSOLE_NAV: ConsoleSection[] = [
  { key: "overview",  label: "Обзор",       path: "/super-admin",           icon: LayoutDashboard },
  { key: "orgs",      label: "Организации", path: "/super-admin/orgs",      icon: Building2 },
  { key: "leads",     label: "Заявки",      path: "/super-admin/leads",     icon: Inbox },
  { key: "support",   label: "Обращения",   path: "/super-admin/support",   icon: LifeBuoy },
  { key: "announcements", label: "Объявления", path: "/super-admin/announcements", icon: Megaphone },
  { key: "journal",   label: "Журнал",      path: "/super-admin/journal",   icon: ScrollText },
  { key: "system",    label: "Система",     path: "/super-admin/system",    icon: Activity },
  { key: "sandboxes", label: "Интеграторы", path: "/super-admin/sandboxes", icon: FlaskConical },
];

/** Нижние вкладки телефона: три частых раздела и «Ещё» — остальные и аккаунт. */
export const CONSOLE_TABS: Array<{ key: string; label: string; path: string; icon: LucideIcon }> = [
  { key: "overview", label: "Обзор",       path: "/super-admin",         icon: LayoutDashboard },
  { key: "orgs",     label: "Организации", path: "/super-admin/orgs",    icon: Building2 },
  { key: "support",  label: "Обращения",   path: "/super-admin/support", icon: LifeBuoy },
  { key: "more",     label: "Ещё",         path: "/super-admin/more",    icon: MoreHorizontal },
];

/** Какой раздел сейчас открыт: «Обзор» — только ровно /super-admin, остальные — по началу пути. */
export function activeSection(pathname: string): ConsoleSection["key"] | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === CONSOLE_BASE) return "overview";
  const hit = CONSOLE_NAV.find(s => s.key !== "overview" && (p === s.path || p.startsWith(s.path + "/")));
  return hit?.key ?? null;
}

/** Активная нижняя вкладка: всё, чего нет внизу (заявки, система, настройки…), живёт в «Ещё». */
export function activeTab(pathname: string): string {
  const s = activeSection(pathname);
  if (s === "overview" || s === "orgs" || s === "support") return s;
  return "more";
}

/** Заголовок шапки телефона и, если есть, куда ведёт стрелка «назад». */
export function consoleTitle(pathname: string): { title: string; back?: string } {
  if (/^\/super-admin\/orgs\/\d+/.test(pathname)) return { title: "Организация", back: "/super-admin/orgs" };
  const s = CONSOLE_NAV.find(n => n.key === activeSection(pathname));
  if (s) return { title: s.label, back: ["leads", "announcements", "journal", "system", "sandboxes"].includes(s.key) ? "/super-admin/more" : undefined };
  if (pathname.startsWith("/super-admin/more")) return { title: "Ещё" };
  if (pathname.startsWith("/settings")) return { title: "Настройки", back: "/super-admin/more" };
  if (pathname.startsWith("/notifications")) return { title: "Уведомления" };
  if (pathname.startsWith("/audit-log")) return { title: "Журнал действий", back: "/super-admin/more" };
  return { title: "Консоль" };
}

/**
 * Ключ анимации появления страницы. Вкладки карточки организации — одна
 * страница: смена вкладки не должна заново «въезжать» всей карточкой.
 */
export function consolePageKey(pathname: string): string {
  const card = /^\/super-admin\/orgs\/\d+/.exec(pathname);
  return card ? card[0] : pathname;
}
