import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { format, isToday, isYesterday } from "date-fns";
import { ru as dateRu } from "date-fns/locale";
import {
  Bell, BellOff, Check, CheckCheck, ChevronRight, CreditCard,
  Loader2, Settings, ShoppingCart, Warehouse,
} from "lucide-react";

/**
 * Уведомления.
 *
 * ── Что было не так ─────────────────────────────────────────────────────────
 *
 * Страница брала первые пятьдесят записей и фильтровала их у себя. На ленте,
 * где заказов много, а платежей мало, вкладка «Платежи» писала «нет уведомлений
 * в этой категории» — при том что они были, просто не попали в первые
 * пятьдесят. Листать дальше было нечем: ручка умела страницы, страница их не
 * просила.
 *
 * Оформление тоже было мимо системы приложения: разделители строк рисовались
 * цветом `#f0f3f8`, а рамка выбранной вкладки — `#c7c9f8`. Оба из отменённой
 * сине-серой палитры и оба вписаны числом, а не токеном: на тёмной теме это
 * светлые полосы поперёк карточки.
 *
 * ── Что здесь теперь ────────────────────────────────────────────────────────
 *
 * Отбор и листание считает сервер. Вкладки показывают, сколько непрочитанного
 * каждого рода: пустая вкладка без числа не отличается от вкладки, где ничего
 * не ждёт, — а разница как раз в том, куда идти первым делом.
 *
 * Прочитать можно, не открывая: раньше единственный способ убрать метку был
 * перейти по ссылке, то есть уйти со страницы после каждой строки.
 */

type TypeKey = "order" | "payment" | "stock" | "system";

const TYPES: Record<TypeKey, {
  icon: React.ComponentType<{ size?: number }>;
  fill: string;
  ink: string;
  label: { ru: string; uz: string };
}> = {
  order:   { icon: ShoppingCart, fill: "var(--color-primary-subtle)", ink: "var(--color-primary-text)",                    label: { ru: "Заказ",   uz: "Buyurtma" } },
  payment: { icon: CreditCard,   fill: "var(--color-success-subtle)", ink: "var(--color-success-text, var(--color-success))", label: { ru: "Платёж",  uz: "To'lov" } },
  stock:   { icon: Warehouse,    fill: "var(--color-warning-subtle)", ink: "var(--color-warning-text, var(--color-warning))", label: { ru: "Склад",   uz: "Ombor" } },
  system:  { icon: Settings,     fill: "var(--color-info-subtle)",    ink: "var(--color-info)",                            label: { ru: "Система", uz: "Tizim" } },
};

const TABS: Array<{ key: "all" | TypeKey; label: { ru: string; uz: string } }> = [
  { key: "all",     label: { ru: "Все",     uz: "Hammasi" } },
  { key: "order",   label: { ru: "Заказы",  uz: "Buyurtmalar" } },
  { key: "stock",   label: { ru: "Склад",   uz: "Ombor" } },
  { key: "payment", label: { ru: "Платежи", uz: "To'lovlar" } },
  { key: "system",  label: { ru: "Система", uz: "Tizim" } },
];

const PAGE = 30;

