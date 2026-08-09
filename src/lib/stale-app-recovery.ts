import { lazy as reactLazy } from "react";

/**
 * Recovery from a stale cached app shell.
 *
 * Every page in this app is a lazy `import()`, so each is its own chunk with a
 * content hash in its filename. A deploy replaces those files: the new build
 * writes `Shops-B7xk2.js`, the old `Shops-a91Ff.js` is gone from the server.
 *
 * That is fine for a browser holding no cache. It is not fine for one holding
 * the *previous* `index.html` — which the service worker precaches and serves
 * offline-first. That HTML names chunks that 404 now, so opening any page
 * whose chunk changed throws "Failed to fetch dynamically imported module" and
 * the route renders an error instead. Pages whose chunks happen to still be
 * cached keep working, which is why only some sections break.
 *
 * Pressing reload does not fix it: the service worker answers the navigation
 * from its own cache and hands back the same stale HTML. That is the "refresh
 * doesn't help" part of the report, and without this module the only way out
 * was to clear site data by hand.
 *
 * So recovery has to actually evict the cache rather than just re-request.
 */

/** True for the browser-specific ways "this chunk no longer exists" surfaces. */
export function isStaleChunkError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  return (
    name === "ChunkLoadError" ||                              // webpack-style, some browsers
    /Failed to fetch dynamically imported module/i.test(message) ||  // Chrome/Edge
    /error loading dynamically imported module/i.test(message) ||    // Firefox
    /Importing a module script failed/i.test(message) ||             // Safari
    /Unable to preload CSS/i.test(message)                           // Vite's CSS preload helper
  );
}

const RELOAD_GUARD_KEY = "stale_app_reloaded_at";
/** Long enough that a genuine repeat failure isn't masked, short enough to retry a later deploy. */
const RELOAD_GUARD_MS = 30_000;

/**
 * Drop every cache and service worker this origin holds, then reload from the
 * network.
 *
 * Guarded against looping: if the fresh copy is *also* broken, reloading again
 * would trap the user in a refresh cycle with no error ever shown. One attempt
 * per 30s window; after that the error surfaces normally so it can be reported.
 *
 * @returns whether a reload was actually started.
 */
export async function recoverFromStaleApp(): Promise<boolean> {
  // A dynamic import fails with the *same* message when the device is simply
  // offline — the file exists on the server, it just can't be reached. Wiping
  // the caches here would take a field agent from "this one page won't open"
  // to "the whole app is gone", since those caches are the only reason the app
  // runs without a connection at all (see OfflineOrders / offline.html).
  // Offline is exactly when the cache is worth most, so leave it alone and let
  // the error surface.
  if (navigator.onLine === false) return false;

  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // Private mode can throw on sessionStorage; a reload without the guard is
    // still better than a permanently broken page.
  }

  // Order matters: unregister first so the reload below cannot be answered by
  // a worker that is about to be removed anyway.
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(r => r.unregister()));
    }
  } catch { /* best effort */ }

  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch { /* best effort */ }

  window.location.reload();
  return true;
}

/**
 * `lazy()` for route components, with stale-cache recovery built in.
 *
 * Wrapping the import here catches the failure before React renders anything,
 * so a user on a stale cache gets a reload straight into the current build
 * instead of an error screen they'd have to act on. If the chunk fails for any
 * other reason (offline, a genuine bug), the error propagates to ErrorBoundary
 * as before — this only intercepts the "file isn't on the server any more"
 * case.
 */
// Mirrors React.lazy's own constraint so route components of any prop shape
// pass through unchanged.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRecovery<T extends React.ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return reactLazy(async () => {
    try {
      return await load();
    } catch (error) {
      if (isStaleChunkError(error) && await recoverFromStaleApp()) {
        // The reload is underway; block on a promise that never settles so
        // nothing renders (and no error flashes) in the meantime.
        await new Promise<never>(() => {});
      }
      throw error;
    }
  });
}
