import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

const ONE_YEAR = 60 * 60 * 24 * 365;

export function serveStaticFiles(app: App) {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");

  app.use("*", serveStatic({
    root: "./dist/public",
    onFound: (_filePath, c) => {
      // Matched against the request path, not the on-disk path, which is
      // separator-dependent. Everything under /assets/ carries a content hash in
      // its name, so it can be cached forever; without this header the browser
      // revalidates every bundle on every navigation.
      const reqPath = c.req.path;
      if (reqPath.startsWith("/assets/")) {
        c.header("Cache-Control", `public, max-age=${ONE_YEAR}, immutable`);
      } else if (reqPath.endsWith(".html") || reqPath.endsWith("sw.js")) {
        c.header("Cache-Control", "no-cache");
      } else {
        c.header("Cache-Control", "public, max-age=86400");
      }
    },
  }));

  // index.html is the SPA fallback for every unmatched route — read it once instead
  // of doing a synchronous disk read on each navigation.
  let indexHtml: string | null = null;

  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    if (indexHtml === null) {
      indexHtml = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");
    }
    c.header("Cache-Control", "no-cache");
    return c.html(indexHtml);
  });
}
