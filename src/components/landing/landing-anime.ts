import { useEffect, useRef } from "react";
import { LX, useInView } from "./landing-tokens";

/* ═══════════════════════════════════════════════════════════════════════════
   ЗАПУСК ANIME.JS НА ЛЕНДИНГЕ

   anime.js подгружается лениво и запускается один раз, когда блок в кадре.
   При «уменьшить движение» сценарий не вызывается: элементы уже стоят в
   конечном состоянии, потому что ни один из них не спрятан разметкой —
   это правило страницы (landing-motion.test.ts), и оно действует и здесь.

   Отдельный файл от оправ: fast refresh перезагружает файл целиком, если в
   нём вперемешку компоненты и функции.
   ═══════════════════════════════════════════════════════════════════════════ */

export type Anime = typeof import("animejs");

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Запустить сценарий anime.js, когда корень попал в кадр.
 * Сценарий возвращает уборку (остановить циклы) — она вызывается при
 * размонтировании. При reduced-motion сценарий не запускается вовсе.
 */
export function useAnime<T extends HTMLElement>(
  run: (anime: Anime, root: T) => void | (() => void),
  threshold = 0.35,
) {
  const { ref, seen } = useInView<T>(threshold);
  const runRef = useRef(run);
  useEffect(() => { runRef.current = run; });
  useEffect(() => {
    if (!seen || !ref.current || reducedMotion()) return;
    let cleanup: void | (() => void);
    let alive = true;
    import("animejs").then(anime => {
      if (!alive || !ref.current) return;
      cleanup = runRef.current(anime, ref.current);
    });
    return () => {
      alive = false;
      cleanup?.();
    };
  }, [seen, ref]);
  return ref;
}

/* ── Тень под бумагу ─────────────────────────────────────────────────────── */
export const WARM_SHADOW = `0 30px 60px -30px ${LX.inkShade45}, 0 12px 24px -16px ${LX.brassShade25}`;
export const NIGHT_SHADOW = `0 40px 80px -40px ${LX.black80}, 0 0 0 1px ${LX.paperOnInk06}`;

