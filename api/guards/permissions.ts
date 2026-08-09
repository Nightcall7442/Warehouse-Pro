/**
 * Permissions system for Warehouse Pro
 * Defines what each role can do with each resource
 */

export type Permission =
  // Products
  | "products:read"
  | "products:create"
  | "products:update"
  | "products:delete"
  // Shops
  | "shops:read"
  | "shops:create"
  | "shops:update"
  | "shops:delete"
  // Orders
  | "orders:read"
  | "orders:create"
  | "orders:update"
  | "orders:cancel"
  | "orders:delete"
  // Stock
  | "stock:read"
  | "stock:adjust"
  | "stock:reserve"
  | "stock:release"
  // Users
  | "users:read"
  | "users:create"
  | "users:update"
  | "users:delete"
  // Reports
  | "reports:read"
  | "reports:export"
  // Analytics
  | "analytics:read"
  | "analytics:export"
  // Dashboard
  | "dashboard:read"
  // Billing
  | "billing:read"
  | "billing:manage"
  // Settings
  | "settings:read"
  | "settings:update"
  // Notifications
  | "notifications:read"
  | "notifications:update"
  // Arrivals
  | "arrivals:read"
  | "arrivals:create"
  | "arrivals:update"
  | "arrivals:delete"
  // Daily Plans
  | "plans:read"
  | "plans:create"
  | "plans:update"
  // Couriers
  | "couriers:read"
  | "couriers:assign"
  | "couriers:update"
  // Merchandiser
  | "merchandiser:read"
  | "merchandiser:create"
  // Tenants (superadmin)
  | "tenants:read"
  | "tenants:create"
  | "tenants:update"
  | "tenants:delete"
  // Import
  | "import:execute"
  // GPS
  | "gps:read"
  | "gps:update";

export type Role = "superadmin" | "ceo" | "operator" | "agent" | "supervisor" | "merchandiser" | "courier";

/**
 * Permission matrix: role → permissions
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  superadmin: [
    // Full access to everything
    "tenants:read", "tenants:create", "tenants:update", "tenants:delete",
    "users:read", "users:create", "users:update", "users:delete",
    "products:read", "products:create", "products:update", "products:delete",
    "shops:read", "shops:create", "shops:update", "shops:delete",
    "orders:read", "orders:create", "orders:update", "orders:cancel", "orders:delete",
    "stock:read", "stock:adjust", "stock:reserve", "stock:release",
    "reports:read", "reports:export",
    "analytics:read", "analytics:export",
    "dashboard:read",
    "billing:read", "billing:manage",
    "settings:read", "settings:update",
    "notifications:read", "notifications:update",
    "arrivals:read", "arrivals:create", "arrivals:update", "arrivals:delete",
    "plans:read", "plans:create", "plans:update",
    "couriers:read", "couriers:assign", "couriers:update",
    "merchandiser:read", "merchandiser:create",
    "import:execute",
    "gps:read", "gps:update",
  ],

  ceo: [
    // Full tenant access (except tenant management)
    "users:read", "users:create", "users:update", "users:delete",
    "products:read", "products:create", "products:update", "products:delete",
    "shops:read", "shops:create", "shops:update", "shops:delete",
    "orders:read", "orders:create", "orders:update", "orders:cancel", "orders:delete",
    "stock:read", "stock:adjust", "stock:reserve", "stock:release",
    "reports:read", "reports:export",
    "analytics:read", "analytics:export",
    "dashboard:read",
    "billing:read", "billing:manage",
    "settings:read", "settings:update",
    "notifications:read", "notifications:update",
    "arrivals:read", "arrivals:create", "arrivals:update", "arrivals:delete",
    "plans:read", "plans:create", "plans:update",
    "couriers:read", "couriers:assign", "couriers:update",
    "merchandiser:read", "merchandiser:create",
    "import:execute",
    "gps:read", "gps:update",
  ],

  operator: [
    // Operations management
    "products:read", "products:create", "products:update",
    "shops:read", "shops:create", "shops:update",
    "orders:read", "orders:create", "orders:update", "orders:cancel",
    "stock:read", "stock:adjust", "stock:reserve", "stock:release",
    "reports:read", "reports:export",
    "analytics:read",
    "dashboard:read",
    "notifications:read", "notifications:update",
    "arrivals:read", "arrivals:create", "arrivals:update",
    "plans:read", "plans:create", "plans:update",
    "couriers:read", "couriers:assign",
    "import:execute",
    "gps:read",
  ],

  supervisor: [
    // Agent supervision
    "products:read",
    "shops:read",
    "orders:read",
    "stock:read",
    "reports:read",
    "analytics:read",
    "dashboard:read",
    "notifications:read",
    "plans:read", "plans:create", "plans:update",
    "couriers:read",
    "merchandiser:read",
    "gps:read",
  ],

  agent: [
    // Field operations
    "products:read",
    "shops:read", "shops:create", "shops:update",
    "orders:read", "orders:create", "orders:cancel",
    "stock:read",
    "plans:read",
    "couriers:read",
    "gps:read", "gps:update",
  ],

  merchandiser: [
    // Merchandiser reports
    "products:read",
    "shops:read",
    "plans:read",
    "merchandiser:read", "merchandiser:create",
    "gps:read",
  ],

  courier: [
    // Delivery operations
    "orders:read",
    "couriers:read", "couriers:update",
    "gps:read", "gps:update",
  ],
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

/**
 * Check if a role has all specified permissions
 */
export function hasAllPermissions(role: Role, permissions: Permission[]): boolean {
  return permissions.every(p => hasPermission(role, p));
}

/**
 * Check if a role has any of the specified permissions
 */
export function hasAnyPermission(role: Role, permissions: Permission[]): boolean {
  return permissions.some(p => hasPermission(role, p));
}

/**
 * Get all permissions for a role
 */
export function getPermissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/**
 * Role hierarchy (higher index = more privileged)
 */
export const ROLE_HIERARCHY: Role[] = [
  "courier",
  "merchandiser",
  "agent",
  "supervisor",
  "operator",
  "ceo",
  "superadmin",
];

/**
 * Check if role1 has equal or higher privilege than role2
 */
export function hasHigherOrEqualRole(role1: Role, role2: Role): boolean {
  return ROLE_HIERARCHY.indexOf(role1) >= ROLE_HIERARCHY.indexOf(role2);
}
