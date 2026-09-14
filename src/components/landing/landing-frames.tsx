import type { CSSProperties, ReactNode, Ref } from "react";
import { useLang } from "@/i18n";
import { LX, MONO } from "./landing-tokens";
import { WARM_SHADOW, NIGHT_SHADOW } from "./landing-anime";
import {
  webShot, mobileShot, manualPage,
  WEB_ASPECT, MOBILE_ASPECT,
  type WebShotKey, type MobileShotKey, type ManualPageKey,
} from "./shots";

/* ═══════════════════════════════════════════════════════════════════════════
   ОПРАВЫ ДЛЯ НАСТОЯЩИХ ЭКРАНОВ И ЗАПУСК ANIME.JS

   Лендинг перестал рисовать программу и показывает её снимки. Чтобы кадры
   не выглядели вклеенными, у них одна оправа на всю страницу: окно браузера
   для веба, корпус телефона для мобилки, тёплая тень под бумагу, затухание
   нижнего края к фону — так обрез кадра не режет глаз.

   anime.js подгружается лениво и запускается один раз, когда блок в кадре.
   При «уменьшить движение» сценарий не вызывается: элементы уже стоят в
   конечном состоянии, потому что ни один из них не спрятан разметкой —
   это правило страницы (landing-motion.test.ts), и оно действует и здесь.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Окно браузера ───────────────────────────────────────────────────────── */
export function Browser({
  shot, alt, children, tone = "paper", fade = true, className = "", style,
}: {
  shot?: WebShotKey;
  alt?: string;
  children?: ReactNode;
  /** dark — окно стоит на ночной полосе. */
  tone?: "paper" | "dark";
  /** Затухание нижнего края к фону — кадр не обрывается линией. */
  fade?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const { lang } = useLang();
  const dark = tone === "dark";
  const bg = dark ? LX.night : LX.paper;
  return (
    <div
      className={`rounded-xl overflow-hidden ${className}`}
      style={{
        border: `1px solid ${dark ? LX.ruleOnInk : LX.ruleStrong}`,
        boxShadow: dark ? NIGHT_SHADOW : WARM_SHADOW,
        background: dark ? LX.ink : LX.paperRaised,
        ...style,
      }}
    >
      <div className="flex items-center gap-3 px-3.5 py-2" style={{ background: dark ? LX.paperOnInk06 : LX.verso }}>
        <span className="flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map(i => (
            <span key={i} className="w-2 h-2 rounded-full" style={{ background: dark ? LX.faintOnInk : LX.ruleStrong }} />
          ))}
        </span>
        <span className="text-[10.5px]" style={{ ...MONO, color: dark ? LX.softOnInk : LX.inkFaint }}>app.warehouse-pro.uz</span>
      </div>
      <div className="relative" style={{ aspectRatio: WEB_ASPECT, background: dark ? LX.ink : LX.appCanvas }}>
        {shot && (
          <img
            src={webShot(shot, lang)}
            alt={alt ?? ""}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full"
            style={{ objectFit: "cover", objectPosition: "top left" }}
          />
        )}
        {children}
        {fade && (
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-16 pointer-events-none"
            style={{ background: `linear-gradient(to bottom, transparent, ${bg})` }}
          />
        )}
      </div>
    </div>
  );
}

/* ── Корпус телефона ─────────────────────────────────────────────────────────
   Пропорции современного телефона: тонкая кромка (2,4 % ширины), большое
   скругление корпуса, экран с чуть меньшим скруглением, «остров» сверху,
   кнопки по бокам, блик стекла. Ширина задаёт всё остальное — корпус
   масштабируется без искажений. Экран держит MOBILE_ASPECT, чтобы кадр
   390×844 ложился целиком, с нижней панелью вкладок.                       */
