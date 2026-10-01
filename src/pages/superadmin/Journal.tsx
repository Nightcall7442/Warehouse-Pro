import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { ScrollText, Search, X } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { PremiumSelect } from "@/components/PremiumSelect";
import { PLATFORM_ACTION_GROUPS } from "@contracts/platform-journal";
import { JournalList, type JournalRow } from "@/components/superadmin/console/JournalList";
import { Chip, Empty, PageHead } from "@/components/superadmin/console/ui";

/* ═══════════════════════════════════════════════════════════════════════════
   «Журнал» — действия владельца платформы (/super-admin/journal).

   ── Что было ────────────────────────────────────────────────────────────────

   Кто сменил Бухаре тариф, кто продлил пробный «на полгода», когда удалили
   «Хорезм Опт» и что у неё было — не знал никто: часть действий консоли не
   оставляла следа вовсе, остальные писались в журнал самой организации и
   пропадали вместе с ней.

   ── Что теперь ──────────────────────────────────────────────────────────────

   Каждое действие консоли — строка: когда, что, над какой организацией,
   было → стало, кто и с какого адреса. Отбор по типу, организации, периоду и
   слову — в адресе (?type=…&org=…&period=…&q=…): ссылкой можно поделиться.
   Только чтение.
   ═══════════════════════════════════════════════════════════════════════════ */

const PERIODS = [
  { key: "7", label: "7 дней" },
  { key: "30", label: "30 дней" },
  { key: "90", label: "90 дней" },
  { key: "all", label: "Всё" },
] as const;

export default function Journal() {
  const [params, setParams] = useSearchParams();
  const type = params.get("type") ?? "";
  const org = Number(params.get("org")) || undefined;
  const period = PERIODS.some(p => p.key === params.get("period")) ? params.get("period")! : "all";
  const q = params.get("q") ?? "";
  const filters = useMemo(() => ({
    type: type || undefined, tenantId: org, days: period === "all" ? undefined : Number(period), q: q.trim() || undefined, limit: 50,
  }), [type, org, period, q]);

  const set = (patch: Record<string, string | null>) => setParams(prev => {
    const next = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") next.delete(k); else next.set(k, v); }
    return next;
  }, { replace: true });

  const list = trpc.tenant.list.useQuery();
  const alive = useMemo(() => { const ids = new Set((list.data ?? []).map(o => o.id)); return (id: number) => !list.data || ids.has(id); }, [list.data]);
  const orgOptions = useMemo(() => [{ value: "", label: "Все организации" },
    ...[...(list.data ?? [])].sort((a, b) => a.name.localeCompare(b.name, "ru")).map(o => ({ value: String(o.id), label: o.name }))], [list.data]);

  return (
    <div data-testid="console-journal">
      <PageHead title="Журнал" subtitle="Что делалось в консоли: кто, когда, было → стало. Строки остаются и после удаления организации." />

      <div className="flex flex-col gap-3" style={{ marginBottom: 14 }}>
        <div className="flex gap-2 items-center flex-wrap console-form">
          <div className="relative flex-1" style={{ maxWidth: 420, minWidth: 220 }}>
            <Search size={17} className="absolute" style={{ left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)" }} />
            <input className="neo-input w-full" value={q} onChange={e => set({ q: e.target.value })} data-testid="journal-search"
              placeholder="Организация, логин, сумма, кто" aria-label="Поиск по журналу"
              style={{ paddingLeft: 42, paddingRight: q ? 44 : 14, minHeight: 46, fontSize: 14 }} />
            {q && (
              <button type="button" onClick={() => set({ q: null })} aria-label="Очистить поиск" className="absolute flex items-center justify-center"
                style={{ right: 2, top: "50%", transform: "translateY(-50%)", width: 44, height: 44, color: "var(--color-text-tertiary)" }}>
                <X size={17} />
              </button>
            )}
          </div>
          <div className="w-full md:w-[220px]" data-testid="journal-type">
            <PremiumSelect value={type} onChange={v => set({ type: v || null })} aria-label="Тип действия" width="100%"
              options={[{ value: "", label: "Все действия" }, ...PLATFORM_ACTION_GROUPS.map(g => ({ value: g.key, label: g.label }))]} />
          </div>
          <div className="w-full md:w-[260px]" data-testid="journal-org">
            <PremiumSelect value={org ? String(org) : ""} onChange={v => set({ org: v || null })} aria-label="Организация" width="100%" options={orgOptions} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="journal-periods">
          {PERIODS.map(p => (
            <Chip key={p.key} active={period === p.key} onClick={() => set({ period: p.key === "all" ? null : p.key })} testId={`journal-period-${p.key}`}>{p.label}</Chip>
          ))}
        </div>
      </div>

      {/* Ключ — фильтры: смена отбора начинает листание заново. */}
      <Pages key={JSON.stringify(filters)} filters={filters} alive={alive} />
    </div>
  );
}

function Pages({ filters, alive }: { filters: { type?: string; tenantId?: number; days?: number; q?: string; limit: number }; alive: (id: number) => boolean }) {
  const first = trpc.platform.journal.useQuery(filters);
  const utils = trpc.useUtils();
  const [more, setMore] = useState<{ rows: JournalRow[]; next: number | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const rows = [...(first.data?.rows ?? []), ...(more?.rows ?? [])];
  const next = more ? more.next : first.data?.nextBefore ?? null;

  const loadMore = async () => {
    if (!next) return;
    setLoading(true);
    try {
      const page = await utils.client.platform.journal.query({ ...filters, before: next });
      setMore(m => ({ rows: [...(m?.rows ?? []), ...page.rows], next: page.nextBefore }));
    } finally { setLoading(false); }
  };

  return (
    <div className="neo-card neo-card-static" style={{ padding: 0, borderRadius: 20, overflow: "hidden" }}>
      {first.isLoading ? (
        <div style={{ padding: 20 }}>{[0, 1, 2, 3].map(i => <div key={i} style={{ height: 18, borderRadius: 8, background: "var(--color-surface-light)", margin: "12px 0" }} />)}</div>
      ) : rows.length === 0 ? (
        <Empty icon={ScrollText} title={filters.q || filters.type || filters.tenantId ? "Ничего не нашли" : "Журнал пуст"}
          hint="Сюда пишутся тарифы, оплаты, продления, статусы, логины и пароли, объявления, удаления и уборка данных." />
      ) : (
        <>
          <JournalList rows={rows} showOrg={!filters.tenantId} alive={alive} />
          {next && (
            <div style={{ padding: 12, borderTop: "1px solid var(--color-border-subtle)" }}>
              <button type="button" className="neo-btn w-full" style={{ minHeight: 44 }} onClick={loadMore} disabled={loading} data-testid="journal-more">
                {loading ? "Загружаю…" : "Показать ещё"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
