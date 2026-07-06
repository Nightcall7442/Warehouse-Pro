# Warehouse Pro — Multi-Tenant WMS

Full-stack TypeScript warehouse management system with multi-tenancy, role-based access control, and real-time capabilities. Updated 2026-07-07.

---

## Features

- **Multi-Tenant Architecture** — Complete data isolation between organizations
- **Role-Based Access Control** — SuperAdmin, CEO, Operator, Supervisor, Agent, Merchandiser, Courier
- **Order Management** — Create, track, and fulfill orders with stock deduction
- **Product Catalog** — Products with barcode support, categories, and stock tracking
- **Shop Management** — Manage retail points with GPS coordinates and debt tracking
- **Warehouse Stock** — Real-time inventory with adjustments, dead stock detection, and reorder suggestions
- **Arrivals** — Track truck arrivals with driver info and expense tracking
- **Agent GPS Tracking** — Real-time field agent location monitoring with trail history
- **Daily Plans** — Assign and track shop visit plans for field agents
- **Analytics & Reports** — Sales by shop, top products, agent performance, COGS, debt reports
- **Real-Time Events** — Server-Sent Events for live dashboard updates
- **Billing** — Subscription management with Basic, Pro, and Exclusive plans
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
| Testing | Vitest (unit) |
| Deploy | Docker, Railway |

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/Nightcall7442/Warehouse-Pro.git
cd Warehouse-Pro/warehouse-pro-web/web
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

### 4. Seed demo data

```bash
npm run db:seed
```

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

---

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | MySQL connection string | `mysql://root:pass@host:3306/railway` |
| `APP_SECRET` | JWT signing secret (48 bytes base64) | `openssl rand -base64 48` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_URL` | `http://localhost:3000` | Public application URL |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated CORS origins |
| `STRIPE_SECRET_KEY` | — | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | — | Stripe webhook secret |
| `STRIPE_BASIC_PRICE_ID` | — | Stripe Price ID for Basic |
| `STRIPE_PRO_PRICE_ID` | — | Stripe Price ID for Pro |
| `STRIPE_EXCLUSIVE_PRICE_ID` | — | Stripe Price ID for Exclusive |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token |
| `TELEGRAM_ADMIN_CHAT_ID` | — | Telegram admin chat ID |

See `.env.example` for the full list.

---

## Development Commands

```bash
# Development
npm run dev              # Start Vite dev server with HMR
npm run build            # Production build (Vite + esbuild)
npm run start            # Start production server

# Code Quality
npm run lint             # Run ESLint
npm run check            # TypeScript type checking

# Testing
npm run test             # Run unit tests (Vitest)

# Database
npm run db:push          # Push schema to database
npm run db:seed          # Seed demo data (idempotent)
npm run db:reset         # Clear + re-push + re-seed
```

---

## Project Structure

```
web/
├── api/                    # Hono backend + tRPC routers
│   ├── auth/               # JWT session management
│   ├── lib/                # Shared utilities (cache, env, logger, etc.)
│   ├── services/           # Business logic layer
│   ├── webhooks/           # External webhook handlers (Stripe, 1C)
│   ├── cron/               # Scheduled tasks
│   ├── __tests__/          # API unit tests (27 files, 310 tests)
│   ├── *-router.ts         # tRPC route handlers (20+ routers)
│   ├── boot.ts             # Server entry point
│   ├── context.ts          # tRPC context
│   └── middleware.ts       # Auth, role, rate-limit middleware
├── db/
│   ├── schema.ts           # Drizzle table definitions (19 tables)
│   ├── relations.ts        # Drizzle relation definitions
│   └── seed.ts             # Demo data (idempotent)
├── src/                    # React frontend
│   ├── components/         # Shared UI components
│   ├── hooks/              # Custom React hooks
│   ├── i18n/               # Internationalization (ru/uz)
│   └── pages/              # Page components (36 pages)
├── contracts/              # Shared types between frontend & backend
├── Dockerfile              # Multi-stage production build
├── docker-compose.yml      # Docker Compose (app + MySQL)
├── vite.config.ts          # Vite build configuration
├── vitest.config.ts        # Unit test configuration
├── .env.example            # Environment variable template
└── package.json
```

---

## Architecture

### Multi-Tenancy

Every database table includes a `tenant_id` column. All queries filter by the authenticated user's tenant, ensuring complete data isolation.

### Middleware Stack

```
Request → Correlation ID → Tenant Isolation → Global Rate Limit → Auth → Role Guard → Handler
```

### Role Hierarchy

| Role | Access |
|------|--------|
| `superadmin` | All tenants, platform management |
| `ceo` | Full tenant access, user management, billing |
| `operator` | Orders, products, shops, stock, arrivals |
| `supervisor` | Agent tracking, daily plans, reports |
| `agent` | Own shops, own orders, GPS tracking |
| `merchandiser` | Visit reports, photo capture |
| `courier` | Deliveries, GPS tracking |

---

## Production Deployment

### Railway

1. Connect GitHub repo `Nightcall7442/Warehouse-Pro` in Railway dashboard
2. Service auto-deploys on push to `main`
3. Set environment variables in Railway dashboard
4. Configure domain: `www.warehouse-pro.uz` → CNAME to Railway

### Docker

```bash
docker compose up -d
```

---

## License

Private — All rights reserved.

