import { animate, stagger, utils } from "animejs";

/* ═══════════════════════════════════════════════════════════════════════════
   ДВИЖЕНИЕ НА ЭКРАНЕ СЛЕЖЕНИЯ

   Здесь оно решает задачу, а не украшает. Экран живой: точки приходят каждые
   тридцать секунд, числа меняются на глазах, и без движения человек не видит,
   ЧТО именно изменилось — он видит другой экран.

   ── Чем это отличается от лендинга ────────────────────────────────────────

   На лендинге движение начинается, когда раздел попал в поле зрения:
   посетитель разворачивает лист сверху вниз. Здесь смотреть некуда — экран
   уже открыт, — и повод у движения другой: ПРИШЛИ НОВЫЕ ДАННЫЕ. Поэтому
   наблюдателя пересечений тут нет, а есть вызовы из эффектов.

   ── Правила ───────────────────────────────────────────────────────────────

   • При prefers-reduced-motion значение ставится сразу, без промежуточных
     кадров. Не «быстрее», а именно сразу: у кого укачивание, тому и короткая
     анимация мешает.

   • Начальное состояние выставляется ИЗ JS. Спрячь мы что-нибудь стилями —
     одна ошибка в сборке, и супервайзер смотрит на пустую панель вместо
     списка агентов.

   • Ничего не анимируется дольше секунды. Это рабочий экран, за ним следят, а
     не любуются; долгое движение здесь — это задержка ответа на вопрос «где
     мои люди».
   ═══════════════════════════════════════════════════════════════════════════ */

/** Укачивание важнее впечатления: значение ставится сразу. */
export const reducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/**
 * Число досчитывается до нового значения.
 *
 * От ТЕКУЩЕГО, а не от нуля: на живом экране «7 из 9» превращается в «8 из 9»,
 * и пересчёт от нуля выглядел бы как обнуление данных. От нуля считают один
 * раз — при первом появлении, и об этом просит сам вызывающий, передав from.
 */
export function countTo(
  el: HTMLElement | null,
  to: number,
  format: (n: number) => string = n => String(Math.round(n)),
  from?: number,
): void {
  if (!el) return;
  const start = from ?? Number(el.dataset.value ?? 0);
  el.dataset.value = String(to);

  if (reducedMotion() || start === to) {
    el.textContent = format(to);
    return;
  }
  const box = { v: start };
  animate(box, {
    v: to,
    duration: 700,
    ease: "outExpo",
    onUpdate: () => { el.textContent = format(box.v); },
    onComplete: () => { el.textContent = format(to); },
  });
}

/**
 * Кольцо прогресса дочерчивается до доли.
 *
 * Обводка круга задаётся длиной штриха и сдвигом: полный штрих равен длине
 * окружности, сдвиг в ту же длину означает пустое кольцо. Анимируется сдвиг —
 * получается дуга, растущая от двенадцати часов по часовой стрелке (сам круг
 * повёрнут на −90° в разметке).
 */
export function sweepRing(circle: SVGCircleElement | null, pct: number, circumference: number): void {
  if (!circle) return;
  const clamped = Math.max(0, Math.min(100, pct));
  const to = circumference * (1 - clamped / 100);

  if (reducedMotion()) {
    utils.set(circle, { strokeDashoffset: to });
    return;
  }
  animate(circle, {
    strokeDashoffset: to,
    duration: 900,
    ease: "outQuint",
  });
}

/**
 * Список появляется волной.
 *
 * Волна здесь не для красоты: строки приезжают пачкой, и одновременное
 * появление десятка одинаковых прямоугольников читается как мелькание. Сдвиг
 * в сорок миллисекунд превращает мелькание в порядок — видно, что список
 * выкладывается, и глаз успевает за ним.
 */
export function revealRows(nodes: Element[]): void {
  if (nodes.length === 0) return;
  if (reducedMotion()) {
    utils.set(nodes, { opacity: 1, translateY: 0 });
    return;
  }
  utils.set(nodes, { opacity: 0, translateY: 8 });
  animate(nodes, {
    opacity: [0, 1],
    translateY: [8, 0],
    duration: 420,
    ease: "outQuint",
    delay: stagger(40),
  });
}

/**
 * Маршрут прочерчивается от начала дня к текущей точке.
 *
 * Наружу отдаётся доля пройденного, а не готовая геометрия: линию рисует
 * карта Яндекса своими средствами, и здесь незачем знать, чем именно.
 *
 * Возвращается остановка. Она нужна не для порядка: выбрали другого агента —
 * прежняя прорисовка обязана прекратиться, иначе две анимации будут по
 * очереди перерисовывать один и тот же объект карты.
 */
export function drawTrail(
  onFrame: (progress: number) => void,
  onDone?: () => void,
): { cancel: () => void } {
  if (reducedMotion()) {
    onFrame(1);
    onDone?.();
    return { cancel: () => {} };
  }
  const box = { p: 0 };
  const anim = animate(box, {
    p: 1,
    duration: 900,
    ease: "inOutQuad",
    onUpdate: () => onFrame(box.p),
    onComplete: () => { onFrame(1); onDone?.(); },
  });
  return {
    cancel: () => {
      // pause, а не revert: revert вернул бы долю к нулю и стёр уже
      // прочерченное, а нам нужно бросить линию там, где застали.
      anim.pause();
    },
  };
}

/**
 * Короткий отклик на обновление: панель едва заметно «дышит».
 *
 * Данные приезжают сами, каждые тридцать секунд. Без этого знака человек не
 * понимает, живой ли экран, и жмёт «Обновить» — а он и так обновляется.
 */
export function pulse(el: HTMLElement | null): void {
  if (!el || reducedMotion()) return;
  animate(el, {
    scale: [1, 1.015, 1],
    duration: 420,
    ease: "inOutQuad",
  });
}
