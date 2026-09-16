---
name: warehouse-import
description: "Импорт магазинов и товаров из Excel/CSV. Используй когда: 'импорт магазинов', 'import shops', 'загрузка Excel', 'импорт товаров', 'bulk import'. Включает territory fallback по району, column mapping, preview."
---

# Import: Импорт из Excel/CSV

## Архитектура

Роутер: `api/import-router.ts`
UI: `src/components/ExcelImport.tsx`
Поддержка: .xlsx, .xls, .csv

## Что реализовано

### Territory Fallback (DONE)

При импорте магазинов:
1. Сначала ищем совпадение по столбцу "Территория"
2. Если не найден — fallback на столбец "Район"
3. Код: `api/import-router.ts:445-457`

### Column Mapping

SHOP_COLUMNS: название→name, владелец→ownerName, телефон→phone, город→city, район→district, адрес→address, долг→debt, широта→gpsLat, долгота→gpsLng, территория→territory, примечания→notes

PRODUCT_COLUMNS: код→code, штрихкод→barcode, название→name, категория→category, цена→unitPrice, себестоимость→costPrice, единица→unit, вес→unitWeight, мин.остаток→reorderPoint, остаток→initialStock

### Preview

`previewImport` — показывает первые 5 строк без импорта.

### Template Download

`downloadTemplate` — генерирует .xlsx шаблон с тестовыми данными.

## Важно

- Auto-generate product codes если не указаны
- Unit translations: шт→pcs, кг→kg, л→l, ящ→box, упак→pack
- Duplicate detection по code (products) — skip с сообщением
- S3 upload для base64 фото
- Cache invalidation после импорта

## Тесты

Файл: `api/__tests__/import-territory.test.ts` — 7 тестов
