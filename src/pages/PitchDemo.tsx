import { useRef, useState, type CSSProperties, type RefObject } from "react";
import { ArrowRight, Loader2, PlayCircle } from "lucide-react";
import { useLang } from "@/i18n";
import { PitchShell, Mono, ArrowLink } from "@/components/pitch/pitch-ui";
import { useDemoStatus, demoLogin, type DemoRole, type DemoStatus } from "@/components/pitch/demo-access";
import { pick, VIDEO_SRC, VIDEO_POSTER, VIDEO_DESCRIPTION, type L } from "@/components/pitch/pitch-content";

/* ═══════════════════════════════════════════════════════════════════════════
   /demo — шестой раздел конкурса: 6.1 ролик, 6.2 его описание, 6.3 доступ к
   работающему прототипу.

   Ролик — public/pitch/demo-uz.mp4 (2:44, обложка demo-poster.jpg). Время
   сцен в описании переносит в плеер; не открылся ролик — обложка и прямая
   ссылка, а не сломанный плеер.

   Прототип — вход кнопкой в демо-организацию (песочницу) без пароля:
   api/http/demo.ts, правила в api/services/pitch-demo.ts.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function PitchDemo() {
  return (
    <PitchShell title={{ uz: "Warehouse Pro — demo", ru: "Warehouse Pro — демо" }}>
      <DemoBody />
    </PitchShell>
  );
}

function DemoBody() {
  const { lang } = useLang();
  const tr = (uz: string, ru: string) => (lang === "uz" ? uz : ru);
  const status = useDemoStatus();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const seek = (start: number) => {
    const v = videoRef.current;
    document.getElementById("video")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!v) return;
    v.currentTime = start;
    // Звука в ролике нет — запуск без нажатия на сам плеер браузер разрешает.
    void v.play()?.catch(() => {});
  };
  return (
    <>
      <section style={{ paddingTop: 40, paddingBottom: 40 }}>
        <div className="p-wrap">
          <p className="p-mono p-kicker p-rise" style={{ margin: 0 }}>Pitch Day 3.0 · {tr("6-bo'lim", "Раздел 6")}</p>
          <h1 className="p-h1 p-rise" style={{ margin: "18px 0 0", animationDelay: "60ms" }}>Demo</h1>
          <p className="p-lead p-rise" style={{ margin: "18px 0 0", maxWidth: "60ch", animationDelay: "120ms" }}>
            {tr(
              "Video mahsulotni qanday ishlashini ko'rsatadi; prototipda esa uni o'zingiz sinab ko'rasiz — namunaviy tashkilotda, ro'yxatdan o'tmasdan.",
              "Ролик показывает, как работает продукт; в прототипе вы пробуете его сами — в демо-организации, без регистрации.",
            )}
          </p>
          <nav className="p-nav p-rise" style={{ display: "flex", flexWrap: "wrap", gap: "4px 22px", marginTop: 20, animationDelay: "160ms" }} aria-label={tr("Bo'limlar", "Разделы")}>
            <a href="#video">6.1 {tr("Video", "Ролик")}</a>
            <a href="#tavsif">6.2 {tr("Tavsif", "Описание")}</a>
            <a href="#prototip">6.3 {tr("Prototip", "Прототип")}</a>
            <a href="/pitch">← {tr("Loyiha sahifasi", "Страница проекта")}</a>
          </nav>
        </div>
      </section>

      <section id="video" data-testid="pitch-demo-video" aria-labelledby="video-title" style={{ paddingBottom: 24, scrollMarginTop: 72 }}>
        <div className="p-wrap">
          <SectionLabel id="video-title" num="6.1" text={tr("Demo video", "Демо-ролик")} />
          <VideoBlock videoRef={videoRef} />
        </div>
      </section>

      <section id="tavsif" data-testid="pitch-demo-description" aria-labelledby="tavsif-title" className="p-chapter" style={{ scrollMarginTop: 72 }}>
        <div className="p-wrap grid lg:grid-cols-12" style={{ gap: "24px 64px" }}>
          <div className="lg:col-span-5">
            <SectionLabel id="tavsif-title" num="6.2" text={tr("Video tavsifi", "Описание ролика")} />
            <p className="p-lead" style={{ margin: "16px 0 0" }}>{pick(lang, VIDEO_DESCRIPTION.lead)}</p>
            <p style={{ margin: "16px 0 0", fontSize: 14, lineHeight: 1.6, color: "var(--soft)" }}>{pick(lang, VIDEO_DESCRIPTION.note)}</p>
          </div>
          <ol data-testid="pitch-demo-scenes" className="lg:col-span-7" style={{ listStyle: "none", padding: 0, margin: 0, borderTop: "1px solid var(--rule-strong)" }}>
            {VIDEO_DESCRIPTION.scenes.map(s => (
              <li key={s.at} className="p-row" style={{ display: "grid", gridTemplateColumns: "64px minmax(0,1fr)", gap: 16, padding: "18px 0" }}>
                {/* Время — кнопка: переносит в плеер на начало сцены. */}
                <button
                  type="button"
                  className="p-mono p-focus"
                  data-testid="pitch-demo-scene-seek"
                  data-start={s.start}
                  onClick={() => seek(s.start)}
                  aria-label={`${tr("Videoda", "В ролике")} ${s.at} — ${pick(lang, s.title)}`}
                  style={{ alignSelf: "start", justifySelf: "start", minHeight: 32, padding: "4px 8px", marginTop: -2, borderRadius: 8, border: "1px solid var(--rule-strong)", background: "transparent", color: "var(--accent-text)", fontSize: 12.5, cursor: "pointer" }}
                >
                  {s.at}
                </button>
                <span>
                  <span style={{ display: "block", fontWeight: 800, fontSize: 16.5, letterSpacing: "-0.015em" }}>{pick(lang, s.title)}</span>
                  <span style={{ display: "block", marginTop: 4, fontSize: 15, lineHeight: 1.6, color: "var(--soft)" }}>{pick(lang, s.text)}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="prototip" data-testid="pitch-demo-prototype" aria-labelledby="prototip-title" className="p-chapter" style={{ background: "var(--band)", scrollMarginTop: 72 }}>
        <div className="p-wrap">
          <div className="grid lg:grid-cols-12" style={{ gap: "24px 64px" }}>
            <div className="lg:col-span-5">
              <SectionLabel id="prototip-title" num="6.3" text={tr("Ishlaydigan prototip", "Работающий прототип")} />
              <p className="p-lead" style={{ margin: "16px 0 0" }}>
                {tr(
                  "Bu haqiqiy mahsulot — warehouse-pro.uz, faqat namunaviy tashkilotda. Parol kerak emas: rolni tanlang va kiring. Buyurtma, tashrif, ombor — hammasini sinab ko'rish mumkin.",
                  "Это настоящий продукт — warehouse-pro.uz, только в демо-организации. Пароль не нужен: выберите роль и войдите. Заказы, визиты, склад — всё можно пробовать.",
                )}
              </p>
              <p style={{ margin: "16px 0 0", fontSize: 14, lineHeight: 1.6, color: "var(--soft)" }}>
                {tr(
                  "Ma'lumotlar namunaviy. Parol, kirish, 2FA, foydalanuvchilar, API kalitlari, to'lov va integratsiya sozlamalari demo rejimda yopiq.",
                  "Данные образцовые. Пароль, вход, 2FA, пользователи, API-ключи, оплата и настройки интеграций в демо-режиме закрыты.",
                )}
              </p>
            </div>
            <div className="lg:col-span-7">
              <RoleList status={status} />
            </div>
          </div>
          <div className="p-cta" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 40 }}>
            <a className="p-btn p-btn-line p-focus" href="/" data-testid="pitch-demo-site">warehouse-pro.uz <ArrowRight size={16} aria-hidden="true" /></a>
            <ArrowLink to="/pitch">{tr("Loyiha haqida", "О проекте")}</ArrowLink>
          </div>
        </div>
      </section>
    </>
  );
}

