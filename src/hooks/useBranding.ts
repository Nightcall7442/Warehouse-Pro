import { useEffect } from "react";
import { trpc } from "@/providers/trpc";
import { rememberBrand } from "@/lib/remembered-brand";
import { readableInk, readableOn } from "@/lib/contrast";

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
  Фон карточки в каждой теме — из index.css (--color-surface).

  Он нужен, чтобы посчитать, каким должен быть АКЦЕНТНЫЙ ТЕКСТ: у него своя
  переменная, и её значение зависит от того, на чём этот текст лежит. Читать
  его во время работы нельзя: переменная в этот момент как раз и задаётся, а в
  другой теме её значение вообще не применено к документу.
*/
const LIGHT_CARD = "#efedea";
const DARK_CARD  = "#221f1c";

const STYLE_ID = "tenant-brand-vars";

/**
 * Правила бренда — таблицей стилей, а не инлайном в <html>.
 *
 * ── Почему не инлайн ────────────────────────────────────────────────────────
 *
 * Инлайновый стиль перебивает ЛЮБОЕ правило таблицы, включая блок .dark.
 * Значит одно значение цвета уезжало сразу в обе темы, и подобрать под каждую
 * свой производный оттенок было нельзя в принципе. А производные нужны: цвет
 * надписи НА заливке и цвет акцентного ТЕКСТА считаются от фона, а фон в
 * темах разный.
 *
 * Правило в таблице стоит на своём месте в порядке применения: светлая тема
 * берёт :root, тёмная — :root.dark, и оба блока пишутся здесь одним куском.
 */
function brandCss(primary: string, secondary: string): string {
  const ink = readableInk(primary);

  const vars = (accentText: string) => [
    `--color-primary: ${primary};`,
    `--color-primary-hover: ${secondary};`,
    `--color-primary-subtle: ${hexToRgba(primary, 0.10)};`,
    `--color-primary-muted: ${hexToRgba(primary, 0.50)};`,
    // Надпись НА заливке. Здесь она не переопределялась вовсе: у светлой темы
    // это белый, и на светло-жёлтой кнопке арендатора надпись пропадала.
    `--color-on-primary: ${ink};`,
    `--color-primary-text: ${accentText};`,
    `--primary: ${hexToHsl(primary)};`,
    `--primary-foreground: ${hexToHsl(ink)};`,
    `--ring: ${hexToHsl(primary)};`,
  ].join(" ");

  return [
    `:root { ${vars(readableOn(LIGHT_CARD, primary))} }`,
    `:root.dark { ${vars(readableOn(DARK_CARD, primary))} }`,
  ].join("\n");
}

/**
 * Забирает бренд арендатора и применяет его ко всему приложению.
 * Зовётся один раз на уровне приложения (App.tsx).
 */
export function useBranding() {
  const { data: branding } = trpc.branding.get.useQuery();

  useEffect(() => {
    if (!branding) return;

    /*
      Свой цвет вписываем, чужой не выдумываем.

      Здесь стояло `branding.primaryColor ?? "#5b6d8a"`, и подстановка была
      цветом СВЕТЛОЙ темы. Значит арендатору, который свой цвет не выбирал,
      светлый акцент прописывался поверх обеих тем — латунный акцент тёмной
      (#c9a227) не показывался никому, кроме тех, кто задал цвет вручную.

      Теперь при пустом бренде правило снимается, и цвет решает таблица: у неё
      есть значение и для светлой темы, и для тёмной. Снимать обязательно, а не
      просто «не ставить»: арендатор может убрать свой цвет в настройках, и без
      этого прежний остался бы висеть до перезагрузки.
    */
    const primary = branding.primaryColor;
    const existing = document.getElementById(STYLE_ID);

    if (primary) {
      const el = existing ?? Object.assign(document.createElement("style"), { id: STYLE_ID });
      el.textContent = brandCss(primary, branding.secondaryColor ?? primary);
      if (!existing) document.head.appendChild(el);
    } else {
      existing?.remove();
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

    /*
      Вывеска запоминается на устройстве.

      Экран входа один на всех, и тенант выбирается уже после пароля — значит
      до входа сервер не знает, чей бренд показывать, и сотрудник арендатора
      каждый день начинал день с чужой вывески. Устройство помнит, чей бренд
      показывало в прошлый раз; подробности и оговорки — в
      lib/remembered-brand.ts.
    */
    rememberBrand({
      appName:        branding.appName,
      logoUrl:        branding.logoUrl,
      loginTitle:     branding.loginTitle,
      loginSubtitle:  branding.loginSubtitle,
      footerText:     branding.footerText,
      primaryColor:   branding.primaryColor,
      secondaryColor: branding.secondaryColor,
    });
  }, [branding]);

  return branding;
}
