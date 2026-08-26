import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { Loader2, Send, CheckCircle2, XCircle, CalendarDays, ShoppingCart, Package, AlertTriangle } from "lucide-react";

export function TelegramSettings() {
  const [chatId, setChatId] = useState("");
  const { lang } = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { data: status } = trpc.telegram.myStatus.useQuery();
  const { data: deepLink } = trpc.telegram.deepLink.useQuery();
  const utils = trpc.useUtils();
  const save   = trpc.telegram.saveChatId.useMutation({
    onSuccess: () => { utils.telegram.myStatus.invalidate(); notify.success(t("Telegram подключён!", "Telegram ulandi!")); },
    onError:   (e) => notify.error(e.message),
  });
  const remove = trpc.telegram.removeChatId.useMutation({
    onSuccess: () => { utils.telegram.myStatus.invalidate(); notify.success(t("Telegram отключён", "Telegram uzildi")); },
    onError:   (e) => notify.error(e.message),
  });

  return (
    <div className="space-y-4">
      {status?.connected ? (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg"
          style={{ background: "rgba(74,222,128,.10)", border: "1px solid rgba(74,222,128,.25)" }}>
          <CheckCircle2 size={18} className="text-success flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-primary">{t("Telegram подключён", "Telegram ulangan")}</p>
            <p className="text-xs text-secondary mt-0.5">chat_id: {status.chatId}</p>
          </div>
          <button onClick={() => remove.mutate()} disabled={remove.isPending}
            className="neo-btn h-9 px-3 text-xs flex items-center gap-1.5"
            style={{ color: "var(--color-danger)" }}>
            {remove.isPending ? <Loader2 size={11} className="animate-spin" /> : <XCircle size={11} />}
            {t("Отключить", "Uzish")}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* One-tap deep link */}
          {deepLink?.url && (
            <a href={deepLink.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-3 rounded-lg transition-all hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #0072ad, #005f8f)", color: "#fff" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z"/>
              </svg>
              <div>
                <p className="text-sm font-semibold">{t("Подключить в 1 клик", "1 bosishda ulash")}</p>
                <p className="text-xs">{t("Откроется Telegram бот", "Telegram bot ochiladi")}</p>
              </div>
            </a>
          )}

          <div className="px-4 py-3 rounded-lg space-y-2 text-sm" style={{ background: "var(--color-surface-light, #f6f4f0)" }}>
            <p className="font-medium text-primary">{t("Или вручную:", "Yoki qo'lda:")}</p>
            <ol className="list-decimal list-inside space-y-1.5 text-secondary">
              <li>{t("Откройте Telegram → найдите", "Telegramni oching →")} <code className="px-1 rounded text-primary" style={{ background: "var(--color-primary-subtle)" }}>@userinfobot</code></li>
              <li>{t("Нажмите /start — получите свой числовой ID", "/start → raqamli ID olasiz")}</li>
              <li>{t("Вставьте ID ниже и нажмите «Подключить»", "ID-ni quyida kiriting va «Ulash» tugmasini bosing")}</li>
            </ol>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-secondary mb-1.5">
              {t("Ваш Telegram chat ID", "Telegram chat ID")}
            </label>
            <div className="flex gap-2">
              <input className="neo-input flex-1 font-data"
                placeholder={t("Например: 123456789", "Masalan: 123456789")}
                value={chatId} onChange={e => setChatId(e.target.value.replace(/\D/g, ""))} />
              <button onClick={() => chatId && save.mutate({ chatId })}
                disabled={save.isPending || !chatId}
                className="neo-btn-primary flex items-center gap-2 disabled:opacity-40">
                {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {t("Подключить", "Ulash")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--color-border, #d8d5cd)", paddingTop: 16 }}>
        <p className="text-sm font-semibold text-primary mb-3">
          {t("Вы будете получать", "Quyidagilarni olasiz")}
        </p>
        <ul className="space-y-2.5 text-sm text-secondary">
          {[
            { Icon: CalendarDays,  text: t("План визитов утром",           "Tashrif rejasi ertalab") },
            { Icon: ShoppingCart,  text: t("Подтверждение новых заказов",  "Yangi buyurtmalar tasdiqi") },
            { Icon: Package,       text: t("Изменение статуса заказа",     "Buyurtma holati o'zgarishi") },
            { Icon: AlertTriangle, text: t("Низкий остаток на складе",     "Omborda kam qoldiq") },
          ].map(({ Icon, text }) => (
            <li key={text} className="flex items-center gap-2.5">
              <Icon size={15} className="flex-shrink-0 text-tertiary" />
              {text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