function SectionLabel({ id, num, text }: { id: string; num: string; text: string }) {
  return (
    <h2 id={id} style={{ margin: 0, display: "flex", alignItems: "baseline", gap: 14, fontSize: "clamp(24px, 3vw, 34px)", fontWeight: 800, letterSpacing: "-0.03em" }}>
      <span className="p-mono" style={{ fontSize: 13, fontWeight: 500, color: "var(--accent-text)", letterSpacing: 0 }}>{num}</span>
      {text}
    </h2>
  );
}

/* ── 6.1 Плеер ─────────────────────────────────────────────────────────────
   Без автозапуска; preload="metadata" — 14 МБ уходят только тем, кто нажал
   «играть» (сервер отдаёт ролик кусками по Range, перемотка не качает всё).
   Не открылся ролик (старая выкладка, обрыв) — обложка и прямая ссылка
   вместо чёрного прямоугольника со сломанным значком. */
function VideoBlock({ videoRef }: { videoRef: RefObject<HTMLVideoElement | null> }) {
  const { lang } = useLang();
  const tr = (uz: string, ru: string) => (lang === "uz" ? uz : ru);
  const [broken, setBroken] = useState(false);
  const frame: CSSProperties = { width: "100%", aspectRatio: "16 / 9", borderRadius: 18, border: "1px solid var(--rule-strong)", display: "block", background: "var(--video-bg)" };

  return (
    <div style={{ marginTop: 20 }}>
      {!broken ? (
        <video
          ref={videoRef}
          data-testid="pitch-demo-player"
          controls
          playsInline
          preload="metadata"
          poster={VIDEO_POSTER}
          src={VIDEO_SRC}
          onError={() => setBroken(true)}
          aria-label={tr("Warehouse Pro demo videosi, 2:44", "Демо-ролик Warehouse Pro, 2:44")}
          style={frame}
        >
          {tr("Brauzeringiz videoni ko'rsata olmaydi.", "Браузер не может показать видео.")}
        </video>
      ) : (
        <div data-testid="pitch-demo-video-broken" style={{ ...frame, position: "relative", overflow: "hidden" }}>
          <img src={VIDEO_POSTER} alt="" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.35 }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "clamp(16px, 4vw, 40px)", display: "flex", alignItems: "flex-end", gap: 16 }}>
            <PlayCircle size={40} aria-hidden="true" style={{ color: "var(--accent)", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "clamp(18px, 2.4vw, 28px)", fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text)" }}>
                {tr("Videoni bu yerda ochib bo'lmadi", "Ролик не открылся здесь")}
              </div>
              <a href={VIDEO_SRC} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 8, fontSize: 14.5, color: "var(--accent-text)", textDecoration: "underline", textUnderlineOffset: 4, padding: "6px 0" }}>
                {tr("Videoni alohida ochish", "Открыть ролик отдельно")} ↗
              </a>
            </div>
          </div>
        </div>
      )}
      <p className="p-mono" style={{ margin: "12px 0 0", fontSize: 11.5, letterSpacing: "0.06em", color: "var(--faint)" }}>
        2:44 · 1920×1080 · {tr("OVOZSIZ, IZOHLAR BILAN", "БЕЗ ЗВУКА, С ПОДПИСЯМИ")}
      </p>
    </div>
  );
}

