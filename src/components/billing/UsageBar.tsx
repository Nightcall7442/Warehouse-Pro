import { colorMix } from "@/lib/color-mix";

interface UsageBarProps {
  used: number;
  max: number | null;
  label: string;
  /** Что перестанет работать при достижении предела. */
  atLimit: string;
  /** Что написать вместо полосы, когда предела нет. */
  noLimit: string;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
}

/**
 * Полоса расхода лимита.
 *
 * ── Чего не хватало ─────────────────────────────────────────────────────────
 *
 * Полоса краснела у предела и молчала о том, что при этом произойдёт. «18/20
 * пользователей» не говорит, случится ли что-то плохое на двадцать первом —
 * откажут в добавлении или просто спишут больше. Теперь под полосой написано.
 */
export function UsageBar({ used, max, label, atLimit, noLimit, icon: Icon }: UsageBarProps) {
  const pct = max ? Math.min((used / max) * 100, 100) : 100;
  const warn = max !== null && used >= max * 0.85;
  const over = max !== null && used >= max;

  const tone = over
    ? "var(--color-danger)"
    : warn
      ? "var(--color-warning)"
      : "var(--color-primary)";
  const ink = over
    ? "var(--color-danger-text, var(--color-danger))"
    : warn
      ? "var(--color-warning-text, var(--color-warning))"
      : "var(--color-text-primary)";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "9px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
          <span style={{
            width: "32px", height: "32px", borderRadius: "11px", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: colorMix(tone, 10), color: ink,
          }}>
            <Icon size={15} />
          </span>
          <span style={{ fontSize: "13.5px", fontWeight: 500, color: "var(--color-text-secondary)" }}>{label}</span>
        </div>
        <div style={{ fontSize: "13.5px", fontWeight: over ? 700 : warn ? 600 : 500, color: ink, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
          {used.toLocaleString("ru")}
          <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400, marginLeft: "4px" }}>
            / {max === null ? "∞" : max.toLocaleString("ru")}
          </span>
        </div>
      </div>

      {/*
        Без предела полосы нет вовсе.

        Она рисовалась залитой на всю ширину — и это была не просто яркая
        зелёная лента во весь экран, а НЕПРАВДА: полный индикатор читается как
        «вы у потолка», тогда как значит ровно обратное. Мерить нечем, значит и
        мерки быть не должно.
      */}
      {max === null ? (
        <p style={{ fontSize: "11.5px", color: "var(--color-text-tertiary)" }}>
          {noLimit}
        </p>
      ) : (
        <div style={{
          height: "9px", borderRadius: "999px", overflow: "hidden",
          background: "var(--color-canvas)", boxShadow: "var(--shadow-pressed)",
        }}>
          <div style={{
            height: "100%", width: `${pct}%`, borderRadius: "999px",
            background: `linear-gradient(90deg, ${tone}, ${colorMix(tone, 70)})`,
            transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
            animation: "progressFill 0.9s ease",
          }} />
        </div>
      )}

      {/* Что случится у предела — только когда он близко. Постоянная строка под
          каждой полосой была бы шумом. */}
      {warn && (
        <p style={{ fontSize: "11.5px", lineHeight: 1.45, color: ink, marginTop: "7px" }}>
          {atLimit}
        </p>
      )}
    </div>
  );
}
