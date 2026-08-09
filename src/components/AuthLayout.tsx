/**
 * AuthLayout.tsx — удалён как самостоятельный компонент.
 *
 * Этот файл был дублирующим: содержал стандартный shadcn/SidebarProvider
 * с заглушками "Page 1 / Page 2" и никуда не использовался в реальной
 * навигации проекта.
 *
 * Единственный layout-компонент — src/components/Layout.tsx.
 * Он содержит:
 *   - Sidebar (десктоп, 260px)
 *   - MobileHeader с breadcrumb
 *   - BottomNav (мобильный, с safe-area и pill-индикатором)
 *   - MobileDrawer
 *
 * Если где-то в проекте остался импорт AuthLayout — замените на Layout:
 *
 *   - import AuthLayout from "@/components/AuthLayout"  ← удалить
 *   + import Layout from "@/components/Layout"          ← использовать
 *
 * AuthLayoutSkeleton можно оставить — он используется в Layout во время
 * загрузки пользователя.
 */

export {};
