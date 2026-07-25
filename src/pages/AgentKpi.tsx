import { useState, useMemo } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { useCurrency } from "@/hooks/useCurrency";
import { TrendingUp, TrendingDown, Target, ShoppingCart, DollarSign, Users, Package, Star, Award, Clock, BarChart3, AlertTriangle, MapPin, Radio, Camera, CheckCircle, XCircle } from "lucide-react";

const PERIODS = [
  { value: "week", labelRu: "Неделя", labelUz: "Hafta" },
  { value: "month", labelRu: "Месяц", labelUz: "Oy" },
  { value: "quarter", labelRu: "Квартал", labelUz: "Chorak" },
] as const;

const GRADE_COLORS: Record<string, string> = {
  A: "#22c55e", B: "#3b82f6", C: "#f59e0b", D: "#f97316", F: "#ef4444",
};

const GRADE_LABELS: Record<string, Record<string, string>> = {
  A: { ru: "Отлично", uz: "Ajoyib" },
  B: { ru: "Хорошо", uz: "Yaxshi" },
  C: { ru: "Удовлетворительно", uz: "Qoniqarli" },
  D: { ru: "Плохо", uz: "Yomon" },
  F: { ru: "Критично", uz: "Juda yomon" },
};

export default function AgentKpi() {
  const { lang } = useLang();
  const { fmt } = useCurrency();
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [period, setPeriod] = useState<"week" | "month" | "quarter">("month");
  const { data: user } = trpc.auth.me.useQuery();

  const isSupervisor = user?.role === "ceo" || user?.role === "operator" || user?.role === "supervisor";

  // Agent sees own KPIs, supervisor sees all agents
  const { data: myKpi, isLoading: myKpiLoading } = trpc.kpi.agentKpi.useQuery({ period }, { enabled: !isSupervisor });
  const { data: allKpi, isLoading: allKpiLoading } = trpc.kpi.supervisorKpi.useQuery({ period }, { enabled: isSupervisor });
  const { data: salaryReport, isLoading: salaryLoading } = trpc.kpi.salaryReport.useQuery({ period }, { enabled: isSupervisor });
  const { data: mySalary, isLoading: mySalaryLoading } = trpc.kpi.salary.useQuery({ period }, { enabled: !isSupervisor });

  const isLoading = isSupervisor ? (allKpiLoading || salaryLoading) : (myKpiLoading || mySalaryLoading);

  if (isLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "50vh" }}>
        <div style={{ width: "32px", height: "32px", borderRadius: "50%", border: "3px solid #f0f3f8", borderTopColor: "#5b6d8a", animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "24px", fontWeight: 700, color: "#2b3450", letterSpacing: "-0.02em" }}>
            {isSupervisor ? t("KPI Агентов", "Agentlar KPI") : t("KPI Агента", "Agent KPI")}
          </h1>
          <p style={{ fontSize: "13px", marginTop: "4px", color: "#6a7290" }}>
            {isSupervisor ? `${allKpi?.length ?? 0} ${t("агентов", "agentlar")}` : myKpi?.agentName} • {isSupervisor ? "" : myKpi?.period}
          </p>
        </div>
        <div style={{ display: "flex", gap: "6px" }}>
          {PERIODS.map(p => (
            <button key={p.value} onClick={() => setPeriod(p.value)}
              style={{
                padding: "6px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                border: "none", cursor: "pointer", transition: "all 0.15s",
                background: period === p.value ? "#5b6d8a" : "#f0f3f8",
                color: period === p.value ? "#fff" : "#6a7290",
              }}>
              {lang === "uz" ? p.labelUz : p.labelRu}
            </button>
          ))}
        </div>
      </div>

      {/* Agent view: own KPIs */}
      {!isSupervisor && myKpi && (
        <>
          <ScoreCards kpi={myKpi} fmt={fmt} t={t} lang={lang} />
          <ScoreBreakdown kpi={myKpi} t={t} />
          {mySalary && <SalarySection salary={mySalary} fmt={fmt} t={t} />}
          <VisitDetails kpi={myKpi} t={t} />
          {myKpi.deliveryCount > 0 && <DeliveryDetails kpi={myKpi} fmt={fmt} t={t} />}
          <GpsSection kpi={myKpi} t={t} />
          <VisitReportsSection kpi={myKpi} t={t} />
        </>
      )}

      {/* Supervisor/CEO view: all agents */}
      {isSupervisor && allKpi && (
        <>
          {/* Summary cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
            <ScoreCard label={t("Всего агентов", "Jami agentlar")} value={String(allKpi.length)} icon={<Users size={20} color="#fff" />} gradient="linear-gradient(135deg, #5b6d8a, #4a5d7a)" />
            <ScoreCard label={t("Средний балл", "O'rtacha ball")} value={String(Math.round(allKpi.reduce((s, k) => s + k.kpiScore, 0) / allKpi.length))} icon={<Star size={20} color="#fff" />} gradient="linear-gradient(135deg, #3b82f6, #2563eb)" />
            <ScoreCard label={t("Общая выручка", "Jami tushum")} value={fmt(allKpi.reduce((s, k) => s + k.revenue, 0))} icon={<DollarSign size={20} color="#fff" />} gradient="linear-gradient(135deg, #22c55e, #16a34a)" />
            <ScoreCard label={t("Общий ФОТ", "Jami oylik")} value={fmt(salaryReport?.reduce((s, r) => s + r.totalSalary, 0) ?? 0)} icon={<Award size={20} color="#fff" />} gradient="linear-gradient(135deg, #f59e0b, #d97706)" />
          </div>

          {/* Agents table */}
          <AgentsTable agents={allKpi} salaries={salaryReport ?? []} fmt={fmt} t={t} lang={lang} />
        </>
      )}
    </div>
  );
}

