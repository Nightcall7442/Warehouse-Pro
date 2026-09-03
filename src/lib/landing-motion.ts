import { animate, createTimeline, stagger, splitText, utils } from "animejs";

/* ═══════════════════════════════════════════════════════════════════════════
   ДВИЖЕНИЕ ЛЕНДИНГА

   Страница была верна по содержанию и мертва по ощущению: всё вставало
   плоско, разом, без единого движения. Разделы ниже первого экрана не
   появлялись вовсе — читатель проматывал готовый лист, а не разворачивал его.

   ── Каким должно быть движение ────────────────────────────────────────────

   Тихим и точным. Короткий подъём и проявление, с задержкой между соседями —
   как метки, которые кладут одну за другой. Числа считаются на глазах, линии
   прочерчиваются, печать оттискивается. Всё — ПО СОБЫТИЮ появления в поле
   зрения, ничего — по прогрессу прокрутки: на Android с инерцией привязка к
   скроллу читается как «сайт заедает», а у покупателя 3G.

   ── Почему триггер не из anime.js ─────────────────────────────────────────

   У библиотеки есть onScroll, но в поставляемых типах он не описан, и брать
   его вслепую в боевой код — значит проверять догадку на живых людях.
   Наблюдатель пересечений ведёт себя предсказуемо и отдаёт ровно то, что
   здесь нужно: один сигнал, когда элемент вошёл в поле зрения. Анимацию
   делает anime.js, момент выбирает наблюдатель.

   ── Что бывает, если сценарий не выполнится ───────────────────────────────

   Начальное состояние выставляется ИЗ JS, а не в стилях. Не выполнится
   сценарий — текст просто останется на месте видимым. Скрывать элементы
   стилями нельзя: одна ошибка в сборке, и посетитель видит пустой лист.

   ── Словарь атрибутов ─────────────────────────────────────────────────────

   data-reveal            — подъём и проявление; соседи с общим родителем идут волной
   data-hero-title/step   — первый экран: заголовок по словам, остальное шагом
   data-count="12345"     — число считается от нуля до значения (разряды через пробел)
   data-rule              — горизонтальная линия прочерчивается слева направо
   data-stamp             — печать оттискивается: крупнее и легче → на место
   data-fold              — знак-лента: сегменты складываются по одному
   ═══════════════════════════════════════════════════════════════════════════ */

const REDUCED = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const EASE = "outQuint";
const RISE = 20;

type Cleanup = () => void;

/** Один наблюдатель на группу: элемент входит — обработчик вызывается один раз. */
function once(
  nodes: Element[],
  // Наблюдатель отдаётся обработчику: волна снимает с наблюдения ВСЮ группу
  // разом, а не только вошедший элемент.
  onEnter: (el: Element, io: IntersectionObserver) => void,
  rootMargin = "0px 0px -10% 0px",
  threshold = 0.01,
): Cleanup {
  if (nodes.length === 0) return () => {};
  const seen = new WeakSet<Element>();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting || seen.has(e.target)) continue;
      seen.add(e.target);
      io.unobserve(e.target);
      onEnter(e.target, io);
    }
  }, { threshold, rootMargin });
  for (const n of nodes) io.observe(n);
  return () => io.disconnect();
}

/** Появление разделов по мере прокрутки. Соседи с общим родителем — одной волной. */
function revealOnScroll(root: HTMLElement): Cleanup {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
  if (nodes.length === 0) return () => {};

  const groups = new Map<Element, HTMLElement[]>();
  for (const n of nodes) {
    const key = n.parentElement ?? root;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
  }
  utils.set(nodes, { opacity: 0, translateY: RISE });

  const done = new WeakSet<Element>();
  return once(nodes, (el, io) => {
    // Вся группа выходит разом, поэтому и с наблюдения снимается разом:
    // иначе соседи остаются висеть на наблюдателе до конца сеанса.
    const group = (groups.get(el.parentElement ?? root) ?? [el as HTMLElement]).filter(g => !done.has(g));
    for (const g of group) { done.add(g); io.unobserve(g); }
    if (group.length === 0) return;
    animate(group, {
      opacity: [0, 1],
      translateY: [RISE, 0],
      duration: 760,
      delay: stagger(70),
      ease: EASE,
    });
  });
}

/**
 * Числа считаются от нуля до значения.
 *
 * Заменяет прежний Counter на requestAnimationFrame: одна библиотека на всё
 * движение, и разряды разделяются как в остальном тексте — пробелом.
 */
