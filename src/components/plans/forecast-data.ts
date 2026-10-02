import { trpc } from "@/providers/trpc";

/** Прогноз по агенту для чужих таблиц (KPI, «Нормы») — из одного запроса. */
export function useForecastByUser() {
  const q = trpc.salesTarget.forecast.useQuery(undefined, { retry: false });
  const by = new Map((q.data?.agents ?? []).map(a => [a.userId, a]));
  return { forecast: q.data, byUser: by };
}
