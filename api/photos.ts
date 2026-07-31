import { Hono, type Context } from "hono";
import { eq, and } from "drizzle-orm";
import { products, shops } from "@db/schema";
import { getDb } from "./queries/connection";
import { authenticateRequest } from "./auth";

/**
 * Photo delivery for entities whose photo is stored in the database as a base64
 * data URL (the fallback when S3 is not configured — see product.uploadPhoto).
 *
 * List endpoints must not inline those blobs: a page of 25 products carried up
 * to ~12 MB of JSON. They now return a URL pointing here instead, so the photo
 * is fetched lazily, in parallel, and cached by the browser. Photos that are
 * already real S3 URLs are returned as-is by the list and never reach this route.
 */
const photos = new Hono();

const DATA_URL_RE = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/;
const CACHE_HEADER = "private, max-age=604800, immutable";

async function serve(
  c: Context,
  loader: (tenantId: number, id: number) => Promise<string | null | undefined>,
) {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "Not Found" }, 404);

  let tenantId: number;
  try {
    const auth = await authenticateRequest(c.req.raw.headers);
    if (!auth.tenant) return c.json({ error: "Unauthorized" }, 401);
    tenantId = auth.tenant.id;
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const photoUrl = await loader(tenantId, id);
  if (!photoUrl) return c.json({ error: "Not Found" }, 404);

  // Already hosted elsewhere (S3) — send the client straight there.
  if (!photoUrl.startsWith("data:")) return c.redirect(photoUrl, 302);

  const match = DATA_URL_RE.exec(photoUrl);
  if (!match) return c.json({ error: "Not Found" }, 404);

  const body = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  return c.body(body, 200, {
    "Content-Type":  match[1],
    "Cache-Control": CACHE_HEADER,
  });
}

photos.get("/product/:id", (c) =>
  serve(c, async (tenantId, id) => {
    const [row] = await getDb().select({ photoUrl: products.photoUrl })
      .from(products)
      .where(and(eq(products.id, id), eq(products.tenantId, tenantId)))
      .limit(1);
    return row?.photoUrl;
  }));

photos.get("/shop/:id", (c) =>
  serve(c, async (tenantId, id) => {
    const [row] = await getDb().select({ photoUrl: shops.photoUrl })
      .from(shops)
      .where(and(eq(shops.id, id), eq(shops.tenantId, tenantId)))
      .limit(1);
    return row?.photoUrl;
  }));

export default photos;
