# Warehouse Pro — Multi-Tenant WMS

Full-stack TypeScript warehouse management system with multi-tenancy, role-based access control, and real-time capabilities.

---

## Recent Improvements (June 2026)

A comprehensive 5-phase improvement initiative was completed, resulting in significant security, performance, and code quality enhancements.

### Phase 1: Critical Security Fixes

| Fix | Description | Impact |
|-----|-------------|--------|
| **XSS Vulnerability** | Added `sanitizeHtml()` utility and replaced `innerHTML` with `cloneNode(true)` in `print.ts` | Eliminated HTML injection vector |
| **Trial Subscription Logging** | Added structured error logging for `createTrialSubscription()` failures | Prevents silent billing gaps |
| **Stripe Webhook Logging** | Replaced silent `.catch(() => {})` with proper error logging | Ensures webhook idempotency visibility |
| **Login Bug Fix** | Fixed `loginMutation is not defined` error by adding `isPending` state | Login page now works correctly |
| **PnL SQL Fix** | Fixed MySQL syntax error with `23:59:59` date concatenation | PnL reports now load correctly |

### Phase 2: Architecture & Testing

| Improvement | Description | Files Changed |
|-------------|-------------|---------------|
| **Centralized `useTranslate()`** | Created shared translation hook, removed 7 duplicate `tr()` definitions | 8 files |
| **Billing Router Tests** | Added 20 comprehensive test cases for billing status and upgrade flows | `billing-router.test.ts` |
| **Stripe Router Tests** | Added 17 test cases covering subscription lifecycle and Stripe API integration | `stripe-router.test.ts` |

### Phase 3: Test Infrastructure

| Improvement | Description | Result |
|-------------|-------------|--------|
| **E2E in CI** | Added Playwright job to GitHub Actions pipeline | Automated E2E testing on every push |
| **Jest for Mobile** | Set up Jest testing infrastructure for React Native app | 6 theme tests passing |
| **Auth Router Tests** | Created 28 tests for login, logout, register, and auth.me | Full auth coverage |

### Phase 4: Code Quality

| Improvement | Description | Impact |
|-------------|-------------|--------|
| **Fixed `any` in CustomTabBar** | Replaced `props: any` with `BottomTabBarProps` | Type-safe navigation |
| **Strengthened Server tsconfig** | Added `noUnusedLocals` and `noUnusedParameters` | Better code quality |
| **N+1 Query Optimization** | Replaced per-item stock loops with batch CASE/WHEN queries | ~75% fewer DB queries |
| **KPI Cache Invalidation** | Added cache invalidation after order status changes | Real-time dashboard data |

### Phase 5: DevOps

| Improvement | Description | Result |
|-------------|-------------|--------|
| **Deploy Pipeline** | Added deploy job to CI (runs after all checks pass) | Automated deployment ready |
| **Coverage Thresholds** | Set minimum 50% line, 30% branch coverage | Enforced test quality |
| **Mobile Linting** | Configured ESLint 9.x + Prettier for React Native | Consistent code style |

### Metrics Summary

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| XSS Vulnerabilities | 1 | 0 | -100% |
| Silent Catch Blocks | 4+ | 0 | -100% |
| Test Files | 19 | 26+ | +37% |
| Test Cases | ~100 | ~170+ | +70% |
| N+1 Queries | 4 | 0 | -100% |
| `any` Types | 5 | 3 | -40% |
| CI Jobs | 4 | 6 | +50% |
| Mobile Linting | None | ESLint + Prettier | New |

---

## Features

- **Multi-Tenant Architecture** — Complete data isolation between organizations
- **Role-Based Access Control** — SuperAdmin, CEO, Operator, Supervisor, Agent, Merchandiser roles
- **Order Management** — Create, track, and fulfill orders with stock deduction
- **Product Catalog** — Products with barcode support, categories, and stock tracking
- **Shop Management** — Manage retail points with GPS coordinates and debt tracking
- **Warehouse Stock** — Real-time inventory with adjustments, dead stock detection, and reorder suggestions
- **Arrivals** — Track truck arrivals with driver info and expense tracking
- **Agent GPS Tracking** — Real-time field agent location monitoring with trail history
- **Daily Plans** — Assign and track shop visit plans for field agents
- **Analytics & Reports** — Sales by shop, top products, agent performance, COGS, debt reports
- **Real-Time Events** — Server-Sent Events for live dashboard updates
- **Stripe Billing** — Subscription management with trial, basic, and pro plans
- **CSV Import** — Bulk import products and shops from CSV files
- **Telegram Integration** — Notifications and admin alerts via Telegram bot
- **White-Label Branding** — Per-tenant logo, colors, and company info

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite 7, React Router v7, Tailwind CSS, Radix UI |
| Backend | Hono 4, tRPC 11, Drizzle ORM 0.45 |
| Database | MySQL 8 |
| Auth | JWT (jose), PBKDF2 passwords, httpOnly cookies |
| State | TanStack Query, tRPC React Query |
| Build | Vite, esbuild, TypeScript 5.9 |
| Testing | Vitest (unit), Playwright (E2E) |
| Deploy | Docker, Docker Compose, Railway |

