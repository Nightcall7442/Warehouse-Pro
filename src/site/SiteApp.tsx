import { useEffect, useLayoutEffect, type ComponentType } from "react";
import { Routes, Route, useLocation } from "react-router";
import SitePageLang from "@/components/landing/SitePageLang";
import { ScrollToTop } from "@/components/ScrollToTop";
import { SITE_PAGES, pageLangs, siteRoute, type SitePageKey } from "@contracts/site-pages";
import { leaveSite } from "./leave-site";
import { PAGE_TITLES } from "./page-titles";

export type SitePages = Record<SitePageKey, ComponentType>;

/**
 * Маршруты сайта для гостя — те же страницы, что в App.tsx, без приложения.
 *
 * Список адресов — из contracts/site-pages: по нему же сборка рисует
 * готовый HTML, а сервер его отдаёт. Каждая страница — на языке своего
 * адреса (SitePageLang, как в App.tsx): / — по-русски и у того, кто выбрал
 * узбекский, /uz — по-узбекски; переключатель уводит на парный адрес.
 * Статья берёт язык из адреса сама (ArticleLayout) и в обёртке не нуждается.
 *
 * Переход по ссылке сайта (подвал → статья, статья → соседняя) — без
 * перезагрузки, поэтому новая страница открывается с начала (ScrollToTop):
 * иначе статья открывалась бы на той высоте, где читатель нажал ссылку.
 * И с заголовком своей страницы (PageTitle): <title> в готовом HTML — у
 * первой открытой, и без этого вкладка, история и закладка показывали бы его
 * на любой следующей.
 *
 * Страницы передаются снаружи: при сборке — обычным импортом (entry-server,
 * готовый HTML без заглушек загрузки), в браузере — загруженная заранее
 * текущая и лениво остальные (site-main).
 */
export default function SiteApp({ pages }: { pages: SitePages }) {
  /*
    Метка «страница ожила»: до неё на экране готовый HTML сборки, и кнопки в
    нём ещё ничего не делают — скрипт рисует страницу поверх. Проверки в
    браузере (e2e) ждут эту метку, прежде чем нажимать; при сборке эффект не
    выполняется, и в готовом HTML метки нет.
  */
  useEffect(() => { document.getElementById("root")?.setAttribute("data-live", ""); }, []);
  return (
    <>
      <ScrollToTop />
      <Routes>
        {SITE_PAGES.flatMap(page => pageLangs(page).map(lang => {
          const Page = pages[page.key];
          const path = page.paths[lang]!;
          return (
            <Route
              key={path}
              path={path}
              element={page.kind === "page" ? <SitePageLang page={page.key}><Page /></SitePageLang> : <Page />}
            />
          );
        }))}
        <Route path="*" element={<LeaveSite />} />
      </Routes>
      <PageTitle />
    </>
  );
}

/**
 * Заголовок вкладки — по адресу, тот же, что у готового HTML этой страницы.
 *
 * Стоит после маршрутов: эффекты соседей идут по порядку, и заголовок
 * ставится последним — после того, что поставила сама страница (PitchShell у
 * сравнения ставит тот же текст) и после того, как ушедшая вернула прежний.
 */
function PageTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const route = siteRoute(pathname);
    if (route) document.title = PAGE_TITLES[route.page.key][route.lang];
  }, [pathname]);
  return null;
}

/**
 * Адрес не сайта (/register, /login, /demo) — полной загрузкой.
 *
 * Регистрация и вход живут в приложении, а его на лёгком входе нет. Переход
 * роутера уже записал новый адрес в историю — replace заменяет эту запись
 * настоящей загрузкой страницы, и «назад» ведёт обратно на сайт. Метки
 * рекламы переживают перезагрузку: они в sessionStorage (lib/attribution).
 */
function LeaveSite() {
  const { pathname, search, hash } = useLocation();
  useLayoutEffect(() => {
    leaveSite(pathname + search + hash);
  }, [pathname, search, hash]);
  return null;
}
