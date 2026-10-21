/**
 * Признак «в этом браузере кто-то входил».
 *
 * Сессия живёт в httpOnly-куке, поэтому до ответа `auth.me` фронтенд не знает
 * даже, стоит ли ждать пользователя. Корню сайта это важно: посетитель
 * warehouse-pro.uz должен увидеть лендинг сразу, а не спиннер на весь
 * round-trip до API, — и при этом залогиненный не должен ловить вспышку
 * лендинга перед своим разделом.
 *
 * Флаг ничего не удостоверяет и ничего не открывает: он только подсказывает,
 * что рисовать в первые 200 мс. Любая настоящая проверка по-прежнему на
 * сервере.
 *
 * Отдельным модулем, а не в useAuth: его читает и входной файл (src/main.tsx),
 * решая, грузить ли гостю лёгкий сайт или приложение, — а useAuth тянет за
 * собой tRPC, react-query и Sentry с трассировкой.
 */
const SESSION_HINT = "wp.hadSession";

export function hadSession(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT) === "1";
  } catch {
    return false;
  }
}

export function setSessionHint(v: boolean) {
  try {
    if (v) localStorage.setItem(SESSION_HINT, "1");
    else localStorage.removeItem(SESSION_HINT);
  } catch {
    /* приватный режим — подсказки просто не будет */
  }
}
