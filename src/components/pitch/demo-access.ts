import { useEffect, useState } from "react";

/**
 * Состояние демо для жюри — /api/demo/status (api/http/demo.ts).
 *
 * Голый fetch, а не tRPC: страницы публичные и без сессии, а ответ нужен один
 * раз при открытии. null — ещё не ответили; при сбое — «выключено», а не
 * вечный спиннер.
 */
export type DemoRole = "ceo" | "agent" | "supervisor";
export interface DemoStatus { enabled: boolean; roles: DemoRole[]; apiKey: string | null }

const OFF: DemoStatus = { enabled: false, roles: [], apiKey: null };

export function useDemoStatus(): DemoStatus | null {
  const [status, setStatus] = useState<DemoStatus | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/demo/status", { credentials: "same-origin", headers: { accept: "application/json" } })
      .then(r => (r.ok ? r.json() : OFF))
      .then((s: DemoStatus) => { if (alive) setStatus({ enabled: !!s.enabled, roles: Array.isArray(s.roles) ? s.roles : [], apiKey: s.apiKey ?? null }); })
      .catch(() => { if (alive) setStatus(OFF); });
    return () => { alive = false; };
  }, []);
  return status;
}

export type DemoLoginResult = { ok: true } | { ok: false; reason: "rate_limited" | "unavailable" };

/** Войти в демо-организацию ролью. Кука ставится сервером; дальше — полная перезагрузка на «/». */
export async function demoLogin(role: DemoRole): Promise<DemoLoginResult> {
  try {
    const r = await fetch("/api/demo/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ role }),
    });
    if (r.ok) return { ok: true };
    return { ok: false, reason: r.status === 429 ? "rate_limited" : "unavailable" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
