import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { env } from "./lib/env";

function isS3Configured(): boolean {
  return !!(env.s3Bucket && env.s3AccessKey && env.s3SecretKey);
}

async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<string> {
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: env.s3Region || "us-east-1",
    credentials: {
      accessKeyId: env.s3AccessKey || "",
      secretAccessKey: env.s3SecretKey || "",
    },
  });
  await s3.send(new PutObjectCommand({
    Bucket: env.s3Bucket!,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  return `https://${env.s3Bucket}.s3.${env.s3Region || "us-east-1"}.amazonaws.com/${key}`;
}

export const uploadRouter = createRouter({
  /** Upload a base64-encoded image to S3 and return the public URL.
   *  Falls back to returning the dataUrl directly if S3 is not configured. */
  file: authedQuery
    .input(z.object({
      dataUrl: z.string().startsWith("data:image/").max(5_000_000, "Макс. 4 МБ"),
      folder: z.enum(["products", "shops", "avatars", "visits"]).default("products"),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!isS3Configured()) {
        return { url: input.dataUrl };
      }

      const match = input.dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!match) throw new Error("Invalid dataUrl format");

      const ext = match[1] === "jpeg" ? "jpg" : match[1];
      const buffer = Buffer.from(match[2], "base64");
      const key = `${input.folder}/${ctx.tenant.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const url = await uploadToS3(key, buffer, `image/${ext === "jpg" ? "jpeg" : ext}`);
      return { url };
    }),
});
