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
    { labelKey: "nav.kpi",        path: "/agent/kpi",  icon: "BarChart3"        },
    { labelKey: "nav.tracking",   path: "/supervisor", icon: "MapPin"          },
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
    { labelKey: "nav.kpi",        path: "/agent/kpi",  icon: "BarChart3"       },
    { labelKey: "nav.reports",    path: "/reports",   icon: "Activity"       },
    { labelKey: "nav.orders",     path: "/orders",    icon: "ClipboardList"   },
    { labelKey: "nav.products",   path: "/products",  icon: "Package"         },
    { labelKey: "nav.shops",      path: "/shops",     icon: "Store"           },
    { labelKey: "nav.arrivals",   path: "/arrivals",  icon: "Truck"           },
    { labelKey: "nav.warehouse",  path: "/warehouse", icon: "Warehouse"       },
    { labelKey: "nav.settings",   path: "/settings",  icon: "Settings"        },
  ],
  // Боковое меню держит полный набор, нижняя панель — только шесть самых
  // ходовых (BOTTOM_NAV в Layout.tsx). Поэтому здесь есть и то, что из панели
  // убрали: KPI и сканер. Иначе агент терял бы к ним доступ совсем.
  agent: [
    { labelKey: "nav.agent",      path: "/agent",          icon: "LayoutDashboard" },
    { labelKey: "nav.kpi",        path: "/agent/kpi",      icon: "BarChart3"       },
    { labelKey: "nav.myShops",    path: "/agent/shops",    icon: "Store"           },
    { labelKey: "nav.products",   path: "/products",       icon: "Package"         },
    { labelKey: "nav.newOrder",   path: "/orders/new",     icon: "PlusCircle"      },
    { labelKey: "nav.myOrders",   path: "/orders",         icon: "ClipboardList"   },
    { labelKey: "nav.barcode",    path: "/barcode",        icon: "Scan"            },
    { labelKey: "nav.gps",        path: "/agent/gps",      icon: "MapPin"          },
    { labelKey: "nav.settings",   path: "/settings",       icon: "Settings"        },
  ],
  supervisor: [
    { labelKey: "nav.kpi",        path: "/agent/kpi",       icon: "BarChart3"     },
    { labelKey: "nav.tracking",   path: "/supervisor",       icon: "MapPin"     },
    { labelKey: "nav.plans",      path: "/supervisor/plans", icon: "Calendar"   },
    { labelKey: "nav.reports",    path: "/reports",          icon: "Activity"  },
    { labelKey: "nav.settings",   path: "/settings",         icon: "Settings"   },
  ],
  merchandiser: [
    { labelKey: "nav.agent",      path: "/agent",          icon: "LayoutDashboard" },
    { labelKey: "nav.kpi",        path: "/agent/kpi",      icon: "BarChart3"       },
    { labelKey: "nav.myShops",    path: "/agent/shops",    icon: "Store"           },
    { labelKey: "nav.plans",      path: "/agent/plans",    icon: "Calendar"        },
    { labelKey: "nav.reports",    path: "/reports",         icon: "Activity"        },
    { labelKey: "nav.settings",   path: "/settings",        icon: "Settings"        },
  ],
  courier: [
    { labelKey: "nav.kpi",        path: "/agent/kpi",  icon: "BarChart3"       },
    { labelKey: "nav.deliveries", path: "/deliveries",  icon: "Truck"           },
    { labelKey: "nav.settings",   path: "/settings",    icon: "Settings"        },
  ],
};

/**
 * Какой пункт навигации подсветить: тот, чей путь совпал ДЛИННЕЕ прочих.
 *
 * Раньше каждый пункт решал за себя — «мой путь или всё, что под ним». У
 * агента внизу два соседних пункта, «Заказ» (/orders/new) и «Мои заказы»
 * (/orders), и на экране нового заказа под это правило подходили оба: горели
 * вместе, две одинаковых подсветки рядом, обе со словом «заказ». После
 * разбивки мастера на страницы (/orders/new/items, /orders/new/review) «Мои
 * заказы» светились подряд все три шага.
 *
 * Длиннейшее совпадение закрывает это раз и навсегда: пункт-потомок сам
 * перебивает родителя, и будущим пунктам отдельных пометок не понадобится.
 */
export function pickActivePath(
  items: { path: string; exact?: boolean }[],
  pathname: string,
): string | undefined {
  let best: string | undefined;
  for (const item of items) {
    const hit = item.exact
      ? pathname === item.path
      : pathname === item.path || pathname.startsWith(item.path + "/");
    if (hit && (best === undefined || item.path.length > best.length)) best = item.path;
  }
  return best;
}

/*
  Адреса, чьи вложенные пути — не отдельные страницы, а шаги одной.

  Обёртка страницы в Layout.tsx стоит с key={pageKey(...)}. Ключ там нужен:
  он заставляет React выбросить прежнюю страницу и создать новую, а без этого
  экраны с параметром в адресе несли бы чужое состояние — открыл другой
  магазин, а в форме оплаты сумма и ключ повторной отправки от предыдущего.

  Но у мастера нового заказа шаги — вложенные маршруты, и общее состояние
  (выбранный магазин, товары, скидка) живёт в родителе. Пока ключом был
  просто путь, переход на второй шаг выбрасывал родителя вместе с выбором:
  сторож видел пустой магазин и возвращал на первый шаг. Со стороны это
  выглядело так, будто кнопка «Продолжить» не работает вовсе — заказ нельзя
  было оформить.
*/
export const NESTED_PAGE_ROOTS = ["/orders/new"];

/** Ключ обёртки страницы: шаги одного мастера дают один и тот же ключ. */
export function pageKey(pathname: string): string {
  const root = NESTED_PAGE_ROOTS.find((r) => pathname === r || pathname.startsWith(r + "/"));
  return root ?? pathname;
}
