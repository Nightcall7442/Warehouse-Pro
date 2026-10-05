import { ru } from "./ru";
import { uz } from "./uz";
import { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import type { ReactNode } from "react";

export type Lang = "ru" | "uz";

const TRANSLATIONS = { ru, uz } as const;

type NestedKeyOf<T> = T extends object
  ? { [K in keyof T]: K extends string
      ? T[K] extends object
        ? `${K}.${NestedKeyOf<T[K]>}`
        : K
      : never
    }[keyof T]
  : never;

export type TKey = NestedKeyOf<typeof ru>;

function getNestedValue(obj: unknown, path: string): string {
  return path.split(".").reduce((o: unknown, k: string) => (o as Record<string, unknown>)?.[k], obj) as string ?? path;
}

export function t(lang: Lang, key: string): string {
  return getNestedValue(TRANSLATIONS[lang], key);
}

// React context
interface LangCtx {
  lang:    Lang;
  setLang: (l: Lang) => void;
  t:       (key: string) => string;
  /** Язык закреплён оболочкой (FixedLang) — выбирать его негде и незачем. */
  fixed?:  boolean;
}

import React from "react";

const LangContext = createContext<LangCtx>({
  lang:    "ru",
  setLang: () => {},
  t:       (k) => k,
});

/**
 * Язык вне React — для помощников вроде выгрузки в Excel, где хука нет.
 * Тот же ключ, что у LangProvider; по умолчанию русский.
 */
export function currentLang(): Lang {
  if (fixedLang) return fixedLang;
  try { const s = localStorage.getItem("lang"); return s === "uz" ? "uz" : "ru"; } catch { return "ru"; }
}

/*
  Язык, закреплённый оболочкой, — сильнее сохранённого.

  Консоль платформы (роль superadmin) только русская: владелец, 01.10.2026,
  «только русский оставь». Сохранённое «uz» в браузере (переключал, будучи
  директором тестовой организации) не должно делать её узбекской ни в
  разметке, ни в тостах вне компонентов (tt, currentLang) — поэтому
  закрепление живёт и здесь, а не только в контексте.
*/
let fixedLang: Lang | null = null;

/**
 * Закрепить язык для всего, что внутри: контекст отдаёт его, setLang ничего
 * не делает, tt/currentLang вне React отвечают им же. Сохранённый выбор не
 * трогается — выйдя из консоли, человек получит свой язык обратно.
 */
export function FixedLang({ lang, children }: { lang: Lang; children: ReactNode }) {
  useEffect(() => {
    fixedLang = lang;
    return () => { fixedLang = null; };
  }, [lang]);
  const translate = useCallback((key: string) => t(lang, key), [lang]);
  const value = useMemo(() => ({ lang, setLang: () => {}, t: translate, fixed: true }), [lang, translate]);
  return React.createElement(LangContext.Provider, { value }, children);
}
/** Выбирал ли человек язык сам — в этом браузере. */
export function hasChosenLang(): boolean {
  try { const s = localStorage.getItem("lang"); return s === "ru" || s === "uz"; } catch { return false; }
}

/**
 * Язык по умолчанию для поддерева — пока человек не выбрал свой.
 *
 * Страницы конкурса (/pitch, /demo) читает узбекоязычное жюри, и открываться
 * они должны по-узбекски, хотя у приложения по умолчанию русский. Но явный
 * выбор сильнее: кто переключил на «Ру» здесь или раньше в приложении, тот
 * его и получает. Пока выбора нет, сохранённое не трогается — заход на
 * /pitch не делает узбекским всё приложение.
 */
export function PreferLang({ lang: fallback, children }: { lang: Lang; children: ReactNode }) {
  const outer = useContext(LangContext);
  const [chosen, setChosen] = useState(hasChosenLang);
  const lang = chosen ? outer.lang : fallback;
  const outerSet = outer.setLang;
  const setLang = useCallback((l: Lang) => { outerSet(l); setChosen(true); }, [outerSet]);
  const translate = useCallback((key: string) => t(lang, key), [lang]);
  const value = useMemo(() => ({ lang, setLang, t: translate }), [lang, setLang, translate]);
  return React.createElement(LangContext.Provider, { value }, children);
}

/** Пара «русский / узбекский» по текущему языку — для тостов вне компонентов. */
export const tt = (ru: string, uz: string): string => (currentLang() === "uz" ? uz : ru);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem("lang");
    if (stored === "ru" || stored === "uz") return stored;
    return "ru";
  });

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem("lang", l);
    setLangState(l);
  }, []);

  const translate = useCallback((key: string) => t(lang, key), [lang]);

  return React.createElement(LangContext.Provider, { value: { lang, setLang, t: translate } }, children);
}

export function useLang() {
  return useContext(LangContext);
}

/**
 * Inline translation helper.
 *
 * @deprecated Use `useLang().t("key")` with keys from the translation dictionary.
 *             This function is kept for backward compatibility and will be removed
 *             once all pages are migrated to the key-based system.
 */
export function useTranslate() {
  const { lang } = useLang();
  return useCallback(
    (ru: string, uz: string) => (lang === "uz" ? uz : ru),
    [lang]
  );
}
