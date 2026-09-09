import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { createRouter, adminQuery, superAdminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { rolePermissions, tenants } from "@db/schema";
import { recordAudit } from "./services/audit-log";
import { capabilityMap, forgetCapabilities, type ConfigurableRole } from "./lib/role-permissions";
import { OPERATOR_CAPABILITIES, type OperatorCapability } from "@contracts/constants";

/* ═══════════════════════════════════════════════════════════════════════════
   Кто и что настраивает

   Две пары процедур, а не одна с необязательным tenantId. Директор правит
   ТОЛЬКО свою организацию — id организации он не присылает вовсе, тот берётся
   из его ключа, и подделать его нечем. Суперадмин правит чужую и обязан
   назвать какую. Слепи это в одну ручку с «tenantId необязателен» — и
   пропущенная проверка роли означала бы правку чужих прав.
   ═══════════════════════════════════════════════════════════════════════════ */

const ROLE: ConfigurableRole = "operator";

const capabilitiesInput = z.record(
  z.enum(OPERATOR_CAPABILITIES),
  z.boolean(),
);

async function readAccess(tenantId: number) {
  return {
    tenantId,
    role: ROLE,
    capabilities: await capabilityMap(getDb(), tenantId, ROLE),
  };
}

/**
 * Записать отличия от умолчания.
 *
 * Разрешение — это удаление строки, а не строка со значением true: умолчание
 * «можно» задаёт код, и хранить его копию в базе значит завести второй
 * источник правды, который однажды разойдётся с первым.
 */
async function writeAccess(
  tenantId: number,
  capabilities: Partial<Record<OperatorCapability, boolean>>,
  actor: { id: number; name: string },
) {
  const db = getDb();
  const denied: OperatorCapability[] = [];

  for (const cap of OPERATOR_CAPABILITIES) {
    const value = capabilities[cap];
    if (value === undefined) continue;
    if (value) {
      await db.delete(rolePermissions).where(and(
        eq(rolePermissions.tenantId, tenantId),
        eq(rolePermissions.role, ROLE),
        eq(rolePermissions.capability, cap),
      ));
    } else {
      denied.push(cap);
      await db.insert(rolePermissions)
        .values({ tenantId, role: ROLE, capability: cap, allowed: false, updatedBy: actor.id })
        .onDuplicateKeyUpdate({ set: { allowed: false, updatedBy: actor.id } });
    }
  }

  forgetCapabilities(tenantId, ROLE);

  /*
    Отобранное право — вопрос ответственности: оператор однажды скажет «мне не
    дают удалить заказ», и в журнале должно быть видно, кто это решил и когда.
  */
  await recordAudit(db, {
    tenantId,
    actorId: actor.id,
    actorName: actor.name,
    action: "access.operator",
    targetType: "role",
    targetId: tenantId,
    meta: { role: ROLE, denied },
  });

  return readAccess(tenantId);
}

export const accessRouter = createRouter({
  /** Права оператора в своей организации — читает директор. */
  operatorAccess: adminQuery.query(({ ctx }) => readAccess(ctx.tenant.id)),

  /** Директор меняет права своего оператора. */
  setOperatorAccess: adminQuery
    .input(z.object({ capabilities: capabilitiesInput }))
    .mutation(({ input, ctx }) =>
      writeAccess(ctx.tenant.id, input.capabilities, { id: ctx.user.id, name: ctx.user.name })),

  /** То же для чужой организации — суперадмину, когда арендатор просит в поддержке. */
  operatorAccessFor: superAdminQuery
    .input(z.object({ tenantId: z.number().int().positive() }))
    .query(async ({ input }) => {
      await requireTenant(input.tenantId);
      return readAccess(input.tenantId);
    }),

  setOperatorAccessFor: superAdminQuery
    .input(z.object({ tenantId: z.number().int().positive(), capabilities: capabilitiesInput }))
    .mutation(async ({ input, ctx }) => {
      await requireTenant(input.tenantId);
      return writeAccess(input.tenantId, input.capabilities, { id: ctx.user.id, name: ctx.user.name });
    }),
});

async function requireTenant(tenantId: number) {
  const [tenant] = await getDb().select({ id: tenants.id })
    .from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new TRPCError({ code: "NOT_FOUND", message: "Организация не найдена" });
}
