import { useEffect, useLayoutEffect, type ComponentType } from "react";
import { Routes, Route, useLocation } from "react-router";
import UzSite from "@/components/landing/UzSite";
import { SITE_PAGES, pageLangs, type SitePageKey } from "@contracts/site-pages";
import { leaveSite } from "./leave-site";

export type SitePages = Record<SitePageKey, ComponentType>;

/**
 * Маршруты сайта для гостя — те же страницы, что в App.tsx, без приложения.
 *
 * Список адресов — из contracts/site-pages: по нему же сборка рисует
 * готовый HTML, а сервер его отдаёт. Узбекские адреса обёрнуты в UzSite —
 * язык из адреса, как в App.tsx.
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
    <Routes>
      {SITE_PAGES.flatMap(page => pageLangs(page).map(lang => {
        const Page = pages[page.key];
        const path = page.paths[lang]!;
        return (
          <Route
            key={path}
            path={path}
            element={lang === "uz" ? <UzSite path={page.paths.ru}><Page /></UzSite> : <Page />}
          />
        );
      }))}
      <Route path="*" element={<LeaveSite />} />
    </Routes>
  );
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
