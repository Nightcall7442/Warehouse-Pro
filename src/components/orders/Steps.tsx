import { CheckCircle2 } from "lucide-react";
import { useLang } from "@/i18n";

interface StepsProps {
  current: number;
  labels: string[];
}

/*
  На телефоне — StepIndicator мобилки v8 (Warehouse-Pro-Mobile,
  app/order/new.tsx): полоса пройденного, номер шага в круге, «Шаг 1 из 3»,
  название шага и точки. Три кружка с подписями — для большого экрана: на
  телефоне они съедали высоту и дублировали то, что и так видно.
*/
export function Steps({ current, labels }: StepsProps) {
  const { lang } = useLang();
  const total = labels.length;
  return (
    <>
      <div className="md:hidden" style={{ marginBottom: 20 }} data-testid="phone-steps">
        <div style={{ height: 5, borderRadius: 999, background: "var(--color-surface-light)", overflow: "hidden", marginBottom: 14 }}>
          <div style={{ height: "100%", width: `${(current / total) * 100}%`, borderRadius: 999, background: "var(--color-primary)", transition: "width .3s ease" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 30, height: 30, borderRadius: 15, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-primary)", color: "var(--color-on-primary)", fontSize: 13, fontWeight: 700 }}>{current}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--color-text-tertiary)" }}>
              {lang === "uz" ? `QADAM ${current} / ${total}` : `ШАГ ${current} ИЗ ${total}`}
            </span>
            <span style={{ display: "block", fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)" }}>{labels[current - 1]}</span>
          </span>
          <span style={{ display: "flex", gap: 5 }}>
            {labels.map((_, i) => (
              <span key={i} style={{ width: i + 1 === current ? 18 : 6, height: 6, borderRadius: 3, background: i + 1 < current ? "color-mix(in srgb, var(--color-primary) 40%, transparent)" : i + 1 === current ? "var(--color-primary)" : "var(--color-border)" }} />
            ))}
          </span>
        </div>
      </div>
      <DesktopSteps current={current} labels={labels} />
    </>
  );
}

function DesktopSteps({ current, labels }: StepsProps) {
  return (
    <div className="hidden md:flex" style={{ alignItems: "center", gap: 0, marginBottom: "32px" }}>
      {labels.map((label, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <div key={label} style={{ display: "flex", alignItems: "center", flex: 1 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", flexShrink: 0 }}>
              <div style={{
                width: "36px", height: "36px", borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "13px", fontWeight: 700, fontFamily: "'Manrope', sans-serif",
                transition: "all 0.3s ease",
                background: done ? "var(--color-primary)" : active ? "var(--color-primary-subtle)" : "var(--color-surface-light, #f6f4f0)",
                // Надпись на заливке — не «#fff», а цвет, который к этой
                // заливке подобран: арендатор вправе выбрать светлый цвет,
                // и белая цифра на нём пропадала.
                color: done ? "var(--color-on-primary, #fff)" : active ? "var(--color-primary-text)" : "var(--color-text-tertiary, #6b6760)",
                boxShadow: done ? "0 4px 12px color-mix(in srgb, var(--color-primary) 30%, transparent)" : active ? "0 0 0 3px color-mix(in srgb, var(--color-primary) 15%, transparent)" : "none",
              }}>
                {done ? <CheckCircle2 size={18} /> : step}
              </div>
              <span style={{
                fontSize: "10px", fontWeight: 600, letterSpacing: "0.08em",
                fontFamily: "'Manrope', sans-serif", textTransform: "uppercase",
                color: active ? "var(--color-primary-text)" : done ? "var(--color-primary-text)" : "var(--color-text-tertiary, #6b6760)",
              }}>
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div style={{
                flex: 1, height: "2px", margin: "0 8px", marginBottom: "20px",
                borderRadius: "1px", transition: "all 0.3s ease",
                background: step < current ? "var(--color-primary)" : "var(--color-border, #d8d5cd)",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
