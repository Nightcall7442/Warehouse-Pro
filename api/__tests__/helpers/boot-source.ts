import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
  boot.ts разнесён: вход/выход — api/http/auth.ts, резервные копии —
  api/http/backup.ts, мост tRPC — api/http/trpc-adapter.ts. Стражи, читающие
  загрузчик как текст, берут всё одним куском отсюда.
*/
export const BOOT_FILES = ["boot.ts", "http/auth.ts", "http/backup.ts", "http/trpc-adapter.ts"];

export function bootSource(): string {
  return BOOT_FILES
    .map(f => readFileSync(join(process.cwd(), "api", ...f.split("/")), "utf8").replace(/\r\n/g, "\n"))
    .join("\n");
}