// ── Agent view components ─────────────────────────────────────────────────────

function ScoreCards({ kpi, fmt, t, lang }: { kpi: any; fmt: (v: number) => string; t: (ru: string, uz: string) => string; lang: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
      <ScoreCard label={t("Общий балл", "Umumiy ball")} value={`${kpi.kpiScore}`} sub={GRADE_LABELS[kpi.kpiGrade]?.[lang] ?? kpi.kpiGrade}
        icon={<Star size={20} color="#fff" />} gradient={`linear-gradient(135deg, ${GRADE_COLORS[kpi.kpiGrade]}, ${GRADE_COLORS[kpi.kpiGrade]}cc)`} />
      <ScoreCard label={t("Выполнение плана", "Reja bajarilishi")} value={`${kpi.visitCompletionRate}%`} sub={`${kpi.visitedPlans}/${kpi.totalPlans} ${t("визитов", "tashriflar")}`}
        icon={<Target size={20} color="#fff" />} gradient="linear-gradient(135deg, #3b82f6, #2563eb)" />
      <ScoreCard label={t("Заказы", "Buyurtmalar")} value={String(kpi.orderCount)} sub={`${fmt(kpi.revenue)} ${t("выручка", "tushum")}`}
        icon={<ShoppingCart size={20} color="#fff" />} gradient="linear-gradient(135deg, #22c55e, #16a34a)" />
      <ScoreCard label={t("Средний чек", "O'rtacha chek")} value={fmt(kpi.avgOrderValue)}
        icon={<DollarSign size={20} color="#fff" />} gradient="linear-gradient(135deg, #f59e0b, #d97706)" />
      <ScoreCard label={t("Возвраты", "Qaytarishlar")} value={`${kpi.returnRate}%`} sub={`${kpi.returnCount} ${t("шт", "dona")}`}
        icon={<AlertTriangle size={20} color="#fff" />} gradient={`linear-gradient(135deg, ${kpi.returnRate > 10 ? "#ef4444" : "#22c55e"}, ${kpi.returnRate > 10 ? "#dc2626" : "#16a34a"})`} />
      <ScoreCard label={t("Магазины", "Do'konlar")} value={String(kpi.assignedShops)} sub={`${fmt(kpi.totalDebt)} ${t("долг", "qarz")}`}
        icon={<Package size={20} color="#fff" />} gradient="linear-gradient(135deg, #8b5cf6, #7c3aed)" />
    </div>
  );
}

