import { LOGIN_PATH } from "@/const";

/**
 * Куда уводить после выхода.
 *
 * Из демо-организации жюри (/demo, Pitch Day) — обратно к выбору роли, а не
 * на страницу входа: логина и пароля у жюри нет, на /login ему делать нечего,
 * и «Выход» выглядел как тупик («как назад?», 05.10.2026).
 */
export const DEMO_RETURN_PATH = "/demo#prototip";

export function logoutTarget(user: { demo?: boolean } | null | undefined): string {
  return user?.demo ? DEMO_RETURN_PATH : LOGIN_PATH;
}
