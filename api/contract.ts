import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "./router";

/*
  Типы входов и выходов всех процедур — для клиентов вне этого репозитория.

  Веб берёт их через trpc.createTRPCReact<AppRouter>. Мобилка (отдельный
  репозиторий, axios строками) — через scripts/mobile-contract.mjs: он
  генерирует проверку «ответ сервера присваиваем тому, что ждёт api.ts»
  и гоняет tsc в CI обоих репозиториев.
*/
export type RouterInputs = inferRouterInputs<AppRouter>;
export type RouterOutputs = inferRouterOutputs<AppRouter>;
