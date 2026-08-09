---
name: warehouse-offline
description: "Офлайн-режим для мобильного приложения Warehouse Pro. Используй когда: 'офлайн режим', 'offline mode', 'работать без интернета', 'кэшировать данные', 'offline shop creation', 'offline plan updates'. Включает persistent query cache, sync queues, location buffer."
---

# Offline Mode: Офлайн-режим мобильного приложения

## Архитектура

База: `src/store/offline.ts` (Zustand + AsyncStorage).
Сеть: `@react-native-community/netinfo`.
Синхронизация: `AutoSync` компонент в `app/_layout.tsx`.

## Что уже работает

- Очередь заказов (`pending_orders`)
- Очередь delivery actions (`pending_delivery_actions`)
- Детекция сети (NetInfo)
- Auto-sync при reconnect
- Draft заказа (24h TTL)
- Product cache (error fallback)

## Шаги реализации

### 1. Persistent Query Cache

Пакеты: `@tanstack/query-async-storage-persister`, `@tanstack/react-query-persist-client`

Файл: `app/_layout.tsx`

```typescript
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import AsyncStorage from '@react-native-async-storage/async-storage';

const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: 'warehouse-pro-cache',
});

// Заменить QueryClientProvider на PersistQueryClientProvider
```

### 2. Offline Plan Status Queue

Файл: `src/store/offline.ts`

Добавить:
```typescript
interface PendingPlanAction {
  id: string;
  planId: number;
  status: 'visited' | 'skipped';
  createdAt: string;
  synced: boolean;
  error?: string;
}

// В store:
pendingPlanActions: PendingPlanAction[];
addPlanAction: (action) => void;
syncPlanActions: () => Promise<void>;
```

### 3. Offline Shop CRUD Queue

Файл: `src/store/offline.ts`

```typescript
interface PendingShopAction {
  id: string;
  type: 'create' | 'update';
  data: Partial<Shop>;
  shopId?: number; // for updates
  createdAt: string;
  synced: boolean;
  error?: string;
}
```

### 4. Offline Photo Upload Queue

```typescript
interface PendingUpload {
  id: string;
  type: 'shop_photo' | 'visit_photo';
  dataUrl: string; // base64
  targetId: number; // shopId or planId
  createdAt: string;
  synced: boolean;
}
```

### 5. Offline Location Buffer

Файл: `src/backgroundLocation.ts`

Буферизовать GPS пакеты в AsyncStorage:
```typescript
const LOCATION_BUFFER_KEY = 'pending_locations';
// При saveLocation fail → add to buffer
// При reconnect → batch upload all buffered
```

### 6. UI улучшения

Файл: `src/components/OfflineBanner.tsx`

Показывать счётчики для всех типов очередей:
- Заказы: N
- Планы: N
- Фото: N
- Локации: N

## Важно

- Idempotency keys для всех queued mutations
- Last-write-wins для конфликтов
- Лимит размера AsyncStorage (кэп фото буфера)
- Не блокировать UI при sync — показывать progress
