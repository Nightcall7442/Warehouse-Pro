import { AlertTriangle, CheckCircle2, Circle, HeartPulse } from "lucide-react";
import type { OrgRow } from "./orgs";
import { Panel, Pill, type Tone } from "./ui";

/* ═══════════════════════════════════════════════════════════════════════════
   «Здоровье» организации на экране: метка в списке и панель «почему» в
   карточке. Оценку и причины считает сервер (api/services/org-health.ts) —
   здесь только показ, чтобы число в списке и в карточке было одним.
   ═══════════════════════════════════════════════════════════════════════════ */

export type Health = NonNullable<OrgRow["health"]>;

const HEALTH_LABEL: Record<Health["level"], string> = { healthy: "Здорова", watch: "Под наблюдением", churn: "Уходит" };
const HEALTH_TONE: Record<Health["level"], Tone> = { healthy: "success", watch: "warning", churn: "danger" };

/** «82 · Здорова» — в списке и в шапке карточки. */
export function HealthPill({ h, testId }: { h: Health; testId?: string }) {
  return (
    <Pill tone={HEALTH_TONE[h.level]} testId={testId}>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{h.score}</span> · {HEALTH_LABEL[h.level]}
    </Pill>
  );
}

/** Цвет полоски — по её собственной полноте: полная «Активность» у уходящей — не красная. */
const fill = (v: number, max: number) => (v / max >= 0.7 ? "success" : v / max >= 0.4 ? "warning" : "danger");

const PARTS: Array<{ key: keyof Health["parts"]; label: string; max: number }> = [
  { key: "activity", label: "Активность", max: 30 },
  { key: "trend",    label: "Заказы к прошлому месяцу", max: 25 },
  { key: "payment",  label: "Оплата", max: 20 },
  { key: "breadth",  label: "Широта работы", max: 15 },
  { key: "people",   label: "Сотрудники", max: 10 },
];

/** Панель «Здоровье» на вкладке «Обзор» карточки: оценка, правило «уходит», причины, из чего число. */
export function HealthPanel({ h }: { h: Health | null | undefined }) {
  // undefined — список организаций ещё грузится; null — оценивать нечего.
  if (h === undefined) {
    return (
      <Panel title="Здоровье" testId="org-health">
        <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0 }}>Считаю…</p>
      </Panel>
    );
  }
  if (!h) {
    return (
      <Panel title="Здоровье" testId="org-health">
        <p style={{ fontSize: 13, color: "var(--color-text-tertiary)", margin: 0 }}>
          Не оценивается: приостановленная организация или песочница интегратора.
        </p>
      </Panel>
    );
  }
  const tone = HEALTH_TONE[h.level];
  return (
    <Panel title="Здоровье" testId="org-health" action={<Pill tone={tone}>{HEALTH_LABEL[h.level]}</Pill>}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span data-testid="org-health-score" style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, color: `var(--color-${tone}-text)`, fontVariantNumeric: "tabular-nums" }}>{h.score}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-tertiary)" }}>из 100</span>
          </div>
          {h.churn && (
            <div data-testid="org-health-churn" className="flex items-start gap-2.5" style={{ marginTop: 14, padding: "12px 14px", borderRadius: 14, background: "var(--color-danger-subtle)", color: "var(--color-danger-text)" }}>
              <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                <b>Уходит:</b> {h.churnBecause.join("; ")}.
                <div style={{ color: "var(--color-text-secondary)", marginTop: 2 }}>Позвонить владельцу — пока клиент ещё платит.</div>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2.5" style={{ marginTop: 16 }} data-testid="org-health-parts">
            {PARTS.map(p => (
              <div key={p.key}>
                <div className="flex items-baseline justify-between gap-3" style={{ fontSize: 12.5, marginBottom: 4 }}>
                  <span style={{ color: "var(--color-text-secondary)" }}>{p.label}</span>
                  <span style={{ fontWeight: 700, color: "var(--color-text-primary)", fontVariantNumeric: "tabular-nums" }}>{h.parts[p.key]} / {p.max}</span>
                </div>
                <div style={{ height: 6, borderRadius: 99, background: "var(--color-surface-light)", boxShadow: "var(--shadow-pressed)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.round((h.parts[p.key] / p.max) * 100)}%`, borderRadius: 99, background: `var(--color-${fill(h.parts[p.key], p.max)})` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="min-w-0">
          <p style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-tertiary)", letterSpacing: "0.07em", textTransform: "uppercase", margin: "0 0 10px" }}>Почему</p>
          <ul className="flex flex-col gap-2.5" style={{ listStyle: "none", margin: 0, padding: 0 }} data-testid="org-health-reasons">
            {h.reasons.map(r => (
              <li key={r.text} className="flex items-start gap-2.5" style={{ fontSize: 13.5, lineHeight: 1.45, color: "var(--color-text-primary)" }} data-tone={r.tone}>
                {r.tone === "bad" ? <AlertTriangle size={16} color="var(--color-danger-text)" style={{ flexShrink: 0, marginTop: 2 }} />
                  : r.tone === "good" ? <CheckCircle2 size={16} color="var(--color-success-text)" style={{ flexShrink: 0, marginTop: 2 }} />
                  : <Circle size={16} color="var(--color-text-tertiary)" style={{ flexShrink: 0, marginTop: 2 }} />}
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
          <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "14px 0 0", lineHeight: 1.5 }}>
            <HeartPulse size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> Оценка за 30 дней: активность, заказы к прошлому месяцу, оплата, широта работы, доля работающих сотрудников. «Уходит» — платящая, у которой 7+ дней тишины, заказы упали вдвое или срок кончается в неделю без продления.
          </p>
        </div>
      </div>
    </Panel>
  );
}
