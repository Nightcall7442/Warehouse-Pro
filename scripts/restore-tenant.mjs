#!/usr/bin/env node
/**
 * Вернуть удалённую организацию из резервной копии — только её, не трогая
 * остальных.
 *
 * ── Зачем ────────────────────────────────────────────────────────────────────
 *
 * Уход организации (api/services/tenant-offboard.ts) стирает её строки из
 * базы насовсем. Развернуть всю копию поверх рабочей базы нельзя: откатились
 * бы заказы, оплаты и остатки всех остальных арендаторов на момент копии.
 * Поэтому копия разворачивается в ЧЕРНОВУЮ базу на том же сервере, и из неё
 * в рабочую переносятся строки одной организации — в обратном порядке
 * удаления: родители раньше детей. Номера строк сохраняются: после удаления
 * они свободны.
 *
 * ── Как ─────────────────────────────────────────────────────────────────────
 *
 *   1. Запись об удалении в platform_audit (action = tenant.offboarded) даёт
 *      номер организации и момент удаления.
 *   2. Берётся последняя копия из хранилища, снятая ДО удаления.
 *   3. Копия разворачивается в <база>_restore_tenant.
 *   4. В одной транзакции — INSERT … SELECT по каждой таблице, только общие
 *      столбцы (схема могла вырасти после копии). Внешние ключи включены: если
 *      что-то не сходится, транзакция откатывается целиком.
 *   5. RESTORE_MODE=plan — откат в конце (проверка без записи), apply —
 *      запись. Черновая база стирается в любом случае.
 *
 * ── Запуск ──────────────────────────────────────────────────────────────────
 *
 *   DATABASE_URL=… S3_*=… RESTORE_TENANT_NAME="FRESH MCHJ" RESTORE_MODE=plan \
 *     node scripts/restore-tenant.mjs
 *
 * Для записи — RESTORE_MODE=apply и RESTORE_CONFIRM=<slug организации>.
 * Организация с тем же номером или slug уже в базе — отказ: второй запуск
 * ничего не задвоит. Вернувшаяся организация остаётся приостановленной, как
 * в минуту удаления, — включает её суперадмин.
 *
 * Порядок таблиц — копия OFFBOARD_ORDER; совпадение стережёт
 * api/__tests__/restore-tenant-order.test.ts.
 */
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

/** Как в tenant-offboard.ts — дети раньше родителей. Восстановление идёт с конца. */
export const OFFBOARD_ORDER = [
  "agent_locations",
  "agent_territories",
  "announcement_dismissals",
  "api_export_log",
  "api_keys",
  { table: "arrival_items", via: { column: "arrival_id", parent: "arrivals" } },
  "audit_log",
  "billing_events",
  "commission_product_rates",
  "commissions",
  "debt_reminders",
  "id_mappings",
  "invites",
  { table: "loading_list_orders", via: { column: "list_id", parent: "loading_lists" } },
  { table: "loading_list_items",  via: { column: "list_id", parent: "loading_lists" } },
  "notifications",
  "onec_config",
  "onec_journal",
  "order_adjustments",
  "order_comments",
  { table: "order_items", via: { column: "order_id", parent: "orders" } },
  { table: "password_reset_tokens", via: { column: "user_id", parent: "users" } },
  "payments",
  { table: "price_list_assignments", via: { column: "price_list_id", parent: "price_lists" } },
  { table: "price_list_items", via: { column: "price_list_id", parent: "price_lists" } },
  { table: "return_items", via: { column: "return_id", parent: "returns" } },
  "role_permissions",
  "salary_payouts",
  "sales_targets",
  "saved_filters",
  "settings",
  "stock_batches",
  { table: "stock_count_items", via: { column: "count_id", parent: "stock_counts" } },
  "stock_movements",
  "stock_transfers",
  "subscriptions",
  "supplier_payments",
  "support_messages",
  "support_threads",
  "telegram_groups",
  "telegram_outbox",
  "telegram_rules",
  "tenant_branding",
  "visit_reports",
  "visit_schedules",
  "warehouse_stock",
  "daily_plans",
  "loading_lists",
  "markdowns",
  "products",
  "returns",
  "stock_counts",
  "supplies",
  "arrivals",
  "orders",
  "price_lists",
  "suppliers",
  "warehouses",
  "shops",
  "territories",
  "users",
];

/** Порядок вставки: сама организация, затем удалённое — с конца. */
export function restoreOrder() {
  return [{ table: "tenants", self: true }, ...[...OFFBOARD_ORDER].reverse().map(s => (typeof s === "string" ? { table: s } : s))];
}

