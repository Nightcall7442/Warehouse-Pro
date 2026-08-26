import { useSyncExternalStore } from "react";

type Theme = "dark" | "light";

/**
 * Тема — одна на всё приложение, а не по копии на каждый вызов хука.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Хук держал тему в useState. Значит, у каждого вызывающего была СВОЯ копия:
 * у левого меню (components/Layout.tsx) одна, у раздела «Внешний вид» другая.
 * Обе писали в localStorage и обе вешали класс на <html>, поэтому картинка
 * менялась — но состояние второго компонента оставалось прежним до его
 * перемонтирования. Со стороны это выглядело так: переключаешь тему в
 * настройках, идёшь в меню — там по-прежнему «Светлая тема», хотя светлая уже
 * включена, и первое нажатие в меню возвращает тёмную.
 *
 * Теперь значение живёт в модуле, а компоненты подписаны на него через
 * useSyncExternalStore: источник один, рассинхронизации взяться неоткуда.
 */

const STORAGE_KEY = "theme";

function readInitial(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* приватный режим — читать нечего */ }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let current: Theme = readInitial();
const listeners = new Set<() => void>();

function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* не сохранилось — не беда */ }
}

// Класс на <html> ставится сразу при загрузке модуля: если ждать первого
// рендера компонента, страница успевает мигнуть чужой темой.
apply(current);

/** Поставить тему явно — именно это нужно кнопкам «Светлая» и «Тёмная». */
export function setTheme(theme: Theme) {
  if (theme === current) return;
  current = theme;
  apply(theme);
  for (const l of listeners) l();
}

export function toggleTheme() {
  setTheme(current === "dark" ? "light" : "dark");
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, () => current, () => current);
  return { theme, setTheme, toggle: toggleTheme };
}
