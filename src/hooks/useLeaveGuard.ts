import { useCallback, useContext, useEffect, useRef } from "react";
import { UNSAFE_NavigationContext, useBeforeUnload } from "react-router";

/**
 * Уход со страницы с несохранёнными правками — спросить.
 *
 * Документ, набранный руками (сорок строк «пришло» при разгрузке, заказ
 * поставщику на тридцать позиций), пропадал от «← Назад», пункта меню или
 * перезагрузки. useBlocker требует data router, а у нас BrowserRouter —
 * поэтому перехвачен navigator.push: через него идут и ссылки, и navigate()
 * меню. Перезагрузка и закрытие вкладки — через beforeunload. Переход с
 * replace (страница сама открывает только что сохранённое) не спрашивает.
 *
 * ask — вопрос человеку (true — уйти) или null, когда правок нет. Берётся
 * свежий на каждой отрисовке: правки появляются после подписки.
 *
 * Возвращает release(): снять вопрос перед уходом, который страница делает
 * сама, — после удаления документа спрашивать «уйти без сохранения?» незачем.
 *
 * Было внутри ArrivalEditor; вынесено, когда тот же вопрос понадобился
 * экрану заказа поставщику.
 */
export function useLeaveGuard(ask: (() => Promise<boolean>) | null): () => void {
  const askRef = useRef<(() => Promise<boolean>) | null>(ask);
  useEffect(() => { askRef.current = ask; });

  const { navigator } = useContext(UNSAFE_NavigationContext);
  /* eslint-disable react-hooks/immutability -- navigator это history роутера, а не состояние React */
  useEffect(() => {
    const push = navigator.push;
    navigator.push = (...a: Parameters<typeof push>) => {
      const q = askRef.current;
      if (!q) return push(...a);
      void q().then(ok => { if (ok) push(...a); });
    };
    return () => { navigator.push = push; };
  }, [navigator]);
  /* eslint-enable react-hooks/immutability */
  useBeforeUnload(useCallback((e: BeforeUnloadEvent) => { if (askRef.current) e.preventDefault(); }, []));

  return useCallback(() => { askRef.current = null; }, []);
}
