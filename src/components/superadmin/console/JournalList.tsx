import type { CSSProperties } from "react";
import { Link, useNavigate } from "react-router";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../api/router";
import { dayTime } from "./format";

/* ═══════════════════════════════════════════════════════════════════════════
   Строки журнала владельца платформы — в разделе «Журнал» и на вкладке
   «Журнал» карточки организации. Компьютер — таблица, телефон — карточки.
   Что изменилось («Тариф: Базовый → Про») собирает сервер одним правилом
   (contracts/platform-journal.describePlatformEntry).
   ═══════════════════════════════════════════════════════════════════════════ */

export type JournalRow = inferRouterOutputs<AppRouter>["platform"]["journal"]["rows"][number];

const th: CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-tertiary)",
  padding: "0 14px", height: 44, textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid var(--color-border-subtle)",
};
const td: CSSProperties = { padding: "12px 14px", fontSize: 13.5, color: "var(--color-text-primary)", borderTop: "1px solid var(--color-border-subtle)", verticalAlign: "top" };

/** Организация названием (снимком); удалённая — с пометкой. Переход в карточку — нажатием на строку. */
function Org({ r, alive }: { r: JournalRow; alive: (id: number) => boolean }) {
  if (!r.tenantId) return <span style={{ color: "var(--color-text-tertiary)" }}>платформа</span>;
  const name = r.tenantName ?? `№ ${r.tenantId}`;
  if (!alive(r.tenantId)) return <span title="Организация удалена">{name} <span style={{ color: "var(--color-text-tertiary)" }}>(удалена)</span></span>;
  return <span style={{ color: "var(--color-primary-text)", fontWeight: 600, overflowWrap: "anywhere" }}>{name}</span>;
}

/** Куда ведёт строка: в карточку живой организации, если она не та, в которой мы уже стоим. */
const linkOf = (r: JournalRow, showOrg: boolean, alive: (id: number) => boolean) =>
  showOrg && r.tenantId && alive(r.tenantId) ? `/super-admin/orgs/${r.tenantId}` : null;

export function JournalList({ rows, showOrg, alive }: { rows: JournalRow[]; showOrg: boolean; alive: (id: number) => boolean }) {
  const navigate = useNavigate();
  return (
    <>
      <div className="hidden md:block" style={{ overflowX: "auto" }}>
        <table className="console-table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }} data-testid="journal-table">
          <thead>
            <tr>
              <th style={{ ...th, width: 150 }}>Когда</th>
              <th style={th}>Действие</th>
              {showOrg && <th style={{ ...th, width: 220 }}>Организация</th>}
              <th style={{ ...th, width: 180 }}>Кто</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} data-testid="journal-row" data-action={r.action}
                onClick={linkOf(r, showOrg, alive) ? () => navigate(linkOf(r, showOrg, alive)!) : undefined}
                style={{ cursor: linkOf(r, showOrg, alive) ? "pointer" : undefined }}>
                <td style={{ ...td, whiteSpace: "nowrap", color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{dayTime(r.createdAt)}</td>
                <td style={td}>
                  <div style={{ fontWeight: 700 }}>{r.label}{r.targetLabel ? <span style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}> · {r.targetLabel}</span> : null}</div>
                  {r.summary && <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginTop: 3, lineHeight: 1.45, overflowWrap: "anywhere" }}>{r.summary}</div>}
                </td>
                {showOrg && <td style={td}><Org r={r} alive={alive} /></td>}
                <td style={{ ...td, color: "var(--color-text-secondary)" }}>
                  <div>{r.actorName ?? "—"}</div>
                  {r.ip && <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", fontVariantNumeric: "tabular-nums" }}>{r.ip}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="md:hidden flex flex-col" data-testid="journal-cards">
        {rows.map((r, i) => {
          const to = linkOf(r, showOrg, alive);
          const body = (<>
            <div className="flex items-baseline justify-between gap-3">
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text-primary)" }}>{r.label}</span>
              <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{dayTime(r.createdAt)}</span>
            </div>
            {showOrg && r.tenantId && <div style={{ fontSize: 13, marginTop: 3 }}><Org r={r} alive={alive} /></div>}
            {r.targetLabel && <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 2, overflowWrap: "anywhere" }}>{r.targetLabel}</div>}
            {r.summary && <div style={{ fontSize: 12.5, color: "var(--color-text-secondary)", marginTop: 3, lineHeight: 1.45, overflowWrap: "anywhere" }}>{r.summary}</div>}
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 4 }}>{r.actorName ?? "—"}{r.ip ? ` · ${r.ip}` : ""}</div>
          </>);
          const style = { display: "block", padding: "12px 16px", borderTop: i > 0 ? "1px solid var(--color-border-subtle)" : undefined, textDecoration: "none", color: "inherit" } as const;
          // Вся карточка — ссылка в организацию: цель касания во всю строку, а не в одно слово.
          return to
            ? <Link key={r.id} to={to} className="console-row" style={style} data-testid="journal-card">{body}</Link>
            : <div key={r.id} style={style} data-testid="journal-card">{body}</div>;
        })}
      </div>
    </>
  );
}
