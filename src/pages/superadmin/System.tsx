import { useSearchParams } from "react-router";
import { Clock3 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import Monitoring from "@/pages/Monitoring";
import { BackupSection } from "@/components/superadmin/BackupSection";
import { JOB_LABEL, OUTCOME, backupState, duration, jobSchedule, type JobRow } from "@/components/superadmin/console/jobs";
import { Empty, Loading, PageHead, Pill, TabBar } from "@/components/superadmin/console/ui";
import { ago, day } from "@/components/superadmin/console/format";

/* ═══════════════════════════════════════════════════════════════════════════
   «Система» — /super-admin/system.

   Здесь собрано то, что раньше жило в двух местах: страница «Мониторинг»
   (/monitoring — теперь ведёт сюда) и блок «Резервная копия» внизу общей
   страницы суперадмина. Новое — фоновые задачи: расписание и журнал
   cron_runs, то есть ответ на «идёт ли ночная копия» без чтения логов.
   Вкладки — в адресе (?tab=…).
   ═══════════════════════════════════════════════════════════════════════════ */

const TABS = [
  { key: "state",  label: "Состояние" },
  { key: "jobs",   label: "Фоновые задачи" },
  { key: "backup", label: "Резервная копия" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function System() {
  const [params] = useSearchParams();
  const raw = params.get("tab");
  const tab: TabKey = TABS.some(t => t.key === raw) ? (raw as TabKey) : "state";
  return (
    <div>
      <PageHead title="Система" subtitle="Состояние сервера, фоновые задачи и резервная копия базы." />
      <div style={{ marginBottom: 16 }}>
        <TabBar testId="system-tabs" active={tab}
          tabs={TABS.map(t => ({ key: t.key, label: t.label, to: t.key === "state" ? "/super-admin/system" : `/super-admin/system?tab=${t.key}` }))} />
      </div>
      {tab === "state" && <Monitoring />}
      {tab === "jobs" && <Jobs />}
      {tab === "backup" && <Backup />}
    </div>
  );
}

function Backup() {
  const { data } = trpc.system.jobs.useQuery();
  const b = backupState(data?.jobs);
  return (
    <div className="flex flex-col gap-4">
      <div className="neo-card neo-card-static flex items-center gap-3 flex-wrap" style={{ padding: 16, borderRadius: 20 }} data-testid="backup-last">
        <Pill tone={!data ? "neutral" : b.stale ? "danger" : "success"}>{!data ? "…" : b.stale ? "Старше 26 часов" : "Свежая"}</Pill>
        <span style={{ fontSize: 13.5, color: "var(--color-text-secondary)" }}>
          Последняя удачная ночная копия: {b.at ? <b style={{ color: "var(--color-text-primary)" }}>{day(b.at)} {b.at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} · {ago(b.at)}</b> : "не было"}
        </span>
      </div>
      <BackupSection />
    </div>
  );
}

function Jobs() {
  const { data, isLoading } = trpc.system.jobs.useQuery(undefined, { refetchInterval: 60_000 });
  if (isLoading) return <Loading />;
  const jobs = data?.jobs ?? [];
  if (jobs.length === 0) return <div className="neo-card neo-card-static" style={{ padding: 0, borderRadius: 20 }}><Empty icon={Clock3} title="Задач нет" /></div>;
  // Сначала то, что требует внимания: упавшие и просроченные.
  const rank: Record<JobRow["outcome"], number> = { failed: 0, overdue: 1, never: 2, ok: 3 };
  const sorted = [...jobs].sort((a, b) => rank[a.outcome] - rank[b.outcome] || (JOB_LABEL[a.name] ?? a.name).localeCompare(JOB_LABEL[b.name] ?? b.name, "ru"));
  return (
    <div className="flex flex-col gap-3">
      <p style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", margin: "0 4px", lineHeight: 1.5 }}>
        Время — по Ташкенту. «Просрочена» — назначенный час прошёл больше часа назад, а удачи после него нет (планировщик догоняет раз в час).
        Длительность пишется в памяти сервера — после перезапуска пусто, пока задача не пройдёт.
      </p>
      <div className="grid gap-3 lg:grid-cols-2" data-testid="jobs-list">
        {sorted.map(j => {
          const o = OUTCOME[j.outcome];
          return (
            <div key={j.name} className="neo-card neo-card-static" style={{ padding: 16, borderRadius: 18 }} data-testid="job-row" data-job={j.name}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--color-text-primary)" }}>{JOB_LABEL[j.name] ?? j.name}</div>
                  <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 2 }}>{j.name} · {jobSchedule(j)}</div>
                </div>
                <Pill tone={o.tone}>{o.label}</Pill>
              </div>
              <dl className="grid grid-cols-3 gap-2" style={{ margin: "12px 0 0", fontSize: 12.5 }}>
                <div className="min-w-0"><dt style={{ color: "var(--color-text-tertiary)" }}>Последний успех</dt><dd style={{ margin: "2px 0 0", fontWeight: 600 }}>{j.lastSuccessAt ? ago(j.lastSuccessAt) : "—"}</dd></div>
                <div className="min-w-0"><dt style={{ color: "var(--color-text-tertiary)" }}>Последняя ошибка</dt><dd style={{ margin: "2px 0 0", fontWeight: 600 }}>{j.lastErrorAt ? ago(j.lastErrorAt) : "—"}</dd></div>
                <div className="min-w-0"><dt style={{ color: "var(--color-text-tertiary)" }}>Длительность</dt><dd style={{ margin: "2px 0 0", fontWeight: 600 }}>{duration(j.lastDurationMs)}</dd></div>
              </dl>
              {j.lastError && (
                <p style={{ margin: "10px 0 0", padding: "8px 10px", borderRadius: 10, background: "var(--color-danger-subtle)", color: "var(--color-danger-text)", fontSize: 12, lineHeight: 1.45, overflowWrap: "anywhere" }} data-testid="job-error">
                  {j.lastError.slice(0, 300)}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
