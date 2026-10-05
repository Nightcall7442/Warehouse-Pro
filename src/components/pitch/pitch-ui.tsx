import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import { ArrowRight, Moon, Sun } from "lucide-react";
import { LogoMark } from "@/components/brand/Logo";
import { PreferLang, useLang } from "@/i18n";
import { useTheme } from "@/hooks/useTheme";
import { pick, type L } from "./pitch-content";
import { PITCH_CSS } from "./pitch-tokens";

/* ═══════════════════════════════════════════════════════════════════════════
   Оболочка страниц конкурса (/pitch, /demo).

   Язык дизайна — лендинга (memory: landing-design-language): линованные
   реестры вместо карточек с иконками, кадры настоящей программы, моно-номера
   глав, латунь как единственный акцент. Отличие одно — тон: страница сначала
   тёмная (ночь лендинга), светлая — бумага лендинга. Тон берётся из темы
   приложения (useTheme), переключатель — в шапке.

   Цвета — только переменные ниже, объявленные один раз на оба тона.
   ═══════════════════════════════════════════════════════════════════════════ */


/** Узбекский по умолчанию, тон — из темы приложения, заголовок вкладки и язык документа. */
export function PitchShell({ title, children, nav }: { title: L; children: ReactNode; nav?: Array<{ href: string; label: L }> }) {
  return (
    <PreferLang lang="uz">
      <ShellInner title={title} nav={nav}>{children}</ShellInner>
    </PreferLang>
  );
}

function ShellInner({ title, children, nav }: { title: L; children: ReactNode; nav?: Array<{ href: string; label: L }> }) {
  const { lang } = useLang();
  const { theme } = useTheme();
  useEffect(() => {
    const prevTitle = document.title;
    const prevLang = document.documentElement.lang;
    document.title = pick(lang, title);
    document.documentElement.lang = lang;
    return () => { document.title = prevTitle; document.documentElement.lang = prevLang; };
  }, [lang, title]);
  return (
    <div className="pitch" data-tone={theme} data-testid="pitch-root" lang={lang}>
      <style>{PITCH_CSS}</style>
      <div aria-hidden="true" style={{ position: "absolute", inset: "0 0 auto 0", height: 900, background: "var(--glow)", pointerEvents: "none" }} />
      <PitchHeader nav={nav} />
      <main style={{ position: "relative" }}>{children}</main>
      <PitchFooter />
    </div>
  );
}

function PitchHeader({ nav }: { nav?: Array<{ href: string; label: L }> }) {
  const { lang } = useLang();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 12);
    h();
    window.addEventListener("scroll", h, { passive: true });
    return () => window.removeEventListener("scroll", h);
  }, []);
  return (
    <header
      style={{
        position: "sticky", top: 0, zIndex: 40,
        paddingTop: "env(safe-area-inset-top, 0px)",
        background: scrolled ? "color-mix(in srgb, var(--bg) 86%, transparent)" : "transparent",
        backdropFilter: scrolled ? "saturate(140%) blur(14px)" : undefined,
        WebkitBackdropFilter: scrolled ? "saturate(140%) blur(14px)" : undefined,
        borderBottom: `1px solid ${scrolled ? "var(--rule)" : "transparent"}`,
        transition: "background .2s ease, border-color .2s ease",
      }}
    >
      <div className="p-wrap" style={{ display: "flex", alignItems: "center", gap: 16, height: 64 }}>
        <Link to="/pitch" className="p-focus" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", minHeight: 44 }} aria-label="Warehouse Pro — pitch">
          <LogoMark size={28} decorative />
          <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.02em" }}>Warehouse Pro</span>
        </Link>
        {nav && (
          <nav className="p-nav hidden lg:flex" style={{ gap: 22, marginLeft: 24 }} aria-label={lang === "uz" ? "Bo'limlar" : "Разделы"}>
            {nav.map(n => <a key={n.href} href={n.href}>{pick(lang, n.label)}</a>)}
          </nav>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <LangSwitch />
          <ThemeSwitch />
        </div>
      </div>
    </header>
  );
}

export function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div role="group" aria-label="Til / Язык" style={{ display: "flex", border: "1px solid var(--rule-strong)", borderRadius: 10, overflow: "hidden" }}>
      {(["uz", "ru"] as const).map(l => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-pressed={lang === l}
          data-testid={`pitch-lang-${l}`}
          className="p-mono p-focus"
          style={{
            minWidth: 44, height: 40, padding: "0 10px", fontSize: 11.5, letterSpacing: "0.08em", textTransform: "uppercase",
            background: lang === l ? "var(--btn-bg)" : "transparent", color: lang === l ? "var(--btn-fg)" : "var(--soft)",
            cursor: "pointer", border: 0,
          }}
        >
          {l === "uz" ? "Uz" : "Ру"}
        </button>
      ))}
    </div>
  );
}

