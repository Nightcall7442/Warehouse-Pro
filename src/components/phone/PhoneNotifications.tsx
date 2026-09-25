import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Bell, CheckSquare, CreditCard, Info, Loader2, Settings, ShoppingCart, Warehouse } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notificationText } from "@/lib/notification-text";
import { EmptyState } from "./kit";
import { CARD } from "./tones";

/*
  Уведомления на телефоне — экран мобилки v8 (Warehouse-Pro-Mobile,
  app/notifications.tsx): сколько непрочитанного и «прочитать всё» значком,
  две вкладки «Все / Непрочитанные», строка — значок, заголовок, текст и
  время; непрочитанное выделено подложкой цвета бренда, а не точкой сбоку:
  точку в ленте из тридцати строк не видно. Владелец, 25.09.2026.
*/
const ICON: Record<string, LucideIcon> = { order: ShoppingCart, payment: CreditCard, stock: Warehouse, system: Settings };
const PAGE = 30;

export function PhoneNotifications() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [unreadOnly, setUnreadOnly] = useState(false);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = trpc.notification.list.useInfiniteQuery(
    { unreadOnly, limit: PAGE },
    { getNextPageParam: last => (last.hasMore ? last.items[last.items.length - 1]?.id : undefined) },
  );
  const { data: counts } = trpc.notification.counts.useQuery();
  const refresh = () => {
    utils.notification.list.invalidate();
    utils.notification.counts.invalidate();
    utils.notification.unreadCount.invalidate();
  };
  const markAll = trpc.notification.markAllRead.useMutation({ onSuccess: refresh });
  const markOne = trpc.notification.markRead.useMutation({ onSuccess: refresh });

  const items = useMemo(() => data?.pages.flatMap(p => p.items) ?? [], [data?.pages]);
  const unread = counts?.unread ?? 0;

  return (
    <div className="space-y-3 animate-fade-up" data-testid="phone-notifications">
      <div className="flex items-center justify-between gap-3">
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
          {unread > 0 ? t(`${unread} непрочитанных`, `${unread} ta o'qilmagan`) : t("Всё прочитано", "Hammasi o'qilgan")}
        </p>
        {unread > 0 && (
          <button type="button" onClick={() => markAll.mutate()} disabled={markAll.isPending} aria-label={t("Отметить всё прочитанным", "Hammasini o'qilgan deb belgilash")}
            className="flex items-center justify-center rounded-2xl flex-shrink-0" style={{ ...CARD, width: 44, height: 44, color: "var(--color-text-secondary)", opacity: markAll.isPending ? 0.5 : 1 }}>
            {markAll.isPending ? <Loader2 size={17} className="animate-spin" /> : <CheckSquare size={17} />}
          </button>
        )}
      </div>

      <div className="flex gap-2">
        {[
          { key: false, label: t("Все", "Hammasi") },
          { key: true, label: unread > 0 ? t(`Непрочитанные · ${unread}`, `O'qilmagan · ${unread}`) : t("Непрочитанные", "O'qilmagan") },
        ].map(tab => {
          const on = unreadOnly === tab.key;
          return (
            <button key={String(tab.key)} type="button" aria-pressed={on} onClick={() => setUnreadOnly(tab.key)} className="flex-1 rounded-2xl"
              style={{ minHeight: 44, fontSize: 13, fontWeight: 600, background: on ? "var(--color-primary)" : "var(--color-surface)", color: on ? "var(--color-on-primary)" : "var(--color-text-secondary)", boxShadow: on ? "none" : "var(--shadow-sm)" }}>
              {tab.label}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 size={22} className="animate-spin" color="var(--color-primary-text)" /></div>
      ) : isError ? (
        <div style={{ ...CARD, borderRadius: 24 }}><EmptyState icon={Info} title={t("Не удалось загрузить", "Yuklab bo'lmadi")} /></div>
      ) : items.length === 0 ? (
        <div style={{ ...CARD, borderRadius: 24 }}>
          <EmptyState
            icon={Bell}
            title={unreadOnly ? t("Непрочитанных нет", "O'qilmaganlar yo'q") : t("Уведомлений нет", "Bildirishnomalar yo'q")}
            hint={unreadOnly ? t("Всё, что приходило, вы уже открыли", "Kelganlarning hammasini ochgansiz") : t("Здесь появятся заказы, оплаты и остатки", "Bu yerda buyurtmalar, to'lovlar va qoldiqlar chiqadi")}
          />
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(n => {
            const Icon = ICON[n.type] ?? Info;
            const text = notificationText(n, lang);
            const when = new Date(n.createdAt).toLocaleString(lang === "uz" ? "uz-Latn-UZ" : "ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
            return (
              <button
                key={n.id}
                type="button"
                data-testid="phone-notification"
                onClick={() => { if (!n.isRead) markOne.mutate({ id: n.id }); if (n.link) navigate(n.link); }}
                className="w-full text-left flex items-start gap-3"
                style={{ padding: 16, borderRadius: 24, background: n.isRead ? "var(--color-surface)" : "var(--color-primary-subtle)", boxShadow: n.isRead ? "var(--shadow-sm)" : "none" }}
              >
                <span className="flex items-center justify-center flex-shrink-0" style={{ width: 34, height: 34, borderRadius: 12, background: "var(--color-surface-light)" }}>
                  <Icon size={16} color={n.isRead ? "var(--color-text-tertiary)" : "var(--color-primary-text)"} />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block" style={{ fontSize: 15, fontWeight: n.isRead ? 500 : 700, color: "var(--color-text-primary)" }}>{text.title}</span>
                  {text.message && <span className="block" style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 2 }}>{text.message}</span>}
                  <span className="block font-data" style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 4 }}>{when}</span>
                </span>
              </button>
            );
          })}
          {hasNextPage && (
            <button type="button" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="neo-btn w-full" style={{ minHeight: 44 }}>
              {isFetchingNextPage && <Loader2 size={13} className="animate-spin" />}
              {t("Показать ещё", "Yana ko'rsatish")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
