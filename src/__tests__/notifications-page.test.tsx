// @vitest-environment jsdom
/**
 * Страница уведомлений.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Страница брала первые пятьдесят записей и фильтровала их у себя. На ленте,
 * где заказов много, а платежей мало, вкладка «Платежи» писала «нет уведомлений
 * в этой категории» — при том что они были, просто не попали в первые
 * пятьдесят. Отбор, который делает не тот, кто владеет данными, врёт ровно на
 * границе страницы, то есть незаметно и всегда в одну сторону.
 *
 * Прочитать, не открывая, было нельзя: метку снимал только переход по ссылке.
 * Разобрать десять уведомлений значило десять раз уйти со страницы и вернуться.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Row = { id: number; type: string; title: string; message: string | null; isRead: boolean; link: string | null; createdAt: Date };

const state: {
  items: Row[];
  hasMore: boolean;
  counts: { unread: number; byType: Record<string, number> };
  lastQuery: Record<string, unknown> | undefined;
} = { items: [], hasMore: false, counts: { unread: 0, byType: {} }, lastQuery: undefined };

const marked: number[] = [];
const navigated: string[] = [];

vi.mock("@/providers/trpc", () => {
  const nothing = () => {};
  return {
    trpc: {
      useUtils: () => ({
        notification: {
          list: { invalidate: nothing },
          counts: { invalidate: nothing },
          unreadCount: { invalidate: nothing },
        },
      }),
      notification: {
        list: {
          useInfiniteQuery: (input: Record<string, unknown>) => {
            state.lastQuery = input;
            return {
              data: { pages: [{ items: state.items, hasMore: state.hasMore }] },
              isLoading: false,
              fetchNextPage: nothing,
              hasNextPage: state.hasMore,
              isFetchingNextPage: false,
            };
          },
        },
        counts: { useQuery: () => ({ data: state.counts }) },
        markRead: { useMutation: () => ({ mutate: (v: { id: number }) => marked.push(v.id), isPending: false }) },
        markAllRead: { useMutation: () => ({ mutate: nothing, isPending: false }) },
      },
    },
  };
});
vi.mock("@/i18n", () => ({ useLang: () => ({ lang: "ru" }) }));
vi.mock("react-router", () => ({ useNavigate: () => (to: string) => navigated.push(to) }));

import Notifications from "@/pages/Notifications";

const now = () => new Date();

beforeEach(() => {
  cleanup();
  marked.length = 0;
  navigated.length = 0;
  state.items = [];
  state.hasMore = false;
  state.counts = { unread: 0, byType: {} };
  state.lastQuery = undefined;
});

describe("лента", () => {
  it("рисует уведомления", () => {
    state.items = [
      { id: 2, type: "order", title: "Новый заказ №14", message: "Мега Дистрибьюшн — 312 000 сум", isRead: false, link: "/orders/14", createdAt: now() },
      { id: 1, type: "stock", title: "Низкий остаток", message: "400мл Cherry — 0 шт.", isRead: true, link: null, createdAt: now() },
    ];
    render(<Notifications />);
    expect(screen.getByText("Новый заказ №14")).toBeTruthy();
    expect(screen.getByText("Низкий остаток")).toBeTruthy();
  });

  it("вкладки показывают, сколько НЕПРОЧИТАННОГО каждого рода", () => {
    /*
      Число «всего» здесь бесполезно: оно не подсказывает, куда идти. Вкладка
      без числа и вкладка, где ничего не ждёт, обязаны выглядеть по-разному —
      разница как раз в этом.
    */
    state.counts = { unread: 5, byType: { order: 3, stock: 2 } };
    render(<Notifications />);
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText(/5 ждут внимания/)).toBeTruthy();
  });

  it("отбор по виду уходит на сервер, а не режется на экране", () => {
    // Тот самый случай: платежей нет в первых пятидесяти — значит, при отборе
    // на экране их не будет никогда, сколько ни листай.
    render(<Notifications />);
    expect(state.lastQuery).toMatchObject({ type: undefined });

    fireEvent.click(screen.getByText("Платежи"));
    expect(state.lastQuery).toMatchObject({ type: "payment" });
  });

  it("«только непрочитанные» тоже спрашивается у сервера", () => {
    render(<Notifications />);
    fireEvent.click(screen.getByText("Непрочитанные"));
    expect(state.lastQuery).toMatchObject({ unreadOnly: true });
  });
});

describe("разбор ленты", () => {
  beforeEach(() => {
    state.items = [
      { id: 2, type: "order", title: "Новый заказ №14", message: null, isRead: false, link: "/orders/14", createdAt: now() },
    ];
  });

  it("прочитать можно, не уходя со страницы", () => {
    render(<Notifications />);
    fireEvent.click(screen.getByLabelText("Отметить прочитанным"));

    expect(marked).toEqual([2]);
    // Главное: со страницы не ушли. Раньше метку снимал только переход.
    expect(navigated).toEqual([]);
  });

  it("нажатие на строку открывает и отмечает прочитанным", () => {
    render(<Notifications />);
    fireEvent.click(screen.getByText("Новый заказ №14"));

    expect(marked).toEqual([2]);
    expect(navigated).toEqual(["/orders/14"]);
  });

  it("у прочитанного кнопки «прочитать» нет", () => {
    state.items = [{ ...state.items[0], isRead: true }];
    render(<Notifications />);
    expect(screen.queryByLabelText("Отметить прочитанным")).toBeNull();
  });
});

describe("пустота бывает разная", () => {
  it("совсем ничего", () => {
    render(<Notifications />);
    expect(screen.getByText("Уведомлений нет")).toBeTruthy();
  });

  it("пусто в выбранном разделе — и сказано, как это снять", () => {
    // «Уведомлений нет» на отобранной вкладке отправляет искать поломку вместо
    // того, чтобы снять отбор.
    render(<Notifications />);
    fireEvent.click(screen.getByText("Платежи"));
    expect(screen.getByText("В этом разделе пусто")).toBeTruthy();
    expect(screen.getByText(/Выберите «Все»/)).toBeTruthy();
  });

  it("непрочитанного нет — это не «нет уведомлений»", () => {
    render(<Notifications />);
    fireEvent.click(screen.getByText("Непрочитанные"));
    expect(screen.getByText("Непрочитанного нет")).toBeTruthy();
  });
});

describe("цвета берутся из системы оформления", () => {
  it("в рамках и разделителях нет вписанных числом цветов", () => {
    /*
      Здесь стояли `#f0f3f8` у разделителя строк и `#c7c9f8` у рамки выбранной
      вкладки — оба из отменённой сине-серой палитры и оба вписаны числом. На
      светлой теме их почти не видно, на тёмной это светлые полосы поперёк
      карточки: цвет, заданный числом, не знает про тему.
    */
    const raw = readFileSync(join(__dirname, "..", "pages", "Notifications.tsx"), "utf8");
    // Пояснения выше сами называют оба прежних цвета — без снятия комментариев
    // проверка ловила бы собственный рассказ о том, что чинит.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    const hardcoded = [...src.matchAll(/border[A-Za-z]*:\s*"[^"]*#[0-9a-fA-F]{3,8}/g)].map(m => m[0]);
    expect(hardcoded).toEqual([]);
    expect(src).not.toContain("#f0f3f8");
    expect(src).not.toContain("#c7c9f8");
  });
});
