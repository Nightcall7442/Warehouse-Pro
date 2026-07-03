import { memo, useCallback, useState } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { useNavigate } from "react-router";
import { useIsMobile } from "@/hooks/use-mobile";
import { Search, Plus, FileDown, ChevronRight, Store, User } from "lucide-react";
import { format } from "date-fns";
import { exportToExcel, formatOrdersForExport } from "@/lib/excel";
import { PremiumSelect } from "@/components/PremiumSelect";

// Status config — одно место для цветов и лейблов
const STATUS: Record<string, { ru: string; uz: string; dot: string; bg: string; text: string; border: string }> = {
  new:        { ru: "Новый",       uz: "Yangi",         dot: "#6366f1", bg: "bg-info/10",    text: "text-info",    border: "border-info/25" },
  processing: { ru: "В обработке", uz: "Jarayonda",     dot: "#f59e0b", bg: "bg-warning/10", text: "text-warning", border: "border-warning/25" },
  completed:  { ru: "Выполнен",    uz: "Bajarildi",     dot: "#10b981", bg: "bg-success/10", text: "text-success", border: "border-success/25" },
  cancelled:  { ru: "Отменён",     uz: "Bekor qilindi", dot: "#ef4444", bg: "bg-danger/10",  text: "text-danger",  border: "border-danger/25" },
};

