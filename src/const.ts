export const LOGIN_PATH = "/login";

export const ROLE_ROUTES: Record<string, string> = {
  superadmin:   "/super-admin",
  ceo:          "/",
  operator:     "/",
  agent:        "/agent",
  supervisor:   "/supervisor",
  merchandiser: "/agent",
  courier:      "/deliveries",
};

// Sidebar nav — ключи для i18n, label берётся через t() в Layout
export const NAV_ITEMS: Record<string, Array<{ labelKey: string; path: string; icon: string }>> = {
  superadmin: [
    { labelKey: "nav.superAdmin", path: "/super-admin", icon: "Zap" },
    { labelKey: "nav.monitoring", path: "/monitoring", icon: "Activity" },
  ],
  ceo: [
    { labelKey: "nav.dashboard",  path: "/",          icon: "LayoutDashboard" },
    { labelKey: "nav.reports",    path: "/reports",   icon: "Activity"        },
    { labelKey: "nav.shops",      path: "/shops",     icon: "Store"           },
    { labelKey: "nav.products",   path: "/products",  icon: "Package"         },
    { labelKey: "nav.orders",     path: "/orders",    icon: "ClipboardList"   },
    { labelKey: "nav.arrivals",   path: "/arrivals",  icon: "Truck"           },
    { labelKey: "nav.warehouse",  path: "/warehouse", icon: "Warehouse"       },
    { labelKey: "nav.warehouseReports", path: "/warehouse-reports", icon: "BarChart3" },
    { labelKey: "nav.auditLog",   path: "/audit-log",  icon: "Shield"       },
    { labelKey: "nav.pnl",        path: "/pnl",       icon: "TrendingUp"      },
    { labelKey: "nav.users",      path: "/users",     icon: "Users"           },
    { labelKey: "nav.billing",    path: "/billing",   icon: "CreditCard"      },
    { labelKey: "nav.settings",   path: "/settings",  icon: "Settings"        },
  ],
  operator: [
    { labelKey: "nav.dashboard",  path: "/",          icon: "LayoutDashboard" },
    { labelKey: "nav.reports",    path: "/reports",   icon: "Activity"       },
    { labelKey: "nav.orders",     path: "/orders",    icon: "ClipboardList"   },
    { labelKey: "nav.products",   path: "/products",  icon: "Package"         },
    { labelKey: "nav.shops",      path: "/shops",     icon: "Store"           },
    { labelKey: "nav.arrivals",   path: "/arrivals",  icon: "Truck"           },
    { labelKey: "nav.warehouse",  path: "/warehouse", icon: "Warehouse"       },
    { labelKey: "nav.settings",   path: "/settings",  icon: "Settings"        },
  ],
  agent: [
    { labelKey: "nav.agent",      path: "/agent",          icon: "LayoutDashboard" },
    { labelKey: "nav.myShops",    path: "/agent/shops",    icon: "Store"           },
    { labelKey: "nav.newOrder",   path: "/orders/new",     icon: "PlusCircle"      },
    { labelKey: "nav.gps",        path: "/agent/gps",      icon: "MapPin"          },
    { labelKey: "nav.settings",   path: "/settings",       icon: "Settings"        },
  ],
  supervisor: [
    { labelKey: "nav.tracking",   path: "/supervisor",       icon: "MapPin"     },
    { labelKey: "nav.plans",      path: "/supervisor/plans", icon: "Calendar"   },
    { labelKey: "nav.reports",    path: "/reports",          icon: "Activity"  },
    { labelKey: "nav.settings",   path: "/settings",         icon: "Settings"   },
  ],
  merchandiser: [
    { labelKey: "nav.agent",      path: "/agent",          icon: "LayoutDashboard" },
    { labelKey: "nav.myShops",    path: "/agent/shops",    icon: "Store"           },
    { labelKey: "nav.plans",      path: "/agent/plans",    icon: "Calendar"        },
    { labelKey: "nav.reports",    path: "/reports",         icon: "Activity"        },
    { labelKey: "nav.settings",   path: "/settings",        icon: "Settings"        },
  ],
  courier: [
    { labelKey: "nav.deliveries", path: "/deliveries",  icon: "Truck"           },
    { labelKey: "nav.settings",   path: "/settings",    icon: "Settings"        },
  ],
};
