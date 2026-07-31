# Migration notes

## P0.1 — Date-filter validation and sargable day bounds

**What changed.** Every date filter now goes through `safeDateParse` /
`isoDaySchema` (`api/lib/date-range.ts`) and every range is expressed with the
day-boundary helpers (`sinceDay`, `beforeNextDay`, `onDay`, `untilDate`) instead
of a hand-built `'<day> 23:59:59'` string.

**Behaviour changes to expect:**

- **Malformed dates are now rejected.** Endpoints that take a required period
  (`analytics.pnl`, `analytics.pnlByPaymentMethod`, `analytics.paymentMethodTrend`,
  `commission.calculate`, `salesTarget.upsert` / `bulkUpsert` / `recalculate` /
  `autoSuggest`, `merchandiser.getReportsByDateRange`) answer `BAD_REQUEST`
  ("Дата должна быть в формате ГГГГ-ММ-ДД") for anything that is not a real
  `YYYY-MM-DD` day, including impossible dates like `2024-02-30`. Previously such
  input reached the query and produced empty or whole-history results. Clients
  that send an empty string for a cleared date input must omit the field instead.
- **Optional filters ignore invalid days.** `order.list`, `analytics.salesByShop`,
  `topProducts`, `agentPerformance`, `cogsByProduct`, `cogsSummary` and
  `salesTarget.list` skip a filter they cannot parse rather than filtering on a
  raw string.
- **The upper bound is now inclusive of the whole last day.** `dateTo` /
  `to` / `periodEnd` compare as `created_at < <nextDay> 00:00:00` rather than
  `<= '<day> 23:59:59'`, so rows stamped in the final second of the day
  (`23:59:59.4`, possible on `timestamp` columns with fractional seconds) are no
  longer dropped. Report totals for a period may therefore be marginally higher
  than before — the earlier numbers were the incorrect ones.
- **`merchandiser.getReportsByDateRange` worked by accident before.** Its upper
  bound was written as ``sql`... <= ${dateTo} 23:59:59` ``, which put the time
  into the SQL text after the bind placeholder and produced a syntactically
  invalid statement. It now builds a valid predicate.
- **`agent.getTrail` bounds one validated day** via `onDay` instead of the
  `T00:00:00`/`T23:59:59` pair, so the last second of the day is included.

No database migration and no client changes are required, provided clients
already send `YYYY-MM-DD` (the web app and the mobile app both do).

## P0.2 — Client identification for rate limiting

**What changed.** `getClientIp` no longer returns the constant `"unknown"` when
`TRUSTED_PROXY_COUNT` is unset or `0`. It now falls back to the TCP peer address,
recorded per request by the HTTP layer in `api/boot.ts`. Proxy headers are still
only trusted when `TRUSTED_PROXY_COUNT > 0`.

**Behaviour changes to expect:**

- **Rate limits actually apply per client on the default configuration.**
  Previously every request shared one `"unknown"` bucket, which meant the global
  limiter (120 req/min) throttled the whole deployment at once and per-IP
  mutation limits were effectively meaningless.
- **`TRUSTED_PROXY_COUNT` must match your topology.** Set it to the number of
  reverse proxies in front of the app (`1` for a single nginx / Railway / Fly
  proxy, `2` for Cloudflare + nginx). Too low and every client behind the proxy
  shares the proxy's address; too high and a client can spoof its own address via
  `X-Forwarded-For`. See `.env.example` for the full description.
- **A production start with `TRUSTED_PROXY_COUNT=0` logs a warning** naming the
  consequence, so the misconfiguration is visible in the logs.
- A non-numeric `TRUSTED_PROXY_COUNT` is treated as `0` instead of `NaN`
  (previously `NaN > 0` was false, so it silently behaved like `0` too).

### Deployment checklist

1. Set `TRUSTED_PROXY_COUNT` in the production environment (`1` behind a single
   reverse proxy).
2. Redeploy and confirm the startup log has no "TRUSTED_PROXY_COUNT=0" warning.
3. Verify a couple of report screens (Reports, P&L) still return the expected
   totals — figures for the last day of a range may rise slightly, see above.

## P0.3 — Request-scoped database handle

**What changed.** `api/queries/connection.ts` keeps one pooled Drizzle instance per
process, but the handle callers get is now resolved from an `AsyncLocalStorage`
scope. The HTTP layer opens that scope once per request (`api/boot.ts`), so
`getDb()` deep inside a call chain returns the same handle the request started
with, and `withTransaction` can make an open transaction the ambient handle.

