# Warehouse Pro — Public API v1: Orders

Read-only export of orders for external systems.
Written against the BEKDRINKS × ASTRA technical specification, v1.0 (10.09.2026).

Base URL: `https://www.warehouse-pro.uz/api/v1`
Transport: HTTPS only.

---

## 1. Authentication

```
Authorization: Bearer wp_live_xxxxxxxxxxxxxxxx
```

The key is issued in Warehouse Pro (Settings → API keys) and shown **once**;
only its SHA-256 hash is stored. It is never accepted in the URL or in a query
parameter — it must not end up in access logs or in a report.

**The company is taken from the key, not from the request.** There is no
`company_id` parameter and there cannot be one: sending another company's id is
not "refused", it is impossible to express.

Key management: create, suspend, revoke, set expiry. A revoked key stops
working immediately.

### Scopes

`read` (everything) or `orders` (this endpoint only).

### Sandbox vs production

Two kinds of key exist, and they differ by **which company they belong to**, not
by which URL you call. The base URL and every endpoint are identical.

| | production | sandbox |
|---|---|---|
| key looks like | `wp_live_…` | `wp_test_…` |
| data | a real customer's orders | invented, ~320 orders over a quarter |
| response header | `X-Warehouse-Environment: production` | `X-Warehouse-Environment: sandbox` |
| `GET /health` says | `"environment": "production"` | `"environment": "sandbox"` |

**Start in the sandbox.** Run your paging, your snapshot and your 401/403/429
handling there — §13 of the specification forbids testing permissions by
touching live data, and there is nothing in a sandbox to break.

The sandbox holds what you need to exercise the contract honestly: more than
three pages, every status, a handful of deleted orders (visible only in changes
mode), a shop with no territory, and orders **both with and without**
`promised_delivery_at` — so your "is it late?" logic meets a null before it
meets production.

**Check the header, not your memory of which key you pasted.** A sandbox key
sitting next to a live one in a config file is how invented numbers reach a real
report; the numbers themselves look perfectly ordinary. If you publish reports
automatically, refuse to publish when the header says `sandbox`.

Ask your Warehouse Pro contact for a sandbox key. It is issued once and shown
once — only its hash is stored.

### Failure codes

| code | meaning | what the client should do |
|---|---|---|
| 401 | missing / unknown key | stop, alert the operator |
| 403 | key suspended, expired, wrong scope, organisation suspended, plan without API | stop, alert the operator |
| 402 | subscription expired | stop, alert the customer — this is billing, not access |
| 429 | rate limit | honour the `Retry-After` header (seconds) |
| 5xx | our fault | exponential backoff, keep the last verified state |

`429` carries both a `Retry-After` header and `retryAfter` in the body.

**Rate limit:** per key, per minute; the value is set on the key (default 100;
sandbox keys are issued at 60, so a 429 is reachable in a test).
**Page size:** default 100, maximum 200.

---

## 2. `GET /orders`

Two modes. They answer different questions and must not be mixed.

### 2.1 Snapshot mode — the daily reconcile

```
GET /orders?created_from=2026-09-01&created_to=2026-09-30&limit=200
```

The first call **fixes the row set** and returns a `snapshot_id`. Every
following page is fetched with `cursor` (which carries the snapshot).

```
GET /orders?cursor=<next_cursor>
```

Repeat while `has_more` is true.

**What the snapshot guarantees.** The set of rows is frozen at the highest
order id existing at snapshot time. Orders created during the export cannot
enter it. Paging walks that id ascending, so **no row is lost and none is
returned twice**, however long the export takes.

**What it does not guarantee.** It freezes *membership*, not *contents*. If an
order's status changes between page 1 and page 3, you receive the new status.
This ERP does not version rows, and pretending otherwise would be a lie. Use
changes mode to pick up what moved.

Why id and not time: an order returned from the archive to active work gets a
new `created_at` (second life). Ordering by time is therefore not stable;
ordering by id is, because id never changes.

### 2.2 Changes mode — every few minutes

```
GET /orders?updated_since=2026-09-10T17:55:00Z
```

Returns every order whose `updated_at` is at or after that moment, **including
deleted ones**, which carry a non-null `deleted_at`. Page with `cursor` as
above.

Delivery is **at least once**: a row modified while you are paging may arrive
twice. Merge by `order_id`. There is no snapshot here by design — the point of
the mode is to see what is new.

Take the next `updated_since` from `server_time` in the response, not from your
own clock. A minute of drift loses orders.