function countUp(root: HTMLElement): Cleanup {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-count]"));
  if (nodes.length === 0) return () => {};
  const fmt = (n: number) =>
    Math.round(n).toLocaleString("ru-RU").replace(/[\u00a0\u202f]/g, " ");
  for (const n of nodes) n.textContent = fmt(0);
  return once(nodes, (el) => {
    const target = Number((el as HTMLElement).dataset.count ?? 0);
    const suffix = (el as HTMLElement).dataset.countSuffix ?? "";
    const box = { v: 0 };
    animate(box, {
      v: target,
      duration: 1400,
      ease: "outExpo",
      onUpdate: () => { el.textContent = fmt(box.v) + suffix; },
    });
  }, "0px 0px -15% 0px", 0.3);
}

/** Линии прочерчиваются слева направо — как черта под итогом в ведомости. */
function drawRules(root: HTMLElement): Cleanup {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-rule]"));
  if (nodes.length === 0) return () => {};
  utils.set(nodes, { scaleX: 0, transformOrigin: "0 50%" });
  return once(nodes, (el) => {
    animate(el, { scaleX: [0, 1], duration: 900, ease: "inOutQuart" });
  });
}

/** Печать оттискивается: чуть крупнее и легче → на место, с коротким пере-давом. */
function stamps(root: HTMLElement): Cleanup {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-stamp]"));
  if (nodes.length === 0) return () => {};
  utils.set(nodes, { opacity: 0, scale: 1.35 });
  return once(nodes, (el) => {
    createTimeline({ defaults: { ease: "outQuad" } })
      .add(el, { opacity: [0, 1], scale: [1.35, 0.96], duration: 260 })
      .add(el, { scale: [0.96, 1], duration: 220, ease: "outBack(1.6)" });
  }, "0px 0px -5% 0px", 0.5);
}

/**
 * Знак-лента складывается по сегментам.
 *
 * Логотип — четыре сложенных отрезка и точка прибытия. На первой отрисовке
 * отрезки встают по одному, снизу вверх по ленте, точка падает последней.
 * Так знак сам показывает, из чего он состоит: маршрут, график, картон.
 */
function foldMarks(root: HTMLElement): Cleanup {
  const marks = Array.from(root.querySelectorAll<SVGSVGElement>("[data-fold]"));
  if (marks.length === 0) return () => {};
  const stops: Cleanup[] = [];
  for (const svg of marks) {
    const segs = Array.from(svg.querySelectorAll<SVGElement>("polygon"));
    const dot = svg.querySelector<SVGElement>("circle");
    if (segs.length === 0) continue;
    utils.set(segs, { opacity: 0, translateY: 6 });
    if (dot) utils.set(dot, { opacity: 0, translateY: -8 });
    stops.push(once([svg], () => {
      const tl = createTimeline({ defaults: { ease: EASE } });
      tl.add(segs, { opacity: [0, 1], translateY: [6, 0], duration: 520, delay: stagger(90) }, 0);
      if (dot) tl.add(dot, { opacity: [0, 1], translateY: [-8, 0], duration: 420, ease: "outBack(2)" }, 380);
    }, "0px", 0.2));
  }
  return () => { for (const s of stops) s(); };
}

/** Первый экран: заголовок по словам, остальное ровным шагом. */
function heroEntrance(root: HTMLElement): Cleanup {
  const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-hero-step]")).sort(
    (a, b) => Number(a.dataset.heroStep) - Number(b.dataset.heroStep),
  );
  const title = root.querySelector<HTMLElement>("[data-hero-title]");
  if (steps.length === 0 && !title) return () => {};

  type Split = { words: HTMLElement[]; revert?: () => void };
  let split: Split | null = null;
  if (title) {
    try { split = splitText(title, { words: true, chars: false }) as unknown as Split; }
    catch { split = null; }
  }
  const words = split?.words?.length ? split.words : title ? [title] : [];
  utils.set([...steps, ...words], { opacity: 0, translateY: 14 });
  if (words.length > 1) utils.set(words, { translateY: 26 });

  const tl = createTimeline({ defaults: { ease: EASE } });
  if (words.length) {
    tl.add(words, { opacity: [0, 1], translateY: [words.length > 1 ? 26 : 14, 0], duration: 900, delay: stagger(46) }, 60);
  }
  for (const [i, el] of steps.entries()) {
    tl.add(el, { opacity: [0, 1], translateY: [14, 0], duration: 700 }, 220 + i * 90);
  }
  return () => { tl.revert?.(); split?.revert?.(); };
}

/** Включить движение на странице. Возвращает уборку — вызывать при размонтировании. */
export function startLandingMotion(root: HTMLElement | null): Cleanup {
  if (!root || REDUCED()) return () => {};
  const stops = [
    heroEntrance(root),
    revealOnScroll(root),
    countUp(root),
    drawRules(root),
    stamps(root),
    foldMarks(root),
  ];
  return () => { for (const s of stops) s(); };
}