function ScoreBreakdown({ kpi, t }: { kpi: any; t: (ru: string, uz: string) => string }) {
  return (
    <div style={{ background: "#fff", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
      <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 600, color: "#2b3450", marginBottom: "16px" }}>
        {t("Детализация балла", "Ball tafsilotlari")}
      </h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <ScoreBar label={t("Выполнение плана", "Reja")} value={kpi.visitCompletionRate} weight={30} color="#3b82f6" />
        <ScoreBar label={t("Выручка", "Tushum")} value={Math.min(100, Math.round((kpi.revenue / 10_000_000) * 100))} weight={25} color="#22c55e" />
        <ScoreBar label={t("Конверсия", "Konversiya")} value={kpi.orderCount > 0 && kpi.totalPlans > 0 ? Math.round((kpi.orderCount / kpi.totalPlans) * 100) : 0} weight={20} color="#f59e0b" />
        <ScoreBar label={t("Без возвратов", "Qaytarishsiz")} value={100 - kpi.returnRate} weight={15} color="#8b5cf6" />
        <ScoreBar label={t("Сбор долгов", "Qarz yig'ish")} value={kpi.debtCollectionRate} weight={10} color="#06b6d4" />
      </div>
    </div>
  );
}

function GpsSection({ kpi, t }: { kpi: any; t: (ru: string, uz: string) => string }) {
  return (
    <div style={{ background: "#fff", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
      <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 600, color: "#2b3450", marginBottom: "16px" }}>
        {t("GPS Трекинг", "GPS kuzatuv")}
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
        <StatBlock label={t("Пингов", "Pinglar")} value={String(kpi.gpsPings)} icon={<MapPin size={16} color="#3b82f6" />} />
        <StatBlock label={t("Статус", "Holat")} value={kpi.isOnline ? t("Онлайн", "Onlayn") : t("Оффлайн", "Oflayn")} icon={<Radio size={16} color={kpi.isOnline ? "#22c55e" : "#ef4444"} />} />
        <StatBlock label={t("Последний пинг", "Oxirgi ping")} value={kpi.lastGpsTime ? formatTime(kpi.lastGpsTime) : "—"} icon={<Clock size={16} color="#6a7290" />} />
      </div>
    </div>
  );
}

function VisitReportsSection({ kpi, t }: { kpi: any; t: (ru: string, uz: string) => string }) {
  return (
    <div style={{ background: "#fff", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
      <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 600, color: "#2b3450", marginBottom: "16px" }}>
        {t("Фотоотчёты", "Foto hisobotlar")}
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
        <StatBlock label={t("Отчётов", "Hisobotlar")} value={String(kpi.visitReportCount)} icon={<Camera size={16} color="#8b5cf6" />} />
        <StatBlock label={t("Последний отчёт", "Oxirgi hisobot")} value={kpi.lastReportTime ? formatTime(kpi.lastReportTime) : "—"} icon={<Clock size={16} color="#6a7290" />} />
      </div>
    </div>
  );
}

function SalarySection({ salary, fmt, t }: { salary: any; fmt: (v: number) => string; t: (ru: string, uz: string) => string }) {
  return (
    <div style={{ background: "#fff", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
      <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 600, color: "#2b3450", marginBottom: "16px" }}>
        {t("Расчёт зарплаты", "Oylik hisoblash")}
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}>
        <SalaryItem label={t("Оклад", "Oylik")} value={fmt(salary.baseSalary)} color="#6a7290" />
        <SalaryItem label={t("Комиссия", "Komissiya")} value={`${fmt(salary.commissionAmount)} (${salary.commissionRate}%)`} color="#3b82f6" />
        <SalaryItem label={t("Бонус за KPI", "KPI bonusi")} value={fmt(salary.bonusAmount)} color="#22c55e" />
        <SalaryItem label={t("ИТОГО", "JAMI")} value={fmt(salary.totalSalary)} color="#2b3450" bold />
      </div>
    </div>
  );
}

