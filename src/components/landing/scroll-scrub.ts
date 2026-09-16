import { useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { reducedMotion } from "./landing-anime";

/* ═══════════════════════════════════════════════════════════════════════════
   ПРОКРУТКА КАК ПЛЁНКА

   Приём Apple: секция выше экрана, сцена внутри прилипает (sticky), а
   прогресс прокрутки сквозь секцию — от 0 до 1 — листает кадры и подписи.
   Читатель не смотрит ролик, а ведёт его рукой: остановился — остановилось.

   ── Почему это не спорит с правилом «движение по событию» ─────────────────

   Правило страницы (landing-motion.ts): появления — по событию, не по
   прогрессу, потому что на Android с инерцией привязка к скроллу читалась
   как «сайт заедает». Здесь привязка намеренная и ДРУГАЯ по устройству:
     · прогресс сглажен (lerp) — рывки инерции не долетают до кадра;
     · рисует холст, а не перекладка DOM: один drawImage на кадр;
     · цикл rAF живёт только пока секция около экрана;
     · при «уменьшить движение» сцена не прилипает и кадры стоят;
     · ничего не спрятано разметкой: без сценария всё видно.

   Кадров может быть сотня (плёнка из видео) или четыре (снимки программы):
   между соседними холст делает перекрёстное затухание, и четыре кадра
   тоже читаются как один непрерывный переход.
   ═══════════════════════════════════════════════════════════════════════════ */

const SMOOTH = 0.14;   // доля пути к цели за кадр: 0.14 при 60 fps ≈ 120 мс до покоя
const EPS = 0.0004;    // ниже — считаем, что дошли, и не перерисовываем

export type Listener = (p: number) => void;

/** Прогресс сквозь секцию: 0 — верх секции у верха окна, 1 — низ секции у низа окна. */
export function scrubProgress(top: number, height: number, viewport: number): number {
  const travel = height - viewport;
  if (travel <= 0) return top <= 0 ? 1 : 0;
  return Math.min(1, Math.max(0, -top / travel));
}

/**
 * Сглаженный прогресс прокрутки сквозь секцию. Подписчики получают число
 * 0…1 не чаще одного раза за кадр и только когда оно изменилось.
 */
export function useScrollScrub(ref: RefObject<HTMLElement | null>): { subscribe: (fn: Listener) => () => void; current: () => number } {
  const listeners = useRef(new Set<Listener>());
  const value = useRef(0);
  const target = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion() || typeof IntersectionObserver === "undefined") return;
    let raf = 0;
    let near = false;
    const measure = () => {
      const r = el.getBoundingClientRect();
      target.current = scrubProgress(r.top, r.height, window.innerHeight);
    };
    const emit = (p: number) => { for (const fn of listeners.current) fn(p); };
    const tick = () => {
      raf = 0;
      measure();
      const d = target.current - value.current;
      if (Math.abs(d) > EPS) {
        value.current += d * SMOOTH;
        if (Math.abs(target.current - value.current) <= EPS) value.current = target.current;
        emit(value.current);
      }
      if (near) raf = requestAnimationFrame(tick);
    };
    const wake = () => { if (!raf && near) raf = requestAnimationFrame(tick); };
    const io = new IntersectionObserver(([e]) => {
      near = e.isIntersecting;
      if (near) wake(); else if (raf) { cancelAnimationFrame(raf); raf = 0; }
    }, { rootMargin: "20% 0px 20% 0px" });
    io.observe(el);
    // Первый кадр — сразу в нужное место, без разгона: страница могла
    // открыться уже посреди секции (возврат назад, ссылка с якорем).
    measure(); value.current = target.current; emit(value.current);
    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("resize", wake);
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", wake);
      window.removeEventListener("resize", wake);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);

  // Один и тот же объект на всю жизнь компонента: подписчики держат его в
  // зависимостях эффектов и не должны переподписываться на каждый рендер.
  return useMemo(() => ({
    subscribe: (fn: Listener) => { listeners.current.add(fn); fn(value.current); return () => { listeners.current.delete(fn); }; },
    current: () => value.current,
  }), []);
}

/** Какой кадр и насколько к следующему: 0.37 из 4 кадров → [1, 0.11]. */
export function frameAt(p: number, count: number): [number, number] {
  if (count <= 1) return [0, 0];
  const x = Math.min(1, Math.max(0, p)) * (count - 1);
  const i = Math.min(count - 2, Math.floor(x));
  return [i, x - i];
}

/**
 * Видимость подписи i из n по прогрессу: полная в своём отрезке, затухает
 * на границах шириной `edge` (в долях всего пути). Первая не затухает
 * снизу, последняя — сверху, чтобы края секции не были пустыми.
 */
export function captionOpacity(p: number, i: number, n: number, edge = 0.06): number {
  if (n <= 1) return 1;
  const seg = 1 / n;
  const from = i * seg, to = (i + 1) * seg;
  const inA = i === 0 ? 1 : Math.min(1, Math.max(0, (p - (from - edge)) / (2 * edge)));
  const outA = i === n - 1 ? 1 : Math.min(1, Math.max(0, ((to + edge) - p) / (2 * edge)));
  return Math.min(inA, outA);
}
