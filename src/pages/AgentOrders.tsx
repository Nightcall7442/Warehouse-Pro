import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { format, parseISO, isToday, isYesterday } from "date-fns";
import { ru as ruLocale } from "date-fns/locale";
import { ChevronRight, ClipboardList, RefreshCw, Plus } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { STATUS } from "@/components/orders/theme-tokens";

/**
 * «Мои заказы» для агента: просто список своих заказов и переход в карточку.
 *
 * Раньше агент попадал на общую страницу заказов — ту же, что оператор и
 * руководитель. На телефоне это выглядело так: два поля выбора дат, кнопки
 * «Excel» и «PDF», а под ними столбик плиток со счётчиками — «ВСЕГО 0»,
 * «НОВЫЕ 0», «В ОБРАБОТКЕ 0»... При нуле заказов страница занимала 1762
 * точки, и агент листал полтора экрана нулей, прежде чем дойти до списка.
 * Ничем из этого он не пользуется: выгрузки делает офис, диапазон дат ему
 * не нужен, а сводка по своим заказам уже есть на «Дне».
 *
 * Форма взята из мобильного приложения (app/(tabs)/orders.tsx): список,
 * разбитый по дням, с «Сегодня» и «Вчера» вместо дат. Так агент за секунду
 * находит заказ, который только что оформил, — а именно за этим он сюда и
 * заходит.
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
  return format(d, "d MMMM", uz ? undefined : { locale: ruLocale });
}

export default function AgentOrders() {
  const navigate = useNavigate();
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (r: string, u: string) => (lang === "uz" ? u : r);

  // Архив нужен редко, но нужен: заказ недельной давности иначе не найти.
  const [archived, setArchived] = useState(false);

  const { data, isLoading, isError, refetch, isFetching } = trpc.order.list.useQuery(
    { page: 1, pageSize: 100, archived },
    // Сервер сам сужает выборку до заказов агента (api/services/order.ts),
    // поэтому фильтр по себе тут не нужен и подделать его нельзя.
    { staleTime: 30_000 },
  );

  const orders = useMemo(() => (data?.data ?? []) as Order[], [data]);

  /*
    Группировка по дню. Порядок дней берём из самого списка, а не сортируем
    заново: сервер уже отдал заказы от свежих к старым, и повторная сортировка
    по дате разошлась бы с ним на заказах, оформленных в одну минуту.
  */
  const days = useMemo(() => {
    const out: { key: string; label: string; items: Order[] }[] = [];
    for (const o of orders) {
      if (!o.createdAt) continue;
      const key = format(typeof o.createdAt === "string" ? parseISO(o.createdAt) : o.createdAt, "yyyy-MM-dd");
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(o);
      else out.push({ key, label: dayLabel(o.createdAt, lang === "uz"), items: [o] });
    }
    return out;
  }, [orders, lang]);

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary tracking-tight">
            {t("Мои заказы", "Buyurtmalarim")}
          </h1>
          <p className="text-sm" style={{ color: "var(--color-text-tertiary)" }}>
            {isLoading ? t("Загружаем…", "Yuklanmoqda…") : t(`${orders.length} за период`, `${orders.length} ta`)}
          </p>
        </div>
        {/* Обновить вручную: связь в магазине рвётся, и ждать фонового
            обновления агенту неоткуда — он не знает, что оно вообще есть. */}
        <button
          onClick={() => refetch()}
          aria-label={t("Обновить", "Yangilash")}
          className="tap flex items-center justify-center rounded-xl border transition-colors"
          style={{ borderColor: "var(--color-border, #d8d5cd)" }}
        >
          <RefreshCw size={18} className={isFetching ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex gap-2">
        {([false, true] as const).map((arch) => (
          <button
            key={String(arch)}
            onClick={() => setArchived(arch)}
            className="tap flex-1 rounded-xl font-medium text-sm transition-colors"
            style={
              archived === arch
                ? { background: "var(--color-primary)", color: "var(--color-on-primary, #fff)" }
                : { border: "1px solid var(--color-border, #d8d5cd)", color: "var(--color-text-secondary)" }
            }
          >
            {arch ? t("Архив", "Arxiv") : t("Активные", "Faol")}
          </button>
        ))}
      </div>

      {isError && (
        <div className="rounded-2xl p-5 text-center space-y-3" style={{ background: "var(--color-surface-raised, #262320)" }}>
          <p style={{ color: "var(--color-text-secondary)" }}>
            {t("Не удалось загрузить заказы", "Buyurtmalarni yuklab bo'lmadi")}
          </p>
          <button onClick={() => refetch()} className="neo-btn-primary tap px-6 rounded-xl">
            {t("Повторить", "Qayta urinish")}
          </button>
        </div>
      )}

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl h-[76px] animate-pulse" style={{ background: "var(--color-surface-raised, #262320)" }} />
          ))}
        </div>
      )}

      {!isLoading && !isError && days.length === 0 && (
        // Пустой экран не оставляем немым: агент должен понять, что всё в
        // порядке, и куда идти дальше.
        <div className="rounded-2xl p-8 text-center space-y-4" style={{ background: "var(--color-surface-raised, #262320)" }}>
          <ClipboardList size={40} style={{ color: "var(--color-text-tertiary)" }} className="mx-auto" />
          <div className="space-y-1">
            <p className="font-medium" style={{ color: "var(--color-text-primary)" }}>
              {archived ? t("В архиве пусто", "Arxiv bo'sh") : t("Заказов пока нет", "Hozircha buyurtma yo'q")}
            </p>
            <p className="text-sm" style={{ color: "var(--color-text-tertiary)" }}>
              {archived
                ? t("Сюда попадают завершённые заказы", "Bu yerga yakunlangan buyurtmalar tushadi")
                : t("Оформленные заказы появятся здесь", "Rasmiylashtirilgan buyurtmalar shu yerda ko'rinadi")}
            </p>
          </div>
          {!archived && (
            <button onClick={() => navigate("/orders/new")} className="neo-btn-primary tap px-6 rounded-xl inline-flex items-center gap-2">
              <Plus size={18} /> {t("Новый заказ", "Yangi buyurtma")}
            </button>
          )}
        </div>
      )}

      {days.map((day) => (
        <div key={day.key} className="space-y-2">
          <p className="font-label text-[11px] tracking-wider px-1" style={{ color: "var(--color-text-tertiary)" }}>
            {day.label.toUpperCase()}
          </p>
          {day.items.map((o) => {
            const s = STATUS[o.status];
            return (
              <button
                key={o.id}
                onClick={() => navigate(`/orders/${o.id}`)}
                className="w-full text-left rounded-2xl p-4 flex items-center gap-3 transition-transform active:scale-[.99]"
                style={{ background: "var(--color-surface-raised, #262320)" }}
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate" style={{ color: "var(--color-text-primary)" }}>
                      {o.shopName ?? t("Магазин не указан", "Do'kon ko'rsatilmagan")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm" style={{ color: "var(--color-text-tertiary)" }}>
                    <span>{o.orderNumber}</span>
                    <span
                      className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                      style={{ background: "var(--color-primary-subtle)", color: s?.dot ?? "var(--color-primary)" }}
                    >
                      {s ? (lang === "uz" ? s.uz : s.ru) : o.status}
                    </span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold tabular-nums" style={{ color: "var(--color-text-primary)" }}>
                    {fmt(Number(o.total ?? 0))}
                  </div>
                </div>
                <ChevronRight size={18} style={{ color: "var(--color-text-tertiary)" }} className="shrink-0" />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
