# Warehouse-Pro — План улучшений

> Дата: 2026-07-15
> Версия проекта: 0.0.0

---

## Фаза 0: Быстрые победы (1-2 дня)

| # | Задача | Файлы | Сложность | Эффект |
|---|--------|-------|-----------|--------|
| 0.1 | Исправить `warehouse-router.ts` — использовать `ctx.db` вместо `getDb()` | `api/warehouse-router.ts` | ★☆☆ | Консистентность |
| 0.2 | Убрать дубликат `CardDots` — импортировать из `DashboardLayout` | `src/pages/Dashboard.tsx`, `src/components/DashboardLayout.tsx` | ★☆☆ | DRY |
| 0.3 | Убрать `as any` в `useCurrency.ts` — добавить правильный тип | `src/hooks/useCurrency.ts` | ★☆☆ | Типобезопасность |
| 0.4 | Убрать `as any` в `Dashboard.tsx` (kpis) | `src/pages/Dashboard.tsx` | ★☆☆ | Типобезопасность |
| 0.5 | Убрать `as any` в `Orders.tsx` (если есть) | `src/pages/Orders.tsx` | ★☆☆ | Типобезопасность |
| 0.6 | Убрать `as any` в `Products.tsx` (если есть) | `src/pages/Products.tsx` | ★☆☆ | Типобезопасность |
| 0.7 | Унифицировать password-reset: из функции → Service-объект | `api/services/password-reset.ts` | ★☆☆ | Консистентность |
| 0.8 | Удалить мёртвый код / закомментированные блоки | По всему проекту | ★☆☆ | Чистота |

---

## Фаза 1: Инфраструктура и масштабирование (3-5 дней)

### 1.1 Redis — Кэш
- Заменить `api/lib/cache.ts` (in-memory LRU) на Redis
- Интерфейс сохранить: `cache.get(key)`, `cache.set(key, value, ttl)`
- Добавить переменные окружения: `REDIS_URL`
- Graceful degradation: если Redis недоступен — fallback на in-memory

**Файлы:** `api/lib/cache.ts`, `.env.example`, `api/lib/env.ts`

### 1.2 Redis — Rate Limiter
- Переписать `api/lib/rate-limit.ts` на Redis + Lua script (sliding window)
- Сохранить API: `checkRateLimit(key, limit, windowMs)`
- Настроить разные лимиты для аутентифицированных и не-аутентифицированных

**Файлы:** `api/lib/rate-limit.ts`, `api/middleware.ts`

### 1.3 Redis — SSE (Pub/Sub)
- Заменить `api/lib/sse.ts` (in-memory EventBus) на Redis Pub/Sub
- При старте подписываться на канал `sse:tenant:{tenantId}`
- При отправке события — публиковать в Redis, все инстансы получают

**Файлы:** `api/lib/sse.ts`, `api/boot.ts`

### 1.4 Graceful Shutdown
- Добавить обработку `SIGTERM`/`SIGINT`
- Закрыть Redis connection, DB pool, SSE connections
- Дать текущим запросам завершиться (таймаут 30с)

**Файлы:** `api/boot.ts`

---

## Фаза 2: Архитектура и код (3-5 дней)

### 2.1 Рефакторинг контроллеров
- **Вариант А** (рекомендуемый): Удалить `api/controllers/`, всю логику в сервисы
- **Вариант Б**: Переписать все роутеры, чтобы проходили через контроллеры
- Перенести mapError из контроллеров в middleware error formatter

**Файлы:** `api/controllers/*`, роутеры, которые их используют

### 2.2 Унификация i18n
- Выбрать единый подход: key-based (рекомендуется)
- Переписать все inline-вызовы `useTranslate()(ru, uz)` на `t("key.name")`
- Удалить `useTranslate` хук
- Проверить, что все ключи покрыты в обоих языках

**Файлы:** `src/i18n/*`, `src/hooks/*`, `src/pages/*`, `src/components/*`

### 2.3 Стандартизация ошибок
- Создать единый маппер ошибок: код → HTTP статус → сообщение
- Все TRPCError должны проходить через central error handler
- Локализовать сообщения об ошибках (RU/UZ/EN)

**Файлы:** `api/middleware.ts`, `api/lib/errors.ts`, `contracts/errors.ts`

### 2.4 Типизация: полный запрет `any`
- Настроить ESLint правило: `@typescript-eslint/no-explicit-any: error`
- Пройтись по всем вхождениям `as any`, `: any`, `<any>` и заменить на конкретные типы
- Добавить eslint-disable только где абсолютно необходимо (drizzle type inference)

