/**
 * Завести бакеты в хранилище и открыть на чтение тот, из которого раздаются
 * фотографии.
 *
 * ── Зачем скриптом, а не руками ─────────────────────────────────────────────
 *
 * У MinIO в свежих сборках веб-консоли нет — создать бакет мышью негде, нужен
 * либо отдельный клиент mc, либо вот такой вызов по протоколу S3. Клиент S3 у
 * приложения и так есть, значит ставить ещё одну программу незачем.
 *
 * Заодно это работает для ЛЮБОГО хранилища, а не только для MinIO: те же две
 * команды выполнятся и на Cloudflare R2, и на Backblaze B2, если однажды
 * переедем. Настройка, записанная скриптом, переживает переезд; настройка,
 * сделанная мышью, — нет.
 *
 * ── Что делает ──────────────────────────────────────────────────────────────
 *
 *   1. создаёт бакет фотографий и бакет копий, если их ещё нет;
 *   2. открывает на ЧТЕНИЕ только бакет фотографий;
 *   3. бакет копий не трогает — и не тронет, даже если его назвать так же.
 *
 * Запуск (переменные берутся у службы, свои вписывать не нужно):
 *
 *     railway run --service Warehouse-Pro node scripts/init-storage.mjs
 *
 * Повторный запуск безопасен: существующий бакет считается за успех.
 */
import { S3Client, CreateBucketCommand, PutBucketPolicyCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

const {
  S3_BUCKET, S3_BACKUP_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY,
  S3_ENDPOINT, S3_FORCE_PATH,
} = process.env;

if (!S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
  console.error("Не заданы S3_BUCKET / S3_ACCESS_KEY / S3_SECRET_KEY — заводить нечего и нечем.");
  process.exit(1);
}

const s3 = new S3Client({
  region: S3_REGION || "us-east-1",
  credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
  ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT, forcePathStyle: Boolean(S3_FORCE_PATH) } : {}),
});

/** Разрешение читать объекты бакета кому угодно — и только читать. */
function publicReadPolicy(bucket) {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { AWS: ["*"] },
      // Именно GetObject. Ни списка содержимого, ни записи: адрес бакета знает
      // любой, кто открыл карточку товара, и запись «кому угодно» означала бы,
      // что подменить чужую фотографию может кто угодно.
      Action: ["s3:GetObject"],
      Resource: [`arn:aws:s3:::${bucket}/*`],
    }],
  });
}

async function ensureBucket(name) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: name }));
    console.log(`бакет ${name}: уже есть`);
    return;
  } catch {
    // Нет — заведём ниже. Разбирать код ошибки незачем: если дело в правах или
    // в сети, создание тут же упадёт со своим, более точным сообщением.
  }
  await s3.send(new CreateBucketCommand({ Bucket: name }));
  console.log(`бакет ${name}: создан`);
}

const photos = S3_BUCKET;
const backups = (S3_BACKUP_BUCKET || "").trim();

await ensureBucket(photos);
if (backups && backups !== photos) await ensureBucket(backups);

/*
  Открывается ровно один бакет — тот, откуда браузер тянет фотографии.

  Сравнение с бакетом копий стоит здесь, а не в голове у того, кто запускает:
  внутри копии вся база целиком — все арендаторы, хеши паролей, телефоны и
  долги, — и открыть её на чтение «кому угодно» значит опубликовать всё.
*/
if (backups && backups === photos) {
  console.error("S3_BUCKET и S3_BACKUP_BUCKET совпадают — открыть фотографии значит открыть и копии базы. Разведите их.");
  process.exit(1);
}

await s3.send(new PutBucketPolicyCommand({ Bucket: photos, Policy: publicReadPolicy(photos) }));
console.log(`бакет ${photos}: открыт на чтение`);
console.log(`бакет ${backups || "(не задан)"}: остаётся закрытым`);
