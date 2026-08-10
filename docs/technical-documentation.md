# Warehouse Pro — Техническая документация

**Версия:** 1.0.0  
**Дата:** Август 2026  
**Автор:** Warehouse Pro Team

---

## Содержание

1. [Обзор платформы](#1-обзор-платформы)
2. [Архитектура](#2-архитектура)
3. [API Reference](#3-api-reference)
4. [Интеграции](#4-интеграции)
5. [Безопасность](#5-безопасность)
6. [Развёртывание](#6-развёртывание)
7. [Мониторинг](#7-мониторинг)

---

## 1. Обзор платформы

### Что это
Warehouse Pro — SaaS-платформа для управления складом, заказами, доставкой и командой агентов. Разработана для рынка Узбекистана с поддержкой мультитенантности.

### Ключевые возможности
- 📦 Управление складом и остатками
- 🛒 Создание и обработка заказов
- 🚚 Управление доставками
- 👥 GPS-трекинг агентов
- 📊 Аналитика и отчёты
- 💳 Биллинг и подписки
- 📱 Мобильное приложение с офлайн-режимом
- 🔔 Telegram уведомления
- 🔗 Интеграция с 1С

### Технологический стек

| Компонент | Технология |
|-----------|------------|
| Frontend | React 19, Vite 7, Tailwind CSS |
| Backend | Hono, tRPC, Drizzle ORM |
| Database | MySQL 8 |
| Cache | Redis (опционально) |
| Mobile | React Native, Expo SDK 54 |
| Платежи | Stripe |
| Хранение файлов | AWS S3 |
| Мониторинг | Sentry, OpenTelemetry |
| Деплой | Railway, Docker |

---

## 2. Архитектура

### Структура проекта

```
warehouse-pro/
├── api/                    # Backend (Hono + tRPC)
│   ├── auth/              # Аутентификация
│   ├── guards/            # RBAC
│   ├── services/          # Бизнес-логика
│   ├── queries/           # Запросы к БД
│   ├── cron/              # Фоновые задачи
│   └── webhooks/          # Webhook обработчики
├── src/                    # Frontend (React)
│   ├── components/        # UI компоненты
│   ├── pages/             # Страницы
│   ├── hooks/             # React хуки
│   └── providers/         # Контекст
├── db/                     # Схема БД
│   ├── schema.ts          # Drizzle схема
│   ├── migrations/        # Миграции
│   └── seed.ts            # Тестовые данные
├── contracts/              # Общие типы
└── docs/                   # Документация
```

### Мультитенантность

Каждый тенант (организация) имеет:
- Изолированные данные (tenantId во всех таблицах)
- Собственные настройки
- Собственную подписку
- Собственное брендинг (white-label)

### Поток запроса

```
Клиент → Hono → tRPC → Middleware (auth, rate limit, RBAC) → Router → Service → DB
```

---

## 3. API Reference

### Аутентификация

Все запросы требуют Bearer токен:
```
Authorization: Bearer <jwt_token>
```

### Основные endpoints

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/login` | Вход в систему |
| POST | `/api/logout` | Выход |
| POST | `/api/trpc/` | tRPC запросы |

### tRPC роутеры

| Роутер | Описание |
|--------|----------|
| `auth` | Аутентификация, профиль |
| `shop` | Магазины |
| `product` | Товары |
| `order` | Заказы |
| `warehouse` | Склады |
| `arrival` | Приходы |
| `user` | Пользователи |
| `analytics` | Аналитика |
| `billing` | Биллинг |
| `notification` | Уведомления |
| `settings` | Настройки |

### Пример запроса

```typescript
// Получить список заказов
const orders = await trpc.order.list.query({
  page: 1,
  pageSize: 25,
  status: "new"
});
```

---

## 4. Интеграции

### 1С

Синхронизация заказов и остатков с 1С:

```typescript
// Конфигурация
{
  url: "http://1c-server:8080",
  username: "admin",
  password: "***",
  syncProducts: true,
  syncOrders: true,
  intervalMinutes: 60
}
```

### Stripe

Автоматические платежи и подписки:

```typescript
// Создание checkout сессии
const session = await trpc.stripe.createCheckoutSession.mutate({
  plan: "pro",
  successUrl: "https://...",
  cancelUrl: "https://..."
});
```

### Telegram

Уведомления в реальном времени:

```typescript
// Уведомление о новом заказе
await notifyTenantRole(tenantId, "ceo", 
  tgMessages.newOrder(orderNumber, shopName, total, "сум")
);
```

---

## 5. Безопасность

### Аутентификация
- JWT с HS256 (jose)
- PBKDF2 для хеширования паролей (100k итераций)
- Token versioning для отзыва сессий
- Biometric auth на мобильных устройствах

### Авторизация
- RBAC с 7 ролями: superadmin, ceo, operator, supervisor, agent, merchandiser, courier
- Middleware-based проверка ролей
- Tenant isolation на всех запросах

### Защита данных
- AES-256-GCM для шифрования чувствительных данных
- CORS + CSRF double-submit cookie
- Rate limiting (120 req/min на пользователя)
- Input validation через Zod
- Parameterized queries (Drizzle ORM)

### Мониторинг
- Sentry для ошибок
- OpenTelemetry для трейсинга
- Telegram алерты для 5xx ошибок
- Audit logging для критических операций

---

## 6. Развёртывание

### Docker

```bash
# Сборка
docker build -t warehouse-pro .

# Запуск
docker run -p 3000:3000 \
  -e DATABASE_URL=mysql://... \
  -e APP_SECRET=... \
  warehouse-pro
```

### Railway

```json
{
  "builder": "DOCKERFILE",
  "healthcheckPath": "/health/ready",
  "restartPolicyType": "ON_FAILURE"
}
```

### Переменные окружения

| Переменная | Описание | Обязательна |
|-----------|----------|-------------|
| `DATABASE_URL` | MySQL connection string | ✅ |
| `APP_SECRET` | JWT secret | ✅ |
| `APP_URL` | Public URL | ✅ |
| `STRIPE_SECRET_KEY` | Stripe API key | ❌ |
| `REDIS_URL` | Redis connection | ❌ |
| `S3_BUCKET` | S3 bucket для файлов | ❌ |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | ❌ |

---

## 7. Мониторинг

### Health endpoints

| Endpoint | Описание |
|----------|----------|
| `/health` | Общий статус |
| `/health/ready` | Readiness probe |
| `/health/1c` | Статус 1C интеграции |

### Метрики

```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 3600,
  "database": "connected",
  "s3": "connected",
  "backup": "ok",
  "cache": {
    "hits": 150,
    "misses": 10,
    "size": 50
  }
}
```

### Sentry alerts

- High Error Rate (>10 errors/min)
- New Error Type Detected
- Server Error (500)
- Slow API Response (P95 > 2s)
- Auth Failure Spike (>5/min)

---

## Приложение A: Роли и права

| Роль | Заказы | Склад | Отчёты | Настройки | Биллинг |
|------|--------|-------|--------|-----------|---------|
| superadmin | ✅ | ✅ | ✅ | ✅ | ✅ |
| ceo | ✅ | ✅ | ✅ | ✅ | ✅ |
| operator | ✅ | ✅ | ✅ | ❌ | ❌ |
| supervisor | 👁 | 👁 | 👁 | ❌ | ❌ |
| agent | ✅ | 👁 | ❌ | ❌ | ❌ |
| merchandiser | 👁 | 👁 | 👁 | ❌ | ❌ |
| courier | ✅ | ❌ | ❌ | ❌ | ❌ |

✅ = полный доступ, 👁 = только чтение

---

## Приложение B: Статусы заказов

| Статус | Описание |
|--------|----------|
| `new` | Новый заказ |
| `processing` | В обработке |
| `shipped` | Отправлен |
| `delivered` | Доставлен |
| `completed` | Завершён |
| `cancelled` | Отменён |

---

*Документация обновлена: 10 августа 2026*