/** Дамп db-dump.ts — по выражениям (тот же разбор, что у репетиции восстановления). */
export function splitStatements(sqlText) {
  const out = [];
  let delimiter = ";";
  let buf = [];
  for (const rawLine of sqlText.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const m = /^DELIMITER\s+(\S+)\s*$/.exec(line);
    if (m) { delimiter = m[1]; continue; }
    if (buf.length === 0 && (line.trim() === "" || line.startsWith("--"))) continue;
    buf.push(line);
    if (line.trimEnd().endsWith(delimiter)) {
      const text = buf.join("\n").trimEnd();
      out.push(text.slice(0, text.length - delimiter.length).trim());
      buf = [];
    }
  }
  const rest = buf.join("\n").trim();
  if (rest) out.push(rest);
  return out.filter(s => s.length > 0);
}

const id = (conn, name) => conn.escapeId(name);

/*
  Столбцы, которые переносятся: все, кроме ВЫЧИСЛЯЕМЫХ (VIRTUAL/STORED).

  Стояло «EXTRA NOT LIKE '%GENERATED%'» — и оно отсекало заодно обычные
  столбцы со значением по умолчанию из выражения: MySQL помечает
  `created_at timestamp DEFAULT (now())` как DEFAULT_GENERATED. Первое
  восстановление (Fresh MCHJ, 26.11.2026) поэтому потеряло все даты
  оформления и входа: они встали временем восстановления. Ту же ошибку
  однажды делала выгрузка (db-dump, 09.10.2026).
*/
async function columnsOf(conn, schema, table) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       AND EXTRA NOT LIKE '%VIRTUAL GENERATED%' AND EXTRA NOT LIKE '%STORED GENERATED%'
     ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  return rows.map(r => r.c);
}

/** Столбцы со значением по умолчанию из выражения — те, что первое восстановление потеряло. */
async function defaultGeneratedOf(conn, schema, table) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND EXTRA LIKE '%DEFAULT_GENERATED%' ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  return rows.map(r => r.c);
}

async function primaryKeyOf(conn, schema, table) {
  const [rows] = await conn.query(
    `SELECT COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION`,
    [schema, table],
  );
  return rows.map(r => r.c);
}

/**
 * Вернуть строкам организации даты из копии — столбцы DEFAULT_GENERATED
 * (created_at, updated_at, lastSignInAt…), которые потеряло первое
 * восстановление. Строки сопоставляются по первичному ключу; новых строк и
 * чужих организаций не касается. commit=false — проба с откатом.
 */
export async function fixTenantDates(conn, { source, target, tenantId, commit }) {
  await conn.query("SET FOREIGN_KEY_CHECKS = 1, UNIQUE_CHECKS = 1");
  const updated = {};
  await conn.beginTransaction();
  try {
    for (const step of restoreOrder()) {
      const dated = await defaultGeneratedOf(conn, source, step.table);
      if (dated.length === 0) continue;
      const tgtCols = new Set(await columnsOf(conn, target, step.table));
      const cols = dated.filter(c => tgtCols.has(c));
      const pk = await primaryKeyOf(conn, source, step.table);
      if (cols.length === 0 || pk.length === 0) continue;
      const S = `${id(conn, source)}.${id(conn, step.table)}`;
      const T = `${id(conn, target)}.${id(conn, step.table)}`;
      const on = pk.map(k => `t.${id(conn, k)} = s.${id(conn, k)}`).join(" AND ");
      const set = cols.map(c => `t.${id(conn, c)} = s.${id(conn, c)}`).join(", ");
      let sql;
      if (step.self) sql = `UPDATE ${T} t JOIN ${S} s ON ${on} SET ${set} WHERE s.id = ?`;
      else if (step.via) {
        sql = `UPDATE ${T} t JOIN ${S} s ON ${on}
               JOIN ${id(conn, source)}.${id(conn, step.via.parent)} p ON p.id = s.${id(conn, step.via.column)}
               SET ${set} WHERE p.tenant_id = ?`;
      } else sql = `UPDATE ${T} t JOIN ${S} s ON ${on} SET ${set} WHERE s.tenant_id = ?`;
      const [res] = await conn.query(sql, [tenantId]);
      if (res.affectedRows > 0) updated[step.table] = res.affectedRows;
    }
    if (commit) await conn.commit(); else await conn.rollback();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  }
  return { updated, total: Object.values(updated).reduce((a, b) => a + b, 0), committed: Boolean(commit) };
}

/**
 * Перенести строки организации из source в target в одной транзакции.
 * commit=false — всё выполняется и откатывается: проверка без записи.
 * Возвращает число строк по таблицам и то, что пришлось пропустить.
 */