**Файлы:** По всему проекту, ESLint config

---

## Фаза 3: Тестирование и CI/CD (2-3 дня)

### 3.1 Поднять coverage
- Lines: 50% → 70%
- Branches: 30% → 50%
- Functions: 50% → 65%

### 3.2 Ключевые тесты
- Тесты на state-переходы заказов (new → processing → completed → cancelled)
- Тесты на multi-tenant изоляцию (data leakage)
- Тесты на subscription gating (billedQuery)
- Тесты на stock concurrency (race conditions)

### 3.3 CI/CD
- Добавить деплой в CI (Docker build & push → Railway/Dokku)
- Добавить integration tests в CI (с MySQL testcontainer)
- Добавить lint-staged / pre-commit hooks

**Файлы:** `.github/workflows/ci.yml`, `Dockerfile`, `vitest.config.ts`

---

## Фаза 4: UX и производительность (2-3 дня)

### 4.1 Разделение больших компонентов
- `Dashboard.tsx` (415 строк) → вынести KPI cards, Charts в отдельные компоненты
- `Orders.tsx` (453 строки) → вынести фильтры, таблицу, модалки

### 4.2 Оптимизация загрузки
- Проверить bundle size (Vite bundle analyzer)
- Добавить code splitting для тяжёлых библиотек (recharts, xlsx)
- Lazy loading для всех страниц (уже частично сделано)

### 4.3 Offline support
- Проверить PWA Service Worker (уже есть `vite-plugin-pwa`)
- Добавить кэширование API-запросов для offline (Cache-first strategy)
- Доделать `OfflineOrders.tsx`

---

## Фаза 5: Безопасность (1-2 дня)

### 5.1 Аудит безопасности
- Проверить CSP заголовки (уже есть, но обновить)
- Добавить helmet-like middleware для Hono
- Проверить rate-limit на auth endpoints (уже есть 20/15min)
- Добавить bruteforce protection на forgot-password

### 5.2 Аудит зависимостей
- `npm audit` — исправить уязвимости
- Обновить `vite-plugin-pwa@0.20` (fails with Vite 7, требует `--legacy-peer-deps`)

---

## Фаза 6: Мониторинг и observability (2-3 дня)

### 6.1 OpenTelemetry
- Добавить OpenTelemetry SDK
- Trace: каждый tRPC запрос → span с tenant_id, user_id, procedure
- Metrics: request count, latency, error rate per endpoint
- Export: OTLP (Jaeger/OpenTelemetry Collector)

### 6.2 Structured logging
- Улучшить `api/lib/logger.ts` — добавить request-scoped fields
- Correlation ID прокидывать во все логи

### 6.3 Health checks
- `GET /health` — проверка DB, Redis, uptime
- `GET /ready` — readiness probe для Kubernetes

---

## Roadmap

```
Фаза 0: Быстрые победы           ████████░░░░░░  (нед. 1)
Фаза 1: Инфраструктура (Redis)   ░░░░░░░░░░░░░░  (нед. 2-3)
Фаза 2: Архитектура и код         ░░░░░░░░░░░░░░  (нед. 3-4)
Фаза 3: Тестирование и CI/CD     ░░░░░░░░░░░░░░  (нед. 4-5)
Фаза 4: UX и производительность  ░░░░░░░░░░░░░░  (нед. 5-6)
Фаза 5: Безопасность             ░░░░░░░░░░░░░░  (нед. 6)
Фаза 6: Observability            ░░░░░░░░░░░░░░  (нед. 7)
```

---

## Оценка трудозатрат

| Фаза | Дней | Описание |
|------|------|----------|
| Фаза 0 | 1-2 | Быстрые исправления |
| Фаза 1 | 3-5 | Redis: кэш + rate-limit + SSE |
| Фаза 2 | 3-5 | Архитектурный рефакторинг |
| Фаза 3 | 2-3 | Тесты + CI/CD |
| Фаза 4 | 2-3 | UX/производительность |
| Фаза 5 | 1-2 | Безопасность |
| Фаза 6 | 2-3 | Мониторинг |
| **Итого** | **14-23** | **2-3 недели** |

---

## Статус выполнения

- [x] **Фаза 0**: Быстрые победы
- [x] **Фаза 1**: Redis — кэш, rate-limiter, SSE
- [ ] **Фаза 2**: Архитектура — контроллеры, i18n, ошибки, типы
- [ ] **Фаза 3**: Тестирование и CI/CD
- [ ] **Фаза 4**: UX и производительность
- [ ] **Фаза 5**: Безопасность
- [ ] **Фаза 6**: Мониторинг и observability
