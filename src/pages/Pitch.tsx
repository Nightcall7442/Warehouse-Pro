import { Fragment, type ReactNode } from "react";
import { useLang } from "@/i18n";
import { useTheme } from "@/hooks/useTheme";
import { Browser, Phone } from "@/components/landing/landing-frames";
import { PitchShell, Chapter, Mono, ArrowLink } from "@/components/pitch/pitch-ui";
import ApiSection from "@/components/pitch/ApiSection";
import { PhotoOrIcon } from "@/components/PhotoOrIcon";
import { useDemoStatus } from "@/components/pitch/demo-access";
import {
  pick, TEAM, ENGINEERING, PROBLEMS, ROLES, WHY_US, ROADMAP, CURRENT_STAGE, NEXT_STEPS,
  STAGES, TECH, AI_NOW, AI_PLANNED, type L, type StepState,
} from "@/components/pitch/pitch-content";

/* ═══════════════════════════════════════════════════════════════════════════
   /pitch — сайт для конкурса Pitch Day 3.0, 1-й этап.

   Разделы по требованиям конкурса: 1 Муаммо → Ечим, 2 Жамоа, 3 почему
   именно мы, 4 дорожная карта, 5 как внедряем; 6 — страница /demo (ролик и
   прототип), здесь только ссылка на неё; 7 — дополнительный раздел API.
   Публичная, без входа, по-узбекски по умолчанию (PitchShell).
   ═══════════════════════════════════════════════════════════════════════════ */

const NAV: Array<{ href: string; label: L }> = [
  { href: "#muammo", label: { uz: "Muammo", ru: "Проблема" } },
  { href: "#jamoa", label: { uz: "Jamoa", ru: "Команда" } },
  { href: "#nega-biz", label: { uz: "Nega biz", ru: "Почему мы" } },
  { href: "#yol-xaritasi", label: { uz: "Yo'l xaritasi", ru: "Дорожная карта" } },
  { href: "#amalga-oshirish", label: { uz: "Reja", ru: "Внедрение" } },
  { href: "#demo", label: { uz: "Demo", ru: "Демо" } },
  { href: "#api", label: { uz: "API", ru: "API" } },
];

const fmt = (n: number) => n.toLocaleString("ru-RU").replace(/[\u00a0\u202f]/g, "\u2009");

export default function Pitch() {
  return (
    <PitchShell title={{ uz: "Warehouse Pro — Pitch Day 3.0", ru: "Warehouse Pro — Pitch Day 3.0" }} nav={NAV}>
      <PitchBody />
    </PitchShell>
  );
}

function PitchBody() {
  const status = useDemoStatus();
  return (
    <>
      <Hero />
      <ProblemSolution />
      <Team />
      <WhyUs />
      <Roadmap />
      <Implementation />
      <DemoTeaser />
      <ApiSection status={status} />
    </>
  );
}

function useTr() {
  const { lang } = useLang();
  return { lang, tr: (uz: string, ru: string) => (lang === "uz" ? uz : ru) };
}

