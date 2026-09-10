import { Suspense } from "react";
import { Routes, Route, Navigate, Outlet } from "react-router";
import { useAuth, hadSession } from "@/hooks/useAuth";
import { useHotkeys } from "@/hooks/useHotkeys";
import Layout from "@/components/Layout";
import ErrorBoundary from "@/components/ErrorBoundary";
import { lazyWithRecovery } from "@/lib/stale-app-recovery";
import { CommandPalette } from "@/components/CommandPalette";
import { NoAccess } from "@/components/NoAccess";
import Login                from "./pages/Login";
import Register             from "./pages/Register";
import Landing              from "./pages/Landing";
const Privacy              = lazyWithRecovery(() => import("./pages/Privacy"));
import ForgotPassword       from "./pages/ForgotPassword";
import ResetPassword        from "./pages/ResetPassword";
import NotFound             from "./pages/NotFound";
import Home                 from "./pages/Home";
import SubscriptionBlocked  from "./pages/SubscriptionBlocked";
import AcceptInvite         from "./pages/AcceptInvite";
import Onboarding           from "./pages/Onboarding";

const Dashboard            = lazyWithRecovery(() => import("./pages/Dashboard"));
const Shops                = lazyWithRecovery(() => import("./pages/Shops"));
const ShopDetail           = lazyWithRecovery(() => import("./pages/ShopDetail"));
const Products             = lazyWithRecovery(() => import("./pages/Products"));
const ProductDetail        = lazyWithRecovery(() => import("./pages/ProductDetail"));
const Orders               = lazyWithRecovery(() => import("./pages/Orders"));
const Catalog              = lazyWithRecovery(() => import("./pages/Catalog"));
const NewOrder             = lazyWithRecovery(() => import("./pages/NewOrder"));
// Шаги — из того же модуля: они читают состояние родителя и отдельной
// загрузки не требуют.
const NewOrderShopStep     = lazyWithRecovery(() => import("./pages/NewOrder").then(m => ({ default: m.NewOrderShopStep })));
const NewOrderItemsStep    = lazyWithRecovery(() => import("./pages/NewOrder").then(m => ({ default: m.NewOrderItemsStep })));
const NewOrderReviewStep   = lazyWithRecovery(() => import("./pages/NewOrder").then(m => ({ default: m.NewOrderReviewStep })));
const OrderDetail          = lazyWithRecovery(() => import("./pages/OrderDetail"));
const Warehouse            = lazyWithRecovery(() => import("./pages/Warehouse"));
const Arrivals             = lazyWithRecovery(() => import("./pages/Arrivals"));
const Reports              = lazyWithRecovery(() => import("./pages/Reports"));
const Users                = lazyWithRecovery(() => import("./pages/Users"));
const AgentDashboard       = lazyWithRecovery(() => import("./pages/AgentDashboard"));
const AgentShops           = lazyWithRecovery(() => import("./pages/AgentShops"));
const AgentPlans           = lazyWithRecovery(() => import("./pages/AgentPlans"));
const AgentGps             = lazyWithRecovery(() => import("./pages/AgentGps"));
const AgentKpi             = lazyWithRecovery(() => import("./pages/AgentKpi"));
const AgentDebts           = lazyWithRecovery(() => import("./pages/AgentDebts"));
const CourierDeliveries    = lazyWithRecovery(() => import("./pages/CourierDeliveries"));
const SupervisorTracking   = lazyWithRecovery(() => import("./pages/SupervisorTracking"));
const SupervisorPlans      = lazyWithRecovery(() => import("./pages/SupervisorPlans"));
const Settings             = lazyWithRecovery(() => import("./pages/Settings"));
const BillingPage          = lazyWithRecovery(() => import("./pages/Billing"));
const BillingSettings      = lazyWithRecovery(() => import("./pages/BillingSettings"));
const SuperAdmin           = lazyWithRecovery(() => import("./pages/SuperAdmin"));
const PnL                  = lazyWithRecovery(() => import("./pages/PnL"));
const Salaries             = lazyWithRecovery(() => import("./pages/Salaries"));
const BarcodePage          = lazyWithRecovery(() => import("./pages/Barcode"));
const OfflineOrders        = lazyWithRecovery(() => import("./pages/OfflineOrders"));
const Notifications        = lazyWithRecovery(() => import("./pages/Notifications"));
const Monitoring           = lazyWithRecovery(() => import("./pages/Monitoring"));
const Support              = lazyWithRecovery(() => import("./pages/Support"));
const WarehouseReports     = lazyWithRecovery(() => import("./pages/WarehouseReports"));
const Returns              = lazyWithRecovery(() => import("./pages/Returns"));
const AuditLog             = lazyWithRecovery(() => import("./pages/AuditLog"));
const MerchandiserVisit    = lazyWithRecovery(() => import("./pages/MerchandiserVisit"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-[50vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: "var(--color-primary)" }} />
    </div>
  );
}

