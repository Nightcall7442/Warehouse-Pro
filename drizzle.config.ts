import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set.\n" +
    "Copy .env.example to .env and fill in your Railway MySQL URL."
  );
}

// Railway and cloud providers require SSL; localhost does not.
function isRemote(u: string): boolean {
  try {
    const host = new URL(u).hostname;
    return host !== "localhost" && host !== "127.0.0.1" && !host.endsWith(".local");
  } catch {
    return false;
  }
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "mysql",
  dbCredentials: {
    url,
    ...(isRemote(url) ? { ssl: { rejectUnauthorized: false } } : {}),
  },
});
