import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { PhoneCall } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../api/router";
import { formatUzPhone, describeSignupSource } from "@contracts/signup";
import { Panel, PlanPill, Pill } from "./ui";
import { STAGE_LABEL, day, money } from "./format";

/* ═══════════════════════════════════════════════════════════════════════════
   «Кому позвонить» — списки панели владельца, у каждой строки телефон.

   Раньше это были четыре списка подряд на общей странице (OwnerPanel): пока
   доберёшься до «Пробных», пролистаешь всех платящих. Теперь — одна панель
   с переключателем: молчат, продления, платят, пробные. Правила счёта — в
   api/services/owner-panel.ts, экран только показывает.

   Название строки ведёт в карточку организации: позвонил — там же продлил,
   сменил тариф или ответил на обращение.
   ═══════════════════════════════════════════════════════════════════════════ */

type Panel_ = inferRouterOutputs<AppRouter>["tenant"]["ownerPanel"];


const TABS = [
  { key: "silent",   label: "Молчат 5+ дн" },
  { key: "renewals", label: "Продления" },
  { key: "paying",   label: "Платят" },
  { key: "trials",   label: "Пробные" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export function CallList({ data }: { data: Panel_ }) {
  const [tab, setTab] = useState<TabKey>("silent");
  const counts: Record<TabKey, number> = {
    silent: data.silent.length, renewals: data.renewals.length,
    paying: data.paying.list.length, trials: data.funnel.trials.length,
  };

  return (
    <Panel title="Кому позвонить" testId="owner-calls" flush>
      <div className="grid grid-cols-2 sm:flex gap-1" role="tablist" aria-label="Списки"
        style={{ margin: "0 16px 10px", padding: 4, borderRadius: 14, background: "var(--color-surface)", boxShadow: "var(--shadow-pressed)", scrollbarWidth: "none" }}>
        {TABS.map(t => {
          const on = t.key === tab;
          return (
            <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => setTab(t.key)} data-testid={`owner-tab-${t.key}`}
              className="flex-1 flex-shrink-0 inline-flex items-center justify-center gap-1.5"
              style={{ minHeight: 44, padding: "0 12px", borderRadius: 11, fontSize: 13, whiteSpace: "nowrap",
                fontWeight: on ? 700 : 600, color: on ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                background: on ? "var(--color-surface-raised, var(--color-surface))" : "transparent", boxShadow: on ? "var(--shadow-sm)" : "none" }}>
              {t.label}
              <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--color-text-tertiary)" }}>{counts[t.key]}</span>
            </button>
          );
        })}
      </div>

      {tab === "silent" && (
        <List testId="owner-silent" empty="Все платящие и пробные работали за последние пять дней.">
          {data.silent.map(r => (
            <CallRow key={r.tenantId} id={r.tenantId} name={r.name} phone={r.phone} email={r.email} badge={<PlanPill plan={r.plan} />}
              meta={`${r.kind === "paying" ? "платит" : "пробный"} · последняя активность ${day(r.lastActivityAt)} · тишина ${r.silentDays} дн.`} />
          ))}
        </List>
      )}
      {tab === "renewals" && (
        <List testId="owner-renewals" empty="В ближайшие две недели оплаченный срок не кончается ни у кого.">
          {data.renewals.map(r => (
            <CallRow key={r.tenantId} id={r.tenantId} name={r.name} phone={r.phone} email={r.email} badge={<PlanPill plan={r.plan} />}
              meta={`до ${day(r.periodEnds)} · осталось ${r.daysLeft} дн. · ${money(r.price)} сум/мес`} />
          ))}
        </List>
      )}
      {tab === "paying" && (
        <List testId="owner-paying" empty="Платящих пока нет.">
          {data.paying.list.map(r => (
            <CallRow key={r.tenantId} id={r.tenantId} name={r.name} phone={r.phone} email={r.email} badge={<PlanPill plan={r.plan} />}
              meta={r.periodEnds ? `${money(r.price)} сум/мес · оплачено до ${day(r.periodEnds)}` : `${money(r.price)} сум/мес · бессрочно`} />
          ))}
        </List>
      )}
      {tab === "trials" && (
        <List testId="owner-trials" empty="Пробных нет.">
          {data.funnel.trials.map(r => {
            const source = describeSignupSource(r.source, "ru");
            return (
              <CallRow key={r.tenantId} id={r.tenantId} name={r.name} phone={r.phone} email={r.email}
                badge={<Pill tone="primary">{STAGE_LABEL[r.stage] ?? r.stage}</Pill>}
                meta={<><StageDots done={r.done} />{" "}{`с ${day(r.createdAt)} · ${r.trialExpired ? "пробный истёк" : "пробный до"} ${day(r.trialEndsAt)}`}{source ? ` · ${source}` : ""}</>} />
            );
          })}
        </List>
      )}
    </Panel>
  );
}

function List({ testId, empty, children }: { testId: string; empty: string; children: ReactNode[] }) {
  return (
    <div data-testid={testId}>
      {children.length === 0
        ? <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0, padding: "10px 20px 14px" }}>{empty}</p>
        : <div className="premium-scrollbar" style={{ maxHeight: 440, overflowY: "auto" }}>{children}</div>}
    </div>
  );
}

/**
 * Строка «кому звонить». На телефоне переносится: название и сведения сверху,
 * кнопка звонка под ними — цель касания не меньше 44 точек.
 */
function CallRow({ id, name, phone, email, badge, meta }: {
  id: number; name: string; phone: string | null; email: string | null; badge: ReactNode; meta: ReactNode;
}) {
  return (
    <div data-testid="owner-row" className="flex items-center flex-wrap" style={{ gap: "8px 12px", padding: "12px 20px", borderTop: "1px solid var(--color-border-subtle)" }}>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Название — ссылка в карточку; высота 44, как у любой цели касания. */}
          <Link to={`/super-admin/orgs/${id}`} className="inline-flex items-center" style={{ minHeight: 44, fontSize: 14.5, fontWeight: 700, color: "var(--color-text-primary)", textDecoration: "none" }}>{name}</Link>
          {badge}
        </div>
        <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginTop: -4, lineHeight: 1.45 }}>{meta}</div>
        {email ? <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 2, overflowWrap: "anywhere" }}>{email}</div> : null}
      </div>
      {phone ? (
        <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="neo-btn" data-testid="owner-call"
          style={{ minHeight: "44px", padding: "0 14px", fontSize: 13, fontWeight: 700, color: "var(--color-primary-text)", fontVariantNumeric: "tabular-nums", textDecoration: "none" }}>
          <PhoneCall size={15} /> {formatUzPhone(phone)}
        </a>
      ) : (
        <span style={{ fontSize: 12.5, color: "var(--color-text-tertiary)" }}>телефона нет</span>
      )}
    </div>
  );
}

/** Семь точек — какие шаги пройдены. Пропуск виден сразу: товары не заведены, а агент уже есть. */
function StageDots({ done }: { done: string[] }) {
  return (
    <span aria-hidden style={{ display: "inline-flex", gap: 3, verticalAlign: "middle" }}>
      {Object.keys(STAGE_LABEL).map(k => (
        <span key={k} style={{ width: 7, height: 7, borderRadius: "50%", background: done.includes(k) ? "var(--color-success)" : "var(--color-border)" }} />
      ))}
    </span>
  );
}
