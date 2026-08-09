import { ru } from "./ru";
import { uz } from "./uz";
import { createContext, useContext, useState, useCallback } from "react";
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
}

import React from "react";

const LangContext = createContext<LangCtx>({
  lang:    "ru",
  setLang: () => {},
  t:       (k) => k,
});

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