/* ── Первый экран ───────────────────────────────────────────────────────── */
function Hero() {
  const { tr } = useTr();
  const { theme } = useTheme();
  return (
    <section data-testid="pitch-hero" style={{ position: "relative", paddingTop: 40, paddingBottom: 72 }}>
      <div className="p-wrap">
        <p className="p-mono p-kicker p-rise" style={{ margin: 0, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px" }}>
          <span>Pitch Day 3.0 · {tr("1-bosqich", "1-й этап")}</span>
          <span data-testid="pitch-stage-badge" style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--teal)", border: "1px solid var(--rule-strong)", borderRadius: 999, padding: "4px 10px" }}>
            <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 99, background: "var(--teal)", boxShadow: "0 0 0 4px var(--teal-soft)" }} />
            {tr("Ishga tushirilgan", "Запущен")}
          </span>
        </p>
        <h1 className="p-h1 p-rise" style={{ margin: "22px 0 0", maxWidth: "18ch", animationDelay: "60ms", textWrap: "balance" }}>
          {tr("Buyurtmadan pulgacha —", "От заказа до денег —")}{" "}
          <span style={{ color: "var(--accent)" }}>{tr("distribyutor uchun bitta tizim", "одна система для дистрибьютора")}</span>
        </h1>
        <div className="grid lg:grid-cols-12 p-rise" style={{ gap: "24px 64px", marginTop: 28, animationDelay: "120ms" }}>
          <p className="p-lead lg:col-span-7" style={{ margin: 0, maxWidth: "60ch" }}>
            {tr(
              "Warehouse Pro — O'zbekistondagi FMCG distribyutorlari uchun SaaS. Savdo agentlari, kuryerlar, merchandayzerlar, ombor va ofis operatorlari, supervayzerlar va direktor bitta bazada ishlaydi: veb, PWA va mobil ilova, o'zbek va rus tillarida.",
              "Warehouse Pro — SaaS для FMCG-дистрибьюторов Узбекистана. Торговые агенты, курьеры, мерчендайзеры, складские и офисные операторы, супервайзеры и директор работают в одной базе: веб, PWA и мобильное приложение, на узбекском и русском.",
            )}
          </p>
          <div className="lg:col-span-5 p-cta" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start", alignContent: "flex-start" }}>
            <ArrowLink to="/demo" solid testId="pitch-cta-demo">{tr("Demo va prototip", "Демо и прототип")}</ArrowLink>
            <ArrowLink to="#muammo">{tr("Muammodan boshlash", "Начать с проблемы")}</ArrowLink>
          </div>
        </div>

        {/* Кадры настоящей программы: директор за компьютером, агент с телефоном. */}
        <div className="p-rise" style={{ position: "relative", marginTop: 56, animationDelay: "180ms", paddingRight: "clamp(56px, 14vw, 200px)" }}>
          <Browser shot="dashboard" content tone={theme === "dark" ? "dark" : "paper"} alt={tr("Direktor paneli", "Панель директора")} />
          <div style={{ position: "absolute", right: 0, bottom: "clamp(-40px, -3vw, -16px)", width: "clamp(124px, 27vw, 268px)" }}>
            <Phone shot="orderStep2" width={268} alt={tr("Agent buyurtmasi telefonda", "Заказ агента в телефоне")} style={{ width: "100%" }} />
          </div>
        </div>
        <p className="p-mono" style={{ fontSize: 11, color: "var(--faint)", letterSpacing: "0.06em", marginTop: 56 }}>
          {tr("KADRLAR — HAQIQIY DASTURDAN, NAMUNAVIY MA'LUMOTLAR BILAN", "КАДРЫ — ИЗ НАСТОЯЩЕЙ ПРОГРАММЫ, НА ДЕМО-ДАННЫХ")}
        </p>
      </div>
    </section>
  );
}

