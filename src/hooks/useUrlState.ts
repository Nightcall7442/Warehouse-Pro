/**
 * Состояние списка, которое живёт в адресе страницы.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Жалоба звучала так: «выбрал магазины с долгом, открыл магазин, нажал назад —
 * и оказался в общем списке». Так и было. Фильтры списка лежали в useState, а
 * при уходе со страницы компонент размонтируется и всё, что в нём было,
 * пропадает. Возврат создаёт его заново — с нуля.
 *
 * Обходной путь в коде уже был: ссылка в карточку магазина руками собирала
 * `?fromPage=…&search=…&city=…&district=…`, а кнопка «назад» в карточке так же
 * руками собирала адрес обратно. Четыре значения из девяти. Остальные пять —
 * долг, агент, территория, сортировка, вид — не переносились, и «магазины с
 * долгом» терялись именно поэтому. Такой список надо помнить пополнять, а
 * забыть его — легко: он и был забыт пять раз.
 *
 * Здесь всё наоборот: значение с самого начала лежит в адресе. Тогда «назад»
 * — обычный шаг назад по истории, и возвращает он ровно тот экран, что был,
 * со всеми фильтрами. Ничего никуда не переносится, потому что переносить
 * нечего.
 *
 * Побочная польза: отфильтрованный список стало можно скопировать ссылкой и
 * послать коллеге, а перезагрузка страницы больше не сбрасывает работу.
 *
 * ── Две тонкости, из-за которых наивная реализация ломается ─────────────────
 *
 * 1. Несколько изменений подряд. В коде есть места вида
 *
 *        setTerritoryFilter(id); setViewMode("list"); setPage(1);
 *
 *    Все три вызова происходят в одном такте и все три видят ОДИН И ТОТ ЖЕ
 *    снимок адреса. Кто записал последним — затёр двух предыдущих. Поэтому
 *    запись идёт через функциональную форму setSearchParams: каждый вызов
 *    получает уже обновлённые параметры.
 *
 * 2. История. Фильтр — это не переход, а уточнение того же экрана. Если писать
 *    их обычным переходом, каждая буква в поиске оставляет запись в истории, и
 *    «назад» придётся жать двадцать раз, разбирая набранное по буквам. Поэтому
 *    replace: true — адрес меняется, запись в истории остаётся одна.
 */
import { useCallback } from "react";
import { useSearchParams } from "react-router";

/** Как значение превращается в строку адреса и обратно. */
export interface UrlCodec<T> {
  parse(raw: string): T;
  /** null — значение по умолчанию, параметр из адреса убирается. */
  format(value: T): string | null;
}

export const urlString: UrlCodec<string> = {
  parse: raw => raw,
  format: v => (v === "" ? null : v),
};

/** Необязательная строка: город, район, идентификатор агента. */
export const urlMaybeString: UrlCodec<string | undefined> = {
  parse: raw => raw || undefined,
  format: v => v ?? null,
};

export const urlNumber: UrlCodec<number | undefined> = {
  parse: raw => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  },
  format: v => (v === undefined ? null : String(v)),
};

/** Страница списка: единица — это «как обычно», её в адресе не видно. */
export const urlPage: UrlCodec<number> = {
  parse: raw => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 1;
  },
  format: v => (v === 1 ? null : String(v)),
};

export const urlBool: UrlCodec<boolean> = {
  parse: raw => raw === "1",
  format: v => (v ? "1" : null),
};

/** Значение из списка допустимых; чужое в адресе игнорируется. */
export function urlEnum<T extends string>(allowed: readonly T[], fallback: T): UrlCodec<T> {
  return {
    parse: raw => (allowed.includes(raw as T) ? (raw as T) : fallback),
    format: v => (v === fallback ? null : v),
  };
}

/**
 * Работает как useState, но хранит значение в адресе страницы.
 *
 * Возвращает ту же пару, что и useState, и принимает как значение, так и
 * функцию от предыдущего — чтобы подставляться в готовый код без переделки
 * вызывающих.
 */
export function useUrlState<T>(
  key: string,
  fallback: T,
  codec: UrlCodec<T>,
): [T, (next: T | ((prev: T) => T)) => void] {
  const [params, setParams] = useSearchParams();

  const raw = params.get(key);
  const value = raw === null ? fallback : codec.parse(raw);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setParams(
        (prev: URLSearchParams) => {
          // Предыдущее значение читается из СВЕЖИХ параметров, а не из
          // замыкания: иначе два изменения в одном такте затрут друг друга.
          const prevRaw = prev.get(key);
          const prevValue = prevRaw === null ? fallback : codec.parse(prevRaw);
          const resolved = typeof next === "function" ? (next as (p: T) => T)(prevValue) : next;

          const out = new URLSearchParams(prev);
          const formatted = codec.format(resolved);
          if (formatted === null) out.delete(key);
          else out.set(key, formatted);
          return out;
        },
        // Уточнение экрана, а не переход: лишних записей в истории быть не
        // должно, иначе «назад» станет разбором каждой набранной буквы.
        { replace: true },
      );
    },
    [key, fallback, codec, setParams],
  );

  return [value, set];
}
