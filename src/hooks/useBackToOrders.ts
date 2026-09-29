import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";

/*
  «Назад» из карточки заказа — к тому же списку, с которого в неё ушли.

  ── Что было ────────────────────────────────────────────────────────────────

  С 18.09.2026 заказ открывается страницей, а «Назад» в ней вёл на голый
  /orders. Вкладка, «Ждут расчёта», агенты, поиск, страница, даты, чипы, вид
  — всё сбрасывалось после каждой карточки. Оператор открывает их 60–100 в
  день и каждый раз настраивал список заново.

  ── Что теперь ──────────────────────────────────────────────────────────────

  Список держит своё состояние в адресе (pages/Orders.tsx, hooks/useUrlState).
  Пришли из списка — шаг назад по истории: браузер вернёт ровно тот адрес, со
  всеми фильтрами и страницей. Прокрутку такой возврат не сбрасывает:
  ScrollToTop поднимает страницу только на push (по location.key), а шаг
  назад — pop.

  Пришли не из списка — по ссылке из мессенджера, из карточки магазина, из
  уведомления или обновили страницу в новой вкладке — шага назад в список
  нет, а увести человека кнопкой «Назад» из приложения или в чужой экран
  нельзя. Тогда — в /orders с последним списком, который смотрели в этой
  вкладке.

  Откуда пришли, знает сам переход: список кладёт в него пометку
  FROM_ORDERS_LIST. Проверка «ключ не default», как в карточке магазина, здесь
  не годится: заказ открывают и из магазина, и из поиска, и шаг назад увёл
  бы туда, а не в список.
*/

const LAST_LIST = "orders_list_search";

/** Состояние перехода «из списка в карточку». */
export const FROM_ORDERS_LIST = { fromOrdersList: true } as const;

/** Список запоминает свой адрес — для возврата в него не шагом назад. */
export function rememberOrdersList(search: string): void {
  const params = new URLSearchParams(search);
  // Окно «Новый заказ» (?new=1) — разовое действие, а не часть списка:
  // возврат из карточки не должен открывать его снова.
  params.delete("new");
  const s = params.toString();
  // Хранилище может быть недоступно (приватное окно) — тогда вернёмся в /orders.
  try { sessionStorage.setItem(LAST_LIST, s ? `?${s}` : ""); } catch { /* не сохранилось — не беда */ }
}

/** Последний список этой вкладки, иначе — список как по умолчанию. */
export function lastOrdersList(): string {
  let saved: string | null = null;
  try { saved = sessionStorage.getItem(LAST_LIST); } catch { /* нет хранилища */ }
  return saved && saved.startsWith("?") ? `/orders${saved}` : "/orders";
}

export function useBackToOrders(): () => void {
  const location = useLocation();
  const navigate = useNavigate();
  const fromList = (location.state as { fromOrdersList?: unknown } | null)?.fromOrdersList === true;
  return useCallback(() => {
    if (fromList) navigate(-1);
    else navigate(lastOrdersList());
  }, [fromList, navigate]);
}
