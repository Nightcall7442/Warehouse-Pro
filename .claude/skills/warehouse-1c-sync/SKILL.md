---
name: warehouse-1c-sync
description: "Интеграция и синхронизация с 1С:Предприятие. Используй когда: 'синхронизация с 1С', '1C integration', 'выгрузка в 1С', 'загрузка из 1С', 'настройка 1С моста', '1C OData'. Включает bidirectional sync products/orders/shops, мониторинг, расписание."
---

# 1C Integration: Синхронизация с 1С:Предприятие

## Архитектура

Мост: `api/lib/onec-bridge.ts` — HTTP клиент для 1C OData API.
Роутер: `api/onec-router.ts` — setup wizard, sync triggers.
Сервис: `api/services/onec-sync.ts` — бизнес-логика синхронизации.
Мониторинг: `api/lib/onec-monitor.ts` — алерты.

Таблицы: `id_mappings`, `sync_status`, `onec_config`.

## Что уже работает

- `syncProducts()` — загрузка товаров из 1С (Catalog_Номенклатура)
- `syncOrderTo1C()` — выгрузка заказа в 1С (Document_РеализацияТоваровИУслуг)
- Setup wizard (saveConfig, testConnection)
- Мониторинг (alerts for sync failures)

## Шаги реализации

### 1. Sync Shops from 1C

Файл: `api/services/onec-sync.ts`

```typescript
async function syncShopsFrom1C(tenantId: number) {
  // OData entity: Catalog_Контрагенты или Catalog_Партнеры
  // Map fields: ИНН → phone, Наименование → name, Адрес → address
  // Use id_mappings (entityType="shop") for deduplication
}
```

### 2. Sync Orders from 1C

```typescript
async function syncOrdersFrom1C(tenantId: number) {
  // OData entity: Document_ЗаказПокупателя
  // Map status: Новый→new, ВРаботе→processing, Выполнен→completed
  // Use id_mappings (entityType="order") for deduplication
}
```

### 3. Auto-sync по расписанию

Файл: `api/onec-router.ts`

Использовать `syncSchedule` эндпоинт + setInterval:
```typescript
// В runtime: setInterval(() => sync(tenantId), intervalMinutes * 60_000)
```

### 4. UI мониторинга

Файл: `src/pages/OneCSync.tsx` (НОВЫЙ)

- Карточки: последняя синхронизация products/orders/shops
- Лог ошибок (из sync_status)
- Кнопки ручной синхронизации
- Настройки интервала (onec_config)
- Health check индикатор

### 5. Обработка конфликтов

- Last-write-wins по `updatedAt`
- Логирование расхождений в `sync_status.error`
- Алерт при >20% ошибок

## OData entities

| Сущность | 1C Entity | Направление |
|----------|-----------|-------------|
| Товары | Catalog_Номенклатура | 1C → WP |
| Магазины | Catalog_Контрагенты | 1C → WP |
| Заказы (out) | Document_РеализацияТоваровИУслуг | WP → 1C |
| Заказы (in) | Document_ЗаказПокупателя | 1C → WP |

## Важно

- Per-tenant конфигурация (onec_config таблица)
- id_mappings для bidirectional UUID resolution
- Не удалять сущности при sync — деактивировать
- Логировать ВСЁ в sync_status
