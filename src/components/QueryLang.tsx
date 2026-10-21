import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { PreferLang, UrlLang, useLang, type Lang } from "@/i18n";
import { langFromSearch } from "@/i18n/page-lang";

/**
 * Язык из ?lang=ru|uz в адресе — для экранов, на которые ведёт ссылка с
 * другим языком: /demo?lang=ru из русского лендинга, /register?lang=uz и
 * /login?lang=uz с узбекских страниц сайта.
 *
 * Такая ссылка сильнее сохранённого выбора и умолчания экрана (prefer), но
 * заход по ней — не выбор: «lang» в хранилище не пишется (UrlLang). Нажатие
 * на переключатель, если он на экране есть, сохраняет выбор и меняет ?lang в
 * адресе на месте — иначе адрес продолжал бы держать прежний язык.
 *
 * Если язык уже задан адресом выше (/uz/compare), ?lang не спорит с ним: две
 * страницы-владельца языка разошлись бы между React и uiLang.
 *
 * Без ?lang — умолчание экрана (PreferLang), если оно есть, иначе язык
 * приложения как есть.
 */
export default function QueryLang({ prefer, children }: { prefer?: Lang; children: ReactNode }) {
  const outer = useLang();
  const { search, hash } = useLocation();
  const navigate = useNavigate();
  const urlLang = outer.fromUrl ? null : langFromSearch(search);
  if (urlLang) {
    const onSwitch = (l: Lang) => {
      const q = new URLSearchParams(search);
      q.set("lang", l);
      navigate({ search: `?${q.toString()}`, hash }, { replace: true });
    };
    return <UrlLang lang={urlLang} onSwitch={onSwitch}>{children}</UrlLang>;
  }
  return prefer ? <PreferLang lang={prefer}>{children}</PreferLang> : <>{children}</>;
}
