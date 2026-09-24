import type { ReactNode } from "react";
import { AppBrand } from "@/components/brand/AppBrand";
import { recallBrand } from "@/lib/remembered-brand";
import { useLang } from "@/i18n";
import { APP_VERSION } from "@contracts/constants";

/**
 * Разворот входа: тёмная половина слева, карточка справа.
 *
 * ── Зачем общий ─────────────────────────────────────────────────────────────
 *
 * Пять экранов — вход, регистрация, забытый пароль, сброс, приглашение — были
 * оформлены каждый по-своему: у входа три десятка цветов, вписанных числом, из
 * палитры, которой в приложении нет, и шрифт Inter (не подключён, подставлялся
 * системный); у восстановления пароля свои десять; у приглашения уже neo-*.
 * Переход между ними выглядел как переход между разными продуктами.
 *
 * ── Про тёмную половину ─────────────────────────────────────────────────────
 *
 * На ней стоит класс `dark`, и токены внутри переключаются на тёмную палитру
 * приложения. Поэтому цветов числом здесь нет вовсе: панель сама собой
 * оказывается фирменной и остаётся тёмной при любой теме — светлая карточка на
 * глубоком фоне и есть то, ради чего разворот делается.
 *
 * ── Про вывеску ─────────────────────────────────────────────────────────────
 *
 * Экран входа один на всех: почта может числиться в нескольких организациях, и
 * тенант выбирается уже ПОСЛЕ пароля. До этого сервер не знает, чей бренд
 * показывать, — поэтому вывеска берётся из памяти устройства (lib/remembered-
 * brand.ts), а не с сервера.
 */
export function AuthShell({ title, subtitle, children, footer }: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Строка под карточкой: «нет аккаунта?», «вспомнили пароль?» и подобное. */
  footer?: ReactNode;
}) {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const brand = recallBrand();

  /*
    Приветствие раньше стояло ДВАЖДЫ: крупно на левой половине и ещё раз в
    карточке. Одна и та же фраза в двух местах одного экрана читается как
    недоделка, а не как оформление.

    Теперь слева — либо своя надпись арендатора, либо то, что система собой
    представляет; приветствие остаётся только в карточке.
  */
  const heroTitle = brand?.loginTitle?.trim()
    || t("Склад, заказы и долги — в одном месте", "Ombor, buyurtmalar va qarzlar — bir joyda");
  const heroSubtitle = brand?.loginSubtitle?.trim()
    || t(
      "Рабочее место директора, оператора, агента и курьера.",
      "Direktor, operator, agent va kuryer uchun ish o'rni.",
    );

  const lines: Array<[string, string]> = [
    ["Остатки и приходы по складам", "Omborlar bo'yicha qoldiq va kirim"],
    ["Заказы от заявки до доставки", "Buyurtma — arizadan yetkazishgacha"],
    ["Долги магазинов и сборы агентов", "Do'konlar qarzi va agent yig'imlari"],
  ];

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--color-canvas)" }}>

      {/* ── Левая половина ───────────────────────────────────────────────── */}
      <div
        className="auth-hero dark"
        style={{
          width: "52%", flexShrink: 0, display: "flex", flexDirection: "column",
          justifyContent: "space-between", padding: "48px 56px", color: "var(--color-text-primary)",
        }}
      >
        <div style={{ position: "relative", zIndex: 1 }}>
          <AppBrand size={34} onDark signedIn={false} color="var(--color-text-primary)" />
        </div>

        <div style={{ position: "relative", zIndex: 1, maxWidth: "440px" }}>
          <h1 style={{
            fontSize: "38px", fontWeight: 800, lineHeight: 1.12, letterSpacing: "-0.035em",
            color: "var(--color-text-primary)", margin: "0 0 18px", whiteSpace: "pre-line",
          }}>
            {heroTitle}
          </h1>
          <p style={{ fontSize: "15px", lineHeight: 1.6, color: "var(--color-text-secondary)", margin: "0 0 32px" }}>
            {heroSubtitle}
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {lines.map(([ru, uz]) => (
              <div key={ru} className="auth-hero-line">
                <span className="auth-hero-dot" />
                {t(ru, uz)}
              </div>
            ))}
          </div>
        </div>

        <div style={{
          position: "relative", zIndex: 1, display: "flex", alignItems: "center",
          justifyContent: "space-between", fontSize: "12px", color: "var(--color-text-tertiary)",
        }}>
          <span>{brand?.footerText?.trim() || `© ${new Date().getFullYear()} Warehouse Pro`}</span>
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-success)" }} />
            v{APP_VERSION}
          </span>
        </div>
      </div>

      {/* ── Правая половина ──────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col items-center justify-start md:justify-center pb-8 md:py-10 md:px-6">
        {/*
          Телефон — как вход мобилки v8 (app/(auth)/login.tsx): плашка hero во
          всю ширину (бирюза в светлой теме, карточка в тёмной) с вывеской и
          крупной надписью, форма наезжает на неё снизу. Владелец, 24.09.2026:
          «PWA точно как мобайл».
        */}
        <div
          className="md:hidden w-full"
          style={{ background: "var(--color-hero)", color: "var(--color-on-hero)", padding: "calc(env(safe-area-inset-top, 0px) + 36px) 24px 60px" }}
          data-testid="auth-phone-hero"
        >
          <AppBrand size={32} onDark signedIn={false} color="var(--color-on-hero)" />
          <h1 style={{ fontSize: "30px", fontWeight: 800, lineHeight: 1.15, letterSpacing: "-0.03em", color: "var(--color-on-hero)", margin: "28px 0 0", whiteSpace: "pre-line" }}>
            {heroTitle}
          </h1>
          <p style={{ fontSize: "14px", lineHeight: 1.55, color: "var(--color-on-hero-soft)", margin: "12px 0 0" }}>
            {heroSubtitle}
          </p>
        </div>

        <div className="animate-fade-up w-full px-4 md:px-0 -mt-8 md:mt-0" style={{ maxWidth: "412px" }}>
          {/* Вывеска над карточкой — только там, где левой половины нет, а на телефоне она в плашке. */}
          <div className="hidden md:flex lg:hidden" style={{ justifyContent: "center", marginBottom: "28px" }}>
            <AppBrand size={34} signedIn={false} color="var(--color-text-primary)" />
          </div>

          <div className="neo-card neo-card-static px-6 py-7 md:px-8 md:py-9">
            <h2 style={{
              fontSize: "25px", fontWeight: 700, letterSpacing: "-0.025em",
              color: "var(--color-text-primary)", margin: "0 0 6px",
            }}>
              {title}
            </h2>
            {subtitle && (
              <p style={{ fontSize: "13.5px", color: "var(--color-text-secondary)", margin: "0 0 26px" }}>
                {subtitle}
              </p>
            )}
            {children}
          </div>

          {footer && (
            <div style={{ marginTop: "20px", textAlign: "center", fontSize: "13px", color: "var(--color-text-secondary)" }}>
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Плашка ошибки.
 *
 * Одна на все экраны входа: у каждого была своя, и красный в них был разный —
 * `#dc2626` у входа, свой у сброса пароля. Человек видит эти экраны подряд.
 */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: "9px", padding: "11px 14px",
      borderRadius: "12px", background: "var(--color-danger-subtle)",
      fontSize: "13px", fontWeight: 500, lineHeight: 1.45,
      color: "var(--color-danger-text, var(--color-danger))",
    }}>
      {children}
    </div>
  );
}
