import { and, eq } from "drizzle-orm";
import { rolePermissions } from "@db/schema";
import { getDb } from "../queries/connection";
import { cache } from "./cache";
import { logger } from "./logger";
import { OPERATOR_CAPABILITIES, allCapabilities, type OperatorCapability } from "@contracts/constants";

type Db = ReturnType<typeof getDb>;

/* ═══════════════════════════════════════════════════════════════════════════
   Права роли внутри организации.

   Зашитые в middleware роли одинаковы для всех арендаторов. Эта надстройка
   позволяет ОТОБРАТЬ у роли отдельные действия в отдельной организации —
   добавить она ничего не может, и это принципиально: роль остаётся потолком,
   настройка только опускает пол.

   Хранятся только отличия. Нет строки — значит можно, как и было до этой
   надстройки. Поэтому выкладка не меняет поведение ни одному арендатору.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Роли, которым вообще можно что-то настраивать. Директора здесь нет и не будет. */
export const CONFIGURABLE_ROLES = ["operator"] as const;
export type ConfigurableRole = typeof CONFIGURABLE_ROLES[number];

/** Полминуты: настройку меняют раз в месяц, а читают на каждом запросе. */
const TTL_MS = 30_000;

const keyOf = (tenantId: number, role: string) => `perm:${tenantId}:${role}`;

/**
 * Что этой роли можно в этой организации.
 *
 * Всегда полный набор возможностей — не «список запретов»: вызывающий читает
 * `map[cap] === false`, и отсутствие ключа никогда не значит «нельзя».
 */
export async function capabilityMap(
  db: Db,
  tenantId: number,
  role: ConfigurableRole,
): Promise<Record<OperatorCapability, boolean>> {
  const cached = cache.get<Record<OperatorCapability, boolean>>(keyOf(tenantId, role));
  if (cached) return cached;

  /*
    Не прочиталось — считаем, что не отбирали ничего.

    Это надстройка НАД ролью, а не сама роль: роль проверена звеном выше и
    держится в любом случае, здесь лишь опускается пол внутри неё. Отвечать
    отказом на сбое означало бы остановить работу склада целиком — и соврать
    человеку текстом «вам это закрыли в организации», хотя никто ничего не
    закрывал. Поэтому сбой отдаёт умолчание и остаётся в журнале.
  */
  let rows: Array<{ capability: string; allowed: boolean }> = [];
  try {
    rows = await db.select({
      capability: rolePermissions.capability,
      allowed:    rolePermissions.allowed,
    }).from(rolePermissions)
      .where(and(eq(rolePermissions.tenantId, tenantId), eq(rolePermissions.role, role)));
  } catch (e) {
    logger.warn("не прочитал настройку прав роли — работаю по умолчанию", {
      tenantId, role, error: e instanceof Error ? e.message : String(e),
    });
    return allCapabilities();
  }

  const map = allCapabilities();
  for (const row of rows) {
    // Мусорное имя в базе (переименовали возможность, строка осталась) не
    // должно попадать в ответ: набор ключей задаёт код, а не содержимое базы.
    if ((OPERATOR_CAPABILITIES as readonly string[]).includes(row.capability)) {
      map[row.capability as OperatorCapability] = !!row.allowed;
    }
  }

  cache.set(keyOf(tenantId, role), map, TTL_MS);
  return map;
}

/** Забыть настройку организации — сразу после её изменения. */
export function forgetCapabilities(tenantId: number, role: ConfigurableRole) {
  cache.invalidate(keyOf(tenantId, role));
}

/**
 * Что можно ЭТОМУ человеку.
 *
 * Роли, для которых настройки нет (директор, агент, супервайзер), получают
 * полный набор: надстройка ничего не отбирает у тех, о ком её не спрашивали.
 */
export async function capabilitiesOf(
  db: Db,
  tenantId: number,
  role: string,
): Promise<Record<OperatorCapability, boolean>> {
  if (!(CONFIGURABLE_ROLES as readonly string[]).includes(role)) return allCapabilities();
  return capabilityMap(db, tenantId, role as ConfigurableRole);
}