function VisitDetails({ kpi, t }: { kpi: any; t: (ru: string, uz: string) => string }) {
  return (
    <div style={{ background: "#fff", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
      <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 600, color: "#2b3450", marginBottom: "16px" }}>
        {t("Визиты", "Tashriflar")}
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
        <StatBlock label={t("Всего", "Jami")} value={String(kpi.totalPlans)} icon={<BarChart3 size={16} color="#6a7290" />} />
        <StatBlock label={t("Посещено", "Tashrif buyurilgan")} value={String(kpi.visitedPlans)} icon={<Clock size={16} color="#22c55e" />} />
        <StatBlock label={t("Пропущено", "O'tkazib yuborilgan")} value={String(kpi.skippedPlans)} icon={<AlertTriangle size={16} color="#f59e0b" />} />
      </div>
    </div>
  );
}

function DeliveryDetails({ kpi, fmt, t }: { kpi: any; fmt: (v: number) => string; t: (ru: string, uz: string) => string }) {
  return (
    <div style={{ background: "#fff", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
      <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 600, color: "#2b3450", marginBottom: "16px" }}>
        {t("Доставки", "Yetkazishlar")}
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
        <StatBlock label={t("Всего", "Jami")} value={String(kpi.deliveryCount)} icon={<Package size={16} color="#6a7290" />} />
        <StatBlock label={t("Доставлено", "Yetkazilgan")} value={String(kpi.deliveredCount)} icon={<CheckCircle size={16} color="#22c55e" />} />
        <StatBlock label={t("Ошибки", "Xatolar")} value={String(kpi.failedCount)} icon={<XCircle size={16} color="#ef4444" />} />
        <StatBlock label={t("Успешность", "Muvaffaqiyat")} value={`${kpi.deliverySuccessRate}%`} icon={<TrendingUp size={16} color="#3b82f6" />} />
      </div>
      {kpi.cashCollected > 0 && (
        <div style={{ marginTop: "12px", padding: "12px", borderRadius: "10px", background: "#f0f3f8", borderLeft: "3px solid #22c55e" }}>
          <p style={{ fontSize: "11px", color: "#6a7290" }}>{t("Собрано наличными", "Naqd pul yig'ilgan")}</p>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 600, color: "#2b3450" }}>{fmt(kpi.cashCollected)}</p>
        </div>
      )}
    </div>
  );
}

// ── Supervisor view: agents table ─────────────────────────────────────────────

