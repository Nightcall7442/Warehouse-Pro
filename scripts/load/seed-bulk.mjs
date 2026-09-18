/**
 * Нагрузочный стенд: дорастить засев demo-uz до размеров боя и больше.
 *
 * Засев (db/seed.ts) даёт десятки заказов — отчёты на нём летают и ничего не
 * показывают. В бою: ~1.4K заказов, 3.4K магазинов, 590 SKU. Здесь по
 * умолчанию — 4 000 магазинов, 30 000 заказов за 120 дней по 3 позиции,
 * оплаты по доставленным, 200 000 точек GPS за месяц: с запасом, чтобы
 * увидеть узкое место раньше, чем его увидит клиент.
 *
 * Только прямой SQL пачками — драйвер mysql2, без ORM: цель — данные, а не
 * бизнес-правила. Идентификаторы организации, агентов и товаров берутся из
 * засева. Запуск: DATABASE_URL=… node scripts/load/seed-bulk.mjs
 * Размеры: LOAD_SHOPS, LOAD_ORDERS, LOAD_DAYS, LOAD_POINTS.
 */
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL не задан"); process.exit(1); }
const SHOPS = Number(process.env.LOAD_SHOPS ?? 4000);
const ORDERS = Number(process.env.LOAD_ORDERS ?? 30000);
const DAYS = Number(process.env.LOAD_DAYS ?? 120);
const POINTS = Number(process.env.LOAD_POINTS ?? 200000);

const db = await mysql.createConnection({ uri: url, multipleStatements: false });
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

const [[tenant]] = await db.query("SELECT id FROM tenants WHERE slug <> 'system' ORDER BY id LIMIT 1");
const tenantId = tenant.id;
const [agents] = await db.query("SELECT id FROM users WHERE tenant_id = ? AND role = 'agent'", [tenantId]);
const [couriers] = await db.query("SELECT id FROM users WHERE tenant_id = ? AND role = 'courier'", [tenantId]);
const [products] = await db.query("SELECT id, unit_price FROM products WHERE tenant_id = ? AND status = 'active'", [tenantId]);
if (!agents.length || !products.length) { console.error("в засеве нет агентов или товаров"); process.exit(1); }
console.log(`организация ${tenantId}: агентов ${agents.length}, курьеров ${couriers.length}, товаров ${products.length}`);

// ── Магазины ────────────────────────────────────────────────────────────────
const cities = ["Tashkent", "Samarkand", "Bukhara", "Nukus", "Karshi", "Andijan", "Fergana", "Namangan"];
const streets = ["Навои кўчаси", "Амир Темур кўчаси", "Беруни кўчаси", "Бобур кўчаси", "Мустақиллик кўчаси", "Юнусобод"];
const shopRows = [];
for (let i = 0; i < SHOPS; i++) {
  const city = pick(cities);
  shopRows.push([tenantId, `Магазин ${city} №${i + 1}`, `+9989${String(10000000 + rnd(89999999))}`, `${pick(streets)}, ${1 + rnd(200)}`, city, pick(agents).id,
    (41.2 + Math.random() * 0.4).toFixed(6), (69.1 + Math.random() * 0.5).toFixed(6), rnd(4) === 0 ? String(500000 + rnd(3000000)) : null]);
}
for (const c of chunks(shopRows, 500)) {
  await db.query("INSERT INTO shops (tenant_id, name, phone, address, city, agent_id, gps_lat, gps_lng, credit_limit) VALUES ?", [c]);
}
const [shops] = await db.query("SELECT id, agent_id FROM shops WHERE tenant_id = ?", [tenantId]);
console.log(`магазинов: ${shops.length}`);