export function Phone({
  shot, alt, width = 260, children, className = "", style, screenRef,
}: {
  shot?: MobileShotKey;
  alt?: string;
  /** Ширина корпуса в px; экран внутри держит MOBILE_ASPECT. */
  width?: number;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  screenRef?: Ref<HTMLDivElement>;
}) {
  const { lang } = useLang();
  const bezel = Math.max(6, Math.round(width * 0.024));
  const radius = Math.round(width * 0.155);
  return (
    <div
      className={`relative shrink-0 ${className}`}
      style={{
        width,
        padding: bezel,
        borderRadius: radius,
        background: LX.deviceBody,
        boxShadow: `inset 0 0 0 1px ${LX.whiteHalo}, inset 0 0 0 ${bezel}px ${LX.deviceEdge}, ${WARM_SHADOW}`,
        ...style,
      }}
    >
      {/* кнопки: громкость слева, питание справа */}
      <span aria-hidden="true" className="absolute rounded-l-sm" style={{ left: -2, top: width * 0.27, width: 2, height: width * 0.075, background: LX.deviceButton }} />
      <span aria-hidden="true" className="absolute rounded-l-sm" style={{ left: -2, top: width * 0.37, width: 2, height: width * 0.075, background: LX.deviceButton }} />
      <span aria-hidden="true" className="absolute rounded-r-sm" style={{ right: -2, top: width * 0.32, width: 2, height: width * 0.12, background: LX.deviceButton }} />
      {/* остров */}
      <span aria-hidden="true" className="absolute left-1/2 -translate-x-1/2 z-20" style={{ top: bezel + Math.round(width * 0.028), width: width * 0.27, height: width * 0.072, borderRadius: 999, background: LX.deviceIsland }} />
      <div
        ref={screenRef}
        className="relative overflow-hidden"
        style={{ aspectRatio: MOBILE_ASPECT, borderRadius: radius - bezel, background: LX.screenBlank }}
      >
        {shot && (
          <img
            src={mobileShot(shot, lang)}
            alt={alt ?? ""}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full"
            style={{ objectFit: "cover", objectPosition: "top" }}
          />
        )}
        {children}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{ background: LX.glass }}
        />
      </div>
    </div>
  );
}

/* ── Страница руководства (с выносками — они и есть фишка) ───────────────── */
export function ManualLeaf({
  page, alt, mobile = false, className = "", style,
}: {
  page: ManualPageKey;
  alt: string;
  mobile?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const { lang } = useLang();
  return (
    <div
      className={`overflow-hidden ${className}`}
      style={{
        aspectRatio: mobile ? "640 / 1090" : "1400 / 972",
        borderRadius: 10,
        background: LX.paperRaised,
        boxShadow: NIGHT_SHADOW,
        ...style,
      }}
    >
      <img src={manualPage(page, lang)} alt={alt} loading="lazy" decoding="async" className="w-full h-full" style={{ objectFit: "cover", objectPosition: "top" }} />
    </div>
  );
}

/* ── Реестр возможностей ─────────────────────────────────────────────────────
   Линованный список в две колонки — тот же язык, что у «Реестра
   возможностей» в главе 04: номер моно, жирный заголовок, строка описания,
   волосяные линии. Не карточки с иконками: сетка одинаковых коробочек — это
   шаблон любого SaaS-сайта, и именно она читалась «дешевле, чем у других». */
export function Ledger({ items, start = 1, dark = false, columns = 2, className = "" }: {
  items: { t: string; d: string }[];
  start?: number;
  dark?: boolean;
  /** Одна колонка — когда реестр стоит рядом с окном. */
  columns?: 1 | 2;
  className?: string;
}) {
  const rule = dark ? LX.ruleOnInk : LX.rule;
  return (
    <ol className={`grid ${columns === 2 ? "md:grid-cols-2" : ""} gap-x-14 lg:gap-x-20 ${className}`} style={{ borderTop: `1px solid ${dark ? LX.ruleOnInk : LX.ruleStrong}` }}>
      {items.map((it, i) => (
        <li key={it.t} className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-4 py-5" style={{ borderBottom: `1px solid ${rule}` }}>
          <span className="text-[12px] pt-1" style={{ ...MONO, color: dark ? LX.brassOnNight : LX.brassDeep }}>{String(start + i).padStart(2, "0")}</span>
          <div>
            <div className="text-[16px] font-bold" style={{ color: dark ? LX.paperOnInk : LX.ink, letterSpacing: "-0.01em" }}>{it.t}</div>
            <p className="mt-1 text-[14px] leading-relaxed" style={{ color: dark ? LX.softOnInk : LX.inkSoft }}>{it.d}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ── Сетка главы: 5/12 слева, 7/12 справа, выровнено по верху ─────────────── */
export function Split({ left, right, className = "", flip = false }: { left: ReactNode; right: ReactNode; className?: string; flip?: boolean }) {
  return (
    <div className={`grid lg:grid-cols-12 gap-10 lg:gap-x-16 items-start ${className}`}>
      <div className={`lg:col-span-5 ${flip ? "lg:order-2" : ""}`}>{left}</div>
      <div className={`lg:col-span-7 ${flip ? "lg:order-1" : ""}`}>{right}</div>
    </div>
  );
}

/* ── Подпись «демо-данные» ───────────────────────────────────────────────── */
export function DemoTag({ dark = false, children }: { dark?: boolean; children: ReactNode }) {
  return (
    <p className="text-[11px] mt-3" style={{ ...MONO, color: dark ? LX.softOnInk : LX.inkFaint }}>
      {children}
    </p>
  );
}
