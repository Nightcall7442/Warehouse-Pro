import { useEffect } from "react";

/**
 * Возвращает странице кликабельность, когда Radix забыл это сделать сам.
 *
 * Radix (Select, Dialog, Sheet, DropdownMenu) на время открытого оверлея ставит
 * на <body> инлайновый `pointer-events: none`, чтобы клики не проходили мимо
 * всплывающего слоя, и снимает его при закрытии. Снятие теряется, если оверлей
 * закрывается в тот же момент, когда открывается что-то другое — а это ровно
 * наш случай: выбор статуса в деталях заказа закрывает Select и тут же
 * открывает подтверждение.
 *
 * Последствие несоразмерно причине. `none` на <body> убивает не только диалог,
 * а ВСЮ страницу: не нажимается ни «Изменить», ни «Отмена», не назначается
 * курьер, не работает ни одна кнопка — и так до перезагрузки. Пользователь
 * видит просто «ничего не нажимается», без единой ошибки в консоли.
 *
 * Точечные обходы уже расползались по коду (см. pointer-events-auto в
 * OrderSlideOver и в ConfirmDialog) — каждый лечит свой экран и ничего не
 * говорит о соседних. Здесь лечится причина: следим за атрибутом style у body
 * и, если `none` стоит, а открытых оверлеев Radix в DOM нет, — снимаем.
 *
 * Проверка «оверлеев нет» намеренно широкая: пока на странице есть хоть один
 * элемент Radix в открытом состоянии, стиль не трогаем — иначе можно вернуть
 * клики фону под настоящим модальным окном.
 */

/** Есть ли на странице хоть один открытый слой Radix. */
function hasOpenRadixLayer(): boolean {
  return document.querySelector(
    "[data-radix-popper-content-wrapper], [data-radix-portal], [data-state='open'][role='dialog'], [data-state='open'][role='listbox'], [data-state='open'][data-radix-menu-content]",
  ) !== null;
}

export function RadixPointerEventsGuard() {
  useEffect(() => {
    const release = () => {
      if (document.body.style.pointerEvents !== "none") return;
      if (hasOpenRadixLayer()) return;
      document.body.style.pointerEvents = "";
    };

    // Проверяем после кадра отрисовки: Radix снимает стиль сам в момент
    // закрытия, и опережать его не нужно — нас интересует только тот случай,
    // когда он этого уже не сделает.
    let frame = 0;
    const scheduleRelease = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => requestAnimationFrame(release));
    };

    // Стиль мог залипнуть ДО того, как защита смонтировалась: наблюдатель видит
    // только изменения, а уже стоящий `none` изменением не является.
    scheduleRelease();

    const observer = new MutationObserver(scheduleRelease);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["style"],
      // Слои Radix монтируются прямыми детьми <body>, поэтому их исчезновение —
      // это и есть момент «открытых слоёв больше нет». Без childList уход слоя
      // остался бы незамеченным, если стиль при этом не переписывался.
      // Намеренно без subtree: иначе колбэк дёргался бы на каждую перерисовку.
      childList: true,
    });

    // Клик — последний рубеж: если стиль всё-таки залип, а человек тычет в
    // мёртвую страницу, освобождаем её на первом же нажатии.
    document.addEventListener("pointerdown", scheduleRelease, true);

    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", scheduleRelease, true);
      cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
