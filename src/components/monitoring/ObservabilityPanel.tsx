import { ExternalLink, ShieldAlert, Activity, Boxes, GaugeCircle } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { COLORS, F } from "./theme";
import { Section } from "./Section";

/**
 * Служебные приборы, тревоги и разрез по ручкам.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * У проекта восемь служб — Prometheus, Grafana, Loki, Jaeger, AlertManager,
 * Redis, MySQL, само приложение, — а страница мониторинга не знала ни об одной.
 * Она показывала свои числа и молчала о том, что рядом стоит целая обвязка:
 * адреса жили в закладках, а «что сейчас горит» узнавали из телеграма.
 *
 * Задача этой страницы — не подменить Grafana, а быть входом: сказать, что не
 * так, и увести в тот прибор, где лежат подробности.
 */

const STATE_LABEL: Record<string, { text: string; color: string }> = {
  ok:             { text: "отвечает",     color: "var(--kpi-green)" },
  down:           { text: "не отвечает",  color: "var(--kpi-red)" },
  unknown:        { text: "не проверяем", color: "var(--color-text-tertiary)" },
  not_configured: { text: "не настроено", color: "var(--color-text-tertiary)" },
};

export function ObservabilityPanel() {
  const { data } = trpc.system.observability.useQuery(undefined, {
    // Проверки служб ходят по сети: раз в полминуты достаточно, чтобы заметить
    // падение, и незачем стучаться в них на каждый рендер страницы.
    refetchInterval: 30_000,
  });

  const cell: React.CSSProperties = {
    padding: "10px 12px", fontSize: "13px", color: COLORS.textPrimary,
    borderBottom: `1px solid ${COLORS.border}`,
  };
  const head: React.CSSProperties = {
    padding: "8px 12px", fontFamily: F.display, fontSize: "10px", fontWeight: 600,
    textTransform: "uppercase", letterSpacing: "0.08em", color: COLORS.textTertiary,
    borderBottom: `1px solid ${COLORS.border}`, textAlign: "left", whiteSpace: "nowrap",
  };
  const num: React.CSSProperties = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

  return (
    <>
      {/* ── Что горит прямо сейчас ─────────────────────────────────────────
          Источник — тот же AlertManager, что пишет в Telegram. Своего списка
          тревог заводить нельзя: два источника правды о том, что сломано,
          разойдутся, и разойдутся молча. */}
      <Section title="Тревоги" icon={ShieldAlert} delay={0.05}>
        {!data ? (
          <p style={{ color: COLORS.textTertiary, fontSize: "13px" }}>Загрузка…</p>
        ) : !data.alertsReachable ? (
          /* «Не знаем» вместо «ничего не горит»: недоступный AlertManager —
             это поломка наблюдения, и успокаивать ею нельзя. */
          <p style={{ color: "var(--color-warning-text)", fontSize: "13px", margin: 0 }}>
            AlertManager не ответил — что горит сейчас, неизвестно. Проверьте карточку службы ниже.
          </p>
        ) : data.alerts.length === 0 ? (
          <p style={{ color: COLORS.textSecondary, fontSize: "13px", margin: 0 }}>
            Ничего не горит. Список приходит из AlertManager — того же, что пишет в Telegram.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {data.alerts.map((a, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap",
                padding: "10px 12px", borderRadius: "10px",
                background: a.severity === "critical" ? "rgba(212,80,80,.10)" : "rgba(212,160,80,.10)",
              }}>
                <span style={{
                  fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
                  color: a.severity === "critical" ? "var(--color-danger-text)" : "var(--color-warning-text)",
                }}>
                  {a.severity}
                </span>
                <strong style={{ fontSize: "13px", color: COLORS.textPrimary }}>{a.name}</strong>
                <span style={{ fontSize: "12px", color: COLORS.textSecondary }}>{a.summary}</span>
                {a.since && (
                  <span style={{ fontSize: "11px", color: COLORS.textTertiary, marginLeft: "auto" }}>
                    с {new Date(a.since).toLocaleString("ru")}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Насыщение ───────────────────────────────────────────────────────
          Четвёртый сигнал здоровья, которого на странице не было. Трафик,
          время и ошибки говорят, что происходит СЕЙЧАС; насыщение — сколько
          осталось до того, как станет плохо. Упёршийся в потолок пул виден в
          остальных трёх только последствием, и причину ищут не там. */}
      <Section title="Насыщение: сколько осталось запаса" icon={GaugeCircle} delay={0.08}>
        {(data?.saturation ?? []).length === 0 ? (
          <p style={{ color: COLORS.textTertiary, fontSize: "13px", margin: 0 }}>Загрузка…</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
            {(data?.saturation ?? []).map(s => {
              const color = s.level === "hot" ? "var(--color-danger-text)"
                : s.level === "warn" ? "var(--color-warning-text)"
                : "var(--kpi-green)";
              return (
                <div key={s.key} title={s.hint} style={{
                  padding: "14px 16px", borderRadius: "12px",
                  background: COLORS.surfaceLight, border: `1px solid ${COLORS.border}`,
                }}>
                  <p style={{ fontSize: "11px", color: COLORS.textTertiary, margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    {s.title}
                  </p>
                  <p style={{ margin: "6px 0 0", fontSize: "20px", fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
                    {s.value}{s.suffix && ` ${s.suffix}`}
                    {s.limit !== null && (
                      <span style={{ fontSize: "13px", fontWeight: 500, color: COLORS.textTertiary }}>
                        {" "}из {s.limit}{s.suffix && ` ${s.suffix}`}
                      </span>
                    )}
                  </p>
                  {/* Полоса рисуется только там, где потолок известен. Рисовать
                      её без потолка значило бы выдумать шкалу. */}
                  {s.ratio !== null && (
                    <span aria-hidden style={{
                      display: "block", marginTop: "10px", height: "4px", borderRadius: "2px",
                      background: COLORS.border,
                    }}>
                      <span style={{
                        display: "block", height: "100%", borderRadius: "2px",
                        width: `${Math.max(2, Math.min(100, s.ratio * 100))}%`,
                        background: color,
                      }} />
                    </span>
                  )}
                  <p style={{ fontSize: "11px", color: COLORS.textTertiary, margin: "8px 0 0", lineHeight: 1.45 }}>
                    {s.hint}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── Приборы ────────────────────────────────────────────────────────── */}
      <Section title="Служебные приборы" icon={Boxes} delay={0.1}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
          {(data?.services ?? []).map(s => {
            const st = STATE_LABEL[s.state] ?? STATE_LABEL.unknown;
            const body = (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: st.color, flexShrink: 0 }} />
                  <strong style={{ fontSize: "13px", color: COLORS.textPrimary }}>{s.title}</strong>
                  {s.url && <ExternalLink size={12} style={{ color: COLORS.textTertiary, marginLeft: "auto" }} />}
                </div>
                <p style={{ fontSize: "12px", color: COLORS.textSecondary, margin: "6px 0 0", lineHeight: 1.45 }}>
                  {s.purpose}
                </p>
                <p style={{ fontSize: "11px", color: COLORS.textTertiary, margin: "6px 0 0" }}>
                  {st.text}
                  {s.latencyMs !== null && ` · ${s.latencyMs} мс`}
                  {/* Служба без публичного адреса — это решение, а не недосмотр:
                      у Loki своей защиты нет, и с доменом журналы читались бы
                      из интернета. Так и написано, чтобы не искали ссылку. */}
                  {s.note && ` · ${s.note}`}
                </p>
              </>
            );
            const box: React.CSSProperties = {
              display: "block", padding: "14px 16px", borderRadius: "12px",
              background: COLORS.surfaceLight, border: `1px solid ${COLORS.border}`,
              textDecoration: "none", color: "inherit",
            };
            return s.url
              ? <a key={s.key} href={s.url} target="_blank" rel="noreferrer" style={box}>{body}</a>
              : <div key={s.key} style={box}>{body}</div>;
          })}
        </div>

        {/* Вкладки на прежней сборке. Раньше это были десятки строк «HTTP 404»
            в журнале ошибок; теперь одно число, и оно означает ровно то, что
            означает: после выкладки люди какое-то время работают со старым. */}
        {typeof data?.staleAssetHits === "number" && data.staleAssetHits > 0 && (
          <p style={{ fontSize: "12px", color: COLORS.textTertiary, margin: "14px 0 0" }}>
            Вкладок на прежней сборке с момента запуска: <b style={{ color: COLORS.textSecondary }}>{data.staleAssetHits}</b>.
            Это не ошибки — приложение подхватывает новую сборку само.
          </p>
        )}
      </Section>

      {/* ── Разрез по ручкам ───────────────────────────────────────────────── */}
      <Section title="Ручки: трафик, ошибки, время" icon={Activity} delay={0.15}>
        {(data?.endpoints ?? []).length === 0 ? (
          <p style={{ color: COLORS.textTertiary, fontSize: "13px", margin: 0 }}>Пока нечего показать.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "620px" }}>
              <thead>
                <tr>
                  <th style={head}>Метод</th>
                  <th style={head}>Путь</th>
                  <th style={{ ...head, textAlign: "right" }}>Запросов</th>
                  <th style={{ ...head, textAlign: "right" }}>Ошибок</th>
                  <th style={{ ...head, textAlign: "right" }}>Среднее</th>
                  <th style={{ ...head, textAlign: "right" }}>p95 ≈</th>
                </tr>
              </thead>
              <tbody>
                {(data?.endpoints ?? []).map((e, i) => (
                  <tr key={i}>
                    <td style={{ ...cell, color: COLORS.textSecondary }}>{e.method}</td>
                    <td style={{ ...cell, fontFamily: "monospace", fontSize: "12px" }}>{e.path}</td>
                    <td style={num}>{e.requests.toLocaleString("ru")}</td>
                    <td style={{ ...num, color: e.errors > 0 ? "var(--color-danger-text)" : COLORS.textTertiary }}>
                      {e.errors > 0 ? `${e.errors} (${e.errorRate.toFixed(1)}%)` : "—"}
                    </td>
                    <td style={num}>{e.avgMs} мс</td>
                    <td style={{ ...num, color: e.p95Ms > 1000 ? "var(--color-warning-text)" : COLORS.textPrimary }}>
                      {e.p95Ms} мс
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* Названо оценкой намеренно: точного перцентиля из гистограммы не
            получить в принципе, а выдавать оценку за точное значение — тот же
            обман, что и «0%» вместо «нет данных». */}
        <p style={{ fontSize: "11px", color: COLORS.textTertiary, margin: "10px 0 0" }}>
          p95 — оценка по корзинам гистограммы, не точное значение. Точные перцентили считает Prometheus.
        </p>
      </Section>
    </>
  );
}
