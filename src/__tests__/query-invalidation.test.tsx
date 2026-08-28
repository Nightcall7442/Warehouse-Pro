// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, waitFor, cleanup } from "@testing-library/react";
import { queryClient } from "@/providers/trpc.client";

/**
 * Одна проверка, которая ловит целый класс ошибок «данные не обновились».
 *
 * Сценарий из жизни: пользователь добавил магазин, открыл окно нового заказа —
 * магазина там нет, помогает только Ctrl+Shift+R. Мутация честно звала
 * invalidate, но запрос окна в этот момент был размонтирован, а настройка
 * refetchOnMount: false означает «не обновлять при монтировании даже
 * устаревшее». Запрос возвращался к жизни со старыми данными и не обновлялся
 * уже никогда — до перезагрузки, которая выбрасывала кэш целиком.
 *
 * Ошибка была не в магазинах: так вело себя любое окно, открытое после
 * изменения данных. Поэтому проверяется сама настройка клиента, а не
 * конкретный экран.
 */

afterEach(() => cleanup());

async function mountInvalidateRemount(client: QueryClient) {
  const fetcher = vi.fn(async () => ["магазин 1"]);

  function ShopList() {
    const { data } = useQuery({ queryKey: ["магазины"], queryFn: fetcher });
    return <div>{(data ?? []).join(" | ")}</div>;
  }
  const wrap = (
    <QueryClientProvider client={client}><ShopList /></QueryClientProvider>
  );

  const first = render(wrap);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  first.unmount();                                  // окно закрыли

  await client.invalidateQueries({ queryKey: ["магазины"] });  // добавили магазин
  fetcher.mockResolvedValue(["магазин 1", "магазин 2"]);

  const second = render(wrap);                      // окно открыли снова
  await waitFor(() => expect(second.container.textContent).toContain("магазин 2"), { timeout: 1000 });

  return fetcher.mock.calls.length;
}

describe("настройки кэша запросов", () => {
  it("после invalidate заново открытый экран показывает свежие данные", async () => {
    // Тот самый клиент, что работает в приложении, а не собранный тут по месту:
    // иначе проверялась бы теория, а не настройка, с которой живут люди.
    expect(await mountInvalidateRemount(queryClient)).toBe(2);
  });

  it("refetchOnMount: false воспроизводит исходную ошибку", async () => {
    // Обратная сторона: показывает, что проверка выше действительно про эту
    // настройку, а не проходит сама по себе.
    const broken = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnMount: false, refetchOnWindowFocus: false } },
    });
    await expect(mountInvalidateRemount(broken)).rejects.toThrow();
  });
});