function ThemeSwitch() {
  const { theme, toggle } = useTheme();
  const { lang } = useLang();
  const dark = theme === "dark";
  const label = dark ? (lang === "uz" ? "Yorug' mavzu" : "Светлая тема") : (lang === "uz" ? "Qorong'i mavzu" : "Тёмная тема");
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="p-focus"
      style={{ width: 44, height: 40, display: "grid", placeItems: "center", border: "1px solid var(--rule-strong)", borderRadius: 10, background: "transparent", color: "var(--soft)", cursor: "pointer" }}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

function PitchFooter() {
  const { lang } = useLang();
  const tr = (uz: string, ru: string) => (lang === "uz" ? uz : ru);
  return (
    <footer style={{ borderTop: "1px solid var(--rule)", position: "relative" }}>
      <div className="p-wrap" style={{ display: "flex", flexWrap: "wrap", gap: "12px 28px", alignItems: "center", paddingTop: 32, paddingBottom: "calc(32px + env(safe-area-inset-bottom, 0px))" }}>
        <span className="p-mono" style={{ fontSize: 11.5, color: "var(--faint)", letterSpacing: "0.04em" }}>Warehouse Pro · Pitch Day 3.0</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 22px", marginLeft: "auto" }} className="p-nav">
          <Link to="/pitch">{tr("Loyiha", "Проект")}</Link>
          <Link to="/demo">Demo</Link>
          <a href="/">{tr("Sayt", "Сайт")}</a>
          <a href="/privacy">{tr("Maxfiylik", "Конфиденциальность")}</a>
        </div>
      </div>
    </footer>
  );
}

/** Глава: моно-номер, заголовок слева (5/12), вводный абзац справа (7/12). */
export function Chapter({ id, num, kicker, title, lead, children, band = false, testId }: {
  id: string; num: string; kicker: string; title: ReactNode; lead?: ReactNode; children?: ReactNode; band?: boolean; testId?: string;
}) {
  return (
    <section id={id} data-testid={testId ?? `pitch-${id}`} aria-labelledby={`${id}-title`} className="p-chapter" style={{ background: band ? "var(--band)" : undefined, scrollMarginTop: 72 }}>
      <div className="p-wrap">
        <div className="grid lg:grid-cols-12" style={{ gap: "20px 64px", alignItems: "end" }}>
          <div className="lg:col-span-6">
            <p className="p-mono p-kicker" style={{ margin: 0 }}>
              <span style={{ color: "var(--faint)" }}>{num}</span>
              <span aria-hidden="true" style={{ display: "inline-block", width: 28, height: 1, background: "var(--rule-strong)", verticalAlign: "middle", margin: "0 12px" }} />
              {kicker}
            </p>
            <h2 id={`${id}-title`} className="p-h2" style={{ margin: "18px 0 0" }}>{title}</h2>
          </div>
          {lead && <div className="lg:col-span-6"><p className="p-lead" style={{ margin: 0, maxWidth: "58ch" }}>{lead}</p></div>}
        </div>
        {children && <div style={{ marginTop: 48 }}>{children}</div>}
      </div>
    </section>
  );
}

export function Mono({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span className="p-mono" style={{ fontSize: 11.5, letterSpacing: "0.06em", color: "var(--faint)", ...style }}>{children}</span>;
}

export function ArrowLink({ to, children, solid = false, testId }: { to: string; children: ReactNode; solid?: boolean; testId?: string }) {
  const cls = `p-btn ${solid ? "p-btn-solid" : "p-btn-line"} p-focus`;
  if (to.startsWith("#")) return <a href={to} className={cls} data-testid={testId}>{children}</a>;
  return <Link to={to} className={cls} data-testid={testId}>{children}<ArrowRight size={16} aria-hidden="true" /></Link>;
}