### 2.3 Parameters

| name | meaning |
|---|---|
| `snapshot_id` | continue an existing snapshot |
| `cursor` | next page; carries its snapshot, and a cursor from another snapshot is refused |
| `limit` | 1…200, default 100 |
| `status` | comma-separated; an unknown value is a `400`, never a silent empty page |
| `created_from`, `created_to` | `YYYY-MM-DD` or ISO 8601. **Both bounds inclusive.** A bare date expands: `from` → `00:00:00`, `to` → `23:59:59` |
| `updated_since` | ISO 8601; switches to changes mode |
| `warehouse_id` | validated against your company; an unknown id is a `404`. Sales happen from the **default warehouse only**, so any other (valid) warehouse legitimately returns **zero rows** — not the whole company |

Date filters apply to **`created_at`** (and `updated_at` for `updated_since`).

### 2.4 Response

Every response — including refusals — carries `X-Warehouse-Environment`
(`production` or `sandbox`).

```json
{
  "server_time": "2026-09-10T18:04:11.512Z",
  "mode": "snapshot",
  "snapshot_id": "eyJtIjo5MTczMSwidCI6IjIwMjYtMDktMTBUMTg6MDQ6MTEuNTEyWiJ9",
  "as_of": "2026-09-10T18:04:11.512Z",
  "updated_since": null,

  "data": [
    {
      "order_id": 91731,
      "order_number": "ORD-2026-091731",
      "company_id": 12,
      "warehouse_id": 3,
      "created_at": "2026-09-09T07:21:44.000Z",
      "updated_at": "2026-09-10T11:02:03.000Z",
      "status": "delivered",
      "amount": "2975000.00",
      "currency": "UZS",
      "shop_id": 418,
      "sales_agent_id": 27,

      "shop_name": "Nokdaun mchj",
      "sales_agent_name": "Otabek",
      "territory_id": 5,
      "territory_name": "Chilonzor",

      "courier_id": 44,
      "courier_name": "Suroj",
      "promised_delivery_at": "2026-09-10T09:00:00.000Z",
      "delivered_at": "2026-09-10T11:02:03.000Z"
    }
  ],

  "next_cursor": "eyJpIjo5MTczMSwicyI6ImV5SnRJam...",
  "has_more": true,
  "total_count": 1284,
  "status_counts": {
    "new": 31, "processing": 12, "shipped": 4, "pending": 0,
    "delivered": 1201, "cancelled": 28, "returned": 8
  },
  "orders_amount_total": "3874120000.00",
  "currency": "UZS"
}
```

`total_count`, `status_counts` and `orders_amount_total` describe the **whole
filtered set**, not the page — that is what you reconcile against. All three are
computed from the same conditions as the rows, in the same request.

---

## 3. Field rules

**Money** is a decimal string with two places (`"2975000.00"`), never a JSON
number: a double loses kopeks, and sum reconciliation is the first acceptance
criterion. `currency` is separate and comes from the organisation's settings.

**Time** is ISO 8601 in UTC with `Z`.

**A missing optional value is `null`.** It is never replaced by a guess, a zero
or an empty string.

### `promised_delivery_at` is set by a person, or it is `null`

The sales agent enters it while standing in the shop — it is the date he says
out loud — and he can move it while the order is open. Nothing sets it
automatically, and `null` is a normal value meaning **no date was promised**.

The distinction matters for your side of the integration: per §9, lateness
without a promise is *unknown*, not "on time". Derive lateness only for orders
that carry the field. We do not fill it with `delivered_at` or `created_at + N`
— §17-G forbids the guess, and an invented promise would become an invented
missed delivery in your report.

Once an order is closed (`delivered`, `cancelled`, `returned`) the promise can
no longer be changed, so a late delivery cannot be tidied away afterwards.

### `warehouse_id`

