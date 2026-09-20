import { trpc } from "@/providers/trpc";
import { useMemo } from "react";
import { useLang } from "@/i18n";

interface SettingsData {
  currencySymbol?: string;
  currency?: string;
  symbolPosition?: "before" | "after";
}

/*
  Символ валюты хранится у арендатора одним словом («сум»), а интерфейс
  двуязычный: в узбекском «52 000 сум» — русское слово посреди узбекского
  экрана (прогон 20.09.2026: на каждой странице). Слово той же валюты на
  другом языке подставляется здесь; чужие символы ($, €) не трогаются.
*/
const SUM: Record<string, { ru: string; uz: string }> = {
  "сум": { ru: "сум", uz: "so'm" }, "сўм": { ru: "сум", uz: "so'm" },
  "so'm": { ru: "сум", uz: "so'm" }, "soʻm": { ru: "сум", uz: "so'm" }, "so‘m": { ru: "сум", uz: "so'm" },
};
export function currencySymbolFor(stored: string | null | undefined, lang: "ru" | "uz"): string {
  if (!stored) return SUM["сум"][lang];
  return SUM[stored.trim().toLowerCase()]?.[lang] ?? stored;
}

export function useCurrency() {
  const { lang } = useLang();
  const { data: settings } = trpc.settings.get.useQuery(undefined, {
    staleTime: 1000 * 60 * 10,
  }) as { data: SettingsData | null };

  const symbol   = currencySymbolFor(settings?.currencySymbol, lang);
  const currency = settings?.currency       ?? "UZS";
  const position = settings?.symbolPosition ?? "after";

  const fmt = useMemo(() => {
    return (amount: string | number | null | undefined, opts?: { decimals?: number } | boolean) => {
      const num     = Number(amount ?? 0);
      const compact = opts === true;
      const decimals = (typeof opts === "object" ? opts?.decimals : undefined) ?? 0;

      let formatted: string;
      if (compact) {
        const abs = Math.abs(num);
        formatted =
          abs >= 1_000_000 ? `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
          : abs >= 1_000   ? `${(num / 1_000).toFixed(1).replace(/\.0$/, "")}K`
          : num.toLocaleString("ru-RU");
      } else {
        formatted = num.toLocaleString("ru-RU", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });
      }
      return position === "before"
        ? `${symbol} ${formatted}`
        : `${formatted} ${symbol}`;
    };
  }, [symbol, position]);

  return { fmt, symbol, currency };
}