import { memo } from "react";
import { useBranding } from "@/hooks/useBranding";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";
import { useOfflineSync } from "@/hooks/useOfflineSync";

/**
 * Раздел не для всех.
 *
 * Не вошёл — на вход; вошёл, но роль другая — экран с объяснением. Раньше
 * оба случая молча уводили на «/», и человек, пришедший по ссылке из
 * сообщения или по закладке, видел не отказ, а как будто поломку.
 *
 * Это не защита: права проверяет сервер, у каждой процедуры requireRole.
 * Здесь — про то, чтобы не звать роль туда, где ей ответят отказом: без
 * этого страница успевала отправить десятки запросов и показать
 * «не удалось загрузить» с кнопкой «Повторить», которая повторяла отказ.
 */
const RoleGuard = memo(function RoleGuard({ children, roles }: { children: React.ReactNode; roles: string[] }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (!roles.includes(user.role)) return <NoAccess />;
  return <>{children}</>;
});

function AppLayout() {
  useBranding();
  // Клавиатура: поднять панели и показать поле, в котором пишут.
  useKeyboardInset();
  /*
    Отправка заказов, сохранённых без связи.

    Раньше она жила в экране «Офлайн» и работала, только пока он открыт: агент
    оформлял заказы в подсобке, выходил на улицу со связью, шёл по приложению
    дальше — а очередь стояла нетронутой, пока он сам не догадается туда
    заглянуть. Здесь она включена на всё приложение: связь появилась — заказы
    ушли, на каком бы экране человек ни был.
  */
  useOfflineSync();
  return <Layout><ErrorBoundary><Outlet /></ErrorBoundary></Layout>;
}

/**
 * Корень сайта. Первый визит на warehouse-pro.uz показывает лендинг, а не
 * форму логина: раньше «/» жил внутри Layout, который любого анонима
 * немедленно уводил на /login — продукт встречал посетителя дверью без
 * вывески. Залогиненный пользователь, как и прежде, попадает сразу в свой
 * раздел (Home разводит по ролям).
 */
function RootGate() {
  const { user, isLoading } = useAuth();
  // Первый визит без следов сессии — лендинг рисуется сразу, не дожидаясь
  // ответа auth.me: иначе посетитель warehouse-pro.uz встречал спиннер на
  // всё время запроса. Тот, кто в этом браузере входил, ждёт ответа, чтобы
  // не поймать вспышку лендинга перед своим разделом.
  if (isLoading) return hadSession() ? <PageLoader /> : <Landing />;
  if (!user) return <Landing />;
  return <Home />;
}

/**
 * Горячие клавиши и палитра команд — только для вошедших.
 *
 * Оба слушателя висели над Routes и работали на публичном лендинге: «n» без
 * модификаторов уводила случайного посетителя на /orders/new, а «/» и Ctrl+K
 * открывали палитру с внутренними разделами. Человек, набирающий текст мимо
 * поля ввода, выбрасывался с маркетинговой страницы в приложение.
 */
function AppShortcuts() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <>
      <HotkeysListener />
      <CommandPalette />
    </>
  );
}

