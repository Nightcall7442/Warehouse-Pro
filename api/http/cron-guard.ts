import { env } from "../lib/env";
import { safeEqual } from "../lib/safe-compare";

/*
  Ключ крон-ручек — только заголовком x-cron-secret.

  Приём из адреса (?secret=) снят: адрес целиком оседает в журналах
  обращений на каждом узле по дороге — прокси, сеть доставки, Loki, — и
  живёт там дольше, чем сам ключ. Заголовок в журналы доступа не попадает.
  Внутренний планировщик (cron/scheduler.ts) эти ручки не зовёт — они для
  запуска руками и внешнего расписания; curl -H "x-cron-secret: …".
*/
export function cronDenied(c: { req: { header: (k: string) => string | undefined } }): string | null {
  if (!env.cronSecret) return "Cron endpoint not configured";
  const secret = c.req.header("x-cron-secret");
  return secret && safeEqual(secret, env.cronSecret) ? null : "Unauthorized";
}
