// Thin wrapper around sonner so we can swap implementations easily
import { toast } from "sonner";

export const notify = {
  success: (msg: string) => toast.success(msg),
  error:   (msg: string) => toast.error(msg),
  info:    (msg: string) => toast.info(msg),
  loading: (msg: string) => toast.loading(msg),
  dismiss: (id?: string | number) => toast.dismiss(id),
};

/*
  О чём молчать, когда наверх всплыла необработанная ошибка.

  Здесь нечего чинить и не о чем беспокоить: приложение работает дальше.
  Список нужен ровно для этого, а не для отсева «шумного» вообще — всё
  остальное человек увидит одной фразой, а текст уйдёт в консоль и в Sentry.
*/
const QUIET = [
  // Служебный работник и его кэш. Приложение прекрасно живёт без него: без
  // офлайна, но целиком рабочее. Сюда же случай, когда браузер запрещает
  // регистрацию вовсе — частное окно, старый iOS, встроенная панель.
  "workbox",
  "non-precached-url",
  "createHandlerBoundToURL",
  "ServiceWorker",
  "serviceWorker",
  // Обрыв связи. У агента мобильный интернет в подсобке магазина — это
  // будни, а не происшествие, и о самой потере связи говорит признак в шапке.
  "net::ERR",
  "Failed to fetch",
  "NetworkError",
  // Подгрузка куска приложения после выкладки: новая версия, старые имена
  // файлов. Лечится перезагрузкой, этим занимается stale-app-recovery.
  "Loading chunk",
  "dynamically imported module",
];

/**
 * Говорить ли человеку о необработанной ошибке.
 *
 * Раньше в тост уходил САМ текст ошибки, а отсев был списком подстрок,
 * который приходилось пополнять на каждый новый шумный случай. Любая
 * незнакомая ошибка проливалась наружу как есть: агент в магазине видел
 * английский текст уровня стека — «Failed to register a ServiceWorker for
 * scope ('...') with script ('...'): An unknown error occurred when fetching
 * the script» — на пол-экрана и ни о чём.
 */
export function shouldTellUser(msg: string): boolean {
  if (QUIET.some((q) => msg.includes(q))) return false;
  // Сетевые ошибки tRPC — тот же обрыв связи, только с другой стороны.
  // Серверные (500) пропускаем: это уже поломка, а не связь.
  if (msg.includes("TRPCClientError") && !msg.includes("500") && !msg.includes("INTERNAL_SERVER_ERROR")) return false;
  return true;
}