export async function copyTenant(conn, { source, target, tenantId, commit }) {
  const [[existing]] = await conn.query(`SELECT id, slug FROM ${id(conn, target)}.tenants WHERE id = ?`, [tenantId]);
  if (existing) throw new Error(`организация #${tenantId} уже есть в ${target} (slug ${existing.slug}) — восстанавливать нечего`);
  const [[src]] = await conn.query(`SELECT id, name, slug, status FROM ${id(conn, source)}.tenants WHERE id = ?`, [tenantId]);
  if (!src) throw new Error(`в копии нет организации #${tenantId}`);
  const [[slugTaken]] = await conn.query(`SELECT id FROM ${id(conn, target)}.tenants WHERE slug = ?`, [src.slug]);
  if (slugTaken) throw new Error(`slug ${src.slug} уже занят организацией #${slugTaken.id}`);

  // Дамп выключает проверки на время своей загрузки; перенос — только с ними.
  await conn.query("SET FOREIGN_KEY_CHECKS = 1, UNIQUE_CHECKS = 1");
  const copied = {};
  const skipped = [];
  await conn.beginTransaction();
  try {
    for (const step of restoreOrder()) {
      const srcCols = await columnsOf(conn, source, step.table);
      if (srcCols.length === 0) { skipped.push(`${step.table}: нет в копии`); continue; }
      const tgtCols = new Set(await columnsOf(conn, target, step.table));
      if (tgtCols.size === 0) { skipped.push(`${step.table}: нет в рабочей базе`); continue; }
      const cols = srcCols.filter(c => tgtCols.has(c));
      const list = cols.map(c => id(conn, c)).join(", ");
      const childList = cols.map(c => `c.${id(conn, c)}`).join(", ");
      let sql;
      if (step.self) {
        sql = `INSERT INTO ${id(conn, target)}.tenants (${list}) SELECT ${list} FROM ${id(conn, source)}.tenants WHERE id = ?`;
      } else if (step.via) {
        sql = `INSERT INTO ${id(conn, target)}.${id(conn, step.table)} (${list})
               SELECT ${childList} FROM ${id(conn, source)}.${id(conn, step.table)} c
               JOIN ${id(conn, source)}.${id(conn, step.via.parent)} p ON p.id = c.${id(conn, step.via.column)}
               WHERE p.tenant_id = ?`;
      } else {
        sql = `INSERT INTO ${id(conn, target)}.${id(conn, step.table)} (${list}) SELECT ${list} FROM ${id(conn, source)}.${id(conn, step.table)} WHERE tenant_id = ?`;
      }
      const [res] = await conn.query(sql, [tenantId]);
      if (res.affectedRows > 0) copied[step.table] = res.affectedRows;
    }
    if (commit) await conn.commit(); else await conn.rollback();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  }
  const total = Object.values(copied).reduce((a, b) => a + b, 0);
  return { tenant: src, copied, skipped, total, committed: Boolean(commit) };
}

