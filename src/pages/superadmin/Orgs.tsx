import { useMemo, useState, type CSSProperties } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Building2, Users as UsersIcon, ShoppingCart, TrendingUp, Plus, Search, X, PhoneCall, ArrowUp, ArrowDown, RefreshCw } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { formatUzPhone } from "@contracts/signup";
import { CreateTenantModal } from "@/components/superadmin/CreateTenantModal";
import { FILTERS, daysLeft, endsAt, inFilter, matches, planOf, readListParams, sortOrgs, statusOf, type FilterKey, type OrgRow, type SortKey } from "@/components/superadmin/console/orgs";
import { PremiumSelect } from "@/components/PremiumSelect";
import { Chip, Empty, PageHead, Pill, PlanPill, Tile } from "@/components/superadmin/console/ui";
import { ago, day, money } from "@/components/superadmin/console/format";
import { HealthPill } from "@/components/superadmin/console/health";

/* ═══════════════════════════════════════════════════════════════════════════
   «Организации» — все клиенты платформы одной таблицей (/super-admin/orgs).

   ── Что было ────────────────────────────────────────────────────────────────

   Список стоял шестым блоком на общей странице: поиск по имени, slug и почте,
   два выпадающих фильтра (тариф, статус) и столбцы за всё время. Кто работает
   сейчас, кто замолчал, у кого кончается оплата — не видно; фильтр
   сбрасывался при выходе из карточки, ссылкой им не поделишься.

   ── Что теперь ──────────────────────────────────────────────────────────────

   Чипы по тем же вопросам, что панель владельца (платят, пробные, истекают,
   молчат, приостановлены), поиск ещё и по ИНН и телефону, сортировка по
   любому столбцу, заказы и выручка за 30 дней, последняя активность. Фильтр,
   поиск и сортировка — в адресе (?f=…&q=…&sort=…&dir=…): «назад» из карточки
   возвращает ровно тот список. На телефоне — карточки вместо таблицы.

   Этап 2: столбец «Здоровье» (оценка 0–100 и уровень, api/services/
   org-health.ts) и чип «Уходят» (?f=churn) — платящие, которых теряем.
   ═══════════════════════════════════════════════════════════════════════════ */

const COLS: Array<{ key: SortKey; label: string; numeric?: boolean; width?: number }> = [
  { key: "name",      label: "Организация" },
  { key: "health",    label: "Здоровье", width: 124 },
  { key: "plan",      label: "Тариф", width: 128 },
  { key: "ends",      label: "Срок до", width: 116 },
  { key: "users",     label: "Польз.", numeric: true, width: 72 },
  { key: "orders30",  label: "Заказы 30 дн", numeric: true, width: 104 },
  { key: "revenue30", label: "Выручка 30 дн", numeric: true, width: 140 },
  { key: "activity",  label: "Активность", width: 116 },
];
/** Направление по умолчанию: имя и срок — по возрастанию, числа и активность — сверху большие и свежие. */
const DEFAULT_DIR: Record<SortKey, "asc" | "desc"> = { name: "asc", health: "asc", plan: "desc", ends: "asc", users: "desc", orders30: "desc", revenue30: "desc", activity: "desc" };

const th: CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)",
  padding: "0 14px", height: 46, textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid var(--color-border-subtle)",
};
const td: CSSProperties = { padding: "12px 14px", fontSize: 13.5, color: "var(--color-text-primary)", borderTop: "1px solid var(--color-border-subtle)", verticalAlign: "middle" };