/* ── 01 Муаммо → Ечим ─────────────────────────────────────────────────── */
function ProblemSolution() {
  const { lang, tr } = useTr();
  return (
    <Chapter
      id="muammo"
      num="01"
      kicker={tr("Muammo → Yechim", "Проблема → Решение")}
      title={tr("Besh joyga bo'lingan kun — bitta tizimda", "День в пяти местах — в одной системе")}
      lead={tr(
        "Distribyutorning kuni beshta joyda bo'linib ketadi: qog'oz, Telegram, Excel, qarz daftari va 1C. Har biri — alohida xato manbai va yo'qolgan pul.",
        "День дистрибьютора разорван на пять мест: бумага, Telegram, Excel, тетрадь долгов и 1С. Каждое — отдельный источник ошибок и потерянных денег.",
      )}
    >
      <div className="hidden md:grid" style={{ gridTemplateColumns: "minmax(110px,2fr) 5fr 5fr", gap: 32, paddingBottom: 12 }}>
        <span />
        <Mono>{tr("MUAMMO — HOZIR QANDAY", "ПРОБЛЕМА — КАК СЕЙЧАС")}</Mono>
        <Mono style={{ color: "var(--accent-text)" }}>{tr("YECHIM — WAREHOUSE PRO DA", "РЕШЕНИЕ — В WAREHOUSE PRO")}</Mono>
      </div>
      <ol data-testid="pitch-problems" style={{ listStyle: "none", padding: 0, margin: 0, borderTop: "1px solid var(--rule-strong)" }}>
        {PROBLEMS.map((p, i) => (
          <li key={p.topic.ru} className="p-row grid md:grid-cols-[minmax(110px,2fr)_5fr_5fr]" style={{ gap: "10px 32px", padding: "26px 0" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
              <span className="p-mono" style={{ fontSize: 12, color: "var(--faint)" }}>{String(i + 1).padStart(2, "0")}</span>
              <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: "-0.02em" }}>{pick(lang, p.topic)}</span>
            </div>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--soft)" }}>
              <span className="block md:hidden p-mono" style={{ fontSize: 10.5, letterSpacing: "0.1em", color: "var(--faint)", marginBottom: 4 }}>{tr("MUAMMO", "ПРОБЛЕМА")}</span>
              {pick(lang, p.problem)}
            </p>
            <p style={{ margin: 0, fontSize: 15.5, lineHeight: 1.6, fontWeight: 600, paddingLeft: 16, borderLeft: "2px solid var(--accent)" }}>
              <span className="block md:hidden p-mono" style={{ fontSize: 10.5, letterSpacing: "0.1em", color: "var(--accent-text)", marginBottom: 4, fontWeight: 400 }}>{tr("YECHIM", "РЕШЕНИЕ")}</span>
              {pick(lang, p.solution)}
            </p>
          </li>
        ))}
      </ol>
      <p style={{ marginTop: 28, fontSize: 14.5, color: "var(--soft)", lineHeight: 1.6 }}>
        <Mono style={{ color: "var(--accent-text)", marginRight: 10 }}>{tr("KIM UCHUN", "ДЛЯ КОГО")}</Mono>
        {pick(lang, ROLES)}
      </p>

    </Chapter>
  );
}

/* ── 02 Жамоа ──────────────────────────────────────────────────────────── */
function Team() {
  const { lang, tr } = useTr();
  return (
    <Chapter
      id="jamoa"
      num="02"
      kicker={tr("Jamoa", "Команда")}
      title={tr("Bitta muhandis va AI agentlar", "Один инженер и ИИ-агенты")}
      lead={tr(
        "Mahsulotni bitta odam quradi va yuritadi — g'oyadan serverdagi ishga tushirishgacha. Kod, testlar va review'da Claude Code agentlari yordam beradi; har bir o'zgarishni inson qabul qiladi.",
        "Продукт строит и ведёт один человек — от идеи до выкладки на сервер. В коде, тестах и ревью помогают агенты Claude Code; каждое изменение принимает человек.",
      )}
      band
    >
      {TEAM.map(m => {
        const initials = pick(lang, m.name).split(" ").map(w => w[0]).join("").slice(0, 2);
        const links = m.links.filter((l): l is { label: string; href: string } => !!l.href);
        return (
          <article key={m.name.uz} data-testid="pitch-team-member" className="grid lg:grid-cols-12" style={{ gap: "28px 64px" }}>
            <div className="lg:col-span-4" style={{ display: "flex", gap: 20, alignItems: "center", alignSelf: "start" }}>
              {/* Портрет не открылся или его ещё нет — инициалы, а не знак поломки. */}
              <span style={{ width: 112, height: 112, borderRadius: 20, flexShrink: 0, overflow: "hidden", display: "grid", placeItems: "center", background: "var(--panel)", border: "1px solid var(--rule-strong)" }}>
                <PhotoOrIcon
                  src={m.photo}
                  alt={pick(lang, m.name)}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  fallback={<span aria-hidden="true" style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-0.04em", color: "var(--accent)" }}>{initials}</span>}
                />
              </span>
              <div>
                <h3 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.1 }}>{pick(lang, m.name)}</h3>
                <p style={{ margin: "8px 0 0", fontSize: 15, fontWeight: 600 }}>{pick(lang, m.role)}</p>
                <p className="p-mono" style={{ margin: "6px 0 0", fontSize: 12, color: "var(--faint)" }}>{pick(lang, m.age)}</p>
              </div>
            </div>
            <dl className="lg:col-span-8" style={{ margin: 0, borderTop: "1px solid var(--rule-strong)" }}>
              <TeamRow term={tr("Mas'uliyat", "Зона ответственности")}>{pick(lang, m.scope)}</TeamRow>
              <TeamRow term={tr("Tajriba", "Опыт")}>{pick(lang, m.background)}</TeamRow>
              <TeamRow term={tr("Ko'nikmalar va texnologiyalar", "Навыки и технологии")}>
                <span className="p-mono" style={{ fontSize: 13, lineHeight: 1.9 }}><Chips items={m.skills} /></span>
              </TeamRow>
              <TeamRow term={tr("AI yordamida ishlab chiqish", "Разработка с ИИ")}>
                {tr("Claude Code agentlari: funksiyalar, testlar, kod review va audit.", "Агенты Claude Code: функции, тесты, ревью кода и аудиты.")}
              </TeamRow>
              <TeamRow term={tr("Havolalar", "Ссылки")}>
                <span style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px" }}>
                  {links.map(l => (
                    <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer" className="p-mono p-focus" data-testid="pitch-team-link"
                      style={{ fontSize: 13, color: "var(--accent-text)", textDecoration: "underline", textUnderlineOffset: 4, padding: "6px 0", minHeight: 32 }}>
                      {l.label} ↗
                    </a>
                  ))}
                </span>
              </TeamRow>
            </dl>
          </article>
        );
      })}
    </Chapter>
  );
}

