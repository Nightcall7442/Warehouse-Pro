import { useEffect, useRef, useSyncExternalStore } from "react";
import { trpc } from "@/providers/trpc";

/*
  Точка местоположения из браузера — сама, раз в десять минут.

  ── Что было ────────────────────────────────────────────────────────────────

  На экране «GPS» стоял переключатель «Авто-трекинг», обещавший слежение.
  Браузер слежения в фоне не умеет: свернул вкладку — таймеры заморожены,
  след обрывается. Переключатель обещал то, чего веб дать не может, а
  включённым он оставался только пока агент сидел на этом одном экране.

  ── Что теперь ──────────────────────────────────────────────────────────────

  Решение владельца: в вебе никакого «авто-слежения», просто раз в десять
  минут точка уходит сама, пока приложение открыто — с любого экрана, без
  кнопок. Спрятали вкладку — молчим (в фоне браузер всё равно не даст),
  вернулись — если прошло десять минут, шлём сразу. Точность «грубая» и
  свежая позиция из кэша до пяти минут: батарею это не трогает. Отказ в
  доступе к геолокации — молчим до следующего запуска: спрашивать каждые
  десять минут значит раздражать, а не следить.

  Настоящий фоновый след — только у мобильного приложения (там следит
  система, а не вкладка).
*/
export const PING_MS = 10 * 60 * 1000;
export const PING_MIN = PING_MS / 60_000;
const LAST_KEY = "gps_last_ping";
const FIX: PositionOptions = { enableHighAccuracy: false, timeout: 30_000, maximumAge: 5 * 60_000 };

/** Пора ли слать: прошло ли PING_MS с последней точки (или её не было). */
export function shouldPing(lastAt: number | null, now: number): boolean {
  return lastAt === null || now - lastAt >= PING_MS;
}

// ── Когда ушла последняя точка: читает экран «GPS», пишет хук ────────────────
const listeners = new Set<() => void>();
function readLast(): number | null {
  try { const v = localStorage.getItem(LAST_KEY); return v ? Number(v) || null : null; } catch { return null; }
}
let last: number | null = readLast();
function setLast(at: number) {
  last = at;
  try { localStorage.setItem(LAST_KEY, String(at)); } catch { /* приватный режим — только в памяти */ }
  listeners.forEach(l => l());
}
export function subscribeLastPing(l: () => void): () => void { listeners.add(l); return () => { listeners.delete(l); }; }
export function getLastPing(): number | null { return last; }
export function useLastPing(): number | null { return useSyncExternalStore(subscribeLastPing, getLastPing, () => null); }

export function useLocationPing(enabled: boolean): void {
  const save = trpc.agent.saveLocation.useMutation({ onSuccess: (_r, vars) => setLast(vars.recordedAt ? Date.parse(vars.recordedAt) : Date.now()) });
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);

  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !navigator.geolocation) return;
    let denied = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const ping = () => {
      if (denied || document.hidden || !navigator.onLine || !shouldPing(getLastPing(), Date.now())) return;
      navigator.geolocation.getCurrentPosition(
        pos => {
          saveRef.current.mutate({
            lat: String(pos.coords.latitude), lng: String(pos.coords.longitude),
            accuracy: String(Math.round(pos.coords.accuracy)),
            recordedAt: new Date(pos.timestamp || Date.now()).toISOString(),
          });
        },
        err => { if (err.code === err.PERMISSION_DENIED) denied = true; },
        FIX,
      );
    };

    // Проверка раз в минуту, а не таймер на десять: вкладка после сна
    // должна отправить сразу, как только прошло время, а не через десять
    // минут после пробуждения.
    const start = () => { if (timer === null) { ping(); timer = setInterval(ping, 60_000); } };
    const stop = () => { if (timer !== null) { clearInterval(timer); timer = null; } };
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) start();
    return () => { document.removeEventListener("visibilitychange", onVisibility); stop(); };
  }, [enabled]);
}
