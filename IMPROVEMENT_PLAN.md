# Warehouse-Pro — План улучшений

> Дата: 2026-07-19 (обновлено)
> Версия проекта: 1.0.0

---

## Фаза 0: Критические исправления ✅

| # | Задача | Статус | Коммит |
|---|--------|--------|--------|
| 0.1 | Исправить 5 падающих тестов (RBAC + mock innerJoin) | ✅ | `045dd97` |
| 0.2 | Удалить неиспользуемый `expo` из web package.json | ✅ | `045dd97` |
| 0.3 | Заменить уязвимый `xlsx@0.18.5` на `exceljs` | ✅ | `634858f` |
| 0.4 | Исправить 16 критических security bugs (cross-tenant, race conditions, XSS, injection) | ✅ | `3381cc1` |
| 0.5 | Добавить миграцию `photo_url` для daily_plans | ✅ | `215e387` |

**npm audit:** 15 → 6 moderate (оставшиеся — транзитивная зависимость exceljs→uuid)

---

## Фаза 1: Производительность ✅

| # | Задача | Статус | Коммит |
|---|--------|--------|--------|
| 1.1 | Batch N+1 в onec-sync (500 SELECT → 1 SELECT) | ✅ | `30329bb` |
| 1.2 | Batch INSERT в NotificationService.createBulk | ✅ | `30329bb` |

---

## Фаза 2: Тестирование ✅

| # | Задача | Статус | Коммит |
|---|--------|--------|--------|
| 2.1 | Frontend tests: order calculations (31 тест) | ✅ | `16fa97a` |
| 2.2 | vitest config: добавлен `src/**/*.test.ts` | ✅ | `16fa97a` |

**Итого тестов:** 360 (329 backend + 31 frontend)

---

## Фаза 3: Архитектура и код (текущая)

### 3.1 Типизация: сокращение `as any`
- ~48 вхождений `as any` в `src/` + `api/`
- Включить `@typescript-eslint/no-explicit-any: error` постепенно
- Добавить `eslint-disable` только где необходимо (Drizzle type inference)

### 3.2 Унификация i18n
- 12 файлов используют inline `useTranslate()(ru, uz)`
- 50+ файлов используют key-based `t("key.name")`
- Выбрать key-based, переписать оставшиеся 12

### 3.3 Разбиение крупных компонентов
- `Landing.tsx` (1090 строк), `sidebar.tsx` (728), `Warehouse.tsx` (670)
- Разбить по логическим границам: фильтры/таблица/модалки

### 3.4 Очистка контроллеров
- `api/controllers/` может быть удален если вся логика в `api/services/`

---

## Фаза 4: Безопасность (следующая)

### 4.1 Rate limit по email на confirmPasswordReset
- Сейчас лимит только по IP — атакующий с ротацией IP может брутфорсить
- Добавить лимит по email: 5 попыток в час на один email

### 4.2 Проверка public-api.ts
- REST API для Exclusive-тарифа — проверить tenant-scoping
- Убедиться что тот же level защиты что и в tRPC роутерах

### 4.3 Оставшиеся npm audit
- 6 moderate от exceljs→uuid — транзитивная, нет прямого фикса
- Мониторить обновления exceljs

---

## Фаза 5: Тестирование (углубление)

### 5.1 Mobile тесты
- Только 1 тестовый файл — добавить:
  - Offline order sync (`OfflineOrders`)
  - Background location (`backgroundLocation.ts`)
  - Auth 401 invalidation (`src/api.ts`)

### 5.2 Frontend тесты
- Тесты на `ErrorBoundary.tsx`
- Тесты на `MerchandiserVisit.tsx` (photos + checklist)

### 5.3 Coverage targets
- Lines: 50% → 70%
- Branches: 30% → 50%

---

## Фаза 6: Документация и DevEx

### 6.1 Актуализация README
- Синхронизировать demo-credentials с текущими ролями
- Обновить секцию RBAC после изменений

### 6.2 CI/CD
- Добавить integration tests с MySQL testcontainer
- Добавить деплой в CI (Docker → Railway/Dokku)

---

## Фаза 7: Observability (полировка)

- OpenTelemetry SDK + OTLP export (уже настроен)
- Structured logging с AsyncLocalStorage (уже настроен)
- Health checks `/health` + `/ready` (уже есть)

---

## Roadmap

```
Фаза 0: Критические исправления  ██████████████  ГОТОВО
Фаза 1: Производительность         ██████████████  ГОТОВО
Фаза 2: Тестирование              ██████████████  ГОТОВО
Фаза 3: Архитектура и код         ░░░░░░░░░░░░░░  ТЕКУЩАЯ
Фаза 4: Безопасность              ░░░░░░░░░░░░░░  СЛЕДУЮЩАЯ
Фаза 5: Тестирование (углубление) ░░░░░░░░░░░░░░
Фаза 6: Документация и DevEx      ░░░░░░░░░░░░░░
Фаза 7: Observability             ██████████████  ГОТОВО
```

---

## Статус выполнения

- [x] **Фаза 0**: Критические исправления — 16 security bugs, 5 failing tests, expo/xlsx
- [x] **Фаза 1**: Производительность — N+1 batch fixes
- [x] **Фаза 2**: Тестирование — 31 frontend test, 360 total
- [ ] **Фаза 3**: Архитектура — as any, i18n, компоненты
- [ ] **Фаза 4**: Безопасность — rate limit email, public-api audit
- [ ] **Фаза 5**: Тестирование (углубление) — mobile, coverage
- [ ] **Фаза 6**: Документация — README, CI/CD
- [x] **Фаза 7**: Observability — OpenTelemetry, logging, health checks
