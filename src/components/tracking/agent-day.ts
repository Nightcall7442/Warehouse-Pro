import type { AgentDay } from "./AgentDayPanel";

/**
 * День агентов, собранный из планов визитов.
 *
 * ── Почему отдельной функцией ───────────────────────────────────────────────
 *
 * Здесь единственное место экрана, где что-то СЧИТАЕТСЯ, а не рисуется:
 * группировка по агенту, доля обхода, порядок снимков. Ошибка тут не видна
 * глазом — она даёт правдоподобное число, — а проверить её на странице целиком
 * значило бы поднимать tRPC, карту и Яндекс ради одного цикла.
 *
 * ── Про агента без плана ────────────────────────────────────────────────────
 *
 * Его в карте нет вовсе, и это не то же самое, что ноль из нуля. Панель на
 * отсутствующей записи говорит «плана на день нет» — это ответ; «0 из 0»
 * выглядело бы как «ничего не сделал», хотя делать было нечего.
 */

/** Строка плана в том виде, в каком её отдаёт agent.getPlans. */
export interface PlanRow {
  id: number;
  agentId?: number | null;
  status: string;
  shopName?: string | null;
  photoUrl?: string | null;
  visitedAt?: Date | string | null;
}

export type DayFacts = Pick<AgentDay, "visited" | "planned" | "photos">;

export function buildAgentDays(
  plans: PlanRow[] | undefined,
  shopFallback: string,
): Map<number, DayFacts> {
  const map = new Map<number, DayFacts>();
  for (const plan of plans ?? []) {
    // Агент у плана обязателен в схеме; ноль здесь — страховка от строки,
    // пришедшей без него, чтобы такие планы собрались в одну кучу, а не
    // разошлись по случайным ключам.
    const agentId = plan.agentId ?? 0;
    const entry = map.get(agentId) ?? { visited: 0, planned: 0, photos: [] };
    entry.planned++;
    if (plan.status === "visited") entry.visited++;
    if (plan.photoUrl) {
      entry.photos.push({
        planId: plan.id,
        url: plan.photoUrl,
        shopName: plan.shopName ?? shopFallback,
        at: plan.visitedAt ? new Date(plan.visitedAt) : null,
      });
    }
    map.set(agentId, entry);
  }

  /*
    Снимки — в порядке визитов: панель читают как ленту дня, и обход, идущий
    задом наперёд, сбивает с толку сильнее, чем кажется.

    Снимок без времени визита уходит в конец: такие остались от планов,
    отмеченных до того, как время начали ставить, и ставить их первыми значило
    бы утверждать, что они самые ранние.
  */
  for (const entry of map.values()) {
    entry.photos.sort((a, b) => {
      if (a.at && b.at) return a.at.getTime() - b.at.getTime();
      if (a.at) return -1;
      if (b.at) return 1;
      return a.planId - b.planId;
    });
  }
  return map;
}