function AgentsTable({ agents, salaries, fmt, t, lang }: {
  agents: any[]; salaries: any[]; fmt: (v: number) => string; t: (ru: string, uz: string) => string; lang: string;
}) {
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);

  const selectedKpi = selectedAgent ? agents.find(a => a.agentId === selectedAgent) : null;
  const selectedSalary = selectedAgent ? salaries.find(s => s.agentId === selectedAgent) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* Agents list */}
      <div style={{ background: "#fff", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
        <h3 style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 600, color: "#2b3450", marginBottom: "16px" }}>
          {t("Рейтинг агентов", "Agentlar reytingi")}
        </h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {agents.map((agent, i) => (
            <div key={agent.agentId}
              onClick={() => setSelectedAgent(selectedAgent === agent.agentId ? null : agent.agentId)}
              style={{
                display: "flex", alignItems: "center", gap: "12px", padding: "12px", borderRadius: "12px",
                cursor: "pointer", transition: "all 0.15s",
                background: selectedAgent === agent.agentId ? "#f0f3f8" : "transparent",
                border: `1px solid ${selectedAgent === agent.agentId ? "#5b6d8a" : "#f0f3f8"}`,
              }}>
              {/* Rank */}
              <div style={{
                width: "28px", height: "28px", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "12px", fontWeight: 700, fontFamily: "'DM Sans', sans-serif",
                background: i < 3 ? ["#fbbf24", "#9ca3af", "#cd7f32"][i] : "#f0f3f8",
                color: i < 3 ? "#fff" : "#6a7290",
              }}>
                {i + 1}
              </div>
              {/* Name + score */}
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: "13px", fontWeight: 600, color: "#2b3450" }}>{agent.agentName}</p>
                <p style={{ fontSize: "11px", color: "#6a7290" }}>
                  {agent.orderCount} {t("заказов", "buyurtma")} • {fmt(agent.revenue)}
                </p>
              </div>
              {/* Score badge */}
              <div style={{
                padding: "4px 10px", borderRadius: "8px", fontSize: "12px", fontWeight: 700,
                background: `${GRADE_COLORS[agent.kpiGrade]}15`, color: GRADE_COLORS[agent.kpiGrade],
              }}>
                {agent.kpiScore} • {agent.kpiGrade}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Selected agent details */}
      {selectedKpi && (
        <>
          <ScoreCards kpi={selectedKpi} fmt={fmt} t={t} lang={lang} />
          <ScoreBreakdown kpi={selectedKpi} t={t} />
          {selectedSalary && <SalarySection salary={selectedSalary} fmt={fmt} t={t} />}
          <VisitDetails kpi={selectedKpi} t={t} />
          {selectedKpi.deliveryCount > 0 && <DeliveryDetails kpi={selectedKpi} fmt={fmt} t={t} />}
          <GpsSection kpi={selectedKpi} t={t} />
          <VisitReportsSection kpi={selectedKpi} t={t} />
        </>
      )}
    </div>
  );
}

function ScoreCard({ label, value, sub, icon, gradient }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; gradient: string;
}) {
  return (
    <div style={{
      background: gradient, borderRadius: "16px", padding: "20px", color: "#fff",
      boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: "11px", opacity: 0.8, fontFamily: "'DM Sans', sans-serif", marginBottom: "4px" }}>{label}</p>
          <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "28px", fontWeight: 700 }}>{value}</p>
          {sub && <p style={{ fontSize: "11px", opacity: 0.7, marginTop: "2px" }}>{sub}</p>}
        </div>
        <div style={{ opacity: 0.8 }}>{icon}</div>
      </div>
    </div>
  );
}

function ScoreBar({ label, value, weight, color }: {
  label: string; value: number; weight: number; color: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
      <span style={{ width: "140px", fontSize: "12px", color: "#6a7290", fontFamily: "'DM Sans', sans-serif", flexShrink: 0 }}>{label} ({weight}%)</span>
      <div style={{ flex: 1, height: "8px", borderRadius: "4px", background: "#f0f3f8", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${value}%`, borderRadius: "4px", background: color, transition: "width 0.5s ease" }} />
      </div>
      <span style={{ width: "40px", textAlign: "right", fontSize: "12px", fontWeight: 600, color: "#2b3450" }}>{value}</span>
    </div>
  );
}

function StatBlock({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "#f0f3f8", textAlign: "center" }}>
      <div style={{ marginBottom: "6px" }}>{icon}</div>
      <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px", fontWeight: 700, color: "#2b3450" }}>{value}</p>
      <p style={{ fontSize: "11px", color: "#6a7290" }}>{label}</p>
    </div>
  );
}

function SalaryItem({ label, value, color, bold }: { label: string; value: string; color: string; bold?: boolean }) {
  return (
    <div style={{ padding: "12px", borderRadius: "10px", background: "#f0f3f8", borderLeft: `3px solid ${color}` }}>
      <p style={{ fontSize: "11px", color: "#6a7290", marginBottom: "4px" }}>{label}</p>
      <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: bold ? "18px" : "14px", fontWeight: bold ? 700 : 600, color: "#2b3450" }}>{value}</p>
    </div>
  );
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ч назад`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD} дн назад`;
}

// Store icon (not in lucide)
function Store({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
      <path d="M2 7h20" />
      <path d="M22 7v3a2 2 0 0 1-2 2v0a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12v0a2 2 0 0 1-2-2V7" />
    </svg>
  );
}
