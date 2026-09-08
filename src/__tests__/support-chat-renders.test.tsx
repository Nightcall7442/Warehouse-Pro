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
  closedAt: Date | null;
  closedBy: string | null;
  purgeAt: Date | null;
} = { available: true, messages: [], unread: 0, closedAt: null, closedBy: null, purgeAt: null };

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
        close:    { useMutation: mutation },
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
  state.closedAt = null;
  state.closedBy = null;
  state.purgeAt = null;
});

/** Сегодняшнее время — чтобы разделитель суток был предсказуем. */
function todayAt(h: number, m: number): Date {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

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
      { id: 1, fromPlatform: false, authorName: null, body: "Не грузятся фото", createdAt: todayAt(10, 0), readAt: null },
      { id: 2, fromPlatform: true, authorName: "Поддержка", body: "Уже смотрим", createdAt: todayAt(10, 5), readAt: null },
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
    expect(screen.getAllByText(/Exclusive/).length).toBeGreaterThan(0);
    // И к кому идти: тариф меняет руководитель, остальным кнопка вела бы на
    // экран, закрытый по роли.
    expect(screen.getByText(/руководитель/)).toBeTruthy();
  });
});

/*
  Ниже — то, из-за чего экран и переписывался. Владелец сказал: «выглядит очень
  дёшево и просто». Дешевизна была не в цветах: время висело под каждой
  репликой подряд, а границы суток не показывались вовсе.
*/
describe("разговор виден как разговор", () => {
  it("подряд идущие реплики одной стороны подписаны временем один раз", () => {
    state.messages = [
      { id: 1, fromPlatform: false, authorName: null, body: "Первое", createdAt: todayAt(10, 0), readAt: null },
      { id: 2, fromPlatform: false, authorName: null, body: "И ещё", createdAt: todayAt(10, 1), readAt: null },
      { id: 3, fromPlatform: false, authorName: null, body: "И вот это", createdAt: todayAt(10, 2), readAt: null },
    ];
    render(<Support />);

    // Три реплики — одна подпись времени. Раньше их было три одинаковых.
    const stamps = screen.getAllByText(/^\d{2}:\d{2}$/);
    expect(stamps).toHaveLength(1);
    expect(screen.getByText("Первое")).toBeTruthy();
    expect(screen.getByText("И вот это")).toBeTruthy();
  });

  it("разные сутки разделены заголовком", () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    yesterday.setHours(18, 0, 0, 0);
    state.messages = [
      { id: 1, fromPlatform: false, authorName: null, body: "Вчерашнее", createdAt: yesterday, readAt: null },
      { id: 2, fromPlatform: true, authorName: "Поддержка", body: "Сегодняшнее", createdAt: todayAt(9, 0), readAt: null },
    ];
    render(<Support />);
    expect(screen.getByText("Вчера")).toBeTruthy();
    expect(screen.getByText("Сегодня")).toBeTruthy();
  });

  it("ждём ответа, только когда последнее слово наше", () => {
    // Состояние настоящее и выводится из переписки. Выдумывать «поддержка в
    // сети» не из чего, и такая надпись была бы враньём.
    state.messages = [
      { id: 1, fromPlatform: false, authorName: null, body: "Вопрос", createdAt: todayAt(10, 0), readAt: null },
    ];
    const { unmount } = render(<Support />);
    expect(screen.getByText(/Ждём ответа/)).toBeTruthy();
    unmount();

    state.messages = [
      ...state.messages,
      { id: 2, fromPlatform: true, authorName: "Поддержка", body: "Ответ", createdAt: todayAt(10, 4), readAt: null },
    ];
    render(<Support />);
    expect(screen.queryByText(/Ждём ответа/)).toBeNull();
  });

  it("пустой разговор предлагает, с чего начать", () => {
    render(<Support />);
    expect(screen.getByText(/Чем помочь/)).toBeTruthy();
    // Подсказки подставляют тему в поле, а не отправляют её.
    expect(screen.getByText("Вопрос по оплате")).toBeTruthy();
  });
});

/*
  Переписка не лежит у нас вечно: завершённый разговор через неделю стирается.
  Дата стирания обязана быть на экране — тихое исчезновение переписки человек
  прочтёт как пропажу, а не как обещанное.
*/
describe("завершённый разговор", () => {
  beforeEach(() => {
    state.messages = [
      { id: 1, fromPlatform: false, authorName: null, body: "Вопрос", createdAt: todayAt(10, 0), readAt: null },
    ];
    state.closedAt = todayAt(11, 0);
    state.purgeAt = new Date(todayAt(11, 0).getTime() + 7 * 86_400_000);
  });

  it("говорит, когда переписка будет удалена и как это отменить", () => {
    state.closedBy = "client";
    render(<Support />);
    expect(screen.getByText(/Вы завершили разговор/)).toBeTruthy();
    expect(screen.getByText(/будет удалена/)).toBeTruthy();
    // Отменить можно, просто написав снова, — и это должно быть сказано.
    expect(screen.getByText(/Напишите ещё раз/)).toBeTruthy();
  });

  it("различает, кто завершил", () => {
    state.closedBy = "silence";
    render(<Support />);
    expect(screen.getByText(/закрылся сам/)).toBeTruthy();
  });

  it("поле ввода остаётся — экран не запирается", () => {
    state.closedBy = "platform";
    render(<Support />);
    // Написать можно и в завершённый: это и есть возврат к разговору.
    expect(screen.getByPlaceholderText(/Опишите/)).toBeTruthy();
    // А кнопки «Завершить» больше нет — завершать нечего.
    expect(screen.queryByText("Завершить")).toBeNull();
  });

  it("у идущего разговора кнопка «Завершить» есть", () => {
    state.closedAt = null;
    state.purgeAt = null;
    render(<Support />);
    expect(screen.getByText("Завершить")).toBeTruthy();
  });
});