New exports from `api/queries/connection.ts`:

| Export | Purpose |
| --- | --- |
| `runWithDb(handle, fn)` | Run `fn` with `handle` as the ambient handle. Used per request; also the clean way to inject a fake in tests. |
| `withTransaction(fn)` | Open a transaction **and** bind it to the async context, so callees that resolve their own handle join it. |
| `inTransaction()` | Whether the ambient handle is a transaction. |
| `checkDatabaseHealth()` | One-round-trip probe, used by `/health` and `/health/ready`. |
| `waitForDatabase(delays?)` | Startup gate; retries with 1s/2s/4s/8s backoff. |
| `closeDb()` | End the pool and drop the cached instance (shutdown). |
| `DrizzleInstance`, `DbHandle` | The handle types, now exported — `api/services/kpi.ts` and `anti-fraud.ts` were already importing `DrizzleInstance` as if it were. |

**Behaviour changes to expect:**

- **Startup blocks on the database.** In production the server probes the database
  before accepting traffic and retries with backoff (1s, 2s, 4s, 8s). If it is
  still unreachable the process exits with code 1 instead of coming up and
  answering every request with a 500. Deployments that used to start "successfully"
  against a cold or misconfigured database will now fail fast and visibly — check
  `DATABASE_URL` first if a deploy starts crash-looping.
- **Shutdown closes the pool through `closeDb()`** rather than reaching into
  `db.$client.end()`, and a failure there is logged instead of thrown.
- **Routers no longer call `getDb()`.** All resolver call sites now use `ctx.db`
  (the same handle). No API surface changed.
