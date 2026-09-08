import { z } from "zod";
import { isSafePhotoValue, PHOTO_VALUE_ERROR } from "./lib/photo-value";
import { createRouter, authedQuery } from "./middleware";
import { env } from "./lib/env";
import { s3Client, publicUrl, isS3Configured } from "./lib/s3";

const ALLOWED_IMAGE_EXTENSIONS = ["jpeg", "jpg", "png", "webp", "gif"] as const;

async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<string> {
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = await s3Client();
  await s3.send(new PutObjectCommand({
    Bucket: env.s3Bucket!,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  return publicUrl(key);
}

export const uploadRouter = createRouter({
  /** Upload a base64-encoded image to S3 and return the public URL.
   *  Falls back to returning the dataUrl directly if S3 is not configured. */
  file: authedQuery
    .input(z.object({
      dataUrl: z.string().refine(isSafePhotoValue, PHOTO_VALUE_ERROR).max(5_000_000, "Макс. 4 МБ"),
      folder: z.enum(["products", "shops", "avatars", "visits"]).default("products"),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!isS3Configured()) {
        return { url: input.dataUrl };
      }

      const match = input.dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!match) throw new Error("Invalid dataUrl format");

      const rawExt = match[1].toLowerCase();
      if (!ALLOWED_IMAGE_EXTENSIONS.includes(rawExt as typeof ALLOWED_IMAGE_EXTENSIONS[number])) {
        throw new Error(`Расширение ${rawExt} не разрешено. Допустимые: ${ALLOWED_IMAGE_EXTENSIONS.join(", ")}`);
      }
      const ext = rawExt === "jpeg" ? "jpg" : rawExt;
      const buffer = Buffer.from(match[2], "base64");
      const key = `${input.folder}/${ctx.tenant.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const url = await uploadToS3(key, buffer, `image/${ext === "jpg" ? "jpeg" : ext}`);
      return { url };
    }),
});
