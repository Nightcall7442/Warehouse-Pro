import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { format, parseISO, isToday, isYesterday } from "date-fns";
import { dateLocale } from "@/lib/date-locale";
import { ChevronRight, Clipboard, ClipboardList, RefreshCw, Plus, WifiOff } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useCurrency } from "@/hooks/useCurrency";
import { plural } from "@/lib/plural";
import { getPendingOrders } from "@/pages/OfflineOrders.helpers";
import { Donut, ProgressBar, EmptyState } from "@/components/phone/kit";
import { CARD, orderTone, orderStatusWord } from "@/components/phone/tones";

/**
 * «Мои заказы» для агента — экран «Заказы» мобилки v8 (Warehouse-Pro-Mobile,
 * app/(tabs)/orders.tsx): сводка и кнопка «Новый», три кольца (всего, новые,
 * выполнены), полоса выполнения, список по дням («Сегодня», «Вчера») и
 * круглая «+» внизу. Владелец, 25.09.2026: «все сделай абсолютно».
 *
 * Раньше агент попадал на общую страницу заказов — ту же, что оператор и
 * руководитель: выгрузки, диапазон дат, полтора экрана плиток с нулями. Ничем
 * из этого он не пользуется.
 *
 * Неотправленное без связи — плашкой сверху, как в мобилке: заказ,
 * оформленный в подвале магазина, не должен выглядеть пропавшим.
 */

type Order = {
  id: number;
  orderNumber: string;
  shopName: string | null;
  status: string;
  total: string | number | null;
  createdAt: string | Date | null;
};

/** «Сегодня», «Вчера» или «5 сентября» — как в мобильном приложении. */
function dayLabel(value: string | Date, uz: boolean): string {
  const d = typeof value === "string" ? parseISO(value) : value;
  if (isToday(d)) return uz ? "Bugun" : "Сегодня";
  if (isYesterday(d)) return uz ? "Kecha" : "Вчера";
  return format(d, "d MMMM", { locale: dateLocale(uz ? "uz" : "ru") });
}

const asDate = (v: string | Date) => (typeof v === "string" ? parseISO(v) : v);

function Ring({ value, total, color, label }: { value: number; total: number; color: string; label: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex-1 min-w-0 flex flex-col items-center" style={{ ...CARD, borderRadius: 20, padding: 12 }}>
      <Donut size={56} stroke={6} segments={[{ value: pct, color }, { value: 100 - pct, color: "transparent" }]} />
      <span className="font-data" style={{ fontSize: 17, fontWeight: 700, color: "var(--color-text-primary)", marginTop: 6 }}>{value}</span>
      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text-tertiary)" }}>{label}</span>
    </div>
  );
}

