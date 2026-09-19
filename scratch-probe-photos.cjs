const mysql = require("mysql2/promise");
(async () => {
  const c = await mysql.createConnection(process.env.MYSQL_PUBLIC_URL || process.env.DATABASE_URL);
  const kind = "CASE WHEN photo_url IS NULL THEN 'null' WHEN photo_url='' THEN 'empty' WHEN photo_url LIKE 'data:%' THEN 'data' WHEN photo_url LIKE 'https://minio-production-9c62.up.railway.app/warehouse-pro-photos/%' THEN 'minio-ok' WHEN photo_url LIKE '%railway.app%' THEN 'railway-other' WHEN photo_url LIKE 'https://%' THEN 'https-other' WHEN photo_url LIKE '/api/photos/%' THEN 'api-photos' ELSE 'other' END";
  const [t] = await c.query("SELECT id, name FROM tenants WHERE name LIKE '%Serena%' LIMIT 2");
  console.log("tenant:", JSON.stringify(t));
  const tid = t[0] && t[0].id;
  const [k] = await c.query(`SELECT ${kind} AS kind, COUNT(*) n FROM products WHERE tenant_id = ? GROUP BY kind`, [tid]);
  console.log("serena products by kind:", JSON.stringify(k));
  const [s] = await c.query("SELECT id, code, LEFT(photo_url, 110) AS u, updated_at FROM products WHERE tenant_id = ? AND code IN ('THS1-03','THS1-01','GP1-01') LIMIT 5", [tid]);
  console.log("samples:", JSON.stringify(s));
  const [all] = await c.query(`SELECT ${kind} AS kind, COUNT(*) n FROM products GROUP BY kind`);
  console.log("all products by kind:", JSON.stringify(all));
  await c.end();
})().catch(e => { console.error("ERR", e.message.slice(0, 200)); process.exit(1); });
