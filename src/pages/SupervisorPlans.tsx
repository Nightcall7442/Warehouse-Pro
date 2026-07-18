import { useState, useMemo } from "react";
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
  const [territoryId, setTerritoryId] = useState(0);
  const [notes, setNotes] = useState("");

  const { data: agents } = trpc.agent.listAgents.useQuery();
  const { data: territories } = trpc.territory.list.useQuery();
  const utils = trpc.useUtils();

  const createPlan = trpc.agent.createPlan.useMutation({
    onSuccess: () => {
      utils.agent.getPlans.invalidate();
      notify.success(t("Планы созданы", "Rejalar yaratildi"));
      onDone();
    },
    onError: (e) => notify.error(e.message),
  });

  const selectedTerritory = territories?.find((tr: any) => tr.id === territoryId);
  const shopCount = selectedTerritory?.shopCount ?? 0;

  const handleCreate = async () => {
    if (!agentId || !territoryId) return;
    const shopsInTerritory = await utils.client.territory.getShops.query({ territoryId });
    if (!shopsInTerritory.length) {
      notify.error(t("В территории нет магазинов", "Territoriyada do'konlar yo'q"));
      return;
    }
    const promises = shopsInTerritory.map((shop: any) =>
      createPlan.mutateAsync({ agentId, shopId: shop.id, planDate: date, notes: notes || undefined })
    );
    await Promise.all(promises);
  };

  return (
    <div className="neo-card" style={{ padding: "24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <h3 style={{ fontSize: "16px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0, letterSpacing: "-0.01em" }}>
          {t("Новый план визита", "Yangi tashrif rejası")} — {format(new Date(date), "dd MMMM yyyy", { locale: lang === "ru" ? dateRu : undefined })}
        </h3>
        <button onClick={onDone} style={{
          width: "32px", height: "32px", borderRadius: "10px",
          background: "var(--color-surface-light)", border: "1px solid var(--color-border)",
          cursor: "pointer", color: "var(--color-text-secondary)",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "all 0.15s",
        }}
          onMouseEnter={e => e.currentTarget.style.background = "var(--color-surface-hover)"}
          onMouseLeave={e => e.currentTarget.style.background = "var(--color-surface-light)"}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ marginBottom: "16px" }}>
        <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>
          {t("АГЕНТ *", "AGENT *")}
        </label>
        <PremiumSelect value={String(agentId)}
          onChange={v => setAgentId(Number(v))}
          options={[{value:"0",label:t("Выберите агента…", "Agent tanlang…")},...(agents??[]).map((a:any)=>({value:String(a.id),label:String(a.name)}))]}
          width="100%" />
      </div>

      <div style={{ marginBottom: "16px" }}>
        <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>
          {t("ТЕРРИТОРИЯ *", "TERRITORIYA *")}
        </label>
        <PremiumSelect value={String(territoryId)}
          onChange={v => setTerritoryId(Number(v))}
          options={[{value:"0",label:t("Выберите территорию…", "Territoriya tanlang…")},...(territories??[]).map((tr:any)=>({value:String(tr.id),label:`${tr.name} (${tr.shopCount} ${t("магазинов","do'kon")})`}))]}
          width="100%" />
        {selectedTerritory && (
          <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", margin: "6px 0 0" }}>
            {t(`${shopCount} магазинов будет добавлено в план`, `${shopCount} ta do'kon reja qo'shiladi`)}
          </p>
        )}
      </div>

      <div style={{ marginBottom: "20px" }}>
        <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-text-secondary)", letterSpacing: "0.06em", textTransform: "uppercase", display: "block", marginBottom: "8px" }}>
          {t("ПРИМЕЧАНИЯ", "IZOHLAR")}
        </label>
        <input className="neo-input" style={{ width: "100%" }}
          placeholder={t("Для всех магазинов территории…", "Territoriyadagi barcha do'konlar uchun…")}
          value={notes} onChange={e => setNotes(e.target.value)} />
      </div>

      <button
        onClick={handleCreate}
        disabled={createPlan.isPending || !agentId || !territoryId}
        className="neo-btn-primary flex items-center gap-2"
        style={{ opacity: createPlan.isPending || !agentId || !territoryId ? 0.5 : 1, width: "100%", justifyContent: "center", padding: "12px 24px" }}
      >
        {createPlan.isPending && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
        {t(`Создать план (${shopCount})`, `Reja yaratish (${shopCount})`)}
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

  // Group plans by agent to show territories
  const groupedPlans = useMemo(() => {
    if (!plans) return [];
    const map = new Map<number, { agentName: string; agentId: number; shops: typeof plans; visited: number; total: number }>();
    for (const p of plans) {
      const agentId = (p as any).agentId ?? 0;
      if (!map.has(agentId)) {
        map.set(agentId, { agentName: (p as any).agentName ?? "—", agentId, shops: [], visited: 0, total: 0 });
      }
      const g = map.get(agentId)!;
      g.shops.push(p);
      g.total++;
      if (p.status === "visited") g.visited++;
    }
    return Array.from(map.values());
  }, [plans]);
  const utils      = trpc.useUtils();
  const updatePlan = trpc.agent.updatePlanStatus.useMutation({
    onSuccess: () => { utils.agent.getPlans.invalidate(); notify.success(t("Статус обновлён", "Holat yangilandi")); },
    onError:   (e) => notify.error(e.message),
  });

  const visited = plans?.filter(p => p.status === "visited").length ?? 0;
  const total   = plans?.length ?? 0;
  const pct     = total > 0 ? Math.round((visited / total) * 100) : 0;
  const progressColor = pct === 100 ? "#34c473" : pct >= 60 ? "#d4973a" : "#5b6d8a";

  return (
    <div className="space-y-4 animate-fade-up">
      {dialog}

      {/* Заголовок */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-pink, #c06080)", boxShadow: "var(--shadow-xs)" }} />
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-orange, #c49530)", boxShadow: "var(--shadow-xs)" }} />
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-teal, #3a9a8a)", boxShadow: "var(--shadow-xs)" }} />
          </div>
          <h1 className="font-display text-2xl font-bold text-primary tracking-tight">
            {t("Планы визитов", "Tashrif rejalari")}
          </h1>
          {isToday && (
            <p className="text-xs mt-0.5" style={{ color: "#5b6d8a" }}>
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
          className="neo-btn w-10 h-10 flex items-center justify-center">
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
          className="neo-btn w-10 h-10 flex items-center justify-center">
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

      {/* Территории агентов */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="neo-card" style={{ padding: "20px" }}>
                <div className="h-5 w-32 bg-surface-light animate-pulse rounded mb-3" />
                <div className="h-4 w-48 bg-surface-light animate-pulse rounded" />
              </div>
            ))
          : groupedPlans.length === 0
          ? (
            <div className="neo-card" style={{ padding: "48px", textAlign: "center" }}>
              <Calendar size={32} style={{ margin: "0 auto 8px", opacity: 0.2, color: "var(--color-text-tertiary)" }} />
              <p style={{ color: "var(--color-text-secondary)", fontSize: "13px" }}>
                {t("На этот день планов нет", "Bu kun uchun reja yo'q")}
              </p>
              <button onClick={() => setShowForm(true)}
                style={{ color: "var(--color-primary)", background: "none", border: "none", cursor: "pointer", marginTop: "8px", fontSize: "13px", fontWeight: 500 }}>
                {t("Создать первый план →", "Birinchi reja yaratish →")}
              </button>
            </div>
          )
          : groupedPlans.map(group => {
              const progress = group.total > 0 ? Math.round((group.visited / group.total) * 100) : 0;
              const allVisited = group.visited === group.total && group.total > 0;
              return (
                <div key={group.agentId} className="neo-card" style={{ padding: "20px" }}>
                  {/* Agent header */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{
                        width: "36px", height: "36px", borderRadius: "10px",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: allVisited ? "var(--color-success-subtle)" : "var(--color-primary-subtle)",
                        color: allVisited ? "var(--color-success)" : "var(--color-primary)",
                        fontWeight: 700, fontSize: "14px",
                      }}>
                        {(group.agentName ?? "A")[0].toUpperCase()}
                      </div>
                      <div>
                        <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>{group.agentName}</p>
                        <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "2px 0 0" }}>
                          {group.visited}/{group.total} {t("магазинов", "do'kon")} · {progress}%
                        </p>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <div style={{ width: "80px", height: "6px", borderRadius: "3px", background: "var(--color-surface-light)", overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: "3px", width: `${progress}%`, background: allVisited ? "var(--color-success)" : "var(--color-primary)", transition: "width 0.5s" }} />
                      </div>
                    </div>
                  </div>

                  {/* Shop list (territory) */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {group.shops.map(plan => {
                      const sc = STATUS_CONFIG[plan.status] ?? STATUS_CONFIG.planned;
                      const hasDebt = Number(plan.shopDebt ?? 0) > 0;
                      return (
                        <div key={plan.id} style={{
                          display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px",
                          borderRadius: "8px", background: "var(--color-surface-light)",
                        }}>
                          <span className={`status-badge ${sc.cls}`} style={{ fontSize: "10px", padding: "2px 6px" }}>
                            {lang === "uz" ? sc.uz : sc.ru}
                          </span>
                          <span style={{ flex: 1, fontSize: "13px", color: "var(--color-text-primary)", fontWeight: 500 }}>
                            {plan.shopName ?? "—"}
                          </span>
                          <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                            {(plan as any).shopCity ?? ""}
                          </span>
                          {hasDebt && (
                            <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-danger)" }}>
                              {fmt(plan.shopDebt ?? 0)}
                            </span>
                          )}
                          {plan.status === "planned" && (
                            <div className="flex gap-1">
                              <button
                                onClick={() => updatePlan.mutate({ planId: plan.id, status: "visited" })}
                                disabled={updatePlan.isPending}
                                className="neo-btn-primary py-1 px-2 text-xs flex items-center gap-1"
                              >
                                <CheckCircle2 size={10} />
                              </button>
                              <button
                                onClick={() => updatePlan.mutate({ planId: plan.id, status: "skipped" })}
                                disabled={updatePlan.isPending}
                                className="neo-btn py-1 px-2 text-xs flex items-center gap-1"
                              >
                                <Clock size={10} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
      </div>
    </div>
  );
}
