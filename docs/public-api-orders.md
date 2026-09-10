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

### Failure codes

| code | meaning | what the client should do |
|---|---|---|
| 401 | missing / unknown key | stop, alert the operator |
| 403 | key suspended, expired, wrong scope, organisation suspended, plan without API | stop, alert the operator |
| 402 | subscription expired | stop, alert the customer — this is billing, not access |
| 429 | rate limit | honour the `Retry-After` header (seconds) |
| 5xx | our fault | exponential backoff, keep the last verified state |

`429` carries both a `Retry-After` header and `retryAfter` in the body.

**Rate limit:** per key, per minute; the value is set on the key (default 60).
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
| `warehouse_id` | validated against your company; an unknown id is a `404` |

Date filters apply to **`created_at`** (and `updated_at` for `updated_since`).

### 2.4 Response

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
      "promised_delivery_at": null,
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

### `promised_delivery_at` is always `null`

This ERP does not store a promised delivery date — there is no column and no
screen where an agent could set one. Per §9 of the specification, lateness
without it is *unknown*, and §17-G forbids filling it with a guess. We could
have returned `delivered_at` or `created_at + N` here; both would be inventions
that another party would then use to count missed deliveries.

If a promised date is needed, it has to become a product feature first — a
field and a place where a human sets it. That is a separate decision, not an
integration detail.

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
warehouse and may yet ship. It does **not** mean late. Lateness is measured
against a promised date, which this ERP does not have.

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

## 7. What is not here yet

Phase 1 is orders only. Stock, debts and staff results are described in §14 of
the specification and are a separate agreement. The existing `/stock`,
`/products` and `/shops` endpoints are older, simpler and **do not carry the
snapshot/cursor guarantees described above** — do not build a reconcile on
them.