function HotkeysListener() {
  useHotkeys();
  return null;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <ErrorBoundary>
      <AppShortcuts />
      <Routes>
        {/* Public */}
        <Route path="/login"              element={<Login />} />
        <Route path="/register"           element={<Register />} />
        <Route path="/forgot-password"    element={<ForgotPassword />} />
        <Route path="/reset-password"     element={<ResetPassword />} />
        <Route path="/invite/:token"      element={<AcceptInvite />} />
        <Route path="/subscription-blocked" element={<SubscriptionBlocked />} />
        {/* Первый запуск организации: заводит склад, товары и приглашает
            людей — всё это ceo и оператор. */}
        <Route path="/onboarding" element={<RoleGuard roles={["ceo","operator"]}><Onboarding /></RoleGuard>} />
        <Route path="/landing"            element={<Landing />} />
        {/* Публичная и без входа: ссылку на неё требуют оба магазина
            приложений, и открывать её будут люди, которые в систему не
            входят вовсе. */}
        <Route path="/privacy"            element={<Privacy />} />
        <Route path="/"                   element={<RootGate />} />

        <Route element={<AppLayout />}>
          {/* Common */}
          {/* Главная руководителя. Все четыре её запроса — supervisorQuery,
              то есть ceo и супервайзер; оператора Home уводит на «Заказы»
              (src/pages/Home.tsx), у остальных свои главные. */}
          <Route path="/dashboard"      element={<RoleGuard roles={["ceo","supervisor"]}><Dashboard /></RoleGuard>} />
          {/* Магазины — managementQuery: ceo, оператор, супервайзер. У агента
              и мерчендайзера свой список, /agent/shops. */}
          <Route path="/shops"          element={<RoleGuard roles={["ceo","operator","supervisor"]}><Shops /></RoleGuard>} />
          <Route path="/shops/:id"      element={<RoleGuard roles={["ceo","operator","supervisor"]}><ShopDetail /></RoleGuard>} />
          {/* Товары, каталог и заказы — fieldSalesQuery: все, кроме курьера.
              Ему сервер отвечает отказом на product.list и order.list, и
              страница успевала выдать до сорока таких заявок. */}
          <Route path="/products"       element={<RoleGuard roles={["ceo","operator","supervisor","agent","merchandiser"]}><Products /></RoleGuard>} />
          {/* Каталог агента — витрина с фотографиями. Пункт «Каталог» в нижней
              панели вёл на /products: админскую страницу с плитками
              статистики и списком строк, где название сжато ценой. */}
          <Route path="/catalog"        element={<RoleGuard roles={["ceo","operator","supervisor","agent","merchandiser"]}><Catalog /></RoleGuard>} />
          <Route path="/products/:id"   element={<RoleGuard roles={["ceo","operator","supervisor","agent","merchandiser"]}><ProductDetail /></RoleGuard>} />
          <Route path="/orders"         element={<RoleGuard roles={["ceo","operator","supervisor","agent","merchandiser"]}><Orders /></RoleGuard>} />
          {/* Шаги заказа — настоящие адреса, а не состояние одной страницы.
              Раньше шаг хранился в useState, и системная «назад» (кнопка
              браузера, жест на телефоне) выкидывала из заказа целиком:
              терялся и выбранный магазин, и набранная корзина. Обновление
              страницы делало то же самое.
              Состояние живёт в NewOrder — он общий родитель трёх шагов и при
              переходе между ними не размонтируется. */}
          <Route path="/orders/new" element={<RoleGuard roles={["ceo","operator","supervisor","agent","merchandiser"]}><NewOrder /></RoleGuard>}>
            <Route index          element={<NewOrderShopStep />} />
            <Route path="items"   element={<NewOrderItemsStep />} />
            <Route path="review"  element={<NewOrderReviewStep />} />
          </Route>
          <Route path="/orders/:id"     element={<RoleGuard roles={["ceo","operator","supervisor","agent","merchandiser"]}><OrderDetail /></RoleGuard>} />
          <Route path="/warehouse"      element={<RoleGuard roles={["ceo","operator"]}><Warehouse /></RoleGuard>} />
          <Route path="/arrivals"       element={<RoleGuard roles={["ceo","operator"]}><Arrivals /></RoleGuard>} />
          {/* Настройки открыты всем: внутри каждый видит только свои разделы
              (см. SECTIONS в pages/Settings.tsx). Раньше маршрут был закрыт
              для всех, кроме ceo и operator, а пункт «Настройки» показывался
              в меню агента, супервайзера, мерчендайзера и курьера — клик по
              нему молча возвращал на главную. Из-за этого агент не мог сменить
              себе пароль с сайта вообще никак.
              Оговорка: при истёкшей подписке организации это по-прежнему так —
              user.changePassword идёт через authedQuery, а тот проверяет
              подписку (исключения только auth./billing./stripe./system.).
              Права на сами действия по-прежнему на сервере: settings.update и
              branding.update — adminQuery, склады — adminQuery. */}
          <Route path="/settings"       element={<Settings />} />
          <Route path="/settings/billing" element={<RoleGuard roles={["ceo"]}><BillingSettings /></RoleGuard>} />
          <Route path="/billing"        element={<RoleGuard roles={["ceo"]}><BillingPage /></RoleGuard>} />
          {/* Доступ решает тариф, а не роль: сервер отвечает признаком, экран
              показывает либо разговор, либо что даёт Exclusive. */}
          <Route path="/support"        element={<Support />} />
          <Route path="/barcode"        element={<RoleGuard roles={["ceo","operator","supervisor","agent","merchandiser"]}><BarcodePage /></RoleGuard>} />
          <Route path="/offline-orders" element={<RoleGuard roles={["ceo","operator","supervisor","agent","merchandiser"]}><OfflineOrders /></RoleGuard>} />
          <Route path="/notifications"  element={<Notifications />} />

          {/* SuperAdmin only */}
          <Route path="/super-admin" element={<RoleGuard roles={["superadmin"]}><SuperAdmin /></RoleGuard>} />
          <Route path="/monitoring" element={<RoleGuard roles={["superadmin"]}><Monitoring /></RoleGuard>} />
          <Route path="/warehouse-reports" element={<RoleGuard roles={["ceo","operator"]}><WarehouseReports /></RoleGuard>} />
          {/*
            Возвраты разбирает офис: агент их только заводит из мобилки.
            Роли те же, что у ручки returns.updateStatus (operatorQuery).
          */}
          <Route path="/returns" element={<RoleGuard roles={["ceo","operator"]}><Returns /></RoleGuard>} />
          <Route path="/audit-log" element={<RoleGuard roles={["ceo","superadmin"]}><AuditLog /></RoleGuard>} />

          {/* CEO only */}
          <Route path="/reports"     element={<RoleGuard roles={["ceo","operator","supervisor","merchandiser"]}><Reports /></RoleGuard>} />
          <Route path="/users"       element={<RoleGuard roles={["ceo"]}><Users /></RoleGuard>} />

          {/* CEO + Operator */}
          {/* "Аналитика" merged into "Отчёты" — old links/bookmarks still work */}
          <Route path="/analytics"   element={<Navigate to="/reports" replace />} />
          {/* Margin and profit are the owner's numbers, not the back office's. */}
          <Route path="/pnl"         element={<RoleGuard roles={["ceo"]}><PnL /></RoleGuard>} />
          {/* Зарплаты — деньги сотрудников, поэтому только руководителю.
              Сам расчёт (kpi.salaryReport) допускает и супервайзера, но
              открывать ему фонд оплаты — отдельное решение, а не побочный
              эффект новой страницы. */}
          <Route path="/salaries"    element={<RoleGuard roles={["ceo"]}><Salaries /></RoleGuard>} />

          {/* Agent */}
          <Route path="/agent"         element={<RoleGuard roles={["ceo","agent","merchandiser"]}><AgentDashboard /></RoleGuard>} />
          <Route path="/agent/shops"   element={<RoleGuard roles={["ceo","agent","merchandiser"]}><AgentShops /></RoleGuard>} />
          <Route path="/agent/plans"   element={<RoleGuard roles={["ceo","agent","merchandiser"]}><AgentPlans /></RoleGuard>} />
          <Route path="/agent/visit/:id" element={<RoleGuard roles={["ceo","agent","merchandiser"]}><MerchandiserVisit /></RoleGuard>} />
          <Route path="/agent/gps"     element={<RoleGuard roles={["ceo","agent"]}><AgentGps /></RoleGuard>} />
          <Route path="/agent/kpi"     element={<RoleGuard roles={["ceo","agent","merchandiser","operator","supervisor","courier"]}><AgentKpi /></RoleGuard>} />
          {/* Долги по СВОИМ заказам. Роли те же, что у «Дня»: собирает долг
              тот, кто его создал. */}
          <Route path="/agent/debts"   element={<RoleGuard roles={["ceo","agent","merchandiser"]}><AgentDebts /></RoleGuard>} />

          {/* Courier */}
          <Route path="/deliveries"    element={<RoleGuard roles={["ceo","operator","courier"]}><CourierDeliveries /></RoleGuard>} />

          {/* Supervisor */}
          <Route path="/supervisor"        element={<RoleGuard roles={["ceo","supervisor"]}><SupervisorTracking /></RoleGuard>} />
          <Route path="/supervisor/plans"  element={<RoleGuard roles={["ceo","supervisor"]}><SupervisorPlans /></RoleGuard>} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      </ErrorBoundary>
    </Suspense>
  );
}
