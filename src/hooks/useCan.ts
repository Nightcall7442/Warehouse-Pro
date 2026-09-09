import { useCallback } from "react";
import { trpc } from "@/providers/trpc";
import type { OperatorCapability } from "@contracts/constants";

/**
 * Что этому человеку можно в этой организации.
 *
 * Возможности приезжают вместе с `auth.me` — тем же запросом и с теми же
 * настройками, что у useAuth, поэтому второго обращения к серверу здесь нет:
 * react-query отдаёт уже полученный ответ.
 *
 * Умолчание — РАЗРЕШЕНО, и это важно для первых кадров: пока ответ не пришёл,
 * `can(...)` отвечает true, и кнопки не мигают «появились — исчезли». Настоящая
 * проверка всё равно на сервере (middleware `can` рядом с проверкой роли);
 * здесь мы только не показываем человеку то, чем он не сможет воспользоваться.
 */
export function useCan(): (capability: OperatorCapability) => boolean {
  const { data: user } = trpc.auth.me.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  return useCallback(
    (capability: OperatorCapability) => user?.can?.[capability] !== false,
    [user],
  );
}
