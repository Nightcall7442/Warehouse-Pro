import { sql, type SQL } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";

/**
 * Photo reference for list queries.
 *
 * When S3 is not configured, photos are stored as base64 data URLs in a
 * mediumtext column (up to ~500 KB each). Selecting that column in a list turns
 * a page of 25 rows into megabytes of JSON. This returns a lazy URL served by
 * api/photos.ts instead, and passes real (S3/http) URLs through untouched.
 *
 * The `?v=` timestamp busts the browser cache whenever the row is updated.
 */
export function photoRef(
  kind: "product" | "shop",
  idCol: AnyMySqlColumn,
  photoCol: AnyMySqlColumn,
  updatedAtCol: AnyMySqlColumn,
): SQL<string | null> {
  const prefix = `/api/photos/${kind}/`;
  return sql<string | null>`CASE
    WHEN ${photoCol} IS NULL OR ${photoCol} = '' THEN NULL
    WHEN ${photoCol} LIKE 'data:%' THEN CONCAT(${prefix}, ${idCol}, '?v=', UNIX_TIMESTAMP(${updatedAtCol}))
    ELSE ${photoCol}
  END`;
}
