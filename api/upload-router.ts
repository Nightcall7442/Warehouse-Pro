import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { uploadToS3, isS3Configured } from "./lib/s3";

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
        // Fallback: store dataUrl directly (dev mode)
        return { url: input.dataUrl };
      }

      // Parse dataUrl
      const match = input.dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!match) throw new Error("Invalid dataUrl format");

      const ext = match[1] === "jpeg" ? "jpg" : match[1];
      const buffer = Buffer.from(match[2], "base64");
      const key = `${input.folder}/${ctx.tenant.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      const url = await uploadToS3(key, buffer, `image/${ext === "jpg" ? "jpeg" : ext}`);
      return { url };
    }),
});