function ago(date: Date, lang: string): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return lang === "uz" ? "Hozirgina" : "только что";
  if (sec < 3600) return `${Math.floor(sec / 60)} ${lang === "uz" ? "daq" : "мин"}`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} ${lang === "uz" ? "soat" : "ч"}`;
  return format(date, "d MMM, HH:mm", { locale: lang === "ru" ? dateRu : undefined });
}

function dayTitle(date: Date, lang: string): string {
  if (isToday(date)) return lang === "uz" ? "Bugun" : "Сегодня";
  if (isYesterday(date)) return lang === "uz" ? "Kecha" : "Вчера";
  return format(date, "d MMMM yyyy", { locale: lang === "ru" ? dateRu : undefined });
}

export default function Notifications() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const [tab, setTab] = useState<"all" | TypeKey>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);

  /*
    Листание по ключу, а не по номеру страницы.

    Продолжение — это идентификатор самой старой показанной записи. Пока
    человек читает, приходят новые уведомления; «страница 2» после этого
    повторила бы уже показанное, сдвинувшись на позицию вниз.

    Смена вкладки сама начинает ленту заново — отбор входит в ключ запроса, и
    сбрасывать накопленное руками не нужно.
  */
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    trpc.notification.list.useInfiniteQuery(
      { type: tab === "all" ? undefined : tab, unreadOnly, limit: PAGE },
      { getNextPageParam: last => (last.hasMore ? last.items[last.items.length - 1]?.id : undefined) },
    );

  const { data: counts } = trpc.notification.counts.useQuery();

  const refresh = () => {
    utils.notification.list.invalidate();
    utils.notification.counts.invalidate();
    utils.notification.unreadCount.invalidate();
  };

  const markAllRead = trpc.notification.markAllRead.useMutation({ onSuccess: refresh });
  const markRead = trpc.notification.markRead.useMutation({ onSuccess: refresh });

  const items = useMemo(() => data?.pages.flatMap(p => p.items) ?? [], [data?.pages]);
  const unread = counts?.unread ?? 0;

  const open = (n: Item) => {
    if (!n.isRead) markRead.mutate({ id: n.id });
    if (n.link) navigate(n.link);
  };

  const days = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const n of items) {
      const d = new Date(n.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      (map.get(key) ?? map.set(key, []).get(key)!).push(n);
    }
    return [...map.values()];
  }, [items]);

  return (
    <div className="max-w-3xl mx-auto animate-fade-up" style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
      {/* ── Шапка ────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
        <div style={{
          width: "46px", height: "46px", borderRadius: "16px", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "linear-gradient(135deg, var(--color-primary), var(--accent-teal, #3a9a8a))",
          color: "var(--color-on-primary)", boxShadow: "var(--shadow-sm)",
        }}>
          <Bell size={21} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: "21px", fontWeight: 700, color: "var(--color-text-primary)", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
            {t("Уведомления", "Bildirishnomalar")}
          </h1>
          <p style={{ fontSize: "12.5px", color: "var(--color-text-secondary)", marginTop: "3px" }}>
            {unread > 0
              ? `${unread} ${t("ждут внимания", "e'tibor kutmoqda")}`
              : t("Всё прочитано", "Hammasi o'qilgan")}
          </p>
        </div>
        {unread > 0 && (
          <button
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="neo-btn"
            style={{ flexShrink: 0, fontSize: "12px", padding: "9px 14px" }}
          >
            {markAllRead.isPending ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCheck size={14} />}
            {t("Прочитать все", "Hammasini o'qish")}
          </button>
        )}
      </div>

      {/* ── Вкладки ──────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", overflowX: "auto", paddingBottom: "2px" }} className="premium-scrollbar">
        {TABS.map(tabItem => {
          const active = tab === tabItem.key;
          // Число на вкладке — это НЕПРОЧИТАННОЕ, а не всего. Всего — цифра ни
          // о чём: она не подсказывает, куда идти.
          const n = tabItem.key === "all" ? unread : (counts?.byType?.[tabItem.key] ?? 0);
          return (
            <button
              key={tabItem.key}
              onClick={() => setTab(tabItem.key)}
              style={{
                flexShrink: 0, display: "inline-flex", alignItems: "center", gap: "7px",
                padding: "8px 14px", borderRadius: "999px", border: "none", cursor: "pointer",
                fontFamily: "inherit", fontSize: "12px", fontWeight: 600,
                background: active ? "var(--color-primary-subtle)" : "var(--color-surface)",
                color: active ? "var(--color-primary-text)" : "var(--color-text-secondary)",
                boxShadow: active ? "var(--shadow-pressed)" : "var(--shadow-sm)",
                transition: "box-shadow 0.2s ease, background 0.15s ease",
              }}
            >
              {t(tabItem.label.ru, tabItem.label.uz)}
              {n > 0 && (
                <span style={{
                  minWidth: "18px", height: "18px", borderRadius: "9px", padding: "0 5px",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: "var(--color-danger-strong)", color: "#fff",
                  fontSize: "10px", fontWeight: 700, fontVariantNumeric: "tabular-nums",
                }}>{n > 99 ? "99+" : n}</span>
              )}
            </button>
          );
        })}

        <button
          onClick={() => setUnreadOnly(v => !v)}
          style={{
            marginLeft: "auto", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: "6px",
            padding: "8px 14px", borderRadius: "999px", border: "none", cursor: "pointer",
            fontFamily: "inherit", fontSize: "12px", fontWeight: 600,
            background: unreadOnly ? "var(--color-primary-subtle)" : "var(--color-surface)",
            color: unreadOnly ? "var(--color-primary-text)" : "var(--color-text-secondary)",
            boxShadow: unreadOnly ? "var(--shadow-pressed)" : "var(--shadow-sm)",
            transition: "box-shadow 0.2s ease, background 0.15s ease",
          }}
        >
          <Check size={13} />
          {t("Непрочитанные", "O'qilmaganlar")}
        </button>
      </div>

      {/* ── Лента ────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="neo-card neo-card-static" style={{ padding: "18px", display: "flex", flexDirection: "column", gap: "12px" }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <div style={{ width: "38px", height: "38px", borderRadius: "13px", background: "var(--color-surface-light)", animation: "shimmer 1.6s infinite" }} />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ height: "11px", width: "45%", borderRadius: "6px", background: "var(--color-surface-light)" }} />
                <div style={{ height: "9px", width: "70%", borderRadius: "6px", background: "var(--color-surface-light)" }} />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Empty t={t} unreadOnly={unreadOnly} filtered={tab !== "all"} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
          {days.map(group => (
            <div key={String(group[0].id)}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", margin: "0 4px 8px" }}>
                <span style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-tertiary)" }}>
                  {dayTitle(new Date(group[0].createdAt), lang)}
                </span>
                <div style={{ flex: 1, height: "1px", background: "var(--color-border-subtle)" }} />
              </div>

              <div className="neo-card neo-card-static" style={{ padding: "6px", display: "flex", flexDirection: "column", gap: "4px" }}>
                {group.map(n => (
                  <Row
                    key={n.id}
                    n={n}
                    lang={lang}
                    t={t}
                    onOpen={() => open(n)}
                    onRead={() => markRead.mutate({ id: n.id })}
                  />
                ))}
              </div>
            </div>
          ))}

          {hasNextPage && (
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="neo-btn"
              style={{ alignSelf: "center", fontSize: "12px", padding: "10px 20px" }}
            >
              {isFetchingNextPage && <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />}
              {t("Показать ещё", "Yana ko'rsatish")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type Item = {
  id: number;
  type: string;
  title: string;
  message: string | null;
  isRead: boolean;
  link: string | null;
  createdAt: Date | string;
};

/**
 * Строка ленты.
 *
 * Непрочитанное отмечено полосой у края и плотным начертанием заголовка: видно
 * на просмотр сверху вниз, не вчитываясь в каждую. Одной точки для этого мало —
 * её ищут глазами по всей ширине.
 */
function Row({ n, lang, t, onOpen, onRead }: {
  n: Item;
  lang: string;
  t: (ru: string, uz: string) => string;
  onOpen: () => void;
  onRead: () => void;
}) {
  const style = TYPES[(n.type as TypeKey)] ?? TYPES.system;
  const Icon = style.icon;
  const clickable = Boolean(n.link);

  return (
    <div
      onClick={clickable ? onOpen : undefined}
      style={{
        position: "relative", display: "flex", alignItems: "flex-start", gap: "12px",
        padding: "12px 14px", borderRadius: "16px", overflow: "hidden",
        cursor: clickable ? "pointer" : "default",
        background: n.isRead ? "transparent" : "var(--color-surface-light)",
        transition: "background 0.15s ease",
      }}
    >
      {!n.isRead && (
        <span style={{
          position: "absolute", left: 0, top: "10px", bottom: "10px", width: "3px",
          borderRadius: "0 3px 3px 0", background: "var(--color-primary)",
        }} />
      )}

      <div style={{
        width: "38px", height: "38px", borderRadius: "13px", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: style.fill, color: style.ink,
      }}>
        <Icon size={17} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: "13.5px", lineHeight: 1.4, color: "var(--color-text-primary)",
          fontWeight: n.isRead ? 500 : 700,
        }}>
          {n.title}
        </p>
        {n.message && (
          <p style={{ fontSize: "12px", lineHeight: 1.5, color: "var(--color-text-secondary)", marginTop: "3px" }}>
            {n.message}
          </p>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
          <span style={{ fontSize: "10.5px", color: "var(--color-text-tertiary)" }}>{ago(new Date(n.createdAt), lang)}</span>
          <span style={{ fontSize: "10.5px", color: style.ink, fontWeight: 600 }}>
            {style.label[lang === "uz" ? "uz" : "ru"]}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0, alignSelf: "center" }}>
        {/* Прочитать, НЕ открывая. Раньше метку снимал только переход по
            ссылке — то есть уйти со страницы после каждой строки. */}
        {!n.isRead && (
          <button
            onClick={e => { e.stopPropagation(); onRead(); }}
            className="neo-btn-icon"
            aria-label={t("Отметить прочитанным", "O'qilgan deb belgilash")}
            title={t("Отметить прочитанным", "O'qilgan deb belgilash")}
            style={{ width: "30px", height: "30px", borderRadius: "10px" }}
          >
            <Check size={14} />
          </button>
        )}
        {clickable && <ChevronRight size={16} style={{ color: "var(--color-text-tertiary)" }} />}
      </div>
    </div>
  );
}

function Empty({ t, unreadOnly, filtered }: { t: (ru: string, uz: string) => string; unreadOnly: boolean; filtered: boolean }) {
  // Три разных пустоты. «Ничего нет» там, где просто отобрано не то, отправляет
  // человека искать поломку вместо того, чтобы снять отбор.
  const [title, hint] = unreadOnly
    ? [t("Непрочитанного нет", "O'qilmaganlar yo'q"), t("Всё разобрано. Снимите отбор, чтобы посмотреть прежние.", "Hammasi ko'rib chiqilgan. Avvalgilarini ko'rish uchun filtrni oling.")]
    : filtered
      ? [t("В этом разделе пусто", "Bu bo'limda bo'sh"), t("Выберите «Все», чтобы посмотреть остальные.", "Qolganlarini ko'rish uchun «Hammasi»ni tanlang.")]
      : [t("Уведомлений нет", "Bildirishnomalar yo'q"), t("Новый заказ, низкий остаток или платёж появятся здесь.", "Yangi buyurtma, kam qoldiq yoki to'lov shu yerda paydo bo'ladi.")];

  return (
    <div className="neo-card neo-card-static" style={{ padding: "48px 24px", textAlign: "center" }}>
      <div style={{
        width: "58px", height: "58px", borderRadius: "20px", margin: "0 auto 16px",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--color-surface)", color: "var(--color-text-tertiary)",
        boxShadow: "var(--shadow-raised)",
      }}>
        <BellOff size={24} />
      </div>
      <p style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "6px" }}>{title}</p>
      <p style={{ fontSize: "13px", lineHeight: 1.6, color: "var(--color-text-tertiary)", maxWidth: "340px", margin: "0 auto" }}>{hint}</p>
    </div>
  );
}
