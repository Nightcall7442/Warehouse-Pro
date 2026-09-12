import { env } from "./env";
import { s3Client, publicUrl, isS3Configured, serverSideEncryption } from "./s3";

/*
  Картинка из data:-строки — в хранилище, обратно — её адрес.

  Без настроенного S3 data:-строка возвращается как есть: приложение умеет
  и так (api/photos.ts отдаёт её байтами). С хранилищем в базе остаётся
  только адрес — дамп и копии перестают носить в себе картинки.
*/
const DATA_URL_RE = /^data:image\/(\w+);base64,(.+)$/;

export function isDataImage(value: string | null | undefined): value is string {
  return typeof value === "string" && DATA_URL_RE.test(value);
}

export async function uploadBase64ToS3(dataUrl: string, folder: string, tenantId: number): Promise<string> {
  if (!isS3Configured()) return dataUrl;

  const match = dataUrl.match(DATA_URL_RE);
  if (!match) return dataUrl;

  const ext = match[1].toLowerCase() === "jpeg" ? "jpg" : match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  const key = `${folder}/${tenantId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = await s3Client();
  await s3.send(new PutObjectCommand({
    Bucket: env.s3Bucket!,
    Key: key,
    Body: buffer,
    ContentType: `image/${ext === "jpg" ? "jpeg" : ext}`,
    ...serverSideEncryption(),
  }));
  return publicUrl(key);
}
