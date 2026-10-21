import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { UrlLang, type Lang } from "@/i18n";
import { langOfPath } from "@/lib/site-paths";
import { sitePage, type SitePageKey } from "@contracts/site-pages";

/**
 * Страница сайта на языке своего адреса: / и /compare — по-русски, /uz и
 * /uz/compare — по-узбекски. Статья делает то же сама (ArticleLayout).
 *
 * Язык берётся из адреса и не сохраняется (UrlLang): ссылка /uz, присланная
 * в Telegram, открывается по-узбекски у любого, но не переключает ему всё
 * приложение. И наоборот: «/» — русская страница и для того, кто когда-то
 * выбрал узбекский. Раньше русские адреса языка не держали: «Uz» на «/»
 * перекрашивал текст на месте, адрес оставался «/», а <html lang> — «ru»;
 * выбравший узбекский получал на «/» русский готовый HTML, который скрипт
 * тут же перерисовывал по-узбекски, — и страница, и поиск видели разное.
 *
 * Нажатие «Ру / Uz» — явный выбор: он сохраняется, и человек уходит на ту же
 * страницу на другом языке, с теми же метками в адресе (utm_*). Языка, на
 * котором страницы нет (политика — только русская), выбор не уводит.
 */
export default function SitePageLang({ page, children }: { page: SitePageKey; children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();
  const onSwitch = (l: Lang) => {
    const to = sitePage(page).paths[l];
    if (to) navigate(to + search + hash);
  };
  return <UrlLang lang={langOfPath(pathname)} onSwitch={onSwitch}>{children}</UrlLang>;
}