export default function Orgs() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { filter: fParam, plan, q, sort, dir } = readListParams(params);
  const overreachParam = params.get("f") === "overreach";
  const filter: FilterKey | "overreach" = overreachParam ? "overreach" : fParam;
  const [creating, setCreating] = useState(false);
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.tenant.list.useQuery();
  const { data: stats } = trpc.tenant.platformStats.useQuery();
  const { data: usage } = trpc.tenant.featureUsage.useQuery();
  const overreach = useMemo(() => new Set((usage ?? []).filter(r => r.overreach.length > 0).map(r => r.tenantId)), [usage]);

  const all = useMemo(() => data ?? [], [data]);
  // Тариф — отдельным выбором, как было в прежнем списке («Все тарифы»).
  const searched = useMemo(() => all.filter(o => matches(o, q) && (!plan || planOf(o) === plan)), [all, q, plan]);
  const counts = useMemo(() => {
    const c = {} as Record<FilterKey | "overreach", number>;
    for (const f of FILTERS) c[f.key] = searched.filter(o => inFilter(o, f.key)).length;
    c.overreach = searched.filter(o => overreach.has(o.id)).length;
    return c;
  }, [searched, overreach]);
  const rows = useMemo(() => sortOrgs(
    searched.filter(o => (filter === "overreach" ? overreach.has(o.id) : inFilter(o, filter))), sort, dir,
  ), [searched, filter, overreach, sort, dir]);

  const set = (patch: Record<string, string | null>) => setParams(prev => {
    const next = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") next.delete(k); else next.set(k, v); }
    return next;
  }, { replace: true });
  const sortBy = (key: SortKey) => set({ sort: key, dir: key === sort ? (dir === "asc" ? "desc" : "asc") : DEFAULT_DIR[key] });

  const byPlan = stats?.byPlan ?? {};
  const planLine = [`пробный ${byPlan.trial ?? 0}`, `базовый ${byPlan.basic ?? 0}`, `про ${byPlan.pro ?? 0}`, `эксклюзив ${byPlan.exclusive ?? 0}`].join(" · ");

  return (
    <div>
      {creating && <CreateTenantModal onClose={() => setCreating(false)} onCreated={() => { utils.tenant.list.invalidate(); utils.tenant.platformStats.invalidate(); }} />}
      <PageHead title="Организации"
        subtitle={data ? `${all.length} всего · показано ${rows.length}` : "Загрузка…"}
        actions={<>
          <button type="button" className="neo-btn" aria-label="Обновить" title="Обновить" data-testid="orgs-refresh" style={{ minHeight: 44, minWidth: 44, padding: "0 12px" }}
            onClick={() => { void utils.tenant.list.invalidate(); void utils.tenant.platformStats.invalidate(); void utils.tenant.featureUsage.invalidate(); }}>
            <RefreshCw size={16} />
          </button>
          <button type="button" className="neo-btn-primary" onClick={() => setCreating(true)} style={{ minHeight: 44 }} data-testid="org-create">
            <Plus size={17} /> <span className="hidden sm:inline">Создать организацию</span><span className="sm:hidden">Создать</span>
          </button>
        </>} />

      {/* Платформа целиком — прежние счётчики «Super Admin», теперь над списком, к которому относятся. */}
      {/* Телефон — одна сводка вместо четырёх плиток: иначе список начинался со второго экрана. */}
      <div className="md:hidden neo-card neo-card-static grid grid-cols-2 gap-x-4 gap-y-3" style={{ padding: 16, borderRadius: 18, marginBottom: 14 }} data-testid="orgs-kpi-compact">
        <MiniStat label="Организаций" value={stats ? String(stats.tenants) : "…"} />
        <MiniStat label="Пользователей" value={stats ? String(stats.users) : "…"} />
        <MiniStat label="Заказов всего" value={stats ? money(stats.orders) : "…"} />
        <MiniStat label="Выручка всего, сум" value={stats ? money(stats.revenue) : "…"} />
        {stats && <p className="col-span-2" style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: 0, lineHeight: 1.45 }}>{planLine}{(stats.byStatus.suspended ?? 0) > 0 ? ` · приостановлено ${stats.byStatus.suspended}` : ""}</p>}
      </div>
      <div className="hidden md:grid gap-4 grid-cols-2 xl:grid-cols-4" style={{ marginBottom: 18 }} data-testid="orgs-kpi">
        <Tile label="Организаций" value={stats?.tenants ?? "…"} icon={Building2} tone="primary"
          hint={stats ? <>{planLine}{(stats.byStatus.suspended ?? 0) > 0 ? ` · приостановлено ${stats.byStatus.suspended}` : ""}</> : undefined} />
        <Tile label="Пользователей" value={stats?.users ?? "…"} icon={UsersIcon} tone="info" />
        <Tile label="Заказов за всё время" value={stats ? money(stats.orders) : "…"} icon={ShoppingCart} tone="success" />
        <Tile label="Выручка за всё время" value={stats ? money(stats.revenue) : "…"} suffix="сум" icon={TrendingUp} tone="warning" />
      </div>

      {/* Поиск и фильтры. */}
      <div className="flex flex-col gap-3" style={{ marginBottom: 14 }}>
        <div className="flex gap-2 items-center flex-wrap">
        <div className="relative flex-1" style={{ maxWidth: 520, minWidth: 220 }}>
          <Search size={17} className="absolute" style={{ left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--color-text-tertiary)" }} />
          <input className="neo-input w-full" value={q} onChange={e => set({ q: e.target.value })} data-testid="orgs-search"
            placeholder="Название, slug, ИНН или телефон" aria-label="Поиск организаций"
            style={{ paddingLeft: 42, paddingRight: q ? 44 : 14, minHeight: 46, fontSize: 14 }} />
          {q && (
            <button type="button" onClick={() => set({ q: null })} aria-label="Очистить поиск" className="absolute flex items-center justify-center"
              style={{ right: 2, top: "50%", transform: "translateY(-50%)", width: 44, height: 44, color: "var(--color-text-tertiary)" }}>
              <X size={17} />
            </button>
          )}
        </div>
        <div className="console-form w-full md:w-[170px]" data-testid="orgs-plan">
          <PremiumSelect value={plan} onChange={v => set({ plan: v || null })} aria-label="Тариф" width="100%"
            options={[{ value: "", label: "Все тарифы" }, { value: "trial", label: "Пробный" }, { value: "basic", label: "Базовый" }, { value: "pro", label: "Про" }, { value: "exclusive", label: "Эксклюзив" }]} />
        </div>
        </div>
        {/* На телефоне чипы переносятся, а не уезжают за край: обрезанный «Истека…» не читается как фильтр. */}
        <div className="flex flex-wrap md:flex-nowrap gap-2 md:overflow-x-auto" style={{ padding: "4px 2px 6px", margin: "0 -2px", scrollbarWidth: "none" }} data-testid="orgs-filters">
          {FILTERS.map(f => (
            <Chip key={f.key} active={filter === f.key} count={counts[f.key]} onClick={() => set({ f: f.key === "all" ? null : f.key })} testId={`filter-${f.key}`}>
              {f.label}
            </Chip>
          ))}
          {(counts.overreach > 0 || filter === "overreach") && (
            <Chip active={filter === "overreach"} count={counts.overreach} onClick={() => set({ f: "overreach" })} testId="filter-overreach">Сверх тарифа</Chip>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="neo-card neo-card-static" style={{ padding: 20, borderRadius: 20 }}>
          {[0, 1, 2, 3].map(i => <div key={i} style={{ height: 18, borderRadius: 8, background: "var(--color-surface-light)", margin: "12px 0" }} />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="neo-card neo-card-static" style={{ padding: 0, borderRadius: 20 }} data-testid="orgs-empty">
          <Empty icon={Building2} title={q ? "Никого не нашли" : "В этом фильтре пусто"}
            hint={q ? "Ищется по названию, slug, ИНН, телефону и почте владельца." : "Выберите «Все», чтобы увидеть остальные организации."} />
        </div>
      ) : (
        <>
          {/* Компьютер — таблица. */}
          <div className="hidden md:block neo-card neo-card-static" style={{ padding: 0, borderRadius: 20, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table className="console-table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }} data-testid="orgs-table">
                <thead>
                  <tr>
                    {COLS.map(c => {
                      const on = sort === c.key;
                      return (
                        <th key={c.key} style={{ ...th, textAlign: c.numeric ? "right" : "left", width: c.width }} aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : "none"}>
                          <button type="button" onClick={() => sortBy(c.key)} data-testid={`sort-${c.key}`}
                            className="inline-flex items-center gap-1" style={{ minHeight: 44, font: "inherit", color: on ? "var(--color-text-primary)" : "inherit", letterSpacing: "inherit", textTransform: "inherit" }}>
                            {c.label}
                            {on && (dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(o => <TableRow key={o.id} o={o} over={overreach.has(o.id)} onOpen={() => navigate(`/super-admin/orgs/${o.id}`)} />)}
                </tbody>
              </table>
            </div>
          </div>

          {/* Телефон — карточки. */}
          <div className="md:hidden flex flex-col gap-3" data-testid="orgs-cards">
            {rows.map(o => <OrgCardRow key={o.id} o={o} over={overreach.has(o.id)} />)}
          </div>
        </>
      )}
    </div>
  );
}

function Ends({ o }: { o: OrgRow }) {
  const e = endsAt(o);
  const d = daysLeft(o);
  if (!e) return <span style={{ color: "var(--color-text-tertiary)" }}>бессрочно</span>;
  // Пробный длится две недели — «12 дн.» у него норма; тревожно за три дня. У платящих — за две недели.
  const soon = o.segment.trial ? 3 : 14;
  const tone = d !== null && d <= 0 ? "var(--color-danger-text)" : d !== null && d <= soon ? "var(--color-warning-text)" : "var(--color-text-secondary)";
  return (
    <span className="flex flex-col">
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{day(e)}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: tone }}>{d !== null && d <= 0 ? "истёк" : `${d} дн.`}</span>
    </span>
  );
}

function TableRow({ o, over, onOpen }: { o: OrgRow; over: boolean; onOpen: () => void }) {
  const st = statusOf(o);
  return (
    <tr onClick={onOpen} style={{ cursor: "pointer" }} data-testid="org-row">
      <td style={td}>
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, borderRadius: 11, background: "var(--color-primary-subtle)", color: "var(--color-primary-text)", fontWeight: 800 }}>
            {o.name.trim()[0]?.toUpperCase()}
          </span>
          <div className="min-w-0">
            <Link to={`/super-admin/orgs/${o.id}`} onClick={e => e.stopPropagation()} className="block"
              style={{ fontWeight: 700, color: "var(--color-text-primary)", textDecoration: "none", maxWidth: 380, overflowWrap: "anywhere", lineHeight: 1.35 }}>{o.name}</Link>
            <div className="flex items-center gap-1.5 flex-wrap" style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 2 }}>
              <span>{o.slug}</span>
              {o.contactPhone && <span>· {formatUzPhone(o.contactPhone)}</span>}
              {st.tone !== "success" && st.tone !== "info" && <Pill tone={st.tone}>{st.label}</Pill>}
              {o.segment.silentDays !== null && <Pill tone="warning">молчит {o.segment.silentDays} дн.</Pill>}
              {over && <Pill tone="warning">сверх тарифа</Pill>}
            </div>
          </div>
        </div>
      </td>
      <td style={td} data-testid="org-health-cell">
        {o.health ? <HealthPill h={o.health} /> : <span style={{ color: "var(--color-text-tertiary)" }}>—</span>}
      </td>
      <td style={td}>
        <PlanPill plan={o.subscription?.plan ?? o.plan} />
        {o.segment.price > 0 && <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 4, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{money(o.segment.price)} сум/мес</div>}
      </td>
      <td style={td}><Ends o={o} /></td>
      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{o.userCount}</td>
      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money(o.orders30)}</td>
      <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{money(o.revenue30)} <span style={{ color: "var(--color-text-tertiary)", fontSize: 12 }}>сум</span></td>
      <td style={{ ...td, color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>{ago(o.lastActivityAt)}</td>
    </tr>
  );
}

function OrgCardRow({ o, over }: { o: OrgRow; over: boolean }) {
  const st = statusOf(o);
  const d = daysLeft(o);
  const e = endsAt(o);
  return (
    <div className="neo-card neo-card-static" style={{ padding: 0, borderRadius: 18, overflow: "hidden" }} data-testid="org-card">
      <Link to={`/super-admin/orgs/${o.id}`} className="console-row block" style={{ padding: "14px 16px", textDecoration: "none", color: "inherit" }}>
        <div className="flex items-start gap-3">
          <span className="flex items-center justify-center flex-shrink-0" style={{ width: 40, height: 40, borderRadius: 12, background: "var(--color-primary-subtle)", color: "var(--color-primary-text)", fontWeight: 800, fontSize: 16 }}>
            {o.name.trim()[0]?.toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div style={{ fontSize: 15.5, fontWeight: 700, color: "var(--color-text-primary)", overflowWrap: "anywhere", lineHeight: 1.3 }}>{o.name}</div>
            <div style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", marginTop: 2 }}>{o.slug}</div>
            <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 8 }}>
              <PlanPill plan={o.subscription?.plan ?? o.plan} />
              {o.health && <HealthPill h={o.health} />}
              {st.label !== "Пробный" && <Pill tone={st.tone}>{st.label}</Pill>}
              {o.segment.silentDays !== null && <Pill tone="warning">молчит {o.segment.silentDays} дн.</Pill>}
              {over && <Pill tone="warning">сверх тарифа</Pill>}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2" style={{ marginTop: 12, fontSize: 12.5 }}>
          <Fact label="Срок до" value={e ? `${day(e)} · ${d !== null && d <= 0 ? "истёк" : `${d} дн.`}` : "бессрочно"} warn={d !== null && d <= (o.segment.trial ? 3 : 14)} />
          <Fact label="Активность" value={ago(o.lastActivityAt)} />
          <Fact label="Заказы 30 дн" value={money(o.orders30)} />
          <Fact label="Выручка 30 дн" value={`${money(o.revenue30)} сум`} />
        </div>
      </Link>
      {o.contactPhone && (
        <a href={`tel:${o.contactPhone.replace(/[^\d+]/g, "")}`} className="flex items-center gap-2"
          style={{ minHeight: 48, padding: "0 16px", borderTop: "1px solid var(--color-border-subtle)", fontSize: 13.5, fontWeight: 700, color: "var(--color-primary-text)", textDecoration: "none", fontVariantNumeric: "tabular-nums" }}>
          <PhoneCall size={15} /> {formatUzPhone(o.contactPhone)}
        </a>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div style={{ fontSize: 11.5, color: "var(--color-text-tertiary)" }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}

function Fact({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <div style={{ color: "var(--color-text-tertiary)", fontSize: 11.5 }}>{label}</div>
      <div className="truncate" style={{ fontWeight: 600, color: warn ? "var(--color-warning-text)" : "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}
