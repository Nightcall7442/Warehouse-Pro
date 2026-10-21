import * as Sentry from "@sentry/react";
import { SENTRY_BASE } from "./sentry-options";

/**
 * Сбор ошибок браузера — приложение.
 *
 * Общие настройки (версия, отсев шума, без личных данных) — в
 * sentry-options.ts: их же берёт лёгкий вход сайта (sentry-lite.ts). Здесь —
 * то, что нужно только приложению: трассировка переходов и запись сеанса.
 */
Sentry.init({
  ...SENTRY_BASE,
  integrations: [
    // Transactions are named by URL, not by route pattern. Parameterized names
    // need reactRouterBrowserTracingIntegration *and* a Sentry-wrapped <Routes>
    // in App.tsx — that integration turns off its own navigation tracking and
    // relies on the wrapper, so switching here alone would lose navigations.
    Sentry.browserTracingIntegration(),
    // Запись сеанса здесь не подключается — она приезжает позже, отдельным
    // куском: см. loadReplayWhenIdle ниже и src/sentry-replay.ts.
  ],

  tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,

  /**
   * Записи сеансов.
   *
   * Было 0,5 — записывалась половина ВСЕХ посещений, включая те, где ничего
   * не случилось. Это и деньги (записи тарифицируются), и чужая работа на
   * стороне Sentry без всякой причины. Пишем только то, что закончилось
   * ошибкой, — ради этого записи и заводились.
   */
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
});

/**
 * Запись сеанса — после первого экрана, а не во входном файле.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * replayIntegration стояла прямо в init выше, и вместе с ней во входной файл
 * ехал весь rrweb: больше сотни килобайт, которые дешёвый Android агента
 * качал по мобильной связи и разбирал ДО того, как нарисовать хоть что-то.
 *
 * ── Что теперь ──────────────────────────────────────────────────────────────
 *
 * Ошибки ловятся с первой секунды, как и раньше: init с глобальными
 * обработчиками остаётся здесь, во входном файле. Запись сеанса
 * подгружается отдельным куском, когда страница загружена и браузер
 * простаивает (requestIdleCallback; где его нет — через три секунды после
 * load). Платим за это одним: ошибка в первые секунды приходит без записи —
 * стек, браузер, пользователь и путь по экранам у неё есть.
 *
 * Почему на всех устройствах, а не «только на компьютере»: труднее всего
 * воспроизвести как раз ошибки агента в поле, и запись нужнее всего там.
 * Задача была убрать её с пути первого экрана, а не выключить.
 *
 * Без DSN (разработка, стенд) не грузится вовсе: отправлять некуда.
 */
function loadReplayWhenIdle(): void {
  if (!import.meta.env.VITE_SENTRY_DSN || typeof window === "undefined") return;
  const load = () => { void import("./sentry-replay").then(m => m.startReplay()).catch(() => { /* без записи — не беда */ }); };
  const idle = () => {
    if ("requestIdleCallback" in window) window.requestIdleCallback(load, { timeout: 15_000 });
    else setTimeout(load, 3_000);
  };
  if (document.readyState === "complete") idle();
  else window.addEventListener("load", idle, { once: true });
}

loadReplayWhenIdle();

/**
 * Кто именно наткнулся на ошибку.
 *
 * Идентификатор пользователя и организации, без почты и имени: этого хватает,
 * чтобы найти человека в своей же базе, и не отдаёт третьей стороне лишнего.
 * Без этого у каждой ошибки в Sentry стоит «аноним», и понять, у одного она
 * человека или у всей организации, нельзя.
 */
export function setSentryUser(user: { id: number; tenantId: number; role: string } | null): void {
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: String(user.id) });
  Sentry.setTag("tenant", String(user.tenantId));
  Sentry.setTag("role", user.role);
}

// Note: window.onerror and unhandledrejection handlers are in app-main.tsx
// (shows toast notifications to users). Sentry captures via globalHandlers integration.
