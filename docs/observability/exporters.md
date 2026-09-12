# Экспортёры MySQL и Redis, второй канал тревог

Приложение отдаёт свои метрики само (`/metrics`), но базу и Redis
Prometheus видит только через экспортёры — отдельные службы Railway. Пока
их нет, цели `mysql` и `redis` в Prometheus стоят «down», и это ничего не
ломает: правила по ним срабатывают на настоящих числах, не на отсутствии.

## MySQL — `prom/mysqld-exporter`

1. В проекте Railway: **New → Docker Image → `prom/mysqld-exporter:latest`**,
   имя службы **`mysqld-exporter`** (по нему Prometheus и ищет:
   `mysqld-exporter.railway.internal:9104`).
2. Переменные службы:

   ```
   DATA_SOURCE_NAME=${{MySQL-avuz.MYSQL_USER}}:${{MySQL-avuz.MYSQL_PASSWORD}}@(${{MySQL-avuz.RAILWAY_PRIVATE_DOMAIN}}:3306)/
   ```

   Лучше завести в базе отдельного пользователя только на чтение статуса:

   ```sql
   CREATE USER 'exporter'@'%' IDENTIFIED BY '<пароль>' WITH MAX_USER_CONNECTIONS 3;
   GRANT PROCESS, REPLICATION CLIENT, SELECT ON *.* TO 'exporter'@'%';
   ```

3. Публичного домена не нужно: Prometheus ходит по внутренней сети.

## Redis — `oliver006/redis_exporter`

1. **New → Docker Image → `oliver006/redis_exporter:latest`**, имя службы
   **`redis-exporter`** (`redis-exporter.railway.internal:9121`).
2. Переменная: `REDIS_ADDR=${{Redis.REDIS_URL}}`.

## Перезапуск Prometheus и AlertManager с новой настройкой

Команды запуска порождаются из `docs/observability/*.yml`:

```bash
node scripts/build-observability-commands.mjs
```

Вставить выведенные команды в **Settings → Deploy → Custom Start Command**
соответствующих служб и нажать Deploy (см. docs/deployment.md — `railway
redeploy` прежнюю настройку не перечитывает).

## Второй канал тревог: вебхук в приложение

Telegram был единственным каналом: сломался бот, потерялся чат — тревоги
молча исчезают. Теперь AlertManager дополнительно бьёт в
`POST https://www.warehouse-pro.uz/api/webhooks/alertmanager` с заголовком `Authorization: Bearer <ALERTMANAGER_WEBHOOK_SECRET>`, а
приложение кладёт тревогу в уведомления суперадминов и шлёт push на
телефон — другой путь доставки.

Один и тот же ключ в двух местах:

- служба **Warehouse-Pro**: `ALERTMANAGER_WEBHOOK_SECRET=<длинная случайная строка>`;
- служба **AlertManager**: та же переменная с тем же значением.

Без переменной ручка отвечает 404, с неверным ключом — 401; AlertManager
это переживает и продолжает слать в Telegram.

## Что появилось в метриках приложения

- `trpc_procedure_duration_seconds{path,type,ok}` и
  `trpc_procedure_errors_total{path,code}` — по каждой процедуре: какая
  ручка тормозит и какая падает. Тревоги «ПроцедураОтказывает» (внутренние
  ошибки > 5 %) и «ПроцедураМедленная» (p95 > 2 с).
- `client_requests_total{client,version}` — кто и какой сборкой ходит.
