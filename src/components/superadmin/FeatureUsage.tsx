import { useState } from "react";
import { ChevronDown, ShieldAlert, ShieldCheck, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { FEATURES, type FeatureKey } from "@contracts/constants";
import { F, COLORS } from "./types";
import { PlanBadge } from "./ui";

/**
 * Что обещано тарифом и что на самом деле в ходу.
 *
 * ── Зачем экран ─────────────────────────────────────────────────────────────
 *
 * Тарифы продают GPS-контроль, обмен с 1С, полную аналитику и брендирование как
 * платные возможности. Код проверяет из них НИ ОДНОЙ: разграничены только чат
 * поддержки и доступ по API. Всё остальное открыто на любом тарифе, включая
 * пробный, — то есть за часть обещаний берут деньги, ничего не разграничивая.
 *
 * Включить проверку одним движением нельзя. Организации уже работают, и если
 * кто-то из них пользуется GPS на тарифе, где его нет, включение отнимет
 * функцию посреди рабочего дня — без предупреждения и без выбора. Сначала надо
 * увидеть, кто и чем пользуется.
 *
 * ── Чему здесь можно верить ─────────────────────────────────────────────────
 *
 * Прямому следу: функция что-то ЗАПИСАЛА — точки GPS, настройки обмена,
 * оформление, ключи, сообщения. Такой след появляется только от использования.
 *
 * Аналитика следов не оставляет: читать отчёт — значит ничего не записать.
 * Поэтому у неё честно стоит «следа нет», а рядом косвенный признак —
 * заполненная себестоимость и планы продаж. Косвенный назван косвенным: по
 * нему нельзя ни поднять тариф, ни отнять функцию.
 */
export function FeatureUsage() {
  const { data, isLoading } = trpc.tenant.featureUsage.useQuery();
  const [open, setOpen] = useState<number | null>(null);

  const rows = data ?? [];
  const problems = rows.filter(r => r.overreach.length > 0);

  return (
    <div className="neo-card neo-card-static" style={{ padding: "20px 22px" }}>
      <div style={{ marginBottom: "14px" }}>
        <h3 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
          Тарифы и что в ходу
        </h3>
        <p className="text-xs" style={{ color: COLORS.textSecondary, margin: "4px 0 0" }}>
          Разграничение по тарифам пока не проверяется кодом — кроме чата поддержки и API.
          Здесь видно, кого затронет, если его включить.
        </p>
      </div>

      {isLoading ? (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "20px", color: COLORS.textTertiary }}>
          <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> Считаю…
        </div>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: "13px", color: COLORS.textTertiary, margin: 0 }}>Организаций нет.</p>
      ) : (
        <>
          {/* Главное — одной строкой: сколько организаций пострадает. */}
          <div style={{
            padding: "12px 14px", borderRadius: "12px", marginBottom: "12px",
            background: problems.length > 0 ? "var(--color-warning-subtle)" : "var(--color-surface-light)",
            display: "flex", alignItems: "flex-start", gap: "10px",
          }}>
            {problems.length > 0
              ? <ShieldAlert size={16} style={{ color: "var(--color-warning-text)", flexShrink: 0, marginTop: "1px" }} />
              : <ShieldCheck size={16} style={{ color: COLORS.textTertiary, flexShrink: 0, marginTop: "1px" }} />}
            <span style={{ fontSize: "12.5px", color: COLORS.textPrimary, lineHeight: 1.5 }}>
              {problems.length > 0 ? (
                <>
                  <b>{problems.length}</b> из {rows.length} пользуются тем, чего тариф не даёт.
                  Включив проверку сейчас, вы отнимете это у них без предупреждения.
                </>
              ) : (
                <>Никто не пользуется тем, чего тариф не даёт — проверку можно включать безопасно.</>
              )}
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {rows.map(r => {
              const isOpen = open === r.tenantId;
              const bad = r.overreach.length > 0;
              return (
                <div key={r.tenantId} style={{
                  borderRadius: "12px", overflow: "hidden",
                  background: "var(--color-surface-light)",
                  boxShadow: bad ? "inset 0 0 0 1px var(--color-warning)" : "inset 0 0 0 1px var(--color-border)",
                }}>
                  <button
                    onClick={() => setOpen(isOpen ? null : r.tenantId)}
                    aria-expanded={isOpen}
                    className="row-hover"
                    style={{
                      width: "100%", display: "flex", alignItems: "center", gap: "10px",
                      padding: "11px 14px", background: "transparent", border: "none",
                      cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <ChevronDown size={14} style={{
                      color: COLORS.textTertiary, flexShrink: 0,
                      transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .2s",
                    }} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: "13.5px", fontWeight: 600, color: COLORS.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.tenantName}
                    </span>
                    <PlanBadge plan={r.plan} />
                    {bad && (
                      <span style={{
                        padding: "3px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: 600,
                        background: "var(--color-warning-subtle)", color: "var(--color-warning-text)", whiteSpace: "nowrap",
                      }}>
                        сверх тарифа: {r.overreach.length}
                      </span>
                    )}
                  </button>

                  {isOpen && (
                    <div style={{ padding: "0 14px 12px 38px", display: "flex", flexDirection: "column", gap: "7px" }}>
                      {r.traces.map(tr => (
                        <Trace key={tr.feature} trace={tr} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** Одна возможность: даёт ли тариф, есть ли след, и что именно нашли. */
function Trace({ trace }: {
  trace: { feature: string; used: boolean; indirect: boolean; evidence: string; allowed: boolean };
}) {
  const name = FEATURES[trace.feature as FeatureKey]?.ru ?? trace.feature;

  /*
    Тон по существу, а не по «хорошо/плохо».

    Тревожный — только там, где функцией пользуются, а тариф её не даёт: это и
    есть строка, требующая решения. Всё остальное — сведения.
  */
  const conflict = trace.used && !trace.allowed;

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "9px", fontSize: "12px" }}>
      <span style={{
        width: "7px", height: "7px", borderRadius: "999px", marginTop: "5px", flexShrink: 0,
        background: conflict ? "var(--color-warning)"
          : trace.used ? "var(--color-primary)"
          : trace.indirect ? "var(--color-border)"
          : "transparent",
        boxShadow: trace.used || trace.indirect ? undefined : "inset 0 0 0 1px var(--color-border)",
      }} />
      <div style={{ minWidth: 0 }}>
        <span style={{ color: conflict ? "var(--color-warning-text)" : COLORS.textPrimary, fontWeight: conflict ? 600 : 500 }}>
          {name}
        </span>
        <span style={{ color: COLORS.textTertiary }}>
          {" · "}{trace.allowed ? "входит в тариф" : "не входит в тариф"}
          {" · "}{trace.evidence}
        </span>
      </div>
    </div>
  );
}
