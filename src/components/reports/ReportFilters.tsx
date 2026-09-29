import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useShopSearch, type PickedShop } from "@/hooks/useShopSearch";
import { PremiumSelect } from "@/components/PremiumSelect";
import type { FilterKind, ReportParams } from "./report-registry";

/**
 * The narrow selectors a report card needs.
 *
 * Deliberately not ShopSelector: that one is built for picking exactly one shop
 * while writing an order — a list of cards, a required value. A report
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

/**
 * Shared shape: "все" first, then the list; empty string clears the filter.
 *
 * ── Почему не родной select ─────────────────────────────────────────────────
 *
 * Здесь стоял <select> с инлайновым стилем. Браузер рисует его по-своему:
 * системная стрелка, системный шрифт списка, светлый фон выпадающей части даже
 * при тёмной теме, и высота, не совпадающая с соседними полями. Двенадцать
 * карточек отчётов встречали человека дюжиной чужеродных прямоугольников.
 *
 * PremiumSelect — тот же список, что во всём остальном приложении: со своей
 * разметкой, клавиатурой и темой. Ширину по-прежнему задаёт карточка.
 */
function Select({ label, value, options, onChange, style }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  style: React.CSSProperties;
}) {
  return (
    <PremiumSelect
      aria-label={label}
      value={value}
      onChange={onChange}
      options={[{ value: "", label }, ...options]}
      width={typeof style.width === "string" ? style.width : "100%"}
    />
  );
}

function AgentFilter({ value, onChange, t, style }: {
  value?: number; onChange: (v?: number) => void; t: (ru: string, uz: string) => string; style: React.CSSProperties;
}) {
  /*
    agent.listAgents, а не user.list: полный список пользователей открыт
    только руководителю и оператору, и у супервайзера и мерчендайзера этот
    фильтр приходил отказом — выпадающий список оставался пустым, и отобрать
    отчёт по агенту они не могли.
  */
  const { data } = trpc.agent.listAgents.useQuery();
  return (
    <Select
      label={t("Все агенты", "Barcha agentlar")}
      value={value ? String(value) : ""}
      onChange={v => onChange(v ? Number(v) : undefined)}
      options={(data ?? []).map(u => ({ value: String(u.id), label: u.name }))}
      style={style}
    />
  );
}

function ShopFilter({ value, onChange, t, style }: {
  value?: number; onChange: (v?: number) => void; t: (ru: string, uz: string) => string; style: React.CSSProperties;
}) {
  /*
    Магазин — поиском на сервере (useShopSearch), а не из 500 самых новых.

    Список грузил 500 последних заведённых точек: у организации с тысячами
    магазинов отчёт по давнему, основному клиенту выбрать было нельзя вовсе.
    Выбранный держится отдельно: иначе следующий поиск стёр бы его из списка,
    и поле показывало бы «Все магазины» при включённом отборе.
  */
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<PickedShop | null>(null);
  const { shops } = useShopSearch(search, { pinned: value && picked?.id === value ? picked : null });
  return (
    <>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder={t("Найти магазин: название, владелец, телефон", "Do'konni topish: nomi, egasi, telefon")}
        aria-label={t("Поиск магазина", "Do'kon qidirish")}
        style={style}
      />
      <Select
        label={t("Все магазины", "Barcha do'konlar")}
        value={value ? String(value) : ""}
        onChange={v => {
          const id = v ? Number(v) : undefined;
          setPicked(shops.find(s => s.id === id) ?? null);
          onChange(id);
        }}
        options={shops.map(s => ({ value: String(s.id), label: s.name }))}
        style={style}
      />
    </>
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
