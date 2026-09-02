import { animate, createTimeline, stagger, splitText, utils } from "animejs";

/* ═══════════════════════════════════════════════════════════════════════════
   ДВИЖЕНИЕ ЛЕНДИНГА

   Страница была верна по содержанию и мертва по ощущению: всё вставало
   плоско, разом, без единого движения. Разделы ниже первого экрана не
   появлялись вовсе — читатель проматывал готовый лист, а не разворачивал его.

   ── Каким должно быть движение ────────────────────────────────────────────

   Тихим и точным. Не отскоки и не пружины: короткий подъём на два десятка
   пикселей и проявление, с задержкой между соседями — как метки, которые
   кладут одну за другой. Движение обязано заканчиваться раньше, чем на него
   обратят внимание; замеченная анимация на деловом сайте — уже ошибка.

   ── Почему триггер не из anime.js ─────────────────────────────────────────

   У библиотеки есть onScroll, но в поставляемых типах он не описан, и брать
   его вслепую в боевой код — значит проверять догадку на живых людях.
   Наблюдатель пересечений уже используется в проекте (landing-tokens.ts),
   ведёт себя предсказуемо и отдаёт ровно то, что здесь нужно: один сигнал,
   когда элемент вошёл в поле зрения. Анимацию делает anime.js, момент
   выбирает наблюдатель.

   ── Что бывает, если сценарий не выполнится ───────────────────────────────

   Начальное состояние выставляется ИЗ JS, а не в стилях. Не выполнится
   сценарий — текст просто останется на месте видимым. Скрывать элементы
   стилями нельзя: одна ошибка в сборке, и посетитель видит пустой лист.
   ═══════════════════════════════════════════════════════════════════════════ */

const REDUCED = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Дыхание всей страницы: одна кривая и один шаг задержки на все разделы. */
const EASE = "outQuint";
const RISE = 20;

type Cleanup = () => void;

/**
 * Появление разделов по мере прокрутки.
 *
 * Элементы помечаются в разметке атрибутом data-reveal. Соседи с одинаковым
 * значением атрибута считаются группой и выходят с задержкой друг за другом —
 * так список из шести пунктов читается как перечисление, а не как вспышка.
 */
function revealOnScroll(root: HTMLElement): Cleanup {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
  if (nodes.length === 0) return () => {};

  // Группы: соседние элементы с общим родителем идут одной волной.
  const groups = new Map<Element, HTMLElement[]>();
  for (const n of nodes) {
    const key = n.parentElement ?? root;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(n);
  }

  utils.set(nodes, { opacity: 0, translateY: RISE });

  const seen = new WeakSet<Element>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting || seen.has(e.target)) continue;
        const group = groups.get(e.target.parentElement ?? root) ?? [e.target as HTMLElement];
        // Вся группа выходит разом: иначе при быстрой прокрутке соседи
        // всплывают вразнобой, и перечисление рассыпается.
        for (const g of group) { seen.add(g); io.unobserve(g); }
        animate(group, {
          opacity: [0, 1],
          translateY: [RISE, 0],
          duration: 760,
          delay: stagger(70),
          ease: EASE,
        });
      }
    },
    // Порог низкий и с отрицательным нижним полем: раздел начинает выходить,
    // когда до него ещё десятая часть экрана, и к моменту чтения уже стоит.
    { threshold: 0.01, rootMargin: "0px 0px -10% 0px" },
  );
  for (const n of nodes) io.observe(n);

  return () => io.disconnect();
}

/**
 * Первый экран.
 *
 * Заголовок разбирается на слова и набирается по одному — единственное
 * заметное движение на странице, и оно приходится на то, ради чего страницу
 * открыли. Остальное поднимается следом, ровным шагом.
 */
function heroEntrance(root: HTMLElement): Cleanup {
  const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-hero-step]")).sort(
    (a, b) => Number(a.dataset.heroStep) - Number(b.dataset.heroStep),
  );
  const title = root.querySelector<HTMLElement>("[data-hero-title]");
  if (steps.length === 0 && !title) return () => {};

  type Split = { words: HTMLElement[]; revert?: () => void };
  let split: Split | null = null;
  if (title) {
    try {
      split = splitText(title, { words: true, chars: false }) as unknown as Split;
    } catch {
      // Разбор не удался — заголовок выйдет целиком. Терять его нельзя.
      split = null;
    }
  }

  const words = split?.words?.length ? split.words : title ? [title] : [];
  utils.set([...steps, ...words], { opacity: 0, translateY: 14 });
  if (words.length > 1) utils.set(words, { translateY: 26 });

  const tl = createTimeline({ defaults: { ease: EASE } });
  if (words.length) {
    tl.add(words, {
      opacity: [0, 1],
      translateY: [words.length > 1 ? 26 : 14, 0],
      duration: 900,
      delay: stagger(46),
    }, 60);
  }
  for (const [i, el] of steps.entries()) {
    tl.add(el, { opacity: [0, 1], translateY: [14, 0], duration: 700 }, 220 + i * 90);
  }

  return () => {
    tl.revert?.();
    split?.revert?.();
  };
}

/**
 * Включить движение на странице. Возвращает уборку — вызывать при размонтировании.
 *
 * При включённом «уменьшить движение» ничего не анимируется и ничего не
 * прячется: страница просто стоит на месте.
 */
export function startLandingMotion(root: HTMLElement | null): Cleanup {
  if (!root || REDUCED()) return () => {};
  const stops = [heroEntrance(root), revealOnScroll(root)];
  return () => { for (const s of stops) s(); };
}