/* ── 6.3 Роли для входа ───────────────────────────────────────────────── */
const ROLE_TEXT: Record<DemoRole, { name: L; button: L; d: L }> = {
  ceo: {
    name: { uz: "Direktor", ru: "Директор" },
    button: { uz: "Direktor sifatida kirish", ru: "Войти как директор" },
    d: { uz: "Bosh panel, P&L, foyda va ABC, savdo xaritasi, qarzlar, ombor.", ru: "Главная панель, P&L, прибыль и ABC, карта продаж, долги, склад." },
  },
  agent: {
    name: { uz: "Savdo agenti", ru: "Торговый агент" },
    button: { uz: "Agent sifatida kirish", ru: "Войти как агент" },
    d: { uz: "Do'konlar, yangi buyurtma, narxlar va pog'onalar, do'kon qarzlari.", ru: "Магазины, новый заказ, цены и ступени, долги магазинов." },
  },
  supervisor: {
    name: { uz: "Supervayzer", ru: "Супервайзер" },
    button: { uz: "Supervayzer sifatida kirish", ru: "Войти как супервайзер" },
    d: { uz: "Agentlar nazorati, rejalar va tashriflar.", ru: "Контроль агентов, планы и визиты." },
  },
};

function RoleList({ status }: { status: DemoStatus | null }) {
  const { lang, setLang } = useLang();
  const tr = (uz: string, ru: string) => (lang === "uz" ? uz : ru);
  const [busy, setBusy] = useState<DemoRole | null>(null);
  const [error, setError] = useState<string | null>(null);
  const roles: DemoRole[] = ["ceo", "agent", "supervisor"];

  const enter = async (role: DemoRole) => {
    setBusy(role); setError(null);
    const r = await demoLogin(role);
    // Язык страницы становится языком приложения: жюри, читавшее по-узбекски,
    // не должно оказаться в русском интерфейсе (у приложения по умолчанию ru).
    if (r.ok) { setLang(lang); window.location.assign("/"); return; }
    setBusy(null);
    setError(r.reason === "rate_limited"
      ? tr("Juda ko'p urinish. 10 daqiqadan keyin qayta urinib ko'ring.", "Слишком много входов. Попробуйте через 10 минут.")
      : tr("Demo hozircha mavjud emas.", "Демо сейчас недоступно."));
  };

  if (status && !status.enabled) {
    return (
      <div data-testid="pitch-demo-unavailable" style={{ border: "1px solid var(--rule-strong)", borderRadius: 14, padding: "20px 22px" }}>
        <div style={{ fontWeight: 800, fontSize: 18 }}>{tr("Demo tashkilot hozircha ulanmagan", "Демо-организация пока не подключена")}</div>
        <p style={{ margin: "8px 0 16px", fontSize: 14.5, color: "var(--soft)", lineHeight: 1.6 }}>
          {tr("Mahsulotni o'z tashkilotingizda 14 kun bepul sinab ko'rishingiz mumkin.", "Продукт можно попробовать в своей организации — 14 дней бесплатно.")}
        </p>
        <ArrowLink to="/register" solid>{tr("Ro'yxatdan o'tish", "Регистрация")}</ArrowLink>
      </div>
    );
  }

  return (
    <div>
      <ul data-testid="pitch-demo-roles" style={{ listStyle: "none", padding: 0, margin: 0, borderTop: "1px solid var(--rule-strong)" }}>
        {roles.map(role => {
          const available = !status || status.roles.includes(role);
          if (status && !available) return null;
          return (
            <li key={role} className="p-row" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "12px 24px", padding: "20px 0" }}>
              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>{pick(lang, ROLE_TEXT[role].name)}</div>
                <p style={{ margin: "4px 0 0", fontSize: 14.5, color: "var(--soft)", lineHeight: 1.55 }}>{pick(lang, ROLE_TEXT[role].d)}</p>
              </div>
              <button
                type="button"
                className={`p-btn ${role === "ceo" ? "p-btn-solid" : "p-btn-line"} p-focus p-full-sm`}
                data-testid={`pitch-demo-login-${role}`}
                disabled={status === null || busy !== null}
                onClick={() => enter(role)}
                style={{ flex: "0 0 auto", minWidth: 280 }}
              >
                {busy === role ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} aria-hidden="true" /> : null}
                {pick(lang, ROLE_TEXT[role].button)} <ArrowRight size={16} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" style={{ margin: "14px 0 0", fontSize: 14.5, color: "var(--accent-text)" }}>{error}</p>}
      <Mono style={{ display: "block", marginTop: 16 }}>{tr("PAROLSIZ · NAMUNAVIY MA'LUMOTLAR · XAVFSIZLIK SOZLAMALARI YOPIQ", "БЕЗ ПАРОЛЯ · ОБРАЗЦОВЫЕ ДАННЫЕ · НАСТРОЙКИ БЕЗОПАСНОСТИ ЗАКРЫТЫ")}</Mono>
    </div>
  );
}
