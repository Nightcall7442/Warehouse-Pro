import { trpc } from "@/providers/trpc";
import type { FilterKind, ReportParams } from "./report-registry";

/**
 * The narrow selectors a report card needs.
 *
 * Deliberately not ShopSelector: that one is built for picking exactly one shop
 * while writing an order — search, city grouping, a required value. A report
 * filter is the opposite shape. Its default is "everyone", it is optional, and
 * it has to sit inside a card without dominating it.
 *
 * Each list is loaded once and shared by every card that asks for it, since
 * react-query dedupes by key — twelve cards offering an agent filter still
 * issue one request for the agent list.
 */
export function ReportFilter({ kind, value, onChange, t, style }: {
  kind: FilterKind;
  value: Partial<ReportParams>;
  onChange: (patch: Partial<ReportParams>) => void;
  t: (ru: string, uz: string) => string;
  style: React.CSSProperties;
}) {
  if (kind === "agent")     return <AgentFilter value={value.agentId} onChange={v => onChange({ agentId: v })} t={t} style={style} />;
  if (kind === "shop")      return <ShopFilter value={value.shopId} onChange={v => onChange({ shopId: v })} t={t} style={style} />;
  if (kind === "territory") return <TerritoryFilter value={value.territoryId} onChange={v => onChange({ territoryId: v })} t={t} style={style} />;
  return <CategoryFilter value={value.category} onChange={v => onChange({ category: v })} t={t} style={style} />;
}

/** Shared shape: "все" first, then the list; empty string clears the filter. */
function Select({ label, value, options, onChange, style }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  style: React.CSSProperties;
}) {
  return (
    <select aria-label={label} value={value} onChange={e => onChange(e.target.value)} style={style}>
      <option value="">{label}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function AgentFilter({ value, onChange, t, style }: {
  value?: number; onChange: (v?: number) => void; t: (ru: string, uz: string) => string; style: React.CSSProperties;
}) {
  const { data } = trpc.user.list.useQuery({ role: "agent", page: 1, pageSize: 200 });
  return (
    <Select
      label={t("Все агенты", "Barcha agentlar")}
      value={value ? String(value) : ""}
      onChange={v => onChange(v ? Number(v) : undefined)}
      options={(data?.data ?? []).map(u => ({ value: String(u.id), label: u.name }))}
      style={style}
    />
  );
}

function ShopFilter({ value, onChange, t, style }: {
  value?: number; onChange: (v?: number) => void; t: (ru: string, uz: string) => string; style: React.CSSProperties;
}) {
  // shop.list's inferred output collapses to {} through the tRPC chain, which
  // is why the shops page casts its rows too. Narrowed here to the two fields
  // this selector actually reads rather than left as any.
  const { data } = trpc.shop.list.useQuery({ page: 1, pageSize: 500 });
  const shops = (data as { data?: Array<{ id: number; name: string }> } | undefined)?.data ?? [];
  return (
    <Select
      label={t("Все магазины", "Barcha do'konlar")}
      value={value ? String(value) : ""}
      onChange={v => onChange(v ? Number(v) : undefined)}
      options={shops.map(s => ({ value: String(s.id), label: s.name }))}
      style={style}
    />
  );
}

function TerritoryFilter({ value, onChange, t, style }: {
  value?: number; onChange: (v?: number) => void; t: (ru: string, uz: string) => string; style: React.CSSProperties;
}) {
  const { data } = trpc.territory.list.useQuery();
  return (
    <Select
      label={t("Все территории", "Barcha hududlar")}
      value={value ? String(value) : ""}
      onChange={v => onChange(v ? Number(v) : undefined)}
      options={(data ?? []).map(tr => ({ value: String(tr.id), label: tr.name }))}
      style={style}
    />
  );
}

function CategoryFilter({ value, onChange, t, style }: {
  value?: string; onChange: (v?: string) => void; t: (ru: string, uz: string) => string; style: React.CSSProperties;
}) {
  const { data } = trpc.product.categories.useQuery();
  return (
    <Select
      label={t("Все категории", "Barcha toifalar")}
      value={value ?? ""}
      onChange={v => onChange(v || undefined)}
      options={(data ?? []).map(c => ({ value: String(c), label: String(c) }))}
      style={style}
    />
  );
}
