import "@/sentry-lite" // Первым: ошибки сайта ловятся с первой секунды, как в приложении.
import { StrictMode, Suspense, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { LangProvider } from "@/i18n";
import { isStaleChunkError, lazyWithRecovery, recoverFromStaleApp } from "@/lib/stale-app-recovery";
import { siteRoute, type SitePageKey } from "@contracts/site-pages";
import SiteApp, { type SitePages } from "./SiteApp";

/*
  Лёгкий вход сайта: гость на /, /compare, /privacy, /uz, /uz/compare.

  Здесь нет tRPC с react-query, useAuth (запроса auth.me), WarehouseProvider
  (запроса warehouseMulti.list), подсказок установки и обновления PWA и
  трассировки Sentry: гостю на лендинге из этого не нужно ничего. Форма
  заявки ходит на сервер голым клиентом (lib/public-api).

  ── Готовый HTML не заменяется заглушкой ─────────────────────────────────────

  Сервер отдал страницу уже нарисованной (scripts/prerender.mjs). createRoot
  очищает контейнер при первой отрисовке; будь страница ленивой, на её месте
  на миг встал бы пустой Suspense, и человек видел бы, как готовый текст
  пропадает и появляется снова. Поэтому кусок текущей страницы загружается
  ДО render: первая же отрисовка — сама страница, и замена незаметна.
  Остальные страницы сайта — лениво, при переходе.
*/
const LOADERS: Record<SitePageKey, () => Promise<{ default: ComponentType }>> = {
  home: () => import("@/pages/Landing"),
  compare: () => import("@/pages/Compare"),
  privacy: () => import("@/pages/Privacy"),
};

async function start() {
  const current = siteRoute(window.location.pathname)?.page.key ?? null;
  let first: ComponentType | null = null;
  if (current) {
    try {
      first = (await LOADERS[current]()).default;
    } catch (e) {
      // Кусок от прошлой выкладки (HTML пришёл раньше, чем сменилась сборка)
      // — перезагрузить один раз, как приложение; не вышло — остаётся готовый
      // HTML, ссылки и тексты на нём живые.
      if (isStaleChunkError(e) && await recoverFromStaleApp()) return;
      throw e;
    }
  }
  const pages = Object.fromEntries(
    (Object.keys(LOADERS) as SitePageKey[]).map(k => [k, k === current && first ? first : lazyWithRecovery(LOADERS[k])]),
  ) as SitePages;

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <LangProvider>
          <Suspense fallback={null}>
            <SiteApp pages={pages} />
          </Suspense>
        </LangProvider>
      </BrowserRouter>
    </StrictMode>,
  );
}

void start();
