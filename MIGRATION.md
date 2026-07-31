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
