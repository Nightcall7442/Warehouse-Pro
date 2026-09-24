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

/*
  Разделы бокового меню.

  Владелец (19.09.2026): «в сайдбаре поменьше разделов — только главные,
  остальные внутри». У директора было девятнадцать пунктов подряд, нижние —
  за краем экрана. Теперь пункт может стоять в группе (`group`): в меню
  видна группа, её пункты раскрываются внутри — только у той группы, где
  человек сейчас (или которую он открыл рукой). Маршруты не менялись.

  Форма записи `role: [ { path: "…" } ]` читается тестами как текст
  (route-guards, bottom-nav-roles) — не менять.
*/
export type NavGroupKey = "sales" | "warehouse" | "team" | "finance";
export type NavItem = { labelKey: string; path: string; icon: string; group?: NavGroupKey };

export const NAV_GROUPS: Record<NavGroupKey, { labelKey: string; icon: string }> = {
  sales:     { labelKey: "nav.groupSales",   icon: "ShoppingCart" },
  warehouse: { labelKey: "nav.warehouse",    icon: "Warehouse" },
  team:      { labelKey: "nav.groupTeam",    icon: "Users" },
  finance:   { labelKey: "nav.groupFinance", icon: "TrendingUp" },
};

// Sidebar nav — ключи для i18n, label берётся через t() в Layout
export const NAV_ITEMS: Record<string, NavItem[]> = {
  superadmin: [
    { labelKey: "nav.superAdmin", path: "/super-admin", icon: "Zap" },
    { labelKey: "nav.monitoring", path: "/monitoring", icon: "Activity" },
  ],
  // Директор: Главная, четыре группы и четыре пункта, которые владелец велел
  // оставить снаружи (19.09.2026): «Магазины», «Биллинг», «Журнал действий»,
  // «Настройки». «Магазины» — выше «Продаж» (владелец, 20.09.2026: «продажа
  // внизу должна магазина»), «Настройки» — самый нижний пункт (владелец,
  // 20.09.2026, стрелкой на снимке меню). «Отчёты склада» пунктом больше нет:
  // это вкладка на «Складе».
  ceo: [
    { labelKey: "nav.dashboard",  path: "/",          icon: "LayoutDashboard" },
    { labelKey: "nav.shops",      path: "/shops",     icon: "Store"           },
    { labelKey: "nav.orders",     path: "/orders",    icon: "ClipboardList",  group: "sales" },
    { labelKey: "nav.returns",    path: "/returns",   icon: "RotateCcw",      group: "sales" },
    { labelKey: "nav.stock",      path: "/warehouse", icon: "Warehouse",      group: "warehouse" },
    { labelKey: "nav.arrivals",   path: "/arrivals",  icon: "Truck",          group: "warehouse" },
    { labelKey: "nav.products",   path: "/products",  icon: "Package",        group: "warehouse" },
    { labelKey: "nav.kpi",        path: "/agent/kpi",  icon: "BarChart3",     group: "team" },
    { labelKey: "nav.tracking",   path: "/supervisor", icon: "MapPin",        group: "team" },
    /*
      План визитов был открыт директору маршрутом (RoleGuard пускает ceo), но
      ссылки на него не было нигде: ни здесь, ни в нижней панели. То есть
      попасть на собственное планирование он мог только набрав адрес руками.
      Ставится рядом со слежением: сначала расставить месяц, потом смотреть,
      как он идёт.
    */
    { labelKey: "nav.plans",      path: "/supervisor/plans", icon: "Calendar", group: "team" },
    { labelKey: "nav.salaries",   path: "/salaries",  icon: "Wallet",         group: "team" },
    { labelKey: "nav.users",      path: "/users",     icon: "Users",          group: "team" },
    { labelKey: "nav.reports",    path: "/reports",   icon: "Activity",       group: "finance" },
    { labelKey: "nav.pnl",        path: "/pnl",       icon: "TrendingUp",     group: "finance" },
    { labelKey: "nav.control",    path: "/control",   icon: "ShieldCheck",    group: "finance" },
    { labelKey: "nav.billing",    path: "/billing",   icon: "CreditCard"      },
    { labelKey: "nav.auditLog",   path: "/audit-log",  icon: "Shield"         },
    { labelKey: "nav.settings",   path: "/settings",  icon: "Settings"        },
  ],
  // Оператор: Главная, Магазины, две группы, Отчёты, KPI, Настройки. Группа
  // «Отчёты» с единственным вложенным «Отчёты» звалась бы дважды одним словом.
  operator: [
    { labelKey: "nav.dashboard",  path: "/",          icon: "LayoutDashboard" },
    { labelKey: "nav.shops",      path: "/shops",     icon: "Store"           },
    { labelKey: "nav.orders",     path: "/orders",    icon: "ClipboardList",  group: "sales" },
    { labelKey: "nav.returns",    path: "/returns",   icon: "RotateCcw",      group: "sales" },
    { labelKey: "nav.stock",      path: "/warehouse", icon: "Warehouse",      group: "warehouse" },
    { labelKey: "nav.arrivals",   path: "/arrivals",  icon: "Truck",          group: "warehouse" },
    { labelKey: "nav.products",   path: "/products",  icon: "Package",        group: "warehouse" },
    { labelKey: "nav.reports",    path: "/reports",   icon: "Activity"       },
    { labelKey: "nav.kpi",        path: "/agent/kpi",  icon: "BarChart3"       },
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
    // Очередь неотправленного: вкладкой внизу она больше не стоит (панель —
    // как в мобилке), значок в шапке появляется только при деле. Здесь —
    // постоянная дверь.
    { labelKey: "nav.offline",    path: "/offline-orders", icon: "WifiOff"         },
    { labelKey: "nav.barcode",    path: "/barcode",        icon: "Scan"            },
    { labelKey: "nav.gps",        path: "/agent/gps",      icon: "MapPin"          },
    { labelKey: "nav.settings",   path: "/settings",       icon: "Settings"        },
  ],
  /*
    Магазины и заказы супервайзеру открыты на чтение — сервер их ему отдаёт
    (shop.list — managementQuery, order.list — fieldSalesQuery), а в
    мобильном приложении «Магазины» у него и так есть вкладкой. В вебе
    пунктов не было: чтобы посмотреть точку своего агента или его заказ,
    приходилось знать адрес страницы наизусть.

    Кнопки, которых сервер ему не даст — создание, правка, удаление,
    импорт, массовые действия, — на самих страницах спрятаны (canOperate в
    src/lib/permissions.ts).
  */
  supervisor: [
    { labelKey: "nav.kpi",        path: "/agent/kpi",       icon: "BarChart3"     },
    { labelKey: "nav.tracking",   path: "/supervisor",       icon: "MapPin"     },
    { labelKey: "nav.plans",      path: "/supervisor/plans", icon: "Calendar"   },
    { labelKey: "nav.shops",      path: "/shops",            icon: "Store"      },
    { labelKey: "nav.orders",     path: "/orders",           icon: "ClipboardList" },
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

export type NavRow =
  | { kind: "item"; item: NavItem; active: boolean; nested: boolean }
  | { kind: "group"; key: NavGroupKey; labelKey: string; icon: string; open: boolean; active: boolean };

/**
 * Строки бокового меню: пункты и заголовки групп в порядке первого
 * появления. Пункты группы видны, только когда она раскрыта; раскрыта та,
 * где человек сейчас, или та, что он открыл рукой (`openGroup`). У заголовка
 * группы `active`, если внутри — текущая страница: свёрнутая группа не должна
 * терять след того, где вы.
 */
export function navRows(items: NavItem[], pathname: string, openGroup: NavGroupKey | null | undefined): NavRow[] {
  const activePath = pickActivePath(items.map(i => ({ path: i.path, exact: i.path === "/" })), pathname);
  const activeGroup = items.find(i => i.path === activePath)?.group ?? null;
  const open = openGroup === undefined ? activeGroup : openGroup;
  const rows: NavRow[] = [];
  const seen = new Set<NavGroupKey>();
  for (const item of items) {
    if (!item.group) { rows.push({ kind: "item", item, active: item.path === activePath, nested: false }); continue; }
    if (seen.has(item.group)) continue;
    seen.add(item.group);
    const g = NAV_GROUPS[item.group];
    rows.push({ kind: "group", key: item.group, labelKey: g.labelKey, icon: g.icon, open: open === item.group, active: activeGroup === item.group });
    if (open === item.group) {
      for (const child of items) if (child.group === item.group) rows.push({ kind: "item", item: child, active: child.path === activePath, nested: true });
    }
  }
  return rows;
}

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
