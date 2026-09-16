---
name: warehouse-gps-autolink
description: "Автоматическая привязка магазинов к территориям по GPS координатам. Используй когда: 'привязать магазины по GPS', 'auto-assign shops to territories', 'территория по координатам', 'автоматическая привязка территорий'. Триггеры: создание магазина с GPS, обновление территории, ручной запуск авто-привязки."
---

# GPS Auto-Link: Авто-привязка магазинов к территориям

## Архитектура

Территории имеют `centerLat/centerLng/radiusKm`. Магазины имеют `gpsLat/gpsLng`.
Haversine функция в `api/lib/geo.ts` вычисляет расстояние.

## Шаги реализации

### 1. Авто-привязка при создании магазина

Файл: `api/shop-router.ts`, мутация `create`

После `db.insert(shops).values(...)`, если есть GPS координаты:
- Запросить все территории тенанта с centerLat/centerLng
- Для каждой вычислить haversine расстояние
- Если расстояние <= radiusKm — обновить territoryId магазина

### 2. Авто-привязка при обновлении территории

Файл: `api/territory-router.ts`, мутация `update`

При изменении center/radius:
- Найти все магазины тенанта с GPS координатами
- Пересчитать привязку для каждого

### 3. Убрать дублирование Haversine

Файл: `api/agent-router.ts`

Удалить inline копии haversine. Импортировать из `api/lib/geo.ts`.

### 4. UI кнопка "Авто-привязка"

Файл: `src/components/shops/TerritoryManager.tsx`

Добавить кнопку, вызывающую `trpc.territory.autoAssign.mutate()`.

## Важно

- Использовать `haversineKm` из `api/lib/geo.ts`, НЕ inline копии
- `autoAssign` уже существует — просто нужно вызывать его автоматически
- Multi-tenant: всегда фильтровать по `tenantId`
- Не привязывать магазины без GPS координат

## Тесты

Файл: `api/__tests__/shop-router.test.ts`

- Магазин с GPS автоматически привязывается к территории при создании
- Магазин без GPS остаётся без территории
- Обновление territory center перепривязывает магазины