export default function AgentOrders() {
  const navigate = useNavigate();
  const { lang } = useLang();
  const { user } = useAuth();
  const { fmt } = useCurrency();
  const t = (r: string, u: string) => (lang === "uz" ? u : r);

  const { data, isLoading, isError, refetch, isFetching } = trpc.order.list.useQuery(
    { page: 1, pageSize: 200 },
    // Сервер сам сужает выборку до заказов агента (api/services/order.ts),
    // поэтому фильтр по себе тут не нужен и подделать его нельзя.
    { staleTime: 30_000 },
  );
  const orders = useMemo(() => (data?.data ?? []) as Order[], [data]);

  // Неотправленное лежит в браузере (IndexedDB) — читаем при открытии.
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    getPendingOrders(user.id).then(list => { if (alive) setPending(list.length); }).catch(() => {});
    return () => { alive = false; };
  }, [user]);

  const stats = useMemo(() => ({
    total: orders.length,
    fresh: orders.filter(o => o.status === "new").length,
    done: orders.filter(o => o.status === "delivered").length,
  }), [orders]);

  /*
    Группировка по дню. Порядок дней берём из самого списка, а не сортируем
    заново: сервер уже отдал заказы от свежих к старым, и повторная сортировка
    по дате разошлась бы с ним на заказах, оформленных в одну минуту.
  */
  const days = useMemo(() => {
    const out: { key: string; label: string; items: Order[] }[] = [];
    for (const o of orders) {
      if (!o.createdAt) continue;
      const key = format(asDate(o.createdAt), "yyyy-MM-dd");
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(o);
      else out.push({ key, label: dayLabel(o.createdAt, lang === "uz"), items: [o] });
    }
    return out;
  }, [orders, lang]);

  const donePct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  return (
    <div className="space-y-4 max-w-lg mx-auto pb-20" data-testid="agent-orders">
      {/* ── Сводка и «Новый» ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="hidden md:block font-display" style={{ fontSize: 24, fontWeight: 800, color: "var(--color-text-primary)", margin: 0 }}>
            {t("Мои заказы", "Buyurtmalarim")}
          </h1>
          <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0 }}>
            {isLoading
              ? t("Загружаем…", "Yuklanmoqda…")
              : t(`${stats.total} ${plural(stats.total, "заказ", "заказа", "заказов")} · ${stats.fresh} ${plural(stats.fresh, "новый", "новых", "новых")}`, `${stats.total} ta buyurtma · ${stats.fresh} ta yangi`)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Обновить вручную: связь в магазине рвётся, а потянуть список вниз, как в приложении, браузер не даёт. */}
          <button
            onClick={() => refetch()}
            aria-label={t("Обновить", "Yangilash")}
            className="flex items-center justify-center rounded-full"
            style={{ width: 40, height: 40, background: "var(--color-surface)", boxShadow: "var(--shadow-sm)", color: "var(--color-text-secondary)" }}
          >
            <RefreshCw size={16} className={isFetching ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => navigate("/orders/new")}
            className="flex items-center gap-1.5 rounded-xl"
            style={{ padding: "10px 14px", background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 13, fontWeight: 700 }}
          >
            <Plus size={14} /> {t("Новый", "Yangi")}
          </button>
        </div>
      </div>

      {/* ── Неотправленное без связи ── */}
      {pending > 0 && (
        <button
          type="button"
          onClick={() => navigate("/offline-orders")}
          data-testid="agent-orders-pending"
          className="w-full flex items-center gap-3 text-left"
          style={{ borderRadius: 20, padding: 14, background: "var(--color-warning-subtle)", border: "1px solid var(--color-warning)" }}
        >
          <WifiOff size={18} color="var(--color-warning-text)" className="flex-shrink-0" />
          <span className="flex-1 min-w-0">
            <span className="block" style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>
              {t(`${pending} ${plural(pending, "заказ не отправлен", "заказа не отправлены", "заказов не отправлены")}`, `${pending} ta buyurtma yuborilmadi`)}
            </span>
            <span className="block" style={{ fontSize: 12, fontWeight: 600, color: "var(--color-primary-text)", marginTop: 2 }}>
              {t("Открыть очередь отправки", "Yuborish navbatini ochish")}
            </span>
          </span>
          <ChevronRight size={16} color="var(--color-text-tertiary)" />
        </button>
      )}

      {/* ── Кольца и полоса выполнения ── */}
      {isLoading ? (
        <div className="flex gap-2">{[0, 1, 2].map(i => <div key={i} className="flex-1 h-[120px] rounded-3xl animate-pulse" style={{ background: "var(--color-surface-light)" }} />)}</div>
      ) : (
        <>
          <div className="flex gap-2">
            <Ring value={stats.total} total={stats.total} color="var(--color-info)" label={t("Всего", "Jami")} />
            <Ring value={stats.fresh} total={stats.total} color="var(--color-primary)" label={t("Новые", "Yangi")} />
            <Ring value={stats.done} total={stats.total} color="var(--color-success)" label={t("Выполнены", "Bajarildi")} />
          </div>
          {stats.total > 0 && <ProgressBar value={donePct} height={6} color="var(--color-success)" />}
        </>
      )}

      {isError && (
        <div className="text-center space-y-3" style={{ ...CARD, borderRadius: 20, padding: 20 }}>
          <p style={{ color: "var(--color-text-secondary)", margin: 0 }}>{t("Не удалось загрузить заказы", "Buyurtmalarni yuklab bo'lmadi")}</p>
          <button onClick={() => refetch()} className="neo-btn-primary">{t("Повторить", "Qayta urinish")}</button>
        </div>
      )}

      {!isLoading && !isError && days.length === 0 && (
        <div style={{ ...CARD, borderRadius: 20 }}>
          <EmptyState icon={ClipboardList} title={t("Заказов пока нет", "Hozircha buyurtma yo'q")} hint={t("Оформленные заказы появятся здесь", "Rasmiylashtirilgan buyurtmalar shu yerda ko'rinadi")} />
        </div>
      )}

      {days.map((day) => (
        <div key={day.key} className="space-y-2">
          <p className="px-1" style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-secondary)", margin: "4px 0 0" }}>{day.label}</p>
          {day.items.map((o) => {
            const tone = orderTone(o.status);
            const time = o.createdAt ? format(asDate(o.createdAt), "HH:mm") : "";
            return (
              <button
                key={o.id}
                onClick={() => navigate(`/orders/${o.id}`)}
                className="w-full text-left flex items-center gap-3 transition-transform active:scale-[.99]"
                style={{ ...CARD, borderRadius: 20, padding: 14 }}
                data-testid="agent-order-row"
              >
                <span className="flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, borderRadius: 10, background: "var(--color-primary-subtle)" }}>
                  <Clipboard size={16} color="var(--color-primary-text)" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate" style={{ fontSize: 15, fontWeight: 600, color: "var(--color-text-primary)" }}>
                    {o.shopName ?? o.orderNumber}
                  </span>
                  <span className="flex items-center gap-1.5 flex-wrap" style={{ fontSize: 12, marginTop: 2 }}>
                    <span style={{ color: "var(--color-text-tertiary)" }}>{o.orderNumber} · {time}</span>
                    <span style={{ fontWeight: 600, color: tone.text }}>
                      {o.status === "pending" ? t("Ждёт офиса", "Ofisni kutmoqda") : orderStatusWord(o.status, lang)}
                    </span>
                  </span>
                </span>
                <span className="font-data flex-shrink-0" style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>{fmt(Number(o.total ?? 0))}</span>
                <ChevronRight size={16} color="var(--color-text-tertiary)" className="flex-shrink-0" />
              </button>
            );
          })}
        </div>
      ))}

      {/* ── «+» над нижней панелью — как в мобилке ── */}
      <button
        type="button"
        onClick={() => navigate("/orders/new")}
        aria-label={t("Новый заказ", "Yangi buyurtma")}
        data-testid="agent-orders-fab"
        className="md:hidden fixed right-5 z-30 flex items-center justify-center rounded-full active:scale-95 transition-transform"
        style={{ bottom: "calc(76px + env(safe-area-inset-bottom, 0px))", width: 56, height: 56, background: "var(--color-primary)", color: "var(--color-on-primary)", boxShadow: "var(--shadow-lg)" }}
      >
        <Plus size={26} />
      </button>
    </div>
  );
}
