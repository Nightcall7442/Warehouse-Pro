/**
 * Seed script — populates Railway MySQL with comprehensive demo data (Uzbekistan context).
 *
 * Idempotent: safe to run multiple times. Clears existing data first, then inserts fresh.
 * Run via:  npm run db:seed
 */
import "dotenv/config";
import { getDb } from "../api/queries/connection";
import * as schema from "./schema";
import { hashPassword } from "../api/auth/password";

const PLACEHOLDER_PHOTO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUAAScY42YAAAAASUVORK5CYII=";

function daysAgo(n: number, hourOffset = 0): Date {
  const d = new Date(Date.now() - n * 86_400_000);
  d.setHours(8 + hourOffset, Math.floor(Math.random() * 60), 0, 0);
  return d;
}

function randomPrice(min: number, max: number): string {
  return (Math.floor(Math.random() * (max - min) + min) / 100).toFixed(2);
}

async function seed() {
  const db = getDb();
  const { randomUUID } = await import("crypto");

  console.log("🌱 Seeding Warehouse Pro database...\n");
  console.log("Clearing existing data...");

  await db.delete(schema.auditLog);
  await db.delete(schema.passwordResetTokens);
  await db.delete(schema.visitReports);
  await db.delete(schema.billingEvents);
  await db.delete(schema.subscriptions);
  await db.delete(schema.idMappings);
  await db.delete(schema.syncStatus);
  await db.delete(schema.tenantBranding);
  await db.delete(schema.invites);
  await db.delete(schema.notifications);
  await db.delete(schema.agentLocations);
  await db.delete(schema.dailyPlans);
  await db.delete(schema.payments);
  await db.delete(schema.arrivalItems);
  await db.delete(schema.arrivals);
  await db.delete(schema.stockMovements);
  await db.delete(schema.warehouseStock);
  await db.delete(schema.orderItems);
  await db.delete(schema.orders);
  await db.delete(schema.shops);
  await db.delete(schema.products);
  await db.delete(schema.settings);
  await db.delete(schema.users);
  await db.delete(schema.tenants);
  console.log("✓ Data cleared\n");

  // ── Tenant ───────────────────────────────────────────────────────────────────
  console.log("Creating tenants...");
  const [tenantR] = await db.insert(schema.tenants).values({
    slug: "demo-uz",
    name: "Олтин Йўл Дистрибуция МЧЖ",
    plan: "pro",
    status: "active",
    planExpiresAt: new Date(Date.now() + 365 * 86_400_000),
    maxUsers: null,
    maxProducts: null,
    maxOrdersMonth: null,
    ownerEmail: "admin@oltin-yol.uz",
    ownerPhone: "+998 90 123 45 67",
  });
  const tenantId = Number(tenantR.insertId);

  await db.insert(schema.settings).values({
    tenantId,
    companyName: "Олтин Йўл Дистрибуция МЧЖ",
    currency: "UZS",
    currencySymbol: "сум",
    symbolPosition: "after",
    defaultReorderPoint: "20.00",
    lowStockThreshold: "30.00",
    companyAddress: "Тошкент вилояти, Чирчиқ ш., Мустақиллик кўчаси, 45-уй",
    companyPhone: "+998 71 234 56 78",
    companyInn: "305678901",
    companyDirector: "Каримов Акбар Жамшидович",
    companyBank: "\"Капитал Банк\" Чирчиқ филиали",
    companyBankAccount: "20206000800123456789",
    companyMfo: "00742",
  });

  await db.insert(schema.subscriptions).values({
    id: randomUUID(),
    tenantId,
    plan: "pro",
    status: "active",
    currentPeriodEnds: new Date(Date.now() + 365 * 86_400_000),
  });
  console.log("✓ Tenant created\n");

  // ── Users ────────────────────────────────────────────────────────────────────
  console.log("Creating users...");
  const password = await hashPassword("password123");
  const superAdminPw = await hashPassword("superadmin123");

  const [systemR] = await db.insert(schema.tenants).values({
    slug: "system",
    name: "System (SuperAdmin)",
    plan: "pro",
    status: "active",
    planExpiresAt: new Date("2038-01-01"),
  });
  const systemTenantId = Number(systemR.insertId);

  await db.insert(schema.users).values({
    tenantId: systemTenantId,
    name: "Super Admin",
    email: "superadmin@system.local",
    passwordHash: superAdminPw,
    role: "superadmin",
    status: "active",
    lastSignInAt: new Date(),
  });

  // CEO
  const [ceoR] = await db.insert(schema.users).values({
    tenantId,
    name: "Каримов Акбар",
    email: "ceo@demo-uz.uz",
    passwordHash: password,
    role: "ceo",
    status: "active",
    lastSignInAt: new Date(),
    phone: "+998 90 111 22 33",
  });
  const ceoId = Number(ceoR.insertId);

  // Operators (2)
  const [op1R] = await db.insert(schema.users).values({
    tenantId,
    name: "Раҳимова Шаҳноза",
    email: "operator1@demo-uz.uz",
    passwordHash: password,
    role: "operator",
    status: "active",
    lastSignInAt: new Date(),
    phone: "+998 91 222 33 44",
  });
  const [op2R] = await db.insert(schema.users).values({
    tenantId,
    name: "Исмоилова Нилуфар",
    email: "operator2@demo-uz.uz",
    passwordHash: password,
    role: "operator",
    status: "active",
    lastSignInAt: new Date(),
    phone: "+998 91 222 33 55",
  });
  const operator1Id = Number(op1R.insertId);
  const operator2Id = Number(op2R.insertId);

  // Agents (5) — different cities
  const agentData = [
    { name: "Эшмуродов Жасур", email: "agent-tashkent@demo-uz.uz", city: "Tashkent" },
    { name: "Тошматов Сардор", email: "agent-samarkand@demo-uz.uz", city: "Samarkand" },
    { name: "Назаров Бехзод", email: "agent-bukhara@demo-uz.uz", city: "Bukhara" },
    { name: "Алиев Фирдавс", email: "agent-nukus@demo-uz.uz", city: "Nukus" },
    { name: "Маматов Ойбек", email: "agent-karshi@demo-uz.uz", city: "Karshi" },
  ];
  const agentIds: number[] = [];
  for (const a of agentData) {
    const [r] = await db.insert(schema.users).values({
      tenantId,
      name: a.name,
      email: a.email,
      passwordHash: password,
      role: "agent",
      status: "active",
      lastSignInAt: new Date(),
    });
    agentIds.push(Number(r.insertId));
  }

  // Supervisor (1)
  const [supR] = await db.insert(schema.users).values({
    tenantId,
    name: "Норматова Гулноза",
    email: "supervisor@demo-uz.uz",
    passwordHash: password,
    role: "supervisor",
    status: "active",
    lastSignInAt: new Date(),
    phone: "+998 93 444 55 66",
  });
  const supervisorId = Number(supR.insertId);

  // Merchandisers (2)
  await db.insert(schema.users).values({
    tenantId,
    name: "Қурбонов Аброр",
    email: "merch1@demo-uz.uz",
    passwordHash: password,
    role: "merchandiser",
    status: "active",
    lastSignInAt: new Date(),
  });
  await db.insert(schema.users).values({
    tenantId,
    name: "Холматова Малика",
    email: "merch2@demo-uz.uz",
    passwordHash: password,
    role: "merchandiser",
    status: "active",
    lastSignInAt: new Date(),
  });
  // NOTE: merchandiser demo data is currently minimal — unlike agents, no shop
  // assignments or visit_reports are seeded for this role yet.

  // Couriers (2)
  const [c1R] = await db.insert(schema.users).values({
    tenantId,
    name: "Тўраев Дилшод",
    email: "courier1@demo-uz.uz",
    passwordHash: password,
    role: "courier",
    status: "active",
    lastSignInAt: new Date(),
    phone: "+998 94 555 66 77",
  });
  const [c2R] = await db.insert(schema.users).values({
    tenantId,
    name: "Ботиров Жамшид",
    email: "courier2@demo-uz.uz",
    passwordHash: password,
    role: "courier",
    status: "active",
    lastSignInAt: new Date(),
    phone: "+998 94 555 66 88",
  });
  const courier1Id = Number(c1R.insertId);
  const courier2Id = Number(c2R.insertId);

  console.log("✓ Users created (12 total)\n");

  // ── Products (35) ────────────────────────────────────────────────────────────
  console.log("Creating products...");
  const productDefs: (typeof schema.products.$inferInsert)[] = [
    // ── Овощи
    { tenantId, code: "VEG-001", barcode: "4780123456789", name: "Помидор свежий", category: "Овощи", costPrice: "8500.00", unitPrice: "12000.00", unit: "kg", unitWeight: "1.000", reorderPoint: "50.00" },
    { tenantId, code: "VEG-002", barcode: "4780123456790", name: "Огурец тепличный", category: "Овощи", costPrice: "7200.00", unitPrice: "10500.00", unit: "kg", unitWeight: "1.000", reorderPoint: "40.00" },
    { tenantId, code: "VEG-003", barcode: "4780123456791", name: "Капуста белокочанная", category: "Овощи", costPrice: "3500.00", unitPrice: "5500.00", unit: "kg", unitWeight: "1.000", reorderPoint: "60.00" },
    { tenantId, code: "VEG-004", barcode: "4780123456792", name: "Морковь мытая", category: "Овощи", costPrice: "4200.00", unitPrice: "6800.00", unit: "kg", unitWeight: "1.000", reorderPoint: "45.00" },
    { tenantId, code: "VEG-005", barcode: "4780123456793", name: "Лук репчатый", category: "Овощи", costPrice: "2800.00", unitPrice: "4500.00", unit: "kg", unitWeight: "1.000", reorderPoint: "80.00" },
    { tenantId, code: "VEG-006", barcode: "4780123456794", name: "Картофель молодой", category: "Овощи", costPrice: "5000.00", unitPrice: "7500.00", unit: "kg", unitWeight: "1.000", reorderPoint: "100.00" },
    // ── Фрукты
    { tenantId, code: "FRU-001", barcode: "4780123456795", name: "Яблоко Гала", category: "Фрукты", costPrice: "9500.00", unitPrice: "14000.00", unit: "kg", unitWeight: "1.000", reorderPoint: "30.00" },
    { tenantId, code: "FRU-002", barcode: "4780123456796", name: "Банан Эквадор", category: "Фрукты", costPrice: "14000.00", unitPrice: "19500.00", unit: "kg", unitWeight: "1.000", reorderPoint: "25.00" },
    { tenantId, code: "FRU-003", barcode: "4780123456797", name: "Виноград Кишмиш", category: "Фрукты", costPrice: "18000.00", unitPrice: "26000.00", unit: "kg", unitWeight: "1.000", reorderPoint: "20.00" },
    { tenantId, code: "FRU-004", barcode: "4780123456798", name: "Арбуз зимний", category: "Фрукты", costPrice: "3200.00", unitPrice: "5500.00", unit: "kg", unitWeight: "1.000", reorderPoint: "15.00" },
    { tenantId, code: "FRU-005", barcode: "4780123456799", name: "Мандарин Марокко", category: "Фрукты", costPrice: "16000.00", unitPrice: "22000.00", unit: "kg", unitWeight: "1.000", reorderPoint: "20.00" },
    // ── Молочные продукты
    { tenantId, code: "MLK-001", barcode: "4780123456800", name: "Молоко \"Eataly\" 1л", category: "Молочные продукты", costPrice: "8200.00", unitPrice: "11500.00", unit: "pcs", unitWeight: "1.030", reorderPoint: "50.00" },
    { tenantId, code: "MLK-002", barcode: "4780123456801", name: "Сметана 20% 300г", category: "Молочные продукты", costPrice: "9500.00", unitPrice: "13500.00", unit: "pcs", unitWeight: "0.300", reorderPoint: "40.00" },
    { tenantId, code: "MLK-003", barcode: "4780123456802", name: "Творог 5% 400г", category: "Молочные продукты", costPrice: "11000.00", unitPrice: "15500.00", unit: "pcs", unitWeight: "0.400", reorderPoint: "30.00" },
    { tenantId, code: "MLK-004", barcode: "4780123456803", name: "Кефир 1л", category: "Молочные продукты", costPrice: "7800.00", unitPrice: "11000.00", unit: "pcs", unitWeight: "1.020", reorderPoint: "35.00" },
    { tenantId, code: "MLK-005", barcode: "4780123456804", name: "Сыр \"Российский\" 500г", category: "Молочные продукты", costPrice: "28000.00", unitPrice: "38000.00", unit: "pcs", unitWeight: "0.500", reorderPoint: "20.00" },
    // ── Мясо
    { tenantId, code: "MEA-001", barcode: "4780123456805", name: "Говядина охлаждённая", category: "Мясо", costPrice: "68000.00", unitPrice: "85000.00", unit: "kg", unitWeight: "1.000", reorderPoint: "15.00" },
    { tenantId, code: "MEA-002", barcode: "4780123456806", name: "Курица бёдра (филе)", category: "Мясо", costPrice: "32000.00", unitPrice: "45000.00", unit: "kg", unitWeight: "1.000", reorderPoint: "25.00" },
    { tenantId, code: "MEA-003", barcode: "4780123456807", name: "Баранина (лопатка)", category: "Мясо", costPrice: "75000.00", unitPrice: "95000.00", unit: "kg", unitWeight: "1.000", reorderPoint: "10.00" },
    { tenantId, code: "MEA-004", barcode: "4780123456808", name: "Колбаса \"Докторская\" 500г", category: "Мясо", costPrice: "22000.00", unitPrice: "32000.00", unit: "pcs", unitWeight: "0.500", reorderPoint: "30.00" },
    // ── Напитки
    { tenantId, code: "BEV-001", barcode: "4780123456809", name: "Вода \"Орол\" 1.5л", category: "Напитки", costPrice: "2800.00", unitPrice: "4200.00", unit: "pcs", unitWeight: "1.500", reorderPoint: "100.00" },
    { tenantId, code: "BEV-002", barcode: "4780123456810", name: "Сок \"Инжир\" яблочный 1л", category: "Напитки", costPrice: "6200.00", unitPrice: "8900.00", unit: "pcs", unitWeight: "1.030", reorderPoint: "60.00" },
    { tenantId, code: "BEV-003", barcode: "4780123456811", name: "Чай \"Greenfield\" 100 пакетиков", category: "Напитки", costPrice: "32000.00", unitPrice: "45000.00", unit: "pcs", unitWeight: "0.250", reorderPoint: "20.00" },
    { tenantId, code: "BEV-004", barcode: "4780123456812", name: "Кофе \"Nescafe Classic\" 100г", category: "Напитки", costPrice: "45000.00", unitPrice: "62000.00", unit: "pcs", unitWeight: "0.100", reorderPoint: "15.00" },
    { tenantId, code: "BEV-005", barcode: "4780123456813", name: "Пепси 1.5л", category: "Напитки", costPrice: "3500.00", unitPrice: "5500.00", unit: "pcs", unitWeight: "1.500", reorderPoint: "80.00" },
    // ── Бакалея
    { tenantId, code: "GRC-001", barcode: "4780123456814", name: "Мука высший сорт \"Олтин Дон\"", category: "Бакалея", costPrice: "5400.00", unitPrice: "6800.00", unit: "kg", unitWeight: "1.000", reorderPoint: "200.00" },
    { tenantId, code: "GRC-002", barcode: "4780123456815", name: "Рис \"Лазер\" Хорезм", category: "Бакалея", costPrice: "13500.00", unitPrice: "17000.00", unit: "kg", unitWeight: "1.000", reorderPoint: "150.00" },
    { tenantId, code: "GRC-003", barcode: "4780123456816", name: "Сахар-песок", category: "Бакалея", costPrice: "8900.00", unitPrice: "10800.00", unit: "kg", unitWeight: "1.000", reorderPoint: "300.00" },
    { tenantId, code: "GRC-004", barcode: "4780123456817", name: "Масло подсолнечное \"Шарк\" 1л", category: "Бакалея", costPrice: "11500.00", unitPrice: "15200.00", unit: "pcs", unitWeight: "0.920", reorderPoint: "80.00" },
    { tenantId, code: "GRC-005", barcode: "4780123456818", name: "Макароны \"Barilla\" 500г", category: "Бакалея", costPrice: "7800.00", unitPrice: "11000.00", unit: "pcs", unitWeight: "0.500", reorderPoint: "40.00" },
    // ── Кондитерия
    { tenantId, code: "SWE-001", barcode: "4780123456819", name: "Печенье \"Юбилейное\" 400г", category: "Кондитерия", costPrice: "9200.00", unitPrice: "13900.00", unit: "pcs", unitWeight: "0.400", reorderPoint: "40.00" },
    { tenantId, code: "SWE-002", barcode: "4780123456820", name: "Шоколад \"Спартак\" молочный 90г", category: "Кондитерия", costPrice: "6500.00", unitPrice: "9800.00", unit: "pcs", unitWeight: "0.090", reorderPoint: "50.00" },
    { tenantId, code: "SWE-003", barcode: "4780123456821", name: "Конфеты \"Барни\" 250г", category: "Кондитерия", costPrice: "18000.00", unitPrice: "25000.00", unit: "pcs", unitWeight: "0.250", reorderPoint: "25.00" },
    { tenantId, code: "SWE-004", barcode: "4780123456822", name: "Мёд натуральный 500г", category: "Кондитерия", costPrice: "52000.00", unitPrice: "72000.00", unit: "pcs", unitWeight: "0.500", reorderPoint: "10.00" },
    // ── Хлеб
    { tenantId, code: "BRD-001", barcode: "4780123456823", name: "Хлеб \"Лепёшка\" нарезной 500г", category: "Хлеб", costPrice: "3200.00", unitPrice: "5000.00", unit: "pcs", unitWeight: "0.500", reorderPoint: "60.00" },
    { tenantId, code: "BRD-002", barcode: "4780123456824", name: "Лаваш тонкий 400г", category: "Хлеб", costPrice: "2500.00", unitPrice: "4000.00", unit: "pcs", unitWeight: "0.400", reorderPoint: "50.00" },
  ];

  const productIds: number[] = [];
  for (const p of productDefs) {
    const [r] = await db.insert(schema.products).values({ ...p, status: "active" });
    productIds.push(Number(r.insertId));
  }
  console.log(`✓ ${productIds.length} products created\n`);

  // ── Stock levels ─────────────────────────────────────────────────────────────
  console.log("Creating stock levels...");
  const lowStockCodes = ["VEG-006", "MEA-003", "SWE-004", "BRD-001", "BEV-004"];
  for (let i = 0; i < productIds.length; i++) {
    const code = productDefs[i].code!;
    const isLow = lowStockCodes.includes(code);
    const currentStock = isLow
      ? Math.floor(Math.random() * 10) + 3
      : Math.floor(Math.random() * 250) + 30;
    const reserved = Math.floor(currentStock * (0.03 + Math.random() * 0.08));
    await db.insert(schema.warehouseStock).values({
      tenantId,
      productId: productIds[i],
      currentStock: String(currentStock),
      reserved: String(reserved),
      available: String(currentStock - reserved),
    });
  }
  console.log("✓ Stock levels created\n");

  // ── Shops (25) ──────────────────────────────────────────────────────────────
  console.log("Creating shops...");
  const shopDefs: (typeof schema.shops.$inferInsert)[] = [
    // Tashkent (10)
    { tenantId, name: "Олтин Дала savdo", ownerName: "Эркаев Дилшод", phone: "+998 91 100 00 01", city: "Tashkent", district: "Юнусабад", address: "Беруни кўчаси, 22", agentId: agentIds[0], debt: "0.00", gpsLat: "41.3603", gpsLng: "69.2853", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Бараka Market", ownerName: "Юсупова Дилноза", phone: "+998 91 100 00 02", city: "Tashkent", district: "Шайхонтохур", address: "Амир Темур кўчаси, 5", agentId: agentIds[0], debt: "850000.00", gpsLat: "41.3111", gpsLng: "69.2797", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Файз Продукт", ownerName: "Рашидов Алишер", phone: "+998 91 100 00 03", city: "Tashkent", district: "Мирзо Улугбек", address: "Навои кўчаси, 41", agentId: agentIds[0], debt: "320000.00", gpsLat: "41.3367", gpsLng: "69.3389", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Гулистон do'koni", ownerName: "Назарова Зулфия", phone: "+998 91 100 00 04", city: "Tashkent", district: "Шайхонтохур", address: "Навои кўчаси, 17", agentId: agentIds[0], debt: "0.00", gpsLat: "41.3046", gpsLng: "69.2781", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Рахмат Савдо", ownerName: "Ибрагимов Рустам", phone: "+998 91 100 00 05", city: "Tashkent", district: "Сергели", address: "Алмазар кўчаси, 8", agentId: agentIds[0], debt: "150000.00", gpsLat: "41.2934", gpsLng: "69.2564", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Чойхона Марказий", ownerName: "Каримова Гулнара", phone: "+998 91 100 00 06", city: "Tashkent", district: "Юнусабад", address: "Мустақиллик кўчаси, 33", agentId: agentIds[0], debt: "0.00", gpsLat: "41.3552", gpsLng: "69.2878", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Dokon Super", ownerName: "Холматов Бекзод", phone: "+998 91 100 00 07", city: "Tashkent", district: "Олмазор", address: "Фарғона Йўли, 112", agentId: agentIds[0], debt: "570000.00", gpsLat: "41.3199", gpsLng: "69.3363", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Умид Мағозин", ownerName: "Тўхтасинова Нилуфар", phone: "+998 91 100 00 08", city: "Tashkent", district: "Бектемир", address: "Бектемир кўчаси, 19", agentId: agentIds[0], debt: "0.00", gpsLat: "41.2803", gpsLng: "69.3198", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Кўпчilik Market", ownerName: "Салимов Акмал", phone: "+998 91 100 00 09", city: "Tashkent", district: "Чиланзар", address: "Чиланзар кўчаси, 45", agentId: agentIds[0], debt: "200000.00", gpsLat: "41.2875", gpsLng: "69.2673", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Навруз Савдо", ownerName: "Дустматова Гулзода", phone: "+998 91 100 00 10", city: "Tashkent", district: "Яшнобод", address: "Яшнобод кўчаси, 7", agentId: agentIds[0], debt: "0.00", gpsLat: "41.3042", gpsLng: "69.3521", photoUrl: PLACEHOLDER_PHOTO },

    // Samarkand (8)
    { tenantId, name: "Регистан Маркет", ownerName: "Шарипов Мирзокирим", phone: "+998 91 200 00 01", city: "Samarkand", district: "Марказий", address: "Регистон кўчаси, 3", agentId: agentIds[1], debt: "0.00", gpsLat: "39.6542", gpsLng: "66.9756", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Самарқанд Таомлари", ownerName: "Назарова Дилдор", phone: "+998 91 200 00 02", city: "Samarkand", district: "Марказий", address: "Амир Темур кўчаси, 28", agentId: agentIds[1], debt: "430000.00", gpsLat: "39.6520", gpsLng: "66.9770", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Хўжа Дийдор savdo", ownerName: "Абдуллаев Сардор", phone: "+998 91 200 00 03", city: "Samarkand", district: "Самарқанд", address: "Бўстонсарай кўчаси, 12", agentId: agentIds[1], debt: "0.00", gpsLat: "39.6517", gpsLng: "66.9842", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Лазервёрк Маркет", ownerName: "Тўраева Гулчеҳра", phone: "+998 91 200 00 04", city: "Samarkand", district: "Марказий", address: "Сиёб кўчаси, 55", agentId: agentIds[1], debt: "175000.00", gpsLat: "39.6470", gpsLng: "66.9615", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Нуроний Market", ownerName: "Эргашев Бахром", phone: "+998 91 200 00 05", city: "Samarkand", district: "Самарқанд", address: "Улугбек кўчаси, 8", agentId: agentIds[1], debt: "0.00", gpsLat: "39.6530", gpsLng: "66.9698", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Дўстлик Савдо", ownerName: "Исмоилова Малика", phone: "+998 91 200 00 06", city: "Samarkand", district: "Марказий", address: "Дўстлик кўчаси, 21", agentId: agentIds[1], debt: "80000.00", gpsLat: "39.6488", gpsLng: "66.9720", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Олтин Сари Маркет", ownerName: "Худойдодов Жамшид", phone: "+998 91 200 00 07", city: "Samarkand", district: "Самарқанд", address: "Пойариқ кўчаси, 14", agentId: agentIds[1], debt: "0.00", gpsLat: "39.6460", gpsLng: "66.9590", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Фермер Маркет", ownerName: "Ботирова Шохина", phone: "+998 91 200 00 08", city: "Samarkand", district: "Марказий", address: "Афросиёб кўчаси, 31", agentId: agentIds[1], debt: "620000.00", gpsLat: "39.6610", gpsLng: "66.9805", photoUrl: PLACEHOLDER_PHOTO },

    // Bukhara (7)
    { tenantId, name: "Истиклол Маркет", ownerName: "Камилов Акбар", phone: "+998 91 300 00 01", city: "Bukhara", district: "Марказий", address: "Истиклол кўчаси, 9", agentId: agentIds[2], debt: "0.00", gpsLat: "39.7747", gpsLng: "64.4217", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Бухоро Таомлари", ownerName: "Сатторова Фируза", phone: "+998 91 300 00 02", city: "Bukhara", district: "Марказий", address: "Коракўл кўчаси, 18", agentId: agentIds[2], debt: "290000.00", gpsLat: "39.7762", gpsLng: "64.4231", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Самоний Market", ownerName: "Рустамов Дилшод", phone: "+998 91 300 00 03", city: "Bukhara", district: "Бухоро", address: "Алишер Навоий кўчаси, 6", agentId: agentIds[2], debt: "0.00", gpsLat: "39.7735", gpsLng: "64.4189", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Пойтахт Савдо", ownerName: "Махмудова Гулнора", phone: "+998 91 300 00 04", city: "Bukhara", district: "Марказий", address: "Навоий кўчаси, 42", agentId: agentIds[2], debt: "150000.00", gpsLat: "39.7700", gpsLng: "64.4175", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Чойхона Мир", ownerName: "Тўхтаев Феруз", phone: "+998 91 300 00 05", city: "Bukhara", district: "Бухоро", address: "Мир Аравalon кўчаси, 3", agentId: agentIds[2], debt: "0.00", gpsLat: "39.7780", gpsLng: "64.4250", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Бозор Маркет", ownerName: "Холматова Малика", phone: "+998 91 300 00 06", city: "Bukhara", district: "Марказий", address: "Таџик кўчаси, 15", agentId: agentIds[2], debt: "480000.00", gpsLat: "39.7715", gpsLng: "64.4200", photoUrl: PLACEHOLDER_PHOTO },
    { tenantId, name: "Роҳат Мағозин", ownerName: "Эргашева Дилноза", phone: "+998 91 300 00 07", city: "Bukhara", district: "Бухоро", address: "Ал-Bukhari кўчаси, 27", agentId: agentIds[2], debt: "0.00", status: "inactive", gpsLat: "39.7755", gpsLng: "64.4210", photoUrl: PLACEHOLDER_PHOTO },
  ];

  const shopIds: number[] = [];
  for (const s of shopDefs) {
    const [r] = await db.insert(schema.shops).values({ ...s, status: s.status ?? "active" });
    shopIds.push(Number(r.insertId));
  }
  console.log(`✓ ${shopIds.length} shops created\n`);

  // ── Orders (80) ─────────────────────────────────────────────────────────────
  console.log("Creating orders...");
  const allAgents = agentIds;
  const statuses: Array<"new" | "processing" | "completed" | "cancelled"> = ["new", "processing", "completed", "cancelled"];
  const deliveryStatuses: Array<"not_assigned" | "assigned" | "out_for_delivery" | "delivered" | "failed"> = [
    "not_assigned", "assigned", "out_for_delivery", "delivered", "failed",
  ];

  let orderCount = 0;
  for (let i = 0; i < 80; i++) {
    const shopIdx = i % shopIds.length;
    const shopId = shopIds[shopIdx];
    const agentId = allAgents[i % allAgents.length];
    const status = statuses[i % 4];
    const daysBack = Math.floor(i / 3);
    const createdAt = daysAgo(daysBack, i % 10);

    const numItems = 1 + Math.floor(Math.random() * 4);
    let subtotal = 0;
    const orderItemsData: (typeof schema.orderItems.$inferInsert)[] = [];
    const usedProducts = new Set<number>();

    for (let j = 0; j < numItems; j++) {
      let prodIdx: number;
      do {
        prodIdx = Math.floor(Math.random() * productIds.length);
      } while (usedProducts.has(prodIdx) && usedProducts.size < productIds.length);
      usedProducts.add(prodIdx);

      const price = Number(productDefs[prodIdx].unitPrice!);
      const qty = Math.floor(Math.random() * 15) + 1;
      const itemSubtotal = price * qty;
      subtotal += itemSubtotal;

      orderItemsData.push({
        orderId: 0,
        productId: productIds[prodIdx],
        quantity: String(qty),
        unitPrice: productDefs[prodIdx].unitPrice!,
        subtotal: String(itemSubtotal),
      });
    }

    const discount = i % 7 === 0 ? (subtotal * 0.05).toFixed(2) : "0.00";
    const total = (subtotal - Number(discount)).toFixed(2);
    const dStatus = status === "completed" ? "delivered"
      : status === "cancelled" ? "failed"
      : status === "processing" ? "out_for_delivery"
      : deliveryStatuses[i % deliveryStatuses.length];
    const courierId = dStatus === "delivered" || dStatus === "out_for_delivery"
      ? (i % 2 === 0 ? courier1Id : courier2Id)
      : null;

    const [orderR] = await db.insert(schema.orders).values({
      tenantId,
      orderNumber: `ORD-${String(1001 + i).padStart(5, "0")}`,
      shopId,
      agentId,
      status,
      subtotal: String(subtotal),
      discount,
      total,
      courierId,
      deliveryStatus: dStatus,
      deliveredAt: status === "completed" ? new Date(createdAt.getTime() + 3600000 * 2) : null,
      createdAt,
      updatedAt: createdAt,
      notes: i % 5 === 0 ? "Срочный заказ" : null,
    });
    const orderId = Number(orderR.insertId);

    for (const item of orderItemsData) {
      await db.insert(schema.orderItems).values({ ...item, orderId });
    }
    orderCount++;
  }
  console.log(`✓ ${orderCount} orders created\n`);

  // ── Payments (15) ────────────────────────────────────────────────────────────
  console.log("Creating payments...");
  const paymentShopIds = shopIds.filter((_, i) => [1, 2, 3, 5, 6, 7, 10, 12, 13, 16, 18, 20].includes(i));
  for (let i = 0; i < 15; i++) {
    const shopId = paymentShopIds[i % paymentShopIds.length];
    const isDebt = i % 3 === 0;
    await db.insert(schema.payments).values({
      tenantId,
      shopId,
      amount: randomPrice(500000, 5000000),
      type: isDebt ? "debt" : "payment",
      notes: isDebt ? "Долг за январь" : "Оплата наличными",
      createdBy: i % 2 === 0 ? operator1Id : operator2Id,
      createdAt: daysAgo(Math.floor(i / 2)),
    });
  }
  console.log("✓ Payments created\n");

  // ── Arrivals (8) ────────────────────────────────────────────────────────────
  console.log("Creating arrivals...");
  const drivers = [
    { name: "Тўраев Дилшод", phone: "+998 94 111 22 33" },
    { name: "Ботиров Жамшид", phone: "+998 94 111 22 44" },
    { name: "Каримов Акбар", phone: "+998 94 111 22 55" },
  ];
  for (let i = 0; i < 8; i++) {
    const driver = drivers[i % drivers.length];
    const [arrR] = await db.insert(schema.arrivals).values({
      tenantId,
      arrivalNumber: `ARR-${String(1001 + i).padStart(4, "0")}`,
      truckId: `H-001-${i + 1} AB`,
      driverName: driver.name,
      driverPhone: driver.phone,
      status: i < 3 ? "completed" : i < 6 ? "unloading" : "pending",
      fuelCost: randomPrice(80000, 250000),
      tollCost: randomPrice(20000, 80000),
      otherCost: randomPrice(0, 50000),
      totalExpense: randomPrice(120000, 380000),
      arrivalDate: daysAgo(i),
      arrivalTime: "08:00",
      unloadingTime: i < 6 ? "09:30" : null,
      notes: i % 2 === 0 ? null : "Задержка на таможне",
      createdAt: daysAgo(i),
      updatedAt: daysAgo(i),
    });
    const arrivalId = Number(arrR.insertId);

    const arrivalItemCount = 3 + Math.floor(Math.random() * 5);
    const usedProd = new Set<number>();
    for (let j = 0; j < arrivalItemCount; j++) {
      let pIdx: number;
      do {
        pIdx = Math.floor(Math.random() * productIds.length);
      } while (usedProd.has(pIdx));
      usedProd.add(pIdx);

      await db.insert(schema.arrivalItems).values({
        arrivalId,
        productId: productIds[pIdx],
        quantity: String(Math.floor(Math.random() * 100) + 10),
        condition: j % 3 === 0 ? "Повреждена упаковка" : "Норма",
        notes: null,
        createdAt: daysAgo(i),
      });
    }
  }
  console.log("✓ Arrivals created\n");

  // ── Stock Movements (20) ────────────────────────────────────────────────────
  console.log("Creating stock movements...");
  for (let i = 0; i < 20; i++) {
    const pIdx = Math.floor(Math.random() * productIds.length);
    const moveType: "in" | "out" | "adjustment" = i % 3 === 0 ? "in" : i % 3 === 1 ? "out" : "adjustment";
    await db.insert(schema.stockMovements).values({
      tenantId,
      productId: productIds[pIdx],
      type: moveType,
      quantity: String(Math.floor(Math.random() * 50) + 5),
      referenceType: moveType === "out" ? "order" : moveType === "in" ? "arrival" : "adjustment",
      referenceId: null,
      notes: moveType === "adjustment" ? "Инвентаризация" : null,
      createdAt: daysAgo(Math.floor(i / 3)),
    });
  }
  console.log("✓ Stock movements created\n");

  // ── Daily Plans (for each agent, last 7 days) ──────────────────────────────
  console.log("Creating daily plans...");
  let planCount = 0;
  for (const agentId of allAgents) {
    for (let d = 0; d < 7; d++) {
      const agentShopCount = 3 + Math.floor(Math.random() * 3);
      const assignedShops = shopDefs
        .map((s, idx) => ({ ...s, idx }))
        .filter(s => s.agentId === agentId)
        .slice(0, agentShopCount);

      if (assignedShops.length === 0) continue;

      for (const shop of assignedShops) {
        let status: "planned" | "visited" | "skipped";
        if (d === 0) {
          status = "planned";
        } else if (d === 1) {
          status = Math.random() > 0.2 ? "visited" : "skipped";
        } else {
          status = Math.random() > 0.1 ? "visited" : "skipped";
        }
        await db.insert(schema.dailyPlans).values({
          tenantId,
          agentId,
          shopId: shopIds[shop.idx],
          planDate: daysAgo(d),
          status,
          notes: status === "skipped" ? "Магазин закрыт" : null,
          createdBy: supervisorId,
          createdAt: daysAgo(d),
          updatedAt: daysAgo(d),
        });
        planCount++;
      }
    }
  }
  console.log(`✓ ${planCount} daily plans created\n`);

  // ── Agent Locations (30) ────────────────────────────────────────────────────
  console.log("Creating agent locations...");
  for (let i = 0; i < 30; i++) {
    const agentId = allAgents[i % allAgents.length];
    const baseLat = [41.31, 39.65, 39.77, 42.46, 38.86][i % 5];
    const baseLng = [69.28, 66.97, 64.42, 59.60, 65.78][i % 5];
    await db.insert(schema.agentLocations).values({
      tenantId,
      agentId,
      lat: String(baseLat + (Math.random() - 0.5) * 0.02).substring(0, 10),
      lng: String(baseLng + (Math.random() - 0.5) * 0.02).substring(0, 11),
      accuracy: String(Math.floor(Math.random() * 20) + 3),
      createdAt: daysAgo(Math.floor(i / 5), i % 12),
    });
  }
  console.log("✓ Agent locations created\n");

  // ── Notifications (10) ──────────────────────────────────────────────────────
  console.log("Creating notifications...");
  const notifUsers = [ceoId, operator1Id, supervisorId, agentIds[0], courier1Id];
  for (let i = 0; i < 10; i++) {
    const types: Array<"order" | "payment" | "stock" | "system"> = ["order", "payment", "stock", "system"];
    const nType = types[i % 4];
    await db.insert(schema.notifications).values({
      tenantId,
      userId: notifUsers[i % notifUsers.length],
      type: nType,
      title: nType === "order" ? "Новый заказ" : nType === "payment" ? "Оплата получена" : nType === "stock" ? "Низкий остаток" : "Система обновлена",
      message: nType === "order" ? "Поступил новый заказ на сумму 250,000 сум" : nType === "payment" ? "Магазин \"Бараka Market\" оплатил 850,000 сум" : nType === "stock" ? "Остаток \"Картофель молодой\" ниже точки дозаказа" : "Версия системы обновлена до 2.1.0",
      isRead: i > 5,
      createdAt: daysAgo(i),
    });
  }
  console.log("✓ Notifications created\n");

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           DATABASE SEEDED SUCCESSFULLY                          ║
╠══════════════════════════════════════════════════════════════════╣
║  SUPER ADMIN (cross-tenant):                                    ║
║    superadmin@system.local        password: superadmin123       ║
║                                                                  ║
║  TENANT — Олтин Йўл Дистрибуция МЧЖ  password: password123     ║
║    ceo@demo-uz.uz                 → CEO / Admin                ║
║    operator1@demo-uz.uz           → Operator                   ║
║    operator2@demo-uz.uz           → Operator                   ║
║    agent-tashkent@demo-uz.uz      → Agent (Tashkent)           ║
║    agent-samarkand@demo-uz.uz     → Agent (Samarkand)          ║
║    agent-bukhara@demo-uz.uz       → Agent (Bukhara)            ║
║    agent-nukus@demo-uz.uz         → Agent (Nukus)              ║
║    agent-karshi@demo-uz.uz        → Agent (Karshi)             ║
║    supervisor@demo-uz.uz          → Supervisor                 ║
║    merch1@demo-uz.uz              → Merchandiser               ║
║    merch2@demo-uz.uz              → Merchandiser               ║
║    courier1@demo-uz.uz            → Courier                    ║
║    courier2@demo-uz.uz            → Courier                    ║
║                                                                  ║
║  DATA SUMMARY:                                                   ║
║    ${shopIds.length} shops (Tashkent/Samarkand/Bukhara)                     ║
║    ${productIds.length} products (food, beverages, dairy, meat, bakery)     ║
║    ${orderCount} orders (30-day spread, 4 statuses)                     ║
║    ${planCount} daily plans (7-day coverage, 5 agents)                    ║
║    ${productIds.length} stock records (5 low-stock items)                ║
║    8 arrivals · 15 payments · 20 stock movements               ║
║    30 agent GPS locations · 10 notifications                    ║
╚══════════════════════════════════════════════════════════════════╝
`);
  process.exit(0);
}

seed().catch((err) => {
  console.error("\n❌ Seed failed:", err.message ?? err);
  if (err.cause) console.error("   cause:", err.cause);
  process.exit(1);
});
