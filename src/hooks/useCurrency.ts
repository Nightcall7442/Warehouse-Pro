import { trpc } from "@/providers/trpc";
import { useMemo } from "react";

interface SettingsData {
  currencySymbol?: string;
  currency?: string;
  symbolPosition?: "before" | "after";
}

export function useCurrency() {
  const { data: settings } = trpc.settings.get.useQuery(undefined, {
    staleTime: 1000 * 60 * 10,
  }) as { data: SettingsData | null };

  const symbol   = settings?.currencySymbol ?? "сум";
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
