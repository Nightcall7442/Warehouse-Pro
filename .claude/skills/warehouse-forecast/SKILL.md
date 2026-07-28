---
name: warehouse-forecast
description: "Прогнозирование спроса и предсказание исчерпания запасов. Используй когда: 'прогноз спроса', 'demand forecast', 'когда закончится товар', 'stockout prediction', 'рекомендация по закупке', 'forecast analytics'. Включает SMA, EMA, linear regression."
---

# Demand Forecast: Прогнозирование спроса

## Архитектура

Данные: `orderItems` (quantity per product per day), `stockMovements`, `warehouseStock`.
Алгоритмы: Simple Moving Average, Exponential Smoothing, Linear Regression.

## Шаги реализации

### 1. Forecast Engine

Файл: `api/services/forecast-engine.ts` (НОВЫЙ)

Алгоритмы:
- `simpleMovingAverage(data[], window)` — скользящее среднее
- `exponentialSmoothing(data[], alpha)` — экспоненциальное сглаживание
- `linearRegression(data[])` — линейная регрессия (trend + intercept)
- `predict(historicalData, horizon, method)` — прогноз на N дней

### 2. Stock Predictor

Файл: `api/services/stock-predictor.ts` (НОВЫЙ)

- `daysUntilStockout(productId, warehouseId)` — текущий остаток / среднее потребление
- `reorderRecommendation(tenantId)` — продукты ниже reorderPoint
- Учитывать pending arrivals

### 3. Forecast Router

Файл: `api/forecast-router.ts` (НОВЫЙ)

Эндпоинты:
- `demandForecast(productId, horizon?, method?)` — прогноз спроса
- `reorderRecommendation` — рекомендации по закупке
- `stockoutPrediction` — предсказание исчерпания
- `categoryTrend(category, period?)` — тренд по категории

### 4. Frontend

Файл: `src/pages/Forecast.tsx` (НОВЫЙ)

- Выбор продукта + горизонт прогноза
- График: факт (линия) + прогноз (пунктир) + доверительный интервал
- Таблица reorder recommendations с urgency badges
- Виджет на Dashboard: "Топ-5 товаров для закупки"

### 5. Регистрация

Файл: `api/router.ts` — добавить `forecast: forecastRouter`
Файл: `src/App.tsx` — маршрут `/forecast`

## SQL запрос для исторических данных

```sql
SELECT DATE(o.created_at) as date, SUM(oi.quantity) as qty
FROM order_items oi
JOIN orders o ON oi.order_id = o.id
WHERE oi.product_id = ? AND o.tenant_id = ? AND o.status = 'completed'
GROUP BY DATE(o.created_at)
ORDER BY date
```

## Важно

- Все вычисления на сервере (не в браузере)
- Кэшировать результаты прогноза (TTL 1 час)
- Учитывать возвраты (returns) при расчёте потребления
- Не показывать прогноз если данных < 14 дней
