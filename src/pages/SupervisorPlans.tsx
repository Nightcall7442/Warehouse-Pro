import { useState } from "react";
import { useCurrency } from "@/hooks/useCurrency";
import { useLang } from "@/i18n";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { format, addDays, subDays } from "date-fns";
import { ru as dateRu } from "date-fns/locale";
import {
  ChevronLeft, ChevronRight, Plus, X,
  Loader2, CheckCircle2, Calendar, Clock,
} from "lucide-react";
import { PremiumSelect } from "@/components/PremiumSelect";

const STATUS_CONFIG: Record<string, { ru: string; uz: string; cls: string }> = {
  planned: { ru: "Запланирован", uz: "Rejalashtirilgan", cls: "bg-info/15 text-info border-info/30"       },
  visited: { ru: "Посещён",      uz: "Borildi",          cls: "bg-success/15 text-success border-success/30" },
  skipped: { ru: "Пропущен",     uz: "O'tkazildi",       cls: "bg-warning/15 text-warning border-warning/30" },
};

// ── Форма создания плана ──────────────────────────────────────────────────────
function CreatePlanForm({ date, onDone, lang }: { date: string; onDone: () => void; lang: "ru" | "uz" }) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [agentId, setAgentId] = useState(0);
  const [shopId,  setShopId]  = useState(0);
  const [notes,   setNotes]   = useState("");

  // user.list (ceo-only) and shop.list (operator-only) both 403 for the
  // supervisor role — these lightweight, supervisor-scoped endpoints exist
  // specifically so this form works for the role it's actually shown to.
  const { data: agents } = trpc.agent.listAgents.useQuery();
  const { data: shops  } = trpc.agent.listShopsForPlan.useQuery();
  const utils = trpc.useUtils();

  const createPlan = trpc.agent.createPlan.useMutation({
    onSuccess: () => {
      utils.agent.getPlans.invalidate();
      notify.success(t("План создан", "Reja yaratildi"));
      onDone();
    },
    onError: (e) => notify.error(e.message),
  });

  return (
    <div className="neo-card p-5 space-y-4" style={{ borderColor: "rgba(75,108,246,.30)" }}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-primary">
          {t("Новый план визита", "Yangi tashrif rejasi")} — {format(new Date(date), "dd MMMM yyyy", { locale: lang === "ru" ? dateRu : undefined })}
        </h3>
        <button onClick={onDone} className="btn-ghost p-1.5"><X size={16} /></button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            {t("АГЕНТ *", "AGENT *")}
          </label>
          <PremiumSelect value={String(agentId)}
            onChange={v => setAgentId(Number(v))}
            options={[{value:"0",label:t("Выберите агента…", "Agent tanlang…")},...(agents??[]).map(a=>({value:String(a.id),label:String(a.name)}))]}
            width="100%" />
        </div>
        <div>
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            {t("МАГАЗИН *", "DO'KON *")}
          </label>
          <PremiumSelect value={String(shopId)}
            onChange={v => setShopId(Number(v))}
            options={[{value:"0",label:t("Выберите магазин…", "Do'kon tanlang…")},...(shops??[]).map(s=>({value:String(s.id),label:`${s.name}${s.city ? ` — ${s.city}` : ""}`}))]}
            width="100%" />
        </div>
        <div className="sm:col-span-2">
          <label className="font-label text-[10px] text-secondary tracking-wider block mb-1.5">
            {t("ПРИМЕЧАНИЯ", "IZOHLAR")}
          </label>
          <input className="neo-input w-full"
            placeholder={t("Дополнительные инструкции…", "Qo'shimcha ko'rsatmalar…")}
            value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>

      <button
        onClick={() => agentId && shopId && createPlan.mutate({ agentId, shopId, planDate: date, notes: notes || undefined })}
        disabled={createPlan.isPending || !agentId || !shopId}
        className="neo-btn-primary flex items-center gap-2 disabled:opacity-40"
      >
        {createPlan.isPending && <Loader2 size={14} className="animate-spin" />}
        {t("Создать план", "Reja yaratish")}
      </button>
    </div>
  );
}

