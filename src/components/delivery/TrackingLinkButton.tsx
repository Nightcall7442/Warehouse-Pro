import { useState } from "react";
import { Link2, Send } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { errorText } from "@/lib/error-text";
import { telegramShareUrl, trackingShareText } from "./links";

/*
  «Ссылка для магазина» — страница «где мой заказ» (/t/<метка>).

  Магазин звонит агенту «когда привезут?», агент звонит курьеру, курьер за
  рулём. Ссылка отвечает сама: принят, у курьера, в пути, доставлен — и
  примерно через сколько, без точного места машины и без фамилии курьера.

  Ссылка просится по нажатию, а не при открытии карточки: подписанная метка
  нужна только тому, кто её отправляет.
*/

export function TrackingLinkButton({ orderId }: { orderId: number }) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const utils = trpc.useUtils();
  const [link, setLink] = useState<{ url: string; number: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchLink = async () => {
    if (link) return link;
    setBusy(true);
    try {
      const r = await utils.order.trackingLink.fetch({ id: orderId });
      setLink(r);
      return r;
    } catch (e) {
      notify.error(errorText(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const r = await fetchLink();
    if (!r) return;
    try {
      await navigator.clipboard.writeText(r.url);
      notify.success(t("Ссылка скопирована — отправьте её магазину", "Havola nusxalandi — do'konga yuboring"));
    } catch {
      // Буфер обмена закрыт (старый браузер, не https) — ссылка остаётся на экране.
      notify.info(t("Скопируйте ссылку из поля ниже", "Havolani pastdagi maydondan nusxalang"));
    }
  };

  /*
    Telegram — обычной ссылкой, когда метка уже на экране: окно, открытое
    после ожидания ответа сервера, браузер считает всплывающим и режет.
  */
  return (
    <div className="space-y-2" data-testid="tracking-link">
      <div className="flex gap-2 flex-wrap">
        <button type="button" onClick={copy} disabled={busy} className="neo-btn tap flex items-center gap-1.5 text-sm flex-1 justify-center"
          style={{ minHeight: 40 }} data-testid="tracking-link-copy">
          <Link2 size={14} />{link ? t("Скопировать ссылку", "Havolani nusxalash") : t("Ссылка для магазина", "Do'kon uchun havola")}
        </button>
        {link && (
          <a href={telegramShareUrl(link.url, trackingShareText(link.number))} target="_blank" rel="noopener noreferrer"
            className="neo-btn tap flex items-center gap-1.5 text-sm justify-center" style={{ minHeight: 40, padding: "0 12px" }}
            aria-label={t("Отправить в Telegram", "Telegramda yuborish")} data-testid="tracking-link-telegram">
            <Send size={14} />Telegram
          </a>
        )}
      </div>
      {link && (
        <input readOnly value={link.url} onFocus={e => e.currentTarget.select()} className="neo-input w-full text-xs font-data"
          aria-label={t("Ссылка для магазина", "Do'kon uchun havola")} data-testid="tracking-link-url" />
      )}
    </div>
  );
}
