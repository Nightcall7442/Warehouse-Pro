import { useState } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { trpc } from "@/providers/trpc";
import { format, addDays, subDays } from "date-fns";
import { ru as dateRu } from "date-fns/locale";
import {
  ChevronLeft, ChevronRight, CheckCircle2,
  Clock, Calendar, MapPin, AlertCircle, PlusCircle, ClipboardList,
} from "lucide-react";
import { useNavigate } from "react-router";

const STATUS_CONFIG = {
  visited: { ru: "Посещён",         uz: "Borildi",              color: "text-success", border: "border-success", dot: "#34c473" },
  planned: { ru: "Запланирован",    uz: "Rejalashtirilgan",     color: "text-info",    border: "border-primary", dot: "#60a5fa" },
  skipped: { ru: "Пропущен",        uz: "O'tkazildi",           color: "text-warning", border: "border-warning", dot: "#e8a830" },
} as const;

const STATUS_ICON = {
  visited: CheckCircle2,
  planned: Calendar,
  skipped: Clock,
};

export default function AgentPlans() {
  const [date, setDate] = useState(new Date());
  const { fmt }   = useCurrency();
  const { lang }  = useLang();
  const { user }  = useAuth();
  const navigate  = useNavigate();
  const isMerchandiser = user?.role === "merchandiser";
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const dateStr   = format(date, "yyyy-MM-dd");
  const isToday   = dateStr === format(new Date(), "yyyy-MM-dd");

  const { data: plans, isLoading } = trpc.agent.getPlans.useQuery({ date: dateStr });
  const utils  = trpc.useUtils();
  const update = trpc.agent.updatePlanStatus.useMutation({
    onSuccess: () => utils.agent.getPlans.invalidate(),
  });

  const visited = plans?.filter(p => p.status === "visited").length ?? 0;
  const total   = plans?.length ?? 0;
  const pct     = total > 0 ? Math.round((visited / total) * 100) : 0;
  const progressColor = pct === 100 ? "#34c473" : pct >= 60 ? "#e8a830" : "#4b6cf6";

  return (
    <div className="space-y-4 max-w-lg mx-auto animate-fade-up">

      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold text-text-primary tracking-tight">
          {t("План визитов", "Tashrif rejasi")}
        </h1>
        {isToday && (
          <span className="font-label text-[10px] px-2.5 py-1 rounded-full tracking-wider"
            style={{ background: "var(--color-primary-subtle, rgba(75,108,246,.10))", color: "#4b6cf6" }}>
            {t("СЕГОДНЯ", "BUGUN")}
          </span>
        )}
      </div>

      {/* Навигация по дате */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setDate(d => subDays(d, 1))}
          className="w-10 h-10 flex items-center justify-center rounded-xl border transition-colors hover:bg-surface-light"
          style={{ borderColor: "var(--color-border, #dde2ec)" }}
        >
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 panel p-3 text-center">
          <p className="font-semibold text-text-primary capitalize">
            {format(date, "EEEE", { locale: lang === "ru" ? dateRu : undefined })}
          </p>
          <p className="font-label text-[11px] tracking-wider mt-0.5" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
            {format(date, "d MMMM yyyy", { locale: lang === "ru" ? dateRu : undefined })}
          </p>
        </div>
        <button
          onClick={() => setDate(d => addDays(d, 1))}
          className="w-10 h-10 flex items-center justify-center rounded-xl border transition-colors hover:bg-surface-light"
          style={{ borderColor: "var(--color-border, #dde2ec)" }}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Прогресс */}
      {total > 0 && (
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-2.5">
            <span className="font-label text-[10px] tracking-wider" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
              {t("ПРОГРЕСС ДНЯ", "KUNLIK PROGRESS")}
            </span>
            <div className="flex items-center gap-2">
              <span className="font-data text-sm text-text-primary font-semibold">
                {visited}/{total}
              </span>
              <span className="font-data text-sm font-bold" style={{ color: progressColor }}>
                {pct}%
              </span>
            </div>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: progressColor }}
            />
          </div>
          {pct === 100 && (
            <p className="text-xs text-success mt-2 text-center">
              🎉 {t("Все визиты выполнены!", "Barcha tashriflar bajarildi!")}
            </p>
          )}
        </div>
      )}

      {/* Список */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-surface-light animate-pulse rounded-xl" />
          ))}
        </div>
      ) : plans?.length === 0 ? (
        <div className="panel p-12 text-center space-y-3">
          <Calendar size={36} className="mx-auto opacity-20 text-text-secondary" />
          <p className="text-text-secondary text-sm">
            {t("На этот день визитов нет", "Bu kun uchun tashrif yo'q")}
          </p>
          <p className="text-xs" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
            {t("Супервайзер ещё не назначил маршрут", "Supervisor yo'l haritasini hali tayinlamadi")}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {plans?.map((plan, idx) => {
            const key  = (plan.status ?? "planned") as keyof typeof STATUS_CONFIG;
            const cfg  = STATUS_CONFIG[key] ?? STATUS_CONFIG.planned;
            const Icon = STATUS_ICON[key] ?? Calendar;
            const done = plan.status === "visited" || plan.status === "skipped";

            return (
              <div
                key={plan.id}
                className={`panel overflow-hidden transition-opacity ${done ? "opacity-60" : ""}`}
              >
                <div className="flex">
                  {/* Цветная полоска статуса */}
                  <div className="w-1 flex-shrink-0" style={{ background: cfg.dot }} />

                  <div className="flex-1 p-4">
                    <div className="flex items-start gap-3">
                      {/* Номер */}
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
                        style={{ background: "var(--color-surface-light, #f0f3f8)", color: "var(--color-text-secondary, #6a7290)" }}
                      >
                        {idx + 1}
                      </div>

                      <div className="flex-1 min-w-0">
                        {/* Название + статус */}
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="font-medium text-text-primary truncate">
                            {plan.shopName ?? t("Магазин", "Do'kon")}
                          </p>
                          <div className={`flex items-center gap-1 text-[10px] font-label flex-shrink-0 ${cfg.color}`}>
                            <Icon size={11} />
                            {lang === "uz" ? cfg.uz : cfg.ru}
                          </div>
                        </div>

                        {/* Адрес */}
                        {plan.shopAddress && (
                          <div className="flex items-center gap-1 text-xs mb-1" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                            <MapPin size={11} className="flex-shrink-0" />
                            <span className="truncate">{plan.shopAddress}</span>
                          </div>
                        )}

                        {/* Долг */}
                        {Number(plan.shopDebt ?? 0) > 0 && (
                          <div className="flex items-center gap-1 text-xs text-danger mb-1">
                            <AlertCircle size={11} className="flex-shrink-0" />
                            {t("Долг:", "Qarz:")} <span className="font-data ml-0.5">{fmt(plan.shopDebt)}</span>
                          </div>
                        )}

                        {/* Заметки */}
                        {plan.notes && (
                          <p className="text-xs italic mt-1" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
                            «{plan.notes}»
                          </p>
                        )}

                        {/* Кнопки действий */}
                        {plan.status === "planned" && (
                          <div className="flex gap-2 mt-3">
                            {isMerchandiser ? (
                              <>
                                <button
                                  onClick={() => navigate(`/agent/visit/${plan.id}?shopId=${plan.shopId ?? ""}&shopName=${encodeURIComponent(plan.shopName ?? "")}`)}
                                  className="btn-primary flex-1 py-2 text-xs flex items-center justify-center gap-1.5"
                                >
                                  <ClipboardList size={13} />
                                  {t("Отчёт о визите", "Tashrif hisoboti")}
                                </button>
                                <button
                                  onClick={() => update.mutate({ planId: plan.id, status: "skipped" })}
                                  disabled={update.isPending}
                                  className="btn-ghost py-2 px-3 text-xs text-warning"
                                >
                                  {t("Пропустить", "O'tkazish")}
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => update.mutate({ planId: plan.id, status: "visited" })}
                                  disabled={update.isPending}
                                  className="btn-primary flex-1 py-2 text-xs flex items-center justify-center gap-1.5"
                                >
                                  <CheckCircle2 size={13} />
                                  {t("Отметить", "Belgilash")}
                                </button>
                                <button
                                  onClick={() => navigate(`/orders/new?shopId=${plan.shopId ?? ""}`)}
                                  className="btn-secondary py-2 px-3 text-xs flex items-center gap-1"
                                >
                                  <PlusCircle size={13} />
                                  {t("Заказ", "Buyurtma")}
                                </button>
                                <button
                                  onClick={() => update.mutate({ planId: plan.id, status: "skipped" })}
                                  disabled={update.isPending}
                                  className="btn-ghost py-2 px-3 text-xs text-warning"
                                >
                                  {t("Пропустить", "O'tkazish")}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