/** Перечень через «·»: строка рвётся между пунктами, а не внутри «MySQL / drizzle» и не перед точкой. */
function Chips({ items }: { items: string[] }) {
  const last = items.length - 1;
  return <>{items.map((x, i) => <Fragment key={x}><span style={{ whiteSpace: "nowrap" }}>{x}{i < last ? " ·" : ""}</span>{i < last ? " " : ""}</Fragment>)}</>;
}

function TeamRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="p-row grid sm:grid-cols-[200px_minmax(0,1fr)]" style={{ gap: "4px 24px", padding: "16px 0" }}>
      <dt className="p-mono" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--faint)", paddingTop: 3 }}>{term}</dt>
      <dd style={{ margin: 0, fontSize: 15, lineHeight: 1.6 }}>{children}</dd>
    </div>
  );
}

/* ── 03 Почему мы ─────────────────────────────────────────────────────── */
function WhyUs() {
  const { lang, tr } = useTr();
  const numbers: Array<{ v: number; label: string; accent?: boolean }> = [
    { v: ENGINEERING.commits, label: tr(`commit, ${ENGINEERING.since} dan beri`, `коммитов с ${ENGINEERING.since}`) },
    { v: ENGINEERING.prsWeb, label: tr("birlashtirilgan PR — veb", "слитых PR — веб") },
    { v: ENGINEERING.prsMobile, label: tr("birlashtirilgan PR — mobil", "слитых PR — мобильное") },
    { v: ENGINEERING.tests, label: tr("avtomatik test — veb", "автотестов — веб"), accent: true },
  ];
  return (
    <Chapter
      id="nega-biz"
      num="03"
      kicker={tr("Nega aynan biz", "Почему именно мы")}
      title={tr("Nega bu muammoni aynan biz hal qila olamiz", "Почему эту задачу решим именно мы")}
      lead={tr(
        "Mahsulot allaqachon ishlab turibdi, soha chuqur o'rganilgan, ishlab chiqish esa AI agentlar va qat'iy testlarga tayanadi. Raqamlar ochiq repozitoriydan — har birini tekshirish mumkin.",
        "Продукт уже работает, отрасль проработана вглубь, а разработка опирается на ИИ-агентов и строгие тесты. Числа — из открытого репозитория, каждое можно проверить.",
      )}
    >
      <div data-testid="pitch-why-numbers" className="grid grid-cols-2 lg:grid-cols-4" style={{ gap: 1, background: "var(--rule-strong)", borderTop: "1px solid var(--rule-strong)", borderBottom: "1px solid var(--rule-strong)" }}>
        {numbers.map(n => (
          <div key={n.label} style={{ padding: "28px 20px 26px", background: "var(--bg)" }}>
            <div style={{ fontSize: "clamp(40px, 6vw, 76px)", fontWeight: 800, letterSpacing: "-0.045em", lineHeight: 1, color: n.accent ? "var(--accent)" : "var(--text)", fontVariantNumeric: "tabular-nums" }}>{fmt(n.v)}</div>
            <div className="p-mono" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--faint)", marginTop: 12 }}>{n.label}</div>
          </div>
        ))}
      </div>
      <ol className="grid md:grid-cols-2" style={{ listStyle: "none", padding: 0, margin: "40px 0 0", gap: "0 64px" }}>
        {WHY_US.map((w, i) => (
          <li key={w.t.ru} className="p-row" style={{ display: "grid", gridTemplateColumns: "40px minmax(0,1fr)", gap: 16, padding: "24px 0" }}>
            <span className="p-mono" style={{ fontSize: 12, color: "var(--accent-text)", paddingTop: 4 }}>{String(i + 1).padStart(2, "0")}</span>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em" }}>{pick(lang, w.t)}</div>
              <p style={{ margin: "8px 0 0", fontSize: 15, lineHeight: 1.6, color: "var(--soft)" }}>{pick(lang, w.d)}</p>
            </div>
          </li>
        ))}
      </ol>
      <p style={{ margin: "28px 0 0", fontSize: 15, lineHeight: 1.6, color: "var(--soft)", maxWidth: "70ch" }}>
        <Mono style={{ color: "var(--accent-text)", marginRight: 10 }}>{tr("ASOSCHI", "ОСНОВАТЕЛЬ")}</Mono>
        {tr(
          "Bobur Yusupov 1 yildan beri distribyutsiya sohasi muammolari ustida ishlaydi: mahsulotdagi har bir qoida — buyurtma bo'yicha qarz, yuklashni to'xtatish, 1C almashinuvi — distribyutorlar bilan ishlash jarayonida paydo bo'lgan.",
          "Бобур Юсупов год работает над задачами дистрибуции: каждое правило в продукте — долг по заказу, стоп отгрузки, обмен с 1С — появилось в работе с дистрибьюторами.",
        )}
      </p>
    </Chapter>
  );
}

