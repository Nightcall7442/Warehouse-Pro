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
  const [selectedShops, setSelectedShops] = useState<Set<number>>(new Set());
  const [notes,   setNotes]   = useState("");
  const [shopSearch, setShopSearch] = useState("");

  const { data: agents } = trpc.agent.listAgents.useQuery();
  const { data: shops  } = trpc.agent.listShopsForPlan.useQuery();
  const utils = trpc.useUtils();

  const createPlan = trpc.agent.createPlan.useMutation({
    onSuccess: () => {
      utils.agent.getPlans.invalidate();
      notify.success(t("Планы созданы", "Rejalar yaratildi"));
      onDone();
    },
    onError: (e) => notify.error(e.message),
  });

  const filteredShops = (shops ?? []).filter((s: any) =>
    !shopSearch || s.name?.toLowerCase().includes(shopSearch.toLowerCase()) || (s.city ?? "").toLowerCase().includes(shopSearch.toLowerCase())
  );

  const toggleShop = (id: number) => {
    setSelectedShops(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedShops(new Set(filteredShops.map((s: any) => s.id)));
  const clearAll = () => setSelectedShops(new Set());

  const handleCreate = async () => {
    if (!agentId || selectedShops.size === 0) return;
    const promises = Array.from(selectedShops).map(shopId =>
      createPlan.mutateAsync({ agentId, shopId, planDate: date, notes: notes || undefined })
    );
    await Promise.all(promises);
  };

  return (
    <div className="neo-card p-5 space-y-4" style={{ borderColor: "rgba(91,109,138,.30)" }}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
          {t("Новый план визита", "Yangi tashrif rejası")} — {format(new Date(date), "dd MMMM yyyy", { locale: lang === "ru" ? dateRu : undefined })}
        </h3>
        <button onClick={onDone} className="p-1.5" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-tertiary)" }}><X size={16} /></button>
      </div>

      {/* Agent */}
      <div>
        <label className="block mb-1.5" style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-secondary)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {t("АГЕНТ *", "AGENT *")}
        </label>
        <PremiumSelect value={String(agentId)}
          onChange={v => setAgentId(Number(v))}
          options={[{value:"0",label:t("Выберите агента…", "Agent tanlang…")},...(agents??[]).map((a:any)=>({value:String(a.id),label:String(a.name)}))]}
          width="100%" />
      </div>

      {/* Shops multi-select */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-secondary)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {t("МАГАЗИНЫ *", "DO'KONLAR *")} <span style={{ color: "var(--color-primary)" }}>({selectedShops.size})</span>
          </label>
          <div className="flex gap-2">
            <button onClick={selectAll} style={{ fontSize: "11px", color: "var(--color-primary)", background: "none", border: "none", cursor: "pointer", fontWeight: 500 }}>
              {t("Все", "Barchasi")}
            </button>
            <button onClick={clearAll} style={{ fontSize: "11px", color: "var(--color-text-tertiary)", background: "none", border: "none", cursor: "pointer", fontWeight: 500 }}>
              {t("Очистить", "Tozalash")}
            </button>
          </div>
        </div>

        {/* Shop search */}
        <div style={{ position: "relative", marginBottom: "8px" }}>
          <input className="neo-input w-full" style={{ paddingLeft: "12px", fontSize: "13px" }}
            placeholder={t("Поиск магазина…", "Do'kon qidirish…")}
            value={shopSearch} onChange={e => setShopSearch(e.target.value)} />
        </div>

        {/* Shop list */}
        <div style={{ maxHeight: "200px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
          {filteredShops.map((shop: any) => {
            const selected = selectedShops.has(shop.id);
            return (
              <div key={shop.id}
                onClick={() => toggleShop(shop.id)}
                style={{
                  display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px",
                  borderRadius: "8px", cursor: "pointer", transition: "all 0.15s",
                  background: selected ? "var(--color-primary-subtle)" : "transparent",
                  border: selected ? "1px solid rgba(91,109,138,.25)" : "1px solid transparent",
                }}>
                <div style={{
                  width: "18px", height: "18px", borderRadius: "4px", flexShrink: 0,
                  border: selected ? "none" : "2px solid var(--color-border)",
                  background: selected ? "var(--color-primary)" : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {selected && <CheckCircle2 size={12} color="#fff" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shop.name}</p>
                  {shop.city && <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "1px 0 0" }}>{shop.city}</p>}
                </div>
              </div>
            );
          })}
          {filteredShops.length === 0 && (
            <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", textAlign: "center", padding: "12px 0" }}>
              {t("Магазины не найдены", "Do'konlar topilmadi")}
            </p>
          )}
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block mb-1.5" style={{ fontSize: "10px", fontWeight: 600, color: "var(--color-text-secondary)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {t("ПРИМЕЧАНИЯ", "IZOHLAR")}
        </label>
        <input className="neo-input w-full"
          placeholder={t("Для всех выбранных магазинов…", "Barcha tanlangan do'konlar uchun…")}
          value={notes} onChange={e => setNotes(e.target.value)} />
      </div>

      <button
        onClick={handleCreate}
        disabled={createPlan.isPending || !agentId || selectedShops.size === 0}
        className="neo-btn-primary flex items-center gap-2"
        style={{ opacity: createPlan.isPending || !agentId || selectedShops.size === 0 ? 0.5 : 1, width: "100%", justifyContent: "center" }}
      >
        {createPlan.isPending && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
        {t(`Создать планы (${selectedShops.size})`, `Rejalar yaratish (${selectedShops.size})`)}
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
                              style={{ borderColor: "color-mix(in srgb, #d4973a 30%, transparent)" }}
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