// ── Главная страница планов супервайзера ──────────────────────────────────────
export default function SupervisorPlans() {
  const [date,        setDate]        = useState(new Date());
  const [showForm,    setShowForm]    = useState(false);
  const [filterAgent, setFilterAgent] = useState(0);
  const { fmt }                       = useCurrency();
  const { lang }                      = useLang();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { dialog }           = useConfirm();

  const dateStr = format(date, "yyyy-MM-dd");
  const isToday = dateStr === format(new Date(), "yyyy-MM-dd");

  const { data: agents } = trpc.agent.listAgents.useQuery();
  const { data: plans, isLoading } = trpc.agent.getPlans.useQuery(
    { agentId: filterAgent || undefined, date: dateStr },
    { refetchInterval: 30_000 }
  );
  const utils      = trpc.useUtils();
  const updatePlan = trpc.agent.updatePlanStatus.useMutation({
    onSuccess: () => { utils.agent.getPlans.invalidate(); notify.success(t("Статус обновлён", "Holat yangilandi")); },
    onError:   (e) => notify.error(e.message),
  });

  const visited = plans?.filter(p => p.status === "visited").length ?? 0;
  const total   = plans?.length ?? 0;
  const pct     = total > 0 ? Math.round((visited / total) * 100) : 0;
  const progressColor = pct === 100 ? "#34c473" : pct >= 60 ? "#e8a830" : "#4b6cf6";

  return (
    <div className="space-y-4 animate-fade-up">
      {dialog}

      {/* Заголовок */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary tracking-tight">
            {t("Планы визитов", "Tashrif rejalari")}
          </h1>
          {isToday && (
            <p className="text-xs mt-0.5" style={{ color: "#4b6cf6" }}>
              {t("Сегодня", "Bugun")}
            </p>
          )}
        </div>
        <button onClick={() => setShowForm(v => !v)} className="neo-btn-primary flex items-center gap-2">
          <Plus size={16} />
          <span className="hidden sm:inline">{t("Создать план", "Reja yaratish")}</span>
        </button>
      </div>

      {/* Навигация по дате */}
      <div className="flex items-center gap-3">
        <button onClick={() => setDate(d => subDays(d, 1))}
          className="w-10 h-10 flex items-center justify-center rounded-xl border hover:bg-surface-light transition-colors"
          style={{ borderColor: "var(--color-border, #dde2ec)" }}>
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 panel p-3 text-center">
          <p className="font-semibold text-primary capitalize">
            {format(date, "EEEE", { locale: lang === "ru" ? dateRu : undefined })}
          </p>
          <p className="font-label text-[11px] tracking-wider mt-0.5" style={{ color: "var(--color-text-tertiary, #98a0b8)" }}>
            {format(date, "d MMMM yyyy", { locale: lang === "ru" ? dateRu : undefined })}
          </p>
        </div>
        <button onClick={() => setDate(d => addDays(d, 1))}
          className="w-10 h-10 flex items-center justify-center rounded-xl border hover:bg-surface-light transition-colors"
          style={{ borderColor: "var(--color-border, #dde2ec)" }}>
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Фильтр + прогресс */}
      <div className="flex items-center gap-3 flex-wrap">
        <PremiumSelect value={String(filterAgent)}
          onChange={v => setFilterAgent(Number(v))}
          options={[{value:"0",label:t("Все агенты", "Barcha agentlar")},...(agents??[]).map(a=>({value:String(a.id),label:String(a.name)}))]}
          width="200px" />

        {total > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-sm font-data" style={{ color: "var(--color-text-secondary, #6a7290)" }}>
              {visited}/{total}
            </span>
            <div className="w-28 h-2 rounded-full overflow-hidden" style={{ background: "var(--color-surface-light, #f0f3f8)" }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: progressColor }} />
            </div>
            <span className="font-data text-sm font-semibold" style={{ color: progressColor }}>
              {pct}%
            </span>
          </div>
        )}
      </div>

      {/* Форма */}
      {showForm && (
        <CreatePlanForm
          date={dateStr}
          lang={lang}
          onDone={() => { setShowForm(false); utils.agent.getPlans.invalidate(); }}
        />
      )}

      {/* Таблица планов */}
      <div className="neo-card overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              {[
                t("АГЕНТ",    "AGENT"),
                t("МАГАЗИН",  "DO'KON"),
                t("ГОРОД",    "SHAHAR"),
                t("ДОЛГ",     "QARZ"),
                t("СТАТУС",   "HOLAT"),
                t("ДЕЙСТВИЯ", "AMALLAR"),
              ].map(h => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={6}><div className="h-4 bg-surface-light animate-pulse rounded" /></td>
                  </tr>
                ))
              : plans?.length === 0
              ? (
                <tr>
                  <td colSpan={6} className="px-4 py-14 text-center">
                    <Calendar size={32} className="mx-auto mb-2 opacity-20 text-secondary" />
                    <p className="text-secondary text-sm">
                      {t("На этот день планов нет", "Bu kun uchun reja yo'q")}
                    </p>
                    <button onClick={() => setShowForm(true)}
                      className="text-primary hover:underline mt-2 text-sm">
                      {t("Создать первый план →", "Birinchi reja yaratish →")}
                    </button>
                  </td>
                </tr>
              )
              : plans?.map(plan => {
                  const sc = STATUS_CONFIG[plan.status] ?? STATUS_CONFIG.planned;
                  const hasDebt = Number(plan.shopDebt ?? 0) > 0;
                  return (
                    <tr key={plan.id}>
                      <td className="font-medium text-primary">
                        {((plan as any).agentName ?? "—")}
                      </td>
                      <td>{plan.shopName ?? "—"}</td>
                      <td className="text-secondary">{((plan as any).shopCity ?? "—")}</td>
                      <td>
                        <span className={`font-data text-sm font-semibold ${hasDebt ? "text-danger" : "text-secondary"}`}>
                          {fmt(plan.shopDebt ?? 0)}
                        </span>
                      </td>
                      <td>
                        <span className={`status-badge ${sc.cls}`}>
                          {lang === "uz" ? sc.uz : sc.ru}
                        </span>
                      </td>
                      <td>
                        {plan.status === "planned" && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => updatePlan.mutate({ planId: plan.id, status: "visited" })}
                              disabled={updatePlan.isPending}
                              className="neo-btn-primary py-1 px-2 text-xs flex items-center gap-1"
                            >
                              <CheckCircle2 size={12} />
                              {t("Готово", "Bajarildi")}
                            </button>
                            <button
                              onClick={() => updatePlan.mutate({ planId: plan.id, status: "skipped" })}
                              disabled={updatePlan.isPending}
                              className="neo-btn py-1 px-2 text-xs flex items-center gap-1 text-warning"
                              style={{ borderColor: "color-mix(in srgb, #e8a830 30%, transparent)" }}
                            >
                              <Clock size={12} />
                              {t("Пропустить", "O'tkazish")}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
