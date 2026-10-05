/**
 * Палитра страниц конкурса (/pitch, /demo) — объявление, как landing-tokens.ts.
 *
 * Два тона на одних переменных: тёмный — ночь лендинга (страница сначала
 * тёмная), светлый — его бумага. Числа живут только здесь; страницы берут
 * var(--…). Храповик color-by-number считает этот файл объявлением палитры.
 * Контраст текста по WCAG (посчитан, не на глаз), худший из двух фонов —
 * страницы и полосы: тёмный тон --soft 8.3:1, --faint 4.9:1, --accent-text
 * 8.3:1, --teal 7.9:1; светлый --soft 6.3:1, --faint 4.9:1, --accent-text
 * 5.0:1, --teal 5.3:1. Светлые --faint, --accent-text и --teal темнее, чем
 * у лендинга: на полосе #ece8df лендинговые давали 4.4–4.6.
 */
export const PITCH_CSS = `
.pitch {
  --bg: #15130f; --band: #1b1915; --panel: #221f1a; --raised: #2a2620;
  --text: #f0eee8; --soft: rgba(240,238,232,0.72); --faint: rgba(240,238,232,0.52);
  --rule: rgba(240,238,232,0.10); --rule-strong: rgba(240,238,232,0.20);
  --accent: #c79351; --accent-text: #d6a466; --accent-soft: rgba(199,147,81,0.12);
  --teal: #5fb8ad; --teal-soft: rgba(95,184,173,0.12);
  --btn-bg: #f0eee8; --btn-fg: #15130f;
  --code-bg: #0e0d0a; --code-text: #e9e4d8;
  --on-accent: #15130f; --video-bg: #000;
  --glow: radial-gradient(1200px 520px at 78% -10%, rgba(199,147,81,0.16), transparent 62%), radial-gradient(900px 480px at -10% 20%, rgba(95,184,173,0.08), transparent 60%);
  background: var(--bg); color: var(--text);
  font-family: 'Manrope', system-ui, -apple-system, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh; min-height: 100dvh;
  overflow-x: clip;
}
.pitch[data-tone="light"] {
  --bg: #f4f2ed; --band: #ece8df; --panel: #faf9f5; --raised: #ffffff;
  --text: #26231e; --soft: #57534a; --faint: #67635a;
  --rule: rgba(72,66,55,0.16); --rule-strong: rgba(72,66,55,0.32);
  --accent: #a8763e; --accent-text: #835a2b; --accent-soft: rgba(168,118,62,0.10);
  --teal: #0d6a62; --teal-soft: rgba(15,118,110,0.08);
  --btn-bg: #26231e; --btn-fg: #f4f2ed;
  --code-bg: #26231e;
  --glow: radial-gradient(1200px 520px at 78% -10%, rgba(168,118,62,0.12), transparent 62%);
}
.pitch ::selection { background: var(--accent); color: var(--btn-fg); }
.pitch a { color: inherit; }
.pitch .p-mono { font-family: 'JetBrains Mono', ui-monospace, 'Cascadia Mono', monospace; font-variant-numeric: tabular-nums; }
.pitch .p-wrap { max-width: 1240px; margin: 0 auto; padding-left: 20px; padding-right: 20px; }
@media (min-width: 768px) { .pitch .p-wrap { padding-left: 40px; padding-right: 40px; } }
.pitch .p-focus:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.pitch .p-h1 { font-size: clamp(38px, 6.4vw, 80px); line-height: 1.0; letter-spacing: -0.045em; font-weight: 800; }
.pitch .p-h2 { font-size: clamp(30px, 4.6vw, 56px); line-height: 1.04; letter-spacing: -0.035em; font-weight: 800; }
.pitch .p-lead { font-size: clamp(16px, 1.5vw, 19px); line-height: 1.6; color: var(--soft); }
.pitch .p-kicker { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent-text); }
.pitch .p-chapter { padding-top: 72px; padding-bottom: 72px; border-top: 1px solid var(--rule); }
@media (min-width: 1024px) { .pitch .p-chapter { padding-top: 120px; padding-bottom: 120px; } }
.pitch .p-row { border-bottom: 1px solid var(--rule); }
.pitch .p-btn { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 48px; padding: 0 22px; border-radius: 12px; font-weight: 700; font-size: 15px; letter-spacing: -0.01em; text-decoration: none; cursor: pointer; transition: transform .15s ease, background .15s ease, border-color .15s ease; }
.pitch .p-btn:active { transform: translateY(1px); }
.pitch .p-btn-solid { background: var(--btn-bg); color: var(--btn-fg); border: 1px solid var(--btn-bg); }
.pitch .p-btn-solid:hover { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.pitch .p-btn-line { background: transparent; color: var(--text); border: 1px solid var(--rule-strong); }
.pitch .p-btn-line:hover { border-color: var(--accent); }
.pitch .p-btn[disabled] { opacity: .5; cursor: default; }
.pitch .p-nav a { color: var(--soft); text-decoration: none; font-size: 13.5px; font-weight: 600; padding: 10px 2px; }
.pitch .p-nav a:hover { color: var(--text); }
.pitch pre.p-code { background: var(--code-bg); color: var(--code-text); border-radius: 14px; padding: 18px 20px; overflow-x: auto; font-size: 12.5px; line-height: 1.65; border: 1px solid var(--rule); }
/* Телефон: призывы во всю ширину — палец попадает, ряд не рвётся на разные длины. */
@media (max-width: 639px) {
  .pitch .p-cta > .p-btn, .pitch .p-btn.p-full-sm { width: 100%; }
}
@media (prefers-reduced-motion: no-preference) {
  .pitch .p-rise { animation: p-rise .7s cubic-bezier(.2,.7,.2,1) backwards; }
  @keyframes p-rise { from { opacity: 0; transform: translateY(14px); } }
}
`;
