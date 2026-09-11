/**
 * Новая версия приложения — по кнопке, а не перезагрузкой посреди работы.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Служебный работник собирался в режиме autoUpdate с skipWaiting: клиент
 * vite-plugin-pwa на событии «новая версия установлена» делал
 * window.location.reload() без вопроса. Выкладки идут почти ежедневно, а
 * форма прихода на сорок позиций держит всё в useState без черновика —
 * оператор терял набранное в самый рабочий час, и это выглядело как
 * «программа сама перезагружается».
 *
 * Теперь режим prompt: новая версия ждёт, пока человек нажмёт «Обновить».
 * Тост не исчезает сам и не мешает работать; обновиться можно и позже —
 * при следующем открытии вкладки новая версия встанет сама.
 */
import { useEffect } from "react";
import { toast } from "sonner";
import { useRegisterSW } from "virtual:pwa-register/react";
import { useTranslate } from "@/i18n";

const TOAST_ID = "app-update";

export function UpdatePrompt() {
  const t = useTranslate();
  const { needRefresh: [needRefresh, setNeedRefresh], updateServiceWorker } = useRegisterSW();

  useEffect(() => {
    if (!needRefresh) return;
    toast.info(t("Доступна новая версия", "Yangi versiya mavjud"), {
      id: TOAST_ID,
      duration: Infinity,
      description: t("Обновите, когда закончите текущее действие.", "Joriy amalni tugatgach yangilang."),
      action: {
        label: t("Обновить", "Yangilash"),
        onClick: () => { void updateServiceWorker(true); },
      },
      onDismiss: () => setNeedRefresh(false),
    });
    return () => { toast.dismiss(TOAST_ID); };
  }, [needRefresh, setNeedRefresh, updateServiceWorker, t]);

  return null;
}