Orders in this ERP are not per-warehouse: sales are made from the default
warehouse only (an owner's decision). The field carries that warehouse's id —
the place the goods actually leave from — or `null` if the organisation has no
default warehouse. It is never a made-up `0`.

### `territory_id` / `territory_name`

Territory belongs to the **shop**, not to the order, and is resolved through
it. A shop with no territory yields `null`.

### Sales agent and courier are different people

`sales_agent_id` is who took the order; `courier_id` is who delivered it. Both
may be set, and they are never the same field.

---

## 4. `GET /orders/statuses`

The status dictionary, served by the machine rather than retold in email —
a document that lives apart goes stale silently.

```json
{
  "statuses": [
    { "code": "new", "name_ru": "новый", "active": true, "counts_as_revenue": false },
    { "code": "processing", "name_ru": "в обработке", "active": true, "counts_as_revenue": false },
    { "code": "shipped", "name_ru": "отгружен", "active": true, "counts_as_revenue": false },
    { "code": "pending", "name_ru": "ожидает", "active": true, "counts_as_revenue": false },
    { "code": "delivered", "name_ru": "доставлен", "active": false, "counts_as_revenue": true },
    { "code": "cancelled", "name_ru": "отменён", "active": false, "counts_as_revenue": false },
    { "code": "returned", "name_ru": "возвращён", "active": false, "counts_as_revenue": false }
  ],
  "active_statuses": ["new", "processing", "shipped", "pending"],
  "notes": { "...": "..." },
  "page_size": { "default": 100, "max": 200 }
}
```

**`active` means the goods are still in play** — the order is held against the
warehouse and may yet ship. It does **not** mean late: lateness is measured
against `promised_delivery_at`, and only for the orders that carry one.

**`counts_as_revenue`** marks the single status every money report in the
product treats as a sale: `delivered`. Do not mix revenue with money collected
or with the value of active orders — payments and returns are separate ledgers.

---

## 5. Order transitions

```
new ──▶ processing ──▶ shipped ──▶ delivered
 │           │            │
 └───────────┴────────────┴──▶ cancelled
                              delivered ──▶ returned
```

`pending` is a holding state used when an order waits on the customer.
A delivered order can be reopened for correction; it then re-enters the flow
and its `created_at` moves to the day of reopening — which is why paging is
ordered by id.

---

## 6. Reconciling

For one filter and one snapshot:

1. Sum the `amount` of every returned row → must equal `orders_amount_total`.
2. Count the rows → must equal `total_count`.
3. Group the rows by status → must equal `status_counts`.

If any of the three disagrees, do not publish the report: the export was
incomplete. Keep the last verified state and retry.

---

## 7. Recovery, retries and idempotency

**The cursor is your checkpoint.** It is stateless and travels with you: we do
not remember where you were. Persist `next_cursor` after each page you have
*durably stored*, and resume from it after a dropped connection, a timeout or a
restart on either side. Resuming from a cursor you already consumed returns the
same rows again — that is by design, and the reason the merge rule below exists.

**Idempotency is by `order_id`.** Every row carries a stable primary key that
never changes, including across a delete or a reopen. Upsert by `order_id`;
never append blindly. In changes mode delivery is *at least once*, so a row can
legitimately arrive twice.

**Never publish a partial export.** A page either arrives whole with `200` or it
does not arrive: the response is built in one piece, so a failure mid-query
becomes a `5xx`, never a truncated `200`. On any error, keep your last verified
state, retry from your stored cursor, and publish only after the three
reconciliation checks below pass.

**Retry policy.**

| code | retry? | how |
|---|---|---|
| 429 | yes | wait the `Retry-After` seconds, then repeat the same cursor |
| 5xx | yes | exponential backoff from ~2s, cap ~5 min, repeat the same cursor |
| 408 / network drop | yes | repeat the same cursor immediately |
| 401 / 403 | no | stop and alert the operator — retrying cannot help |
| 402 | no | stop and alert the customer — this is billing |
| 400 / 404 | no | your request is wrong; fix it |

## 8. What we log on our side

Every call to `GET /orders` is recorded for 30 days: the moment, the mode, the
cursor you sent, the cursor we returned, the HTTP status, the number of rows and
the reconciliation totals of that response.

The customer sees this in Warehouse Pro (Settings → API keys → *Обмен за сутки*):
last successful export, requests and rows in the last 24 hours, the number of
refusals and the last one, plus the checkpoint you would resume from. That is
what makes the 24-hour trial (§17-H) answerable from our side.

**What we do not know**, and therefore do not claim: whether your reconciliation
matched, whether you de-duplicated correctly, and how many rows you dropped on
your side. Those live in your log; keep them, because together the two halves
settle any dispute about a missing order.

## 9. What is not here yet

Phase 1 is orders only. Stock, debts and staff results are described in §14 of
the specification and are a separate agreement. The existing `/stock`,
`/products` and `/shops` endpoints are older, simpler and **do not carry the
snapshot/cursor guarantees described above** — do not build a reconcile on
them.