const StatusBadge = memo(function StatusBadge({ status, lang }: { status: string; lang: "ru" | "uz" }) {
  const s = STATUS[status] ?? STATUS.new;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${s.bg} ${s.text} ${s.border}`}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.dot }} />
      {lang === "uz" ? s.uz : s.ru}
    </span>
  );
});

export default function Orders() {
  const [page, setPage]     = useState(1);
  const { fmt }             = useCurrency();
  const { lang }            = useLang();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const isMobile            = useIsMobile();
  const navigate            = useNavigate();
  const utils               = trpc.useUtils();

  const { data, isLoading } = trpc.order.list.useQuery({
    page, pageSize: 25,
    search: search || undefined,
    status: (status || undefined) as any,
  });

  const { data: allOrders } = trpc.order.list.useQuery({ page: 1, pageSize: 1000 });

  const updateStatus = trpc.order.updateStatus.useMutation({
    onSuccess: () => { utils.order.list.invalidate(); notify.success("Заказ обновлён"); },
    onError:   (e) => notify.error(e.message),
  });

  const handleExport = useCallback(() => {
    if (!allOrders?.data) return;
    exportToExcel(formatOrdersForExport(allOrders.data), "orders-export");
  }, [allOrders?.data]);

  const t = useCallback((ru: string, uz: string) => lang === "uz" ? uz : ru, [lang]);

  const handleNewOrder = useCallback(() => navigate("/orders/new"), [navigate]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="font-display text-2xl font-bold text-text-primary tracking-tight">
          {t("Заказы", "Buyurtmalar")}
        </h1>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2 text-sm py-2">
            <FileDown size={15} />
            <span className="hidden sm:inline">Excel</span>
          </button>
          <button onClick={handleNewOrder} className="btn-primary flex items-center gap-2">
            <Plus size={16} />
            <span className="hidden sm:inline">{t("Новый заказ", "Yangi buyurtma")}</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
          <input
            className="input-field pl-9 w-full"
            placeholder={t("Поиск заказов…", "Buyurtma qidirish…")}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <PremiumSelect value={status} onChange={v => { setStatus(v); setPage(1); }}
          options={[{value:"",label:t("Все статусы","Barcha holatlar")},...Object.entries(STATUS).map(([k,v])=>({value:k,label:lang==="uz"?v.uz:v.ru}))]}
          width="180px" />
      </div>

      {/* Mobile cards */}
      {isMobile ? (
        <div className="space-y-2.5">
          {isLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-[88px] bg-surface-light animate-pulse rounded-xl" />
              ))
            : data?.data.length === 0
            ? <p className="text-center text-text-secondary py-14 text-sm">{t("Нет заказов", "Buyurtma yo'q")}</p>
            : data?.data.map(o => {
                const s = STATUS[o.status] ?? STATUS.new;
                return (
                  <div
                    key={o.id}
                    className="panel p-0 overflow-hidden cursor-pointer active:scale-[0.99] transition-transform"
                    onClick={() => navigate(`/orders/${o.id}`)}
                  >
                    {/* Color accent strip based on status */}
                    <div className="flex">
                      <div className="w-1 flex-shrink-0 rounded-l-xl" style={{ background: s.dot }} />
                      <div className="flex-1 p-3.5">
                        {/* Top row */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-data text-sm font-semibold text-text-primary">
                            {o.orderNumber}
                          </span>
                          <StatusBadge status={o.status} lang={lang} />
                        </div>
                        {/* Bottom row */}
                        <div className="flex items-end justify-between">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <Store size={11} className="text-text-secondary flex-shrink-0" />
                              <span className="text-[13px] text-text-primary truncate max-w-[160px]">
                                {o.shopName ?? "—"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <User size={11} className="text-text-secondary flex-shrink-0" />
                              <span className="text-xs text-text-secondary">
                                {o.agentName ?? "—"} · {o.createdAt ? format(new Date(o.createdAt), "d MMM") : ""}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-data text-base font-bold text-text-primary">
                              {fmt(o.total)}
                            </span>
                            <ChevronRight size={15} className="text-text-secondary" />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
        </div>
      ) : (
        /* Desktop table */
        <div className="panel overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-light">
                {[
                  t("ЗАКАЗ",  "BUYURTMA"),
                  t("ДАТА",   "SANA"),
                  t("МАГАЗИН","DO'KON"),
                  t("АГЕНТ",  "AGENT"),
                  t("ИТОГО",  "JAMI"),
                  t("СТАТУС", "HOLAT"),
                  t("ДЕЙСТВИЯ","AMALLAR"),
                ].map(h => (
                  <th key={h} className="text-left px-4 py-3 font-h3 text-text-secondary text-[11px] tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border-subtle">
                      <td colSpan={7} className="px-4 py-4">
                        <div className="h-4 bg-surface-light animate-pulse rounded" />
                      </td>
                    </tr>
                  ))
                : data?.data.length === 0
                ? <tr><td colSpan={7} className="px-4 py-14 text-center text-text-secondary text-sm">{t("Нет заказов", "Buyurtma yo'q")}</td></tr>
                : data?.data.map(o => (
                    <tr
                      key={o.id}
                      className="border-b border-border-subtle hover:bg-surface-light/50 cursor-pointer"
                      onClick={() => navigate(`/orders/${o.id}`)}
                    >
                      <td className="px-4 py-3 font-data text-sm font-medium text-primary">{o.orderNumber}</td>
                      <td className="px-4 py-3 text-sm text-text-secondary">
                        {o.createdAt ? format(new Date(o.createdAt), "dd.MM.yyyy") : ""}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-primary">{o.shopName ?? "—"}</td>
                      <td className="px-4 py-3 text-sm text-text-secondary">{o.agentName ?? "—"}</td>
                      <td className="px-4 py-3 font-data text-sm font-semibold text-text-primary">{fmt(o.total)}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={o.status} lang={lang} />
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        {o.status === "new" && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => updateStatus.mutate({ id: o.id, status: "processing" })}
                              className="btn-secondary py-1 px-2 text-xs"
                            >
                              {t("В работу", "Jarayonga")}
                            </button>
                            <button
                              onClick={() => updateStatus.mutate({ id: o.id, status: "completed" })}
                              className="btn-primary py-1 px-2 text-xs"
                            >
                              {t("Выполнен", "Bajarildi")}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.total > 25 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-secondary">{data.total} {t("всего", "jami")}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary py-1 px-3 text-sm disabled:opacity-40">
              {t("Назад", "Orqaga")}
            </button>
            <button onClick={() => setPage(p => p + 1)} disabled={page * 25 >= data.total} className="btn-secondary py-1 px-3 text-sm disabled:opacity-40">
              {t("Далее", "Keyingi")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
