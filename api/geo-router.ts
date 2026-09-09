import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { createRouter, supervisorQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { users } from "@db/schema";
import { buildGeoDay } from "./services/visit-geo";

/* ═══════════════════════════════════════════════════════════════════════════
   Геоаналитика.

   Отдельным роутером, а не строкой в agent-router: тот и так перевалил за
   тысячу строк и держит всё подряд — планы, заказы, магазины, координаты. А у
   этого раздела будет продолжение (неделя, территория, тепловая карта), и
   пусть оно растёт в своём файле, а не в общей куче.
   ═══════════════════════════════════════════════════════════════════════════ */
export const geoRouter = createRouter({
  /**
   * Как прошёл день у одного сотрудника.
   *
   * Шаги визита восстанавливаются из уже пишущихся координат, а не из кнопок
   * «пришёл / ушёл»: кнопки живут в мобильном приложении, оно в другом
   * репозитории, и ручка под них была бы очередной написанной и никем не
   * вызываемой. Разбор пингов работает уже сегодня — и агент не может нажать
   * «пришёл», сидя дома.
   */
  day: supervisorQuery
    .input(z.object({
      agentId: z.number().int().positive(),
      day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "День задаётся как ГГГГ-ММ-ДД"),
    }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      // Свой сотрудник: id приходит из запроса, и без проверки экран показал бы
      // маршрут человека из чужой организации.
      const [agent] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.id, input.agentId), eq(users.tenantId, ctx.tenant.id))).limit(1);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND", message: "Сотрудник не найден в вашей организации" });

      return buildGeoDay(db, ctx.tenant.id, input.agentId, input.day);
    }),
});