async function main() {
  const mysql = (await import("mysql2/promise")).default;
  const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import("@aws-sdk/client-s3");
  // Переменные — как их читает приложение (api/lib/env.ts): без пробелов и
  // переводов строк по краям. Ключ S3 с хвостовым переводом строки приложению
  // не мешает, а подпись запроса без обрезки не сходится.
  const env = Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
  const mode = ["apply", "check", "fixdates", "fixdates-apply"].includes(env.RESTORE_MODE) ? env.RESTORE_MODE : "plan";
  const name = (env.RESTORE_TENANT_NAME ?? "").trim();
  if (!env.DATABASE_URL || !name) throw new Error("нужны DATABASE_URL и RESTORE_TENANT_NAME");

  const url = new URL(env.DATABASE_URL);
  const target = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const source = `${target}_restore_tenant`;
  const conn = await mysql.createConnection({ uri: env.DATABASE_URL, connectTimeout: 30_000, multipleStatements: false });
  const log = (msg, extra) => console.log(`[restore] ${msg}`, extra ? JSON.stringify(extra) : "");
  try {
    const [[audit]] = await conn.query(
      `SELECT tenant_id AS tenantId, tenant_name AS tenantName, created_at AS at, meta FROM platform_audit
       WHERE action = 'tenant.offboarded' AND tenant_name = ? ORDER BY id DESC LIMIT 1`, [name]);
    if (!audit) throw new Error(`в platform_audit нет удаления организации «${name}»`);
    if (mode === "check") {
      // Только чтение: что видит вход и калитка подписки у вернувшейся организации.
      const t = audit.tenantId;
      const [[tenant]] = await conn.query(`SELECT id, name, slug, status, plan, trial_ends_at, plan_expires_at FROM tenants WHERE id = ?`, [t]);
      const [subs] = await conn.query(`SELECT id, plan, status, trial_ends_at, current_period_ends, expiry_notice_at FROM subscriptions WHERE tenant_id = ?`, [t]);
      const [users] = await conn.query(
        `SELECT id, role, status, (password_hash IS NOT NULL AND password_hash <> '') AS hasPassword,
                CONCAT(LEFT(email, 2), '***', SUBSTRING(email, LOCATE('@', email))) AS email, lastSignInAt
         FROM users WHERE tenant_id = ? ORDER BY id`, [t]);
      const counts = {};
      for (const table of ["orders", "shops", "products", "payments", "warehouse_stock"]) {
        const [[c]] = await conn.query(`SELECT COUNT(*) AS n FROM ${id(conn, table)} WHERE tenant_id = ?`, [t]);
        counts[table] = Number(c.n);
      }
      const [[last]] = await conn.query(`SELECT MAX(created_at) AS lastOrder FROM orders WHERE tenant_id = ?`, [t]);
      console.log("RESTORE-CHECK " + JSON.stringify({ tenant, subscriptions: subs, users, counts, lastOrder: last.lastOrder, now: new Date() }));
      return;
    }
    const deletedAt = new Date(audit.at);
    const meta = typeof audit.meta === "string" ? JSON.parse(audit.meta) : audit.meta;
    log("удаление найдено", { tenantId: audit.tenantId, deletedAt: deletedAt.toISOString(), deletedTotal: meta?.total });

    const s3 = new S3Client({
      region: env.S3_REGION || "auto",
      requestHandler: { connectionTimeout: 10_000, requestTimeout: 300_000 },
      endpoint: env.S3_ENDPOINT || undefined,
      // Как в приложении: S3_FORCE_PATH непустой — путь, иначе по умолчанию SDK.
      forcePathStyle: Boolean(env.S3_FORCE_PATH),
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    });
    const bucket = (env.S3_BACKUP_BUCKET || env.S3_BUCKET || "").trim();
    let token; const all = [];
    do {
      const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "backups/warehouse-pro-", ContinuationToken: token }));
      all.push(...(r.Contents ?? []));
      token = r.NextContinuationToken;
    } while (token);
    const before = all.filter(o => o.Key && o.LastModified && o.LastModified < deletedAt)
      .sort((a, b) => b.LastModified - a.LastModified);
    const chosen = env.RESTORE_BACKUP_KEY ? all.find(o => o.Key === env.RESTORE_BACKUP_KEY) : before[0];
    if (!chosen) throw new Error(`нет копии, снятой до ${deletedAt.toISOString()}`);
    log("копия", { key: chosen.Key, at: chosen.LastModified.toISOString(), mb: (chosen.Size / 1048576).toFixed(1), copiesBefore: before.length });

    const got = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: chosen.Key }));
    const statements = splitStatements(gunzipSync(Buffer.from(await got.Body.transformToByteArray())).toString("utf8"));
    log("копия скачана", { statements: statements.length });

    await conn.query(`DROP DATABASE IF EXISTS ${id(conn, source)}`);
    await conn.query(`CREATE DATABASE ${id(conn, source)} CHARACTER SET utf8mb4`);
    try {
      await conn.query(`USE ${id(conn, source)}`);
      for (const st of statements) await conn.query(st);
      await conn.query(`USE ${id(conn, target)}`);
      log("копия развёрнута в черновую базу", { source });

      if (mode === "apply" || mode === "fixdates-apply") {
        const [[t]] = await conn.query(`SELECT slug FROM ${id(conn, source)}.tenants WHERE id = ?`, [audit.tenantId]);
        if (!t || env.RESTORE_CONFIRM !== t.slug) throw new Error(`для записи задайте RESTORE_CONFIRM=${t?.slug ?? "<slug>"}`);
      }
      if (mode === "fixdates" || mode === "fixdates-apply") {
        const fixed = await fixTenantDates(conn, { source, target, tenantId: audit.tenantId, commit: mode === "fixdates-apply" });
        console.log("RESTORE-FIXDATES " + JSON.stringify({ mode, backup: chosen.Key, ...fixed }));
        return;
      }
      const report = await copyTenant(conn, { source, target, tenantId: audit.tenantId, commit: mode === "apply" });
      const deleted = meta?.deleted ?? {};
      const diff = Object.keys({ ...deleted, ...report.copied })
        .filter(k => k !== "tenants" && Number(deleted[k] ?? 0) !== Number(report.copied[k] ?? 0))
        .map(k => `${k}: удалено ${deleted[k] ?? 0}, в копии ${report.copied[k] ?? 0}`);
      console.log("RESTORE-REPORT " + JSON.stringify({ mode, backup: chosen.Key, ...report, differsFromDeleted: diff }));
    } finally {
      await conn.query(`DROP DATABASE IF EXISTS ${id(conn, source)}`).catch(e => log("черновая база не стёрлась", { error: e.message }));
    }
  } finally {
    await conn.end().catch(() => conn.destroy());
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(() => process.exit(0), (e) => { console.error("RESTORE-FAILED " + (e?.message ?? e)); process.exit(1); });
}