/* ── 04 Дорожная карта ────────────────────────────────────────────────── */
function Roadmap() {
  const { lang, tr } = useTr();
  const current = ROADMAP.findIndex(s => s.key === CURRENT_STAGE);
  return (
    <Chapter
      id="yol-xaritasi"
      num="04"
      kicker={tr("Yo'l xaritasi", "Дорожная карта")}
      title={tr("G'oyadan ishlayotgan mahsulotgacha", "От идеи до работающего продукта")}
      lead={tr("To'rt bosqich: g'oya, prototip, MVP, ishga tushirish. Biz to'rtinchisidamiz.", "Четыре стадии: идея, прототип, MVP, запуск. Мы на четвёртой.")}
      band
    >
      <ol data-testid="pitch-roadmap" className="grid lg:grid-cols-4" style={{ listStyle: "none", padding: 0, margin: 0, gap: 0 }}>
        {ROADMAP.map((s, i) => {
          const reached = i <= current;
          const here = i === current;
          return (
            <li key={s.key} data-stage={s.key} data-current={here ? "true" : undefined} aria-current={here ? "step" : undefined}
              style={{ position: "relative" }} className="pl-9 pb-8 lg:pl-0 lg:pr-8 lg:pb-0">
              {/* линия: вертикальная на телефоне, горизонтальная на компьютере */}
              <span aria-hidden="true" className="lg:hidden" style={{ position: "absolute", left: 9, top: 22, bottom: 0, width: 2, background: i < current ? "var(--accent)" : "var(--rule-strong)", display: i === ROADMAP.length - 1 ? "none" : undefined }} />
              <span aria-hidden="true" className="hidden lg:block" style={{ position: "absolute", left: 22, right: 0, top: 9, height: 2, background: i < current ? "var(--accent)" : "var(--rule-strong)", display: i === ROADMAP.length - 1 ? "none" : undefined }} />
              <span aria-hidden="true" className="absolute left-0 top-0 lg:relative lg:block" style={{
                width: 20, height: 20, borderRadius: 99,
                background: reached ? "var(--accent)" : "var(--bg)", border: `2px solid ${reached ? "var(--accent)" : "var(--rule-strong)"}`,
                boxShadow: here ? "0 0 0 6px var(--accent-soft)" : undefined,
              }} />
              <div className="lg:mt-6">
                <div className="p-mono" style={{ fontSize: 11, color: "var(--faint)", letterSpacing: "0.08em" }}>{String(i + 1).padStart(2, "0")}</div>
                <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.025em", marginTop: 6, color: here ? "var(--accent)" : "var(--text)" }}>{pick(lang, s.name)}</div>
                {here && (
                  <div data-testid="pitch-roadmap-here" className="p-mono" style={{ display: "inline-block", marginTop: 8, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 8px", borderRadius: 6, background: "var(--accent)", color: "var(--on-accent)", fontWeight: 600 }}>
                    {tr("Biz shu yerdamiz", "Мы здесь")}
                  </div>
                )}
                <p style={{ margin: "10px 0 0", fontSize: 14.5, lineHeight: 1.6, color: "var(--soft)", maxWidth: "34ch" }}>{pick(lang, s.d)}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <div style={{ marginTop: 48 }}>
        <Mono style={{ color: "var(--accent-text)" }}>{tr("KEYINGI QADAMLAR", "СЛЕДУЮЩИЕ ШАГИ")}</Mono>
        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", borderTop: "1px solid var(--rule-strong)" }} className="grid md:grid-cols-2 md:gap-x-16">
          {NEXT_STEPS.map(s => (
            <li key={s.ru} className="p-row" style={{ padding: "14px 0", fontSize: 15, display: "flex", gap: 12 }}>
              <span aria-hidden="true" style={{ color: "var(--accent)" }}>→</span>{pick(lang, s)}
            </li>
          ))}
        </ul>
      </div>
    </Chapter>
  );
}

/* ── 05 Как внедряем ──────────────────────────────────────────────────── */
const STATE_LABEL: Record<StepState, L> = {
  done: { uz: "Bajarildi", ru: "Сделано" },
  now: { uz: "Jarayonda", ru: "В работе" },
  planned: { uz: "Rejada", ru: "В планах" },
};

function Implementation() {
  const { lang, tr } = useTr();
  return (
    <Chapter
      id="amalga-oshirish"
      num="05"
      kicker={tr("Amalga oshirish", "Как внедряем")}
      title={tr("Bosqichlar, texnologiyalar va AI", "Этапы, технологии и ИИ")}
      lead={tr(
        "Yechim bosqichma-bosqich quriladi: avval dala, keyin ofis va ombor, keyin direktor va integratsiyalar. Har bir bosqich ishlab turgan mahsulotda tekshiriladi.",
        "Решение строится по этапам: сначала поле, потом офис и склад, потом директор и интеграции. Каждый этап проверяется на работающем продукте.",
      )}
    >
      <ol data-testid="pitch-stages" style={{ listStyle: "none", padding: 0, margin: 0, borderTop: "1px solid var(--rule-strong)" }}>
        {STAGES.map((s, i) => (
          <li key={s.name.ru} className="p-row grid grid-cols-[40px_minmax(0,1fr)] md:grid-cols-[40px_220px_minmax(0,1fr)_120px]" style={{ gap: "6px 16px", padding: "20px 0", alignItems: "baseline" }}>
            <span className="p-mono" style={{ fontSize: 12, color: "var(--faint)" }}>{String(i + 1).padStart(2, "0")}</span>
            <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.02em" }}>{pick(lang, s.name)}</span>
            <span className="col-start-2 md:col-start-auto" style={{ fontSize: 15, lineHeight: 1.6, color: "var(--soft)" }}>{pick(lang, s.d)}</span>
            <span className="col-start-2 md:col-start-auto p-mono" data-state={s.state} style={{
              fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", justifySelf: "start",
              padding: "4px 8px", borderRadius: 6,
              color: s.state === "done" ? "var(--teal)" : s.state === "now" ? "var(--accent-text)" : "var(--faint)",
              border: `1px solid ${s.state === "done" ? "var(--teal)" : s.state === "now" ? "var(--accent)" : "var(--rule-strong)"}`,
            }}>{pick(lang, STATE_LABEL[s.state])}</span>
          </li>
        ))}
      </ol>

      <div className="grid lg:grid-cols-12" style={{ gap: "48px 64px", marginTop: 64 }}>
        <div className="lg:col-span-5">
          <Mono style={{ color: "var(--accent-text)" }}>{tr("TEXNOLOGIYALAR", "ТЕХНОЛОГИИ")}</Mono>
          <dl data-testid="pitch-tech" style={{ margin: "12px 0 0", borderTop: "1px solid var(--rule-strong)" }}>
            {TECH.map(t => (
              <div key={t.items} className="p-row" style={{ display: "grid", gridTemplateColumns: "130px minmax(0,1fr)", gap: 16, padding: "14px 0" }}>
                <dt style={{ fontWeight: 700, fontSize: 14.5 }}>{pick(lang, t.area)}</dt>
                <dd className="p-mono" style={{ margin: 0, fontSize: 13, color: "var(--soft)", lineHeight: 1.6 }}><Chips items={t.items.split(" · ")} /></dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="lg:col-span-7" data-testid="pitch-ai">
          <Mono style={{ color: "var(--accent-text)" }}>{tr("AI VOSITALARI VA YECHIMLARI", "ИИ-ИНСТРУМЕНТЫ И РЕШЕНИЯ")}</Mono>
          <AiList title={tr("Hozir ishlatilmoqda", "Используется сейчас")} items={AI_NOW} />
          <AiList title={tr("Rejada — AI funksiyalari", "В планах — функции ИИ")} items={AI_PLANNED} planned />
        </div>
      </div>
    </Chapter>
  );
}

function AiList({ title, items, planned = false }: { title: string; items: Array<{ t: L; d: L }>; planned?: boolean }) {
  const { lang } = useLang();
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: planned ? "var(--faint)" : "var(--text)", padding: "10px 0", borderTop: "1px solid var(--rule-strong)" }}>{title}</div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {items.map(it => (
          <li key={it.t.ru} className="p-row" style={{ padding: "14px 0", display: "grid", gridTemplateColumns: "14px minmax(0,1fr)", gap: 12 }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, marginTop: 8, background: planned ? "transparent" : "var(--teal)", border: planned ? "1px solid var(--faint)" : undefined }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15.5 }}>{pick(lang, it.t)}</div>
              <p style={{ margin: "4px 0 0", fontSize: 14.5, lineHeight: 1.6, color: "var(--soft)" }}>{pick(lang, it.d)}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── 06 Демо — отдельная страница /demo ───────────────────────────────── */
function DemoTeaser() {
  const { tr } = useTr();
  const { theme } = useTheme();
  return (
    <Chapter
      id="demo"
      num="06"
      kicker="Demo"
      title={tr("Video va ishlaydigan prototip", "Ролик и работающий прототип")}
      lead={tr(
        "Demo sahifasida: 2 daqiqa 44 soniyalik video, uning tavsifi va namunaviy tashkilotga kirish — direktor, agent yoki supervayzer sifatida, parolsiz.",
        "На странице демо: ролик на 2:44, его описание и вход в демо-организацию — директором, агентом или супервайзером, без пароля.",
      )}
      band
    >
      <div className="grid lg:grid-cols-12" style={{ gap: 40, alignItems: "center" }}>
        <div className="lg:col-span-4">
          <ol style={{ listStyle: "none", padding: 0, margin: "0 0 28px", borderTop: "1px solid var(--rule-strong)" }}>
            {[
              ["6.1", tr("Demo video", "Демо-ролик")],
              ["6.2", tr("Video tavsifi", "Описание ролика")],
              ["6.3", tr("Ishlaydigan prototipga kirish", "Вход в работающий прототип")],
            ].map(([n, t]) => (
              <li key={n} className="p-row" style={{ display: "flex", gap: 16, padding: "14px 0", fontSize: 15.5, fontWeight: 600 }}>
                <span className="p-mono" style={{ fontSize: 12, color: "var(--accent-text)", paddingTop: 3, fontWeight: 400 }}>{n}</span>{t}
              </li>
            ))}
          </ol>
          <ArrowLink to="/demo" solid testId="pitch-demo-link">{tr("Demo sahifasi", "Страница демо")}</ArrowLink>
        </div>
        <div className="lg:col-span-8">
          <Browser shot="orders" content tone={theme === "dark" ? "dark" : "paper"} aspect={1174 / 560} alt={tr("Buyurtmalar", "Заказы")} />
        </div>
      </div>
    </Chapter>
  );
}