// ── Заказы, позиции, оплаты ─────────────────────────────────────────────────
const statuses = ["delivered", "delivered", "delivered", "delivered", "shipped", "processing", "new", "cancelled", "returned"];
const methods = ["cash", "cash", "card", "transfer", "debt"];
const now = Date.now();
let orderNo = 900000;
for (const batch of chunks(Array.from({ length: ORDERS }, (_, i) => i), 1000)) {
  const rows = [];
  const meta = [];
  for (const _ of batch) {
    const shop = pick(shops);
    const created = new Date(now - rnd(DAYS * 86400000));
    const status = pick(statuses);
    // Товары в заказе без повторов: order_items держит уникальность (заказ, товар).
    const chosen = new Map();
    for (let k = 0; k < 1 + rnd(4); k++) { const p = pick(products); if (!chosen.has(p.id)) chosen.set(p.id, { p, q: 1 + rnd(20) }); }
    const items = [...chosen.values()];
    const subtotal = items.reduce((s, it) => s + Number(it.p.unit_price) * it.q, 0);
    const method = pick(methods);
    rows.push([tenantId, `LT-${orderNo++}`, shop.id, shop.agent_id, status, subtotal.toFixed(2), "0.00", subtotal.toFixed(2), method,
      status === "delivered" ? "delivered" : status === "shipped" ? "out_for_delivery" : "not_assigned",
      status === "delivered" || status === "shipped" ? (couriers.length ? pick(couriers).id : null) : null,
      status === "delivered" ? new Date(created.getTime() + 3600000 * (1 + rnd(30))) : null, created]);
    meta.push({ items, status, method, subtotal, shop, created });
  }
  const [res] = await db.query("INSERT INTO orders (tenant_id, order_number, shop_id, agent_id, status, subtotal, discount, total, payment_method, delivery_status, courier_id, delivered_at, created_at) VALUES ?", [rows]);
  const firstId = res.insertId;
  const itemRows = [];
  const payRows = [];
  meta.forEach((m, i) => {
    const orderId = firstId + i;
    for (const it of m.items) {
      const line = Number(it.p.unit_price) * it.q;
      itemRows.push([orderId, it.p.id, it.q.toFixed(2), Number(it.p.unit_price).toFixed(2), (Number(it.p.unit_price) * 0.8).toFixed(2), line.toFixed(2), m.status === "delivered" ? it.q.toFixed(2) : null]);
    }
    if (m.status === "delivered" && m.method !== "debt") {
      payRows.push([tenantId, m.shop.id, orderId, m.subtotal.toFixed(2), "payment", m.method === "debt" ? "cash" : m.method, "paid", m.created]);
    }
  });
  for (const c of chunks(itemRows, 2000)) await db.query("INSERT INTO order_items (order_id, product_id, quantity, unit_price, cost_price, subtotal, delivered_quantity) VALUES ?", [c]);
  for (const c of chunks(payRows, 2000)) await db.query("INSERT INTO payments (tenant_id, shop_id, order_id, amount, type, payment_method, status, created_at) VALUES ?", [c]);
}
const [[{ n: ordersN }]] = await db.query("SELECT COUNT(*) n FROM orders WHERE tenant_id = ?", [tenantId]);
console.log(`заказов: ${ordersN}`);

// ── Точки GPS за месяц ───────────────────────────────────────────────────────
const ptRows = [];
for (let i = 0; i < POINTS; i++) {
  const a = pick(agents);
  ptRows.push([tenantId, a.id, (41.2 + Math.random() * 0.4).toFixed(8), (69.1 + Math.random() * 0.5).toFixed(8), (5 + rnd(40)).toFixed(2), 20 + rnd(80), new Date(now - rnd(30 * 86400000))]);
}
for (const c of chunks(ptRows, 5000)) await db.query("INSERT INTO agent_locations (tenant_id, agent_id, lat, lng, accuracy, battery_level, created_at) VALUES ?", [c]);
const [[{ n: ptsN }]] = await db.query("SELECT COUNT(*) n FROM agent_locations WHERE tenant_id = ?", [tenantId]);
console.log(`точек GPS: ${ptsN}`);
await db.end();