- **`getDb()` is still the right call in three places**, deliberately: during
  authentication and the WebSocket upgrade (`api/queries/users.ts`,
  `api/queries/tenants.ts` — no tRPC context exists yet), in Hono handlers
  (webhooks, `public-api.ts`, `photos.ts`, cron endpoints — inside the request
  scope, so they get the request's handle), and in background/off-request work
  (`api/lib/ws.ts` debounced location writes, push/1C services, `api/cron/*`),
  where it resolves to the pooled instance as before.

### Why one connection per request was **not** implemented

The original plan called for checking a connection out of the pool per request and
releasing it at the end. That would break this codebase in three ways, so the
scope is an async-context-bound *handle*, not a pinned connection:

1. **SSE never ends.** `GET /api/events` holds its response open for hours; a
   connection released "at end of request" would never be released. With
   `DB_CONNECTION_LIMIT` at 20, roughly 20 open dashboards would exhaust the pool.
   The same applies to the WebSocket upgrade path, which bypasses Hono middleware
   entirely.
2. **Parallel queries would serialize.** 36 call sites fan out with `Promise.all`
   — the dashboard issues 7 aggregates at once. A single mysql2 connection runs
   statements one at a time, so those would become sequential round-trips.
3. **Minutes-long requests would squat a connection.** `import.executeImport` and
   the 1C sync interleave DB writes with S3/OData calls, and the cron endpoints run
   in the same process.

### Transaction safety

`db.transaction(...)` is still correct wherever the callback only uses its `tx`
handle — which is the case at all 40 current call sites. Use `withTransaction`
instead when a transaction callback needs to call a **service** that resolves its
own handle: with the plain form, such a callee runs on a different pooled
connection, outside the transaction, and a rollback cannot undo its writes. That
hazard existed before this change; it is now avoidable rather than invisible.

### Testing (P0.3)

`runWithDb(fakeHandle, fn)` injects a handle without patching the module, and
`api/queries/__tests__/connection.test.ts` covers the scoping, transaction
propagation, backoff and shutdown paths against a faked mysql2 pool.

The `createTestDb()` from the original plan — in-memory SQLite or a testcontainers
MySQL — is **not** part of this change. SQLite would diverge from the schema
(mysql-core column types, `DATE_FORMAT`, `FOR UPDATE`, `ON DUPLICATE KEY`), and
testcontainers needs a Docker daemon that neither this environment nor the current
CI job provides. Existing tests keep mocking `../queries/connection`, which still
works because `getDb()` remains a zero-argument export.

## P0.4 — Real database backups

**What changed.** `api/cron/backup.ts` used to `SELECT COUNT(*)` from eight tables
and upload that JSON summary to a key ending in `.sql`. There was no dump, so
there was nothing to restore from — and with no S3 configured it logged
"Backup verified" and returned success. It now runs `mysqldump`, streams the
output through gzip and AES-256-GCM into S3, keeps 7 daily / 4 weekly / 12
monthly copies, and verifies that the uploaded artifact actually restores.

The artifact is `backups/<tier>/warehouse-pro-<YYYY-MM-DD>.sql.gz.enc`. Object
metadata carries what a restore needs: `iv`, `authtag`, `checksum` (of the
encrypted bytes), `plaintext-checksum`, `plaintext-size`, `timestamp`, `database`,
`algorithm`, `compression`.

**New configuration** (see `.env.example` for the full text):

| Variable | Meaning |
| --- | --- |
| `BACKUP_ENCRYPTION_KEY` | 32 bytes hex (`openssl rand -hex 32`). **Required** — without it the job refuses to run rather than uploading a plaintext dump. Store it outside the backup bucket; if it is lost, every backup is unrecoverable. |
| `BACKUP_SCHEDULE` | 5-field cron for the scheduler container, UTC. Default `0 2 * * *`. |
| `BACKUP_VERIFY_DATABASE_URL` | Scratch database the restore check loads each dump into. Empty skips the check. **Must not point at production** — the check drops and recreates the schema. |
| `MYSQLDUMP_PATH` / `MYSQL_PATH` | Override when the client binaries are not on `PATH`. |

**Behaviour changes to expect:**

- **The job now fails loudly.** No S3 configuration, a missing or malformed
  encryption key, a `mysqldump` that exits non-zero, an empty dump, or a failed
  restore check all return `success: false`, and `GET /api/cron/backup` answers
  **500** instead of 200 so an external cron caller notices.
- **`mysqldump` is required.** The web image deliberately does not ship MySQL
  client binaries, so `GET /api/cron/backup` on the web container now fails with
  "Не найден исполняемый файл mysqldump". Scheduled backups run in the new
  `backup` container instead (`docker compose up backup`); for a one-off run
  there, use `node dist/cron/backup-runner.js --now`. If you must keep driving
  backups through the HTTP endpoint on the web image, add `mariadb-client` to the
  `runtime` stage or point `MYSQLDUMP_PATH` at a mounted client.
- **Alpine's client caveat.** The `backup` stage installs `mariadb-client`, whose
  `mysqldump` writes MySQL 8-compatible output but cannot authenticate against an
  account using MySQL 8's default `caching_sha2_password`. Give the backup account
  `mysql_native_password`, or point `MYSQLDUMP_PATH`/`MYSQL_PATH` at Oracle's
  client build.
- **Credentials never reach argv.** Both binaries are invoked with
  `--defaults-extra-file` pointing at a 0600 file in a private temp directory,
  which is removed in a `finally` along with the plaintext dump. `--password=` on
  the command line is readable by any process via `ps`, and `MYSQL_PWD` leaks the
  same way through `/proc`.
- **Restore drill.** `verifyBackup(key)` downloads the object, checks the
  ciphertext checksum against the metadata, decrypts, compares the plaintext
  checksum, then drops/recreates the scratch schema, loads the dump and asserts
  `SELECT COUNT(*) FROM tenants >= 1`. Downloading rather than reusing the local
  file is deliberate: it also proves the upload arrived intact.

### Deployment checklist

1. Generate and store `BACKUP_ENCRYPTION_KEY` (`openssl rand -hex 32`) in the
   secret manager — **not** in the backup bucket.
2. Set the `S3_*` variables; without them there is nowhere to upload.
3. Deploy the `backup` service (`docker compose up -d backup`, or the equivalent
   separate service on your platform). Confirm the startup log line
   `backup scheduler started` shows the expected `nextRun`.
4. Point `BACKUP_VERIFY_DATABASE_URL` at a scratch instance (compose provides
   `mysql-verify`, tmpfs-backed and wiped on restart) and confirm the first run
   logs `verified: true`.
5. Grant the backup account `SELECT, LOCK TABLES, SHOW VIEW, EVENT, TRIGGER`, and
   check that its auth plugin works with the client in the image (see above).

### Not verified in this environment

The restore path — `mysqldump`, the `mysql` client and the scratch instance — was
**not** executed end to end here: this environment has no Docker daemon and no
MySQL server. What is covered by tests: the encryption/compression round trip and
its tamper detection (17 tests), retention tiering and pruning (21), argument and
credential handling plus every failure guard including a real `spawn` of a missing
and of a failing binary (20), and the full upload path against a fake `mysqldump`
and an intercepted S3 client, asserting that what lands in the bucket decrypts
back to the exact dump (13). The claim "restore verification passes in under 5
minutes" therefore still needs one real run against a live database — step 4 of
the checklist above is that run.
