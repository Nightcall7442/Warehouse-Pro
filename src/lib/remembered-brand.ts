/**
 * Бренд арендатора, запомненный на этом устройстве.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * Экран входа один на всех. Тенант выбирается ПОСЛЕ пароля — одна и та же
 * почта может числиться в нескольких организациях, — и до этого момента
 * сервер попросту не знает, чей бренд показывать. Поэтому вход и остаётся
 * витриной поставщика: логотип системы, её название, её цвет.
 *
 * Для человека это выглядит странно: сотрудник «Акме» открывает приложение
 * каждый день с одного и того же телефона и каждый день видит чужую вывеску, а
 * своё — только войдя.
 *
 * Здесь это лечится тем, что доступно без домена: устройство помнит, чей бренд
 * оно показывало в прошлый раз. Первый вход на новом устройстве — вывеска
 * поставщика, дальше — своя. На общем телефоне покажется бренд того, кто
 * заходил последним; это ровно то, что человек и видел, и хуже, чем сейчас, не
 * станет. Выход из учётной записи память стирает.
 *
 * ── Почему не sessionStorage и не куки ──────────────────────────────────────
 *
 * Нужна память МЕЖДУ запусками, поэтому не sessionStorage. И это оформление, а
 * не данные: на сервер оно не ходит, поэтому не кука.
 */

const KEY = "wp.brand";

export interface RememberedBrand {
  appName?: string | null;
  logoUrl?: string | null;
  loginTitle?: string | null;
  loginSubtitle?: string | null;
  footerText?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
}

/** Пустой бренд помнить незачем: он ничего не изменит на экране. */
function hasAnything(b: RememberedBrand): boolean {
  return Object.values(b).some(v => typeof v === "string" && v.trim() !== "");
}

export function rememberBrand(b: RememberedBrand): void {
  try {
    if (!hasAnything(b)) { forgetBrand(); return; }
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* Приватное окно или запрет на хранилище — вывеска просто останется общей. */
  }
}

export function recallBrand(): RememberedBrand | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // Чужая или испорченная запись не должна ронять экран входа.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as RememberedBrand;
  } catch {
    return null;
  }
}

export function forgetBrand(): void {
  try { localStorage.removeItem(KEY); } catch { /* см. выше */ }
}
