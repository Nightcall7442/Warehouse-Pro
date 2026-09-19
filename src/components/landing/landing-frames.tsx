import type { CSSProperties, ReactNode, Ref } from "react";
import { useLang } from "@/i18n";
import { LX, MONO } from "./landing-tokens";
import { WARM_SHADOW, NIGHT_SHADOW } from "./landing-anime";
import {
  webShot, webContent, mobileShot, manualPage,
  WEB_ASPECT, WEB_CONTENT_ASPECT, MOBILE_ASPECT,
  type WebShotKey, type MobileShotKey, type ManualPageKey,
} from "./shots";

/* Один набор скруглений на все оправы и листы — разнобой радиусов и есть
   первое, по чему страница читается собранной из кусков. */
export const R = { sheet: 14, window: 18 } as const;

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

/* ── Окно браузера ───────────────────────────────────────────────────────────
   content — кадр без бокового меню приложения: в главах о заказах, складе и
   деньгах кадр должен быть о своём содержании, крупно, а не о меню,
   одинаковом на каждом снимке. Хром окна — тонкая полоса с тремя точками и
   адресом; тень длинная и мягкая, как у листа на столе.                      */
export function Browser({
  shot, alt, children, tone = "paper", fade = true, content = false, aspect, className = "", style,
}: {
  shot?: WebShotKey;
  alt?: string;
  children?: ReactNode;
  /** dark — окно стоит на ночной полосе. */
  tone?: "paper" | "dark";
  /** Своя пропорция окна: кадр во весь горизонт режется снизу под затухание, чтобы уместиться в экран. */
  aspect?: number;
  /** Затухание нижнего края к фону — кадр не обрывается линией. */
  fade?: boolean;
  /** Кадр без бокового меню приложения. */
  content?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const { lang } = useLang();
  const dark = tone === "dark";
  const bg = dark ? LX.night : LX.paper;
  return (
    <div
      className={`overflow-hidden ${className}`}
      style={{
        borderRadius: R.window,
        border: `1px solid ${dark ? LX.ruleOnInk : LX.ruleStrong}`,
        boxShadow: dark ? NIGHT_SHADOW : WARM_SHADOW,
        background: dark ? LX.ink : LX.paperRaised,
        ...style,
      }}
    >
      <div className="flex items-center gap-3 px-4 h-9" style={{ background: dark ? LX.paperOnInk06 : LX.verso, borderBottom: `1px solid ${dark ? LX.ruleOnInk : LX.rule}` }}>
        <span className="flex gap-1.5" aria-hidden="true">
          {[0, 1, 2].map(i => (
            <span key={i} className="w-2 h-2 rounded-full" style={{ background: dark ? LX.faintOnInk : LX.ruleStrong }} />
          ))}
        </span>
        <span className="text-[10.5px]" style={{ ...MONO, color: dark ? LX.softOnInk : LX.inkFaint, letterSpacing: "0.02em" }}>app.warehouse-pro.uz</span>
      </div>
      <div className="relative" style={{ aspectRatio: aspect ?? (content ? WEB_CONTENT_ASPECT : WEB_ASPECT), background: dark ? LX.ink : LX.appCanvas }}>
        {shot && (
          <img
            src={content ? webContent(shot, lang) : webShot(shot, lang)}
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
            className="absolute inset-x-0 bottom-0 h-20 pointer-events-none"
            style={{ background: `linear-gradient(to bottom, transparent, ${bg})` }}
          />
        )}
      </div>
    </div>
  );
}

/* ── Лист: карточка с волосяной рамкой, без тени ─────────────────────────────
   Правило страницы — линовка, а не тени. Лист один на всю страницу: радиус,
   рамка и поля не меняются от главы к главе.                                  */
export function Sheet({ title, aside, children, className = "", style }: {
  title?: string;
  /** Правый верхний угол: пометка моно. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={`p-6 md:p-7 ${className}`} style={{ borderRadius: R.sheet, background: LX.paperRaised, border: `1px solid ${LX.ruleStrong}`, ...style }}>
      {(title || aside) && (
        <div className="flex items-baseline justify-between gap-4 mb-5">
          {title && <span className="text-[11px] uppercase" style={{ ...MONO, color: LX.brassText, letterSpacing: "0.08em" }}>{title}</span>}
          {aside}
        </div>
      )}
      {children}
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
        <li key={it.t} className="grid grid-cols-[40px_minmax(0,1fr)] gap-x-4 py-6" style={{ borderBottom: `1px solid ${rule}` }}>
          <span className="text-[12px] pt-1.5" style={{ ...MONO, color: dark ? LX.brassOnNight : LX.brassDeep }}>{String(start + i).padStart(2, "0")}</span>
          <div>
            <div className="text-[17px] font-bold" style={{ color: dark ? LX.paperOnInk : LX.ink, letterSpacing: "-0.015em", lineHeight: 1.25 }}>{it.t}</div>
            <p className="mt-1.5 text-[14.5px] leading-relaxed max-w-[48ch]" style={{ color: dark ? LX.softOnInk : LX.inkSoft }}>{it.d}</p>
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

/* ── Сцена: кадр во весь горизонт, карточка поверх нижнего края ─────────────
   «Монументальный реестр», глава 2 (20.09.2026). Раньше кадр программы стоял
   в 7/12 колонки — окно-открытка, на 2K нечитаемое. Теперь кадр занимает всю
   колонку страницы (снимки лежат в ×2, на 2K они по-прежнему резкие), а
   живая карточка главы — одна — лежит поверх его нижней кромки, как лист на
   столе поверх экрана. Подпись под сценой — моно, как у фигуры в реестре.
   На телефоне карточка становится под кадр.                                  */
/** Пропорция кадра на сцене: шире окна содержания, чтобы сцена умещалась в экран на 2K. */
export const STAGE_ASPECT = 1174 / 700;

export function Stage({ frame, card, caption, flip = false, className = "" }: {
  frame: ReactNode;
  /** Живая карточка главы: слева (или справа при flip) поверх нижней кромки кадра. */
  card?: ReactNode;
  caption?: ReactNode;
  flip?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className={`relative ${card ? "lg:pb-14" : ""}`}>
        {frame}
        {card && (
          <div
            className={`mt-6 lg:mt-0 lg:absolute lg:bottom-0 lg:w-[420px] ${flip ? "lg:right-8" : "lg:left-8"}`}
            style={{ boxShadow: WARM_SHADOW, borderRadius: R.sheet }}
          >
            {card}
          </div>
        )}
      </div>
      {caption && (
        <p className="mt-4 text-[11px] uppercase" style={{ ...MONO, color: LX.inkFaint, letterSpacing: "0.08em" }}>{caption}</p>
      )}
    </div>
  );
}

/* ── Монумент: одно число главы ────────────────────────────────────────────
   «Монументальный реестр», глава 3 (20.09.2026): иерархия масштабом, а не
   жирностью — одно огромное число (или цепочка чисел со стрелками) и
   булавочная моно-подпись под каждым, ничего среднего. Число считается от
   нуля при появлении (data-count, lib/landing-motion). Последнее звено
   цепочки — латунью: это то, ради чего глава.                               */
export function Monument({ parts, note, dark = false, className = "" }: {
  parts: Array<{ value: number; label: string; suffix?: string; brass?: boolean }>;
  /** Подпись-метка под числами: «демо-данные · …». */
  note?: string;
  dark?: boolean;
  className?: string;
}) {
  const ink = dark ? LX.paperOnInk : LX.ink;
  const brass = dark ? LX.brassOnNight : LX.brass;
  const faint = dark ? LX.softOnInk : LX.inkFaint;
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-6 md:gap-x-10">
        {parts.map((p, i) => (
          <div key={p.label} className="flex items-center gap-x-6 md:gap-x-10">
            {/* Стрелка — на оптической середине цифр (блок центрирован вместе с подписью, поэтому поднята на её высоту); на телефоне числа стоят столбиком без стрелок. */}
            {i > 0 && (
              <span aria-hidden="true" className="relative hidden md:block w-16 h-px mb-[26px]" style={{ background: dark ? LX.softOnInk : LX.ruleStrong }}>
                <span className="absolute right-0 top-1/2 w-2.5 h-2.5 -translate-y-1/2 rotate-45 border-t border-r" style={{ borderColor: dark ? LX.softOnInk : LX.ruleStrong }} />
              </span>
            )}
            <div>
              <div
                className="font-extrabold leading-none"
                style={{ fontSize: "clamp(3rem, 6.4vw, 6.5rem)", letterSpacing: "-0.045em", color: p.brass ? brass : ink, fontVariantNumeric: "tabular-nums" }}
              >
                <span data-count={p.value}>{p.value.toLocaleString("ru-RU").replace(/[\u00a0\u202f]/g, " ")}</span>
                {p.suffix && <span className="ml-2 font-medium" style={{ fontSize: "0.32em", letterSpacing: "0", color: faint }}>{p.suffix}</span>}
              </div>
              <div className="mt-3 text-[11px] uppercase" style={{ ...MONO, fontWeight: 500, letterSpacing: "0.1em", color: p.brass ? (dark ? LX.brassOnNight : LX.brassText) : faint }}>{p.label}</div>
            </div>
          </div>
        ))}
      </div>
      {note && <p className="mt-5 text-[11px]" style={{ ...MONO, color: faint, letterSpacing: "0.02em" }}>{note}</p>}
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