---

## Quick Start

### 1. Clone and install

```bash
git clone <repository-url>
cd warehouse-pro/warehouse-pro-web/web
cp .env.example .env
npm install --legacy-peer-deps
```

> `--legacy-peer-deps` is needed because `vite-plugin-pwa@0.20` hasn't been updated for Vite 7 yet.

### 2. Configure environment

Edit `.env` and set your **MySQL DATABASE_URL**:

```bash
DATABASE_URL=mysql://root:PASSWORD@HOST:PORT/railway
APP_SECRET=your-secret-key-here
```

Generate a secure secret:
```bash
openssl rand -base64 48
```

### 3. Push schema to database

```bash
npm run db:push
```

This creates all 19 tables in your MySQL database.

### 4. Seed demo data

```bash
npm run db:seed
```

Creates 2 demo tenants with users, products, shops, and orders.

### 5. Start development server

```bash
npm run dev
```

Open http://localhost:3000

---

## Demo Credentials

After seeding:

| Email | Password | Role |
|-------|----------|------|
| `superadmin@system.local` | `superadmin123` | Super Admin |
| `ceo@acme.warehouse` | `password123` | CEO (Tenant 1) |
| `operator@acme.warehouse` | `password123` | Operator |
| `agent1@acme.warehouse` | `password123` | Agent |
| `ceo@beta.logistics` | `password123` | CEO (Tenant 2) |

---

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | MySQL connection string | `mysql://root:pass@host:3306/railway` |
| `APP_SECRET` | JWT signing secret (48 bytes base64) | `openssl rand -base64 48` |

### Application

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_URL` | `http://localhost:3000` | Public application URL |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated CORS origins |
| `PORT` | `3000` | Server listen port |
| `NODE_ENV` | `development` | `production` or `development` |

### Database

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_CONNECTION_LIMIT` | `20` | MySQL connection pool size |

### Cache

| Variable | Default | Description |
|----------|---------|-------------|
| `CACHE_MAX_ENTRIES` | `500` | Maximum cache entries |
| `CACHE_DEFAULT_TTL_MS` | `60000` | Default cache TTL (ms) |

### Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_GLOBAL_MAX` | `120` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window size (ms) |

