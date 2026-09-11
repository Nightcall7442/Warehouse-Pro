import { randomBytes } from "crypto";
import { getDb } from "../queries/connection";
import { logger } from "../lib/logger";
import { env } from "../lib/env";
import { startDump } from "../services/db-dump";
import { s3Client, serverSideEncryption, isOffsiteBackupConfigured, offsiteBackupClient } from "../lib/s3";
import { backupLastSuccessTimestamp, backupLastSizeBytes } from "../prometheus-metrics";

import { firstRow } from "../lib/db-rows";
/**
 * Database backup cron job
 * Runs daily at 3 AM UTC
 *
 * Produces a real, restorable logical dump of the database, gzipped, and
 * uploads it to S3. The dump itself is built by `startDump` — the same code
 * path the superadmin download button uses. Requires S3
 * credentials — without S3 there is nowhere durable to put the dump (the
 * container's filesystem doesn't survive a redeploy), so that case is
 * reported as a failure rather than a false "success".
 */
export async function runBackup(): Promise<{ success: boolean; message: string }> {
  const timestamp = new Date().toISOString().split("T")[0];
  // Имя дампа больше не выводится из одной только даты.
  //
  // Раньше ключ был ровно `backups/warehouse-pro-<дата>.sql.gz` и лежал в том
  // же бакете, из которого сервер раздаёт фото товаров и магазинов голым
  // адресом вида https://<бакет>.s3.<регион>.amazonaws.com/<ключ>. Имя бакета и
  // регион уходят клиенту в каждом списке товаров, то есть известны любому, кто
  // хоть раз открыл карточку. Дальше подставить предсказуемый ключ — вопрос
  // одной строки, а внутри дампа вся база: все арендаторы, users.password_hash,
  // api_keys.key_hash, телефоны и долги магазинов.
  //
  // Случайный суффикс делает адрес неугадываемым даже если политика бакета
  // по-прежнему пускает читать что угодно; полный ключ пишется в лог, оттуда
  // его берут при восстановлении.
  const backupKey = `backups/warehouse-pro-${timestamp}-${randomBytes(12).toString("hex")}.sql.gz`;

  // Sanity-check table counts alongside the dump — if the dump silently
  // produced far fewer rows than the live tables have, something's wrong.
  const tables = ["tenants", "users", "products", "orders", "order_items", "shops", "warehouse_stock", "payments"];
  const counts: Record<string, number> = {};
  try {
    const db = getDb();
    for (const table of tables) {
      try {
        const result = await db.execute(`SELECT COUNT(*) as count FROM ${table}`);
        counts[table] = Number(firstRow<{ count: number }>(result)?.count ?? 0);
      } catch {
        counts[table] = -1;
      }
    }
  } catch (err) {
    logger.error("Backup: failed to read table counts", { error: err instanceof Error ? err.message : String(err) });
  }

  if (!(env.s3Bucket && env.s3AccessKey && env.s3SecretKey)) {
    logger.error("Backup skipped — no S3 configured, dump has nowhere durable to go", { counts });
    return { success: false, message: "Backup NOT performed: S3 is not configured, so there is no durable storage for the dump" };
  }

  try {
    /*
      Копию снимает та же служба, что отдаёт её суперадмину по кнопке.

      Раньше здесь стоял свой запуск mysqldump — второй способ снять копию,
      отличавшийся от первого мелочами. Проку от этого не было никакого, а
      цена была: сломались они порознь и в разное время, и про ночную копию
      никто бы не узнал, потому что её никто не открывает.

      Поток уже сжат — отдельного gzip здесь быть не должно.
    */
    const { stream } = await startDump();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const gzipped = Buffer.concat(chunks);

    if (gzipped.length === 0) {
      throw new Error("dump produced an empty output");
    }

    // Дамп кладётся в отдельный бакет, а не туда, откуда раздаются фото.
    //
    // S3_BACKUP_BUCKET — приватный бакет только под резервные копии: у него своя
    // политика, и «читать может кто угодно», нужное фотографиям, на него не
    // распространяется. Пока переменная не задана, копия всё же делается — база
    // без бэкапа опаснее бэкапа в общем бакете, — но в лог уходит
    // предупреждение, и в общем бакете она лежит под неугадываемым ключом.
    const backupBucket = (process.env.S3_BACKUP_BUCKET ?? "").trim();
    const targetBucket = backupBucket || env.s3Bucket;
    if (!backupBucket) {
      logger.warn(
        "Backup: S3_BACKUP_BUCKET is not set — the dump goes into the same bucket that serves public photos",
        { bucket: env.s3Bucket },
      );
    }

    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    // Клиент общий на всё приложение: он же умеет чужой адрес входа, если
    // хранилище не амазоновское.
    const s3 = await s3Client();
    const put = () => new PutObjectCommand({
      Bucket: targetBucket,
      Key: backupKey,
      Body: gzipped,
      ContentType: "application/gzip",
      // Шифрование на стороне S3: тот, кто получит доступ к самому хранилищу в
      // обход API (снятый том, чужая реплика), получит нечитаемый файл.
      // ACL здесь намеренно не передаётся: у бакетов с Object Ownership =
      // BucketOwnerEnforced любой ACL в запросе — ошибка, и бэкап бы просто
      // перестал загружаться.
      //
      // Заголовок уходит только на сам AWS. Хранилища вроде Cloudflare R2
      // шифруют содержимое сами и всегда, а незнакомый заголовок отвергают
      // целиком — то есть ночная копия падала бы каждую ночь ради шифрования,
      // которое там и так включено. Проверять нечего: наличие своего адреса
      // входа и означает «хранилище не амазоновское».
      ...serverSideEncryption(),
      Metadata: { tableCounts: JSON.stringify(counts) },
    });
    await s3.send(put());

    /*
      Зеркало вне площадки. Обе загрузки обязательны, если зеркало настроено:
      копия, которая есть только на той же площадке, что и база, — это не
      копия на случай потери площадки. Отказ зеркала = отказ работы, и он
      уходит суперадмину тем же путём, что и любой провал крона.
    */
    let mirrored = false;
    if (isOffsiteBackupConfigured()) {
      const offsite = await offsiteBackupClient();
      await offsite.send(put());
      mirrored = true;
    }

    backupLastSuccessTimestamp.set(Math.floor(Date.now() / 1000));
    backupLastSizeBytes.set(gzipped.length);

    logger.info("Backup dump uploaded to S3", { bucket: targetBucket, key: backupKey, gzippedBytes: gzipped.length, counts, mirrored });
    return { success: true, message: `Backup saved: ${backupKey} (${(gzipped.length / 1024 / 1024).toFixed(1)} MB gzipped)${mirrored ? ", mirrored offsite" : ""}` };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error("Backup failed", { error });
    return { success: false, message: `Backup failed: ${error}` };
  }
}
