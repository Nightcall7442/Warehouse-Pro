// @vitest-environment jsdom
/**
 * Экран поддержки обязан отрисоваться.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Владелец прислал снимок: у арендатора на экране поддержки вместо разговора
 * стоит «Nimadir noto'g'ri ketdi» — перехватчик ошибок. В журнале сервера при
 * этом пусто: ответы приходили нормально, падала отрисовка.
 *
 * Ветку «не тот тариф» я видел своими глазами и она рисуется. Значит ломается
 * вторая — та, которую видит только организация на Exclusive, то есть ровно та,
 * которую нельзя было проверить, не будучи клиентом.
 *
 * ── Отсюда проверка ─────────────────────────────────────────────────────────
 *
 * Обе ветки рисуются здесь с настоящими по форме данными. Экран, доступный
 * только части клиентов, обязан иметь проверку: иначе о поломке узнаёшь по
 * фотографии чужого монитора.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const state: {
  available: boolean;
  messages: Array<Record<string, unknown>>;
  unread: number;
} = { available: true, messages: [], unread: 0 };

vi.mock("@/providers/trpc", () => {
  const nothing = () => {};
  const mutation = () => ({ mutate: nothing, isPending: false });
  return {
    trpc: {
      useUtils: () => ({ support: { thread: { invalidate: nothing }, unread: { invalidate: nothing } } }),
      support: {
        thread:   { useQuery: () => ({ data: { ...state, hasMore: false }, isLoading: false }) },
        send:     { useMutation: mutation },
        markRead: { useMutation: mutation },
      },
    },
  };
});
vi.mock("@/lib/toast", () => ({ notify: { error: () => {}, success: () => {} } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { name: "Директор" } }) }));
vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }) }));

import Support from "@/pages/Support";

beforeEach(() => {
  cleanup();
  // jsdom не умеет прокрутку. Это его пробел, а не поведение экрана.
  Element.prototype.scrollIntoView = vi.fn();
  state.available = true;
  state.messages = [];
  state.unread = 0;
});

describe("экран поддержки", () => {
  it("рисует пустой разговор", () => {
    render(<Support />);
    expect(screen.getByText(/Поддержка/)).toBeTruthy();
    expect(screen.getByPlaceholderText(/Опишите/)).toBeTruthy();
  });

  it("рисует переписку", () => {
    /*
      Форма ровно та, что отдаёт сервер: дата приходит объектом Date через
      superjson, имя автора у сообщения пользователя пустое.
    */
    state.messages = [
      { id: 1, fromPlatform: false, authorName: null, body: "Не грузятся фото", createdAt: new Date("2026-09-08T10:00:00Z"), readAt: null },
      { id: 2, fromPlatform: true, authorName: "Поддержка", body: "Уже смотрим", createdAt: new Date("2026-09-08T10:05:00Z"), readAt: null },
    ];
    render(<Support />);
    expect(screen.getByText("Не грузятся фото")).toBeTruthy();
    expect(screen.getByText("Уже смотрим")).toBeTruthy();
    // Имя ответившего стоит над его репликой — «Поддержка» встречается и в
    // заголовке экрана, поэтому ищем именно подпись автора.
    expect(screen.getAllByText("Поддержка").length).toBeGreaterThan(1);
  });

  it("переживает дату строкой", () => {
    // JSON без superjson отдаёт дату строкой. Экран не должен от этого падать:
    // разница незаметна до тех пор, пока не окажется, что она есть.
    state.messages = [
      { id: 3, fromPlatform: true, authorName: "Поддержка", body: "Готово", createdAt: "2026-09-08T10:05:00.000Z", readAt: null },
    ];
    render(<Support />);
    expect(screen.getByText("Готово")).toBeTruthy();
  });

  it("на чужом тарифе показывает, что даёт Exclusive", () => {
    state.available = false;
    render(<Support />);
    expect(screen.getByText(/Прямая линия/)).toBeTruthy();
    // Не отказ и не пустой экран: человек должен понять, как получить нужное.
    expect(screen.getByText(/Exclusive/)).toBeTruthy();
  });
});
