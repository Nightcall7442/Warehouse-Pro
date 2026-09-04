import { useEffect } from "react";
import { trpc } from "@/providers/trpc";

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Токены shadcn/ui хранят цвет разложенным на тон, насыщенность и светлоту.
function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/*
  Переменные, которые ставит бренд арендатора. Список нужен, чтобы их можно
  было СНЯТЬ: арендатор вправе убрать свой цвет, и тогда решать должна
  таблица стилей, а не то, что осталось висеть в <html> с прошлого раза.
*/
const BRAND_VARS = [
  "--color-primary",
  "--color-primary-hover",
  "--color-primary-subtle",
  "--color-primary-muted",
  "--primary",
  "--ring",
];

/**
 * Fetches tenant branding and applies CSS variables to :root.
 * Call once at app level (e.g. in App.tsx or a provider).
 */
export function useBranding() {
  const { data: branding } = trpc.branding.get.useQuery();

  useEffect(() => {
    if (!branding) return;
    const root = document.documentElement;

    /*
      Свой цвет вписываем, чужой не выдумываем.

      Здесь стояло `branding.primaryColor ?? "#5b6d8a"`, и подстановка была
      цветом СВЕТЛОЙ темы. Значит, арендатору, который свой цвет не выбирал,
      светлый акцент прописывался прямо в <html> — а inline-стиль перебивает
      любое правило таблицы, включая блок .dark. Латунный акцент тёмной темы
      (#c9a227) не показывался никому, кроме тех, кто задал цвет вручную.

      Теперь при пустом бренде свойства СНИМАЮТСЯ, и цвет решает таблица: у
      неё есть значение и для светлой темы, и для тёмной. Снимать обязательно,
      а не просто «не ставить»: арендатор может убрать свой цвет в настройках,
      и без этого прежний остался бы висеть до перезагрузки.
    */
    const primary = branding.primaryColor;

    if (primary) {
      const secondary = branding.secondaryColor ?? primary;

      root.style.setProperty("--color-primary", primary);
      root.style.setProperty("--color-primary-hover", secondary);
      root.style.setProperty("--color-primary-subtle", hexToRgba(primary, 0.10));
      root.style.setProperty("--color-primary-muted", hexToRgba(primary, 0.50));
      root.style.setProperty("--primary", hexToHsl(primary));
      root.style.setProperty("--ring", hexToHsl(primary));
    } else {
      for (const v of BRAND_VARS) root.style.removeProperty(v);
    }

    // Update document title if appName is set
    if (branding.appName) {
      document.title = branding.appName;
    }

    // Update favicon if faviconUrl is set
    if (branding.faviconUrl) {
      const link = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
      if (link) link.href = branding.faviconUrl;
    }
  }, [branding]);

  return branding;
}