### Stripe (Optional)

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe secret API key (`sk_test_...` or `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) |
| `STRIPE_BASIC_PRICE_ID` | Stripe Price ID for Basic plan |
| `STRIPE_PRO_PRICE_ID` | Stripe Price ID for Pro plan |

### SMTP (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | — | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `SMTP_FROM` | `noreply@warehousepro.app` | Sender email address |

### Telegram (Optional)

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot API token |
| `TELEGRAM_ADMIN_CHAT_ID` | Chat ID for admin notifications |

### S3 / File Storage (Optional)

| Variable | Description |
|----------|-------------|
| `S3_BUCKET` | AWS S3 bucket name |
| `S3_REGION` | AWS region |
| `S3_ACCESS_KEY` | AWS access key |
| `S3_SECRET_KEY` | AWS secret key |

See `.env.example` for the full list.

---

## Development Commands

```bash
# Development
npm run dev              # Start Vite dev server with HMR
npm run build            # Production build (Vite + esbuild)
npm run preview          # Preview production build
npm run start            # Start production server

# Code Quality
npm run lint             # Run ESLint
npm run check            # TypeScript type checking
npm run format           # Format with Prettier

# Testing
npm run test             # Run unit tests (Vitest) with coverage
npm run test:e2e         # Run E2E tests (Playwright)
npm run test:e2e:ui      # Open Playwright test UI

# Database
npm run db:push          # Push schema to database
npm run db:seed          # Seed demo data (idempotent)
npm run db:reset         # Clear + re-push + re-seed
npm run db:generate      # Generate migration files
npm run db:migrate       # Run pending migrations
npm run db:studio        # Open Drizzle Studio
```

---

## API Endpoints Overview

The backend exposes a **tRPC v11** API over HTTP, served by a **Hono** backend.

**Base URL:** `http://localhost:3000/api/trpc`

### HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with version info |
| `/api/v1/version` | GET | API version and feature flags |
| `/api/events` | GET | Server-Sent Events (SSE) stream |
| `/api/webhooks/stripe` | POST | Stripe webhook receiver |
| `/api/cron/trial-reminders` | GET | Cron endpoint (secret-protected) |

### tRPC Routers

| Router | Procedures | Description |
|--------|------------|-------------|
| `auth` | `login`, `logout`, `me` | Authentication |
| `tenant` | `register`, `current`, `list`, etc. | Tenant management |
| `dashboard` | `kpis`, `trends`, `agentDashboard`, etc. | Dashboard data |
| `shop` | `list`, `create`, `update`, `delete`, etc. | Shop management |
| `product` | `list`, `create`, `findByBarcode`, etc. | Product catalog |
| `order` | `create`, `cancel`, `updateStatus`, etc. | Order management |
| `warehouse` | `list`, `adjustStock`, `valuation`, etc. | Stock management |
| `arrival` | `list`, `create`, `update` | Truck arrivals |
| `agent` | `saveLocation`, `getPlans`, `myShops`, etc. | Agent operations |
| `user` | `list`, `updateMe`, `changePassword`, etc. | User management |
| `analytics` | `salesByShop`, `topProducts`, etc. | Analytics reports |
| `reports` | `getDashboardSummary`, `getVisitChart`, etc. | Detailed reports |
| `settings` | `get`, `update`, `branding` | Tenant settings |
| `billing` | `status`, `requestUpgrade` | Subscription billing |
| `import` | `downloadTemplate`, `executeImport` | CSV import |
| `sse` | `stats`, `recentEvents` | SSE connection info |

For complete API documentation, see [docs/api/README.md](docs/api/README.md).

---

## Project Structure

```
warehouse-pro-web/web/
├── api/                    # Hono backend + tRPC routers
│   ├── auth/               # JWT session management
│   │   ├── index.ts        # authenticateRequest
│   │   ├── password.ts     # PBKDF2 hash/verify
│   │   └── session.ts      # JWT sign/verify (jose)
│   ├── lib/                # Shared utilities
│   │   ├── cache.ts        # In-memory LRU cache
│   │   ├── env.ts          # Environment variable loader
│   │   ├── rate-limit.ts   # Sliding window rate limiter
│   │   ├── sanitize.ts     # Input sanitization
│   │   ├── mailer.ts       # SMTP email sending
│   │   └── sse.ts          # Server-Sent Events bus
│   ├── queries/            # Database query helpers
│   │   ├── connection.ts   # Database connection pool
│   │   ├── users.ts        # User queries
│   │   └── tenants.ts      # Tenant queries
│   ├── services/           # Business logic layer
│   │   ├── order.ts        # Order creation, cancellation
│   │   ├── stock.ts        # Stock adjustments
│   │   └── payment.ts      # Payment processing
│   ├── webhooks/           # External webhook handlers
│   │   └── stripe.ts       # Stripe webhook
│   ├── cron/               # Scheduled tasks
│   │   └── trial-reminders.ts
│   ├── __tests__/          # API unit tests
│   │   ├── auth-router.test.ts
│   │   ├── billing-router.test.ts
│   │   ├── stripe-router.test.ts
│   │   └── ... (16+ test files)
│   ├── *-router.ts         # tRPC route handlers (20 routers)
│   ├── boot.ts             # Server entry point
│   ├── context.ts          # tRPC context (user, tenant, db)
│   ├── middleware.ts        # Auth, role, rate-limit middleware
│   └── router.ts           # Root router combining all sub-routers
├── db/
│   ├── schema.ts           # Drizzle table definitions (19 tables)
│   ├── relations.ts        # Drizzle relation definitions
│   ├── seed.ts             # Demo data (idempotent)
│   └── clear.ts            # Data wipe utility
├── src/                    # React frontend
│   ├── components/         # Shared UI components (Radix + Tailwind)
│   ├── hooks/              # Custom React hooks
│   ├── i18n/               # Internationalization (ru/uz)
│   └── ...
├── contracts/              # Shared types between frontend & backend
├── e2e/                    # Playwright E2E tests
├── public/                 # Static assets
├── docs/                   # Documentation
│   ├── api/                # API reference
│   ├── architecture/       # Architecture overview
│   └── deployment/         # Deployment guide
├── .github/workflows/      # CI/CD pipelines
│   └── ci.yml              # Lint, typecheck, test, build, e2e, deploy
├── docker-compose.yml      # Docker Compose (app + MySQL)
├── Dockerfile              # Multi-stage production build
├── drizzle.config.ts       # Drizzle Kit configuration
├── vite.config.ts          # Vite build configuration
├── vitest.config.ts        # Unit test configuration (with coverage thresholds)
├── .env.example            # Environment variable template
└── package.json
```

---

## Architecture

### Multi-Tenancy

Every database table includes a `tenant_id` column. All queries filter by the authenticated user's tenant, ensuring complete data isolation.

### Middleware Stack

```
Request → Correlation ID → Tenant Isolation → Global Rate Limit → Auth → Role Guard → Mutation Rate Limit → Handler
```

### Role Hierarchy

| Role | Access |
|------|--------|
| `superadmin` | All tenants, platform management |
| `ceo` | Full tenant access, user management, billing |
| `operator` | Orders, products, shops, stock, arrivals |
| `supervisor` | Agent tracking, daily plans, reports |
| `agent` | Own shops, own orders, GPS tracking |
| `merchandiser` | Read-only analytics |

### Testing Structure

```
api/__tests__/
├── auth-router.test.ts          # 28 tests (login, logout, register, me)
├── billing-router.test.ts       # 20 tests (status, upgrade)
├── stripe-router.test.ts        # 17 tests (subscription lifecycle)
├── order-business-logic.test.ts # Order stock operations
├── tenant-isolation.test.ts     # RBAC matrix tests
├── session.test.ts              # JWT verification
├── password.test.ts             # PBKDF2 hash/verify
├── rate-limit.test.ts           # Rate limiting
├── notification-router.test.ts  # Notification CRUD
├── product-router.test.ts       # Product operations
├── shop-router.test.ts          # Shop management
├── stock-api.test.ts            # Stock adjustments
├── warehouse-router.test.ts     # Warehouse operations
├── order-api.test.ts            # Order API tests
├── integration.test.ts          # Cross-module tests
└── helpers/                     # Test utilities
    └── mock-db.ts               # In-memory database mock

api/services/__tests__/
├── order.test.ts                # Order service tests
├── stock.test.ts                # Stock service tests
└── payment.test.ts              # Payment service tests
```

**Coverage Thresholds:**
- Lines: 50%
- Functions: 50%
- Branches: 30%
- Statements: 50%

---

## Documentation

- [API Reference](docs/api/README.md) — tRPC routers, authentication, rate limiting
- [Architecture Overview](docs/architecture/README.md) — System design, data flow, tech stack
- [Deployment Guide](docs/deployment/README.md) — Docker, Railway, environment variables
- [Mobile App](../warehouse-pro-mobile/mobile/README.md) — React Native Expo setup
- [Changelog](../CHANGELOG.md) — All project changes

---

## Mobile App

The React Native Expo mobile app is located at `warehouse-pro-mobile/mobile/`.

### Mobile Quick Start

```bash
cd ../warehouse-pro-mobile/mobile
npm install
npm start
```

### Mobile Commands

```bash
npm start             # Start Expo dev server
npm run android       # Start on Android
npm run ios           # Start on iOS
npm run web           # Start on web
npm run test          # Run Jest tests
npm run lint          # Run ESLint
npm run lint:fix      # Auto-fix lint issues
npm run format        # Format with Prettier
```

---

## Troubleshooting

### `ECONNREFUSED` or `ETIMEDOUT` when running db commands

Your `DATABASE_URL` is wrong or pointing to localhost. Make sure:
1. `.env` file exists in the project root
2. `DATABASE_URL` is set to the correct MySQL URL
3. The URL format is: `mysql://root:PASSWORD@HOST:PORT/database_name`

### `npm install` fails with peer dependency error

Always use `--legacy-peer-deps`:
```bash
npm install --legacy-peer-deps
```

### `db:push` shows "No changes detected" but seed fails

The schema is synced but the connection in seed uses a different driver.
Make sure `DATABASE_URL` in `.env` is correct and run:
```bash
npm run db:push && npm run db:seed
```

### TypeScript errors after pulling latest changes

```bash
rm -rf node_modules
npm install --legacy-peer-deps
npm run check
```

### Tests fail after database changes

Reset the database:
```bash
npm run db:reset
npm run test
```

---

## Production Deployment

### Railway

1. Add a **Node** service in Railway
2. Set environment variables (copy from `.env`, add `NODE_ENV=production`)
3. Build command: `npm install --legacy-peer-deps && npm run build`
4. Start command: `npm start`

The app serves the React build as static files from the Hono server.

### Docker

```bash
docker compose up -d
```

See [Deployment Guide](docs/deployment/README.md) for full details.
