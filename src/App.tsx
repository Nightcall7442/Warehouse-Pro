import { lazy, Suspense } from "react";
import { Routes, Route, Navigate, Outlet } from "react-router";
import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import ErrorBoundary from "@/components/ErrorBoundary";
import Login                from "./pages/Login";
import Register             from "./pages/Register";
import Landing              from "./pages/Landing";
import ForgotPassword       from "./pages/ForgotPassword";
import ResetPassword        from "./pages/ResetPassword";
import NotFound             from "./pages/NotFound";
import Home                 from "./pages/Home";
import SubscriptionBlocked  from "./pages/SubscriptionBlocked";
import AcceptInvite         from "./pages/AcceptInvite";
import Onboarding           from "./pages/Onboarding";

const Dashboard            = lazy(() => import("./pages/Dashboard"));
const Shops                = lazy(() => import("./pages/Shops"));
const ShopDetail           = lazy(() => import("./pages/ShopDetail"));
const Products             = lazy(() => import("./pages/Products"));
const ProductDetail        = lazy(() => import("./pages/ProductDetail"));
const Orders               = lazy(() => import("./pages/Orders"));
const NewOrder             = lazy(() => import("./pages/NewOrder"));
const OrderDetail          = lazy(() => import("./pages/OrderDetail"));
const Warehouse            = lazy(() => import("./pages/Warehouse"));
const Arrivals             = lazy(() => import("./pages/Arrivals"));
const Reports              = lazy(() => import("./pages/Reports"));
const Users                = lazy(() => import("./pages/Users"));
const AgentDashboard       = lazy(() => import("./pages/AgentDashboard"));
const AgentShops           = lazy(() => import("./pages/AgentShops"));
const AgentPlans           = lazy(() => import("./pages/AgentPlans"));
const AgentGps             = lazy(() => import("./pages/AgentGps"));
const CourierDeliveries    = lazy(() => import("./pages/CourierDeliveries"));
const SupervisorTracking   = lazy(() => import("./pages/SupervisorTracking"));
const SupervisorPlans      = lazy(() => import("./pages/SupervisorPlans"));
const Settings             = lazy(() => import("./pages/Settings"));
const BillingPage          = lazy(() => import("./pages/Billing"));
const BillingSettings      = lazy(() => import("./pages/BillingSettings"));
const SuperAdmin           = lazy(() => import("./pages/SuperAdmin"));
const PnL                  = lazy(() => import("./pages/PnL"));
const BarcodePage          = lazy(() => import("./pages/Barcode"));
const OfflineOrders        = lazy(() => import("./pages/OfflineOrders"));
const Notifications        = lazy(() => import("./pages/Notifications"));
const Monitoring           = lazy(() => import("./pages/Monitoring"));
const WarehouseReports     = lazy(() => import("./pages/WarehouseReports"));
const AuditLog             = lazy(() => import("./pages/AuditLog"));
const MerchandiserVisit    = lazy(() => import("./pages/MerchandiserVisit"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-[50vh]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: "var(--color-primary)" }} />
    </div>
  );
}

import { memo } from "react";

const RoleGuard = memo(function RoleGuard({ children, roles }: { children: React.ReactNode; roles: string[] }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
});

function AppLayout() {
  return <Layout><ErrorBoundary pageName="Страница"><Outlet /></ErrorBoundary></Layout>;
}

export default function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <ErrorBoundary pageName="Приложение">
      <Routes>
        {/* Public */}
        <Route path="/login"              element={<Login />} />
        <Route path="/register"           element={<Register />} />
        <Route path="/forgot-password"    element={<ForgotPassword />} />
        <Route path="/reset-password"     element={<ResetPassword />} />
        <Route path="/invite/:token"      element={<AcceptInvite />} />
        <Route path="/subscription-blocked" element={<SubscriptionBlocked />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/landing"            element={<Landing />} />

        <Route element={<AppLayout />}>
          {/* Common */}
          <Route path="/"               element={<Home />} />
          <Route path="/dashboard"      element={<Dashboard />} />
          <Route path="/shops"          element={<Shops />} />
          <Route path="/shops/:id"      element={<ShopDetail />} />
          <Route path="/products"       element={<Products />} />
          <Route path="/products/:id"   element={<ProductDetail />} />
          <Route path="/orders"         element={<Orders />} />
          <Route path="/orders/new"     element={<NewOrder />} />
          <Route path="/orders/:id"     element={<OrderDetail />} />
          <Route path="/warehouse"      element={<Warehouse />} />
          <Route path="/arrivals"       element={<Arrivals />} />
          <Route path="/settings"       element={<Settings />} />
          <Route path="/settings/billing" element={<BillingSettings />} />
          <Route path="/billing"        element={<BillingPage />} />
          <Route path="/barcode"        element={<BarcodePage />} />
          <Route path="/offline-orders" element={<OfflineOrders />} />
          <Route path="/notifications"  element={<Notifications />} />

          {/* SuperAdmin only */}
          <Route path="/super-admin" element={<RoleGuard roles={["superadmin"]}><SuperAdmin /></RoleGuard>} />
          <Route path="/monitoring" element={<RoleGuard roles={["superadmin"]}><Monitoring /></RoleGuard>} />
          <Route path="/warehouse-reports" element={<RoleGuard roles={["ceo","operator"]}><WarehouseReports /></RoleGuard>} />
          <Route path="/audit-log" element={<RoleGuard roles={["ceo","superadmin"]}><AuditLog /></RoleGuard>} />

          {/* CEO only */}
          <Route path="/reports"     element={<RoleGuard roles={["ceo","operator","supervisor","merchandiser"]}><Reports /></RoleGuard>} />
          <Route path="/users"       element={<RoleGuard roles={["ceo"]}><Users /></RoleGuard>} />

          {/* CEO + Operator */}
          {/* "Аналитика" merged into "Отчёты" — old links/bookmarks still work */}
          <Route path="/analytics"   element={<Navigate to="/reports" replace />} />
          <Route path="/pnl"         element={<RoleGuard roles={["ceo","operator"]}><PnL /></RoleGuard>} />

          {/* Agent */}
          <Route path="/agent"         element={<RoleGuard roles={["ceo","agent","merchandiser"]}><AgentDashboard /></RoleGuard>} />
          <Route path="/agent/shops"   element={<RoleGuard roles={["ceo","agent","merchandiser"]}><AgentShops /></RoleGuard>} />
          <Route path="/agent/plans"   element={<RoleGuard roles={["ceo","agent","merchandiser"]}><AgentPlans /></RoleGuard>} />
          <Route path="/agent/visit/:id" element={<RoleGuard roles={["ceo","agent","merchandiser"]}><MerchandiserVisit /></RoleGuard>} />
          <Route path="/agent/gps"     element={<RoleGuard roles={["ceo","agent"]}><AgentGps /></RoleGuard>} />

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
