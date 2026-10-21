import { useLang } from "@/i18n";
import { PitchShell, Chapter, Mono, ArrowLink } from "@/components/pitch/pitch-ui";
import { pick, GAPS, type L } from "@/components/pitch/pitch-content";
import { AREAS, QUESTIONS, PLAYERS, STEPS, SOURCES, CHECKED_AT, type Area, type SourceKey } from "@/components/compare/compare-content";

/* ═══════════════════════════════════════════════════════════════════════════
   /compare — «Выбираете систему для дистрибуции? Сравните по делу».

   Для дистрибьютора, который выбирает между нами, Sales Doctor, Smartup и
   привычными 1С с Excel. Правило содержания — в compare-content.ts: о себе
   только то, что работает, о других — только публичное со ссылкой и датой,
   без «у них нет». Оболочка и язык дизайна — страниц Pitch Day (линованные
   реестры, моно-номера, латунь), но как страница сайта: по-русски по
   умолчанию, знак ведёт на главную.
   ═══════════════════════════════════════════════════════════════════════════ */

const NAV: Array<{ href: string; label: L }> = [
  { href: "#bolimlar", label: { ru: "По разделам", uz: "Bo'limlar" } },
  { href: "#savollar", label: { ru: "Цена и запуск", uz: "Narx va ishga tushirish" } },
  { href: "#bozor", label: { ru: "Кто на рынке", uz: "Bozorda kim bor" } },
  { href: "#otish", label: { ru: "Как перейти", uz: "Qanday o'tish" } },
];

function useTr() {
  const { lang } = useLang();
  return { lang, tr: (uz: string, ru: string) => (lang === "uz" ? uz : ru) };
}

export default function Compare() {
  return (
    <PitchShell
      lang="ru"
      site
      title={{ ru: "Warehouse Pro, Sales Doctor, Smartup — сравнение систем для дистрибуции", uz: "Warehouse Pro, Sales Doctor, Smartup — distribyutsiya tizimlarini taqqoslash" }}
      nav={NAV}
    >
      <Hero />
      <Areas />
      <Questions />
      <Players />
      <Gaps />
      <Steps />
    </PitchShell>
  );
}

function Hero() {
  const { lang, tr } = useTr();
  return (
    <section data-testid="compare-hero" style={{ position: "relative", paddingTop: 40, paddingBottom: 72 }}>
      <div className="p-wrap">
        <p className="p-mono p-kicker p-rise" style={{ margin: 0 }}>
          {tr("Taqqoslash", "Сравнение")} · {CHECKED_AT}
        </p>
        <h1 className="p-h1 p-rise" style={{ margin: "22px 0 0", maxWidth: "20ch", animationDelay: "60ms", textWrap: "balance" }}>
          {tr("Distribyutsiya uchun tizim tanlayapsizmi?", "Выбираете систему для дистрибуции?")}{" "}
          <span style={{ color: "var(--accent)" }}>{tr("Ish bo'yicha solishtiring", "Сравните по делу")}</span>
        </h1>
        <div className="grid lg:grid-cols-12 p-rise" style={{ gap: "24px 64px", marginTop: 28, animationDelay: "120ms" }}>
          <p className="p-lead lg:col-span-7" style={{ margin: 0, maxWidth: "60ch" }}>
            {tr(
              "Bo'limma-bo'lim: bizda nima ishlaydi va Sales Doctor bilan Smartup o'zlari haqida ochiq nima aytgan — havola va sana bilan. Boshqalarda nima yo'qligini aytmaymiz: ularning tizimini ichidan ko'rmaganmiz. Bizda nima yo'qligi — ochiq yozilgan.",
              "Раздел за разделом: что работает у нас и что Sales Doctor и Smartup публично говорят о себе — со ссылкой и датой. Чего нет у других, рассказывать не будем: их систем изнутри мы не видели. Чего нет у нас — написано прямо.",
            )}
          </p>
          <div className="lg:col-span-5 p-cta" style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start", alignContent: "flex-start" }}>
            <ArrowLink to="/register" solid testId="compare-cta-register">{tr("14 kun bepul sinab ko'rish", "Попробовать 14 дней бесплатно")}</ArrowLink>
            <ArrowLink to={`/demo?lang=${lang}`} testId="compare-cta-demo">{tr("Ro'yxatdan o'tmasdan demo", "Демо без регистрации")}</ArrowLink>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── 01 Раздел за разделом ─────────────────────────────────────────────── */
const COLS = "lg:grid-cols-[1fr_1.7fr_1.2fr_1.2fr]";

function ClaimCell({ claim, name }: { claim: Area["salesDoctor"]; name: string }) {
  const { lang, tr } = useTr();
  return (
    <div data-testid="compare-claim" data-claimed={claim ? "yes" : "no"}>
      <Mono style={{ display: "block", marginBottom: 4 }}><span className="lg:hidden">{name}</span></Mono>
      {claim ? (
        <p style={{ margin: 0, color: "var(--soft)", fontSize: 15, lineHeight: 1.55 }}>
          {pick(lang, claim.text)}{" "}
          <a href={`#manba-${claim.source}`} className="p-mono p-focus" style={{ fontSize: 12, color: "var(--faint)", whiteSpace: "nowrap" }}>
            [{SOURCES[claim.source].label.split(",")[0]}]
          </a>
        </p>
      ) : (
        <p style={{ margin: 0, color: "var(--faint)", fontSize: 15, lineHeight: 1.55 }}>{tr("Kompaniyadan aniqlang", "Уточняйте у компании")}</p>
      )}
    </div>
  );
}

function Areas() {
  const { lang, tr } = useTr();
  return (
    <Chapter
      id="bolimlar"
      num="01"
      kicker={tr("Bo'limma-bo'lim", "Раздел за разделом")}
      title={tr("Yuklash varaqasidan hisobotgacha", "От погрузочного листа до отчёта")}
      lead={tr(
        "«E'lon qilingan» — kompaniya yoki matbuot mahsulotni ochiq shunday tasvirlaydi; manbalar pastda. «Aniqlang» — bu bo'lim haqida ochiq hech narsa topmadik, demak buni kompaniyaning o'zidan so'rang.",
        "«Заявлено» — так компания или пресса описывают продукт публично; источники ниже. «Уточняйте» — об этом разделе публично мы ничего не нашли, спросите у самой компании.",
      )}
      band
      testId="compare-areas"
    >
      <div role="table" aria-label={tr("Bo'limlar bo'yicha taqqoslash", "Сравнение по разделам")} style={{ borderTop: "1px solid var(--rule)" }}>
        <div role="row" className={`hidden lg:grid ${COLS}`} style={{ gap: 24, padding: "14px 0", borderBottom: "1px solid var(--rule-strong)" }}>
          <Mono>{tr("Bo'lim", "Раздел")}</Mono>
          <Mono style={{ color: "var(--accent)" }}>Warehouse Pro</Mono>
          <Mono>Sales Doctor</Mono>
          <Mono>Smartup</Mono>
        </div>
        {AREAS.map(a => (
          <div key={a.area.ru} role="row" data-testid="compare-area" className={`p-row grid ${COLS}`} style={{ gap: "10px 24px", padding: "20px 0" }}>
            <div role="rowheader" style={{ fontWeight: 800, fontSize: 16.5, lineHeight: 1.35 }}>{pick(lang, a.area)}</div>
            <div role="cell" data-testid="compare-ours" data-gap={a.oursGap ? "yes" : "no"}>
              <Mono style={{ display: "block", marginBottom: 4, color: "var(--accent)" }}><span className="lg:hidden">Warehouse Pro</span></Mono>
              <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: a.oursGap ? "var(--faint)" : undefined }}>{pick(lang, a.ours)}</p>
            </div>
            <div role="cell"><ClaimCell claim={a.salesDoctor} name="Sales Doctor" /></div>
            <div role="cell"><ClaimCell claim={a.smartup} name="Smartup" /></div>
          </div>
        ))}
      </div>
    </Chapter>
  );
}

/* ── 02 Цена и запуск ──────────────────────────────────────────────────── */
function Questions() {
  const { lang, tr } = useTr();
  return (
    <Chapter
      id="savollar"
      num="02"
      kicker={tr("Narx va ishga tushirish", "Цена и запуск")}
      title={tr("Bu savollarni istalgan tizimga bering", "Эти вопросы задайте любой системе")}
      lead={tr("Bizning javoblar — o'ngda. Boshqalarning javobini yoniga qo'ying.", "Наши ответы — справа. Положите рядом ответы других.")}
      testId="compare-questions"
    >
      <ol style={{ listStyle: "none", margin: 0, padding: 0, borderTop: "1px solid var(--rule)" }}>
        {QUESTIONS.map((x, i) => (
          <li key={x.q.ru} className="p-row grid lg:grid-cols-12" data-testid="compare-question" style={{ gap: "8px 32px", padding: "22px 0" }}>
            <div className="lg:col-span-5" style={{ display: "flex", gap: 16, alignItems: "baseline" }}>
              <Mono style={{ minWidth: 24 }}>{String(i + 1).padStart(2, "0")}</Mono>
              <span style={{ fontWeight: 700, fontSize: 17, lineHeight: 1.35 }}>{pick(lang, x.q)}</span>
            </div>
            <p className="lg:col-span-7" data-testid="compare-answer" style={{ margin: 0, color: "var(--soft)", fontSize: 15.5, lineHeight: 1.6 }}>
              {pick(lang, x.a)}
            </p>
          </li>
        ))}
      </ol>
    </Chapter>
  );
}

/* ── 03 Кто на рынке ───────────────────────────────────────────────────── */
function SourceLink({ k }: { k: SourceKey }) {
  const { lang, tr } = useTr();
  const s = SOURCES[k];
  return (
    <a id={`manba-${k}`} href={s.href} target="_blank" rel="noreferrer noopener" data-testid="compare-source" className="p-mono p-focus" style={{ fontSize: 12, color: "var(--faint)", letterSpacing: "0.04em", scrollMarginTop: 96 }}>
      {tr("Manba", "Источник")}: {s.label}{s.note ? ` · ${pick(lang, s.note)}` : ""}
    </a>
  );
}

function Players() {
  const { lang, tr } = useTr();
  return (
    <Chapter
      id="bozor"
      num="03"
      kicker={tr("Bozorda kim bor", "Кто на рынке")}
      title={tr("Yana kimlar bor", "Кто ещё есть на рынке")}
      lead={tr(
        `Faqat ochiq ma'lumotlar (${CHECKED_AT} da tekshirilgan). Biror narsa eskirgan yoki noaniq bo'lsa — yozing, o'sha kuni tuzatamiz.`,
        `Только публичные сведения (сверено ${CHECKED_AT}). Если что-то устарело или неточно — напишите, исправим в тот же день.`,
      )}
      band
      testId="compare-players"
    >
      <div className="grid md:grid-cols-3" style={{ gap: 20 }}>
        {PLAYERS.map(p => (
          <article key={p.name} data-testid="compare-player" style={{ border: "1px solid var(--rule-strong)", borderRadius: 16, padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 19, fontWeight: 800, letterSpacing: "-0.01em" }}>{p.name}</h3>
            <p style={{ margin: 0, color: "var(--soft)", fontSize: 16, lineHeight: 1.55 }}>{pick(lang, p.what)}</p>
            <ul style={{ margin: 0, paddingLeft: 18, color: "var(--soft)", fontSize: 15, lineHeight: 1.55, display: "grid", gap: 6 }}>
              {p.facts.map(f => <li key={f.ru}>{pick(lang, f)}</li>)}
            </ul>
            {p.sources.length > 0 && (
              <div style={{ marginTop: "auto", display: "grid", gap: 4 }}>
                {p.sources.map(k => <SourceLink key={k} k={k} />)}
              </div>
            )}
          </article>
        ))}
      </div>
    </Chapter>
  );
}

/* ── 04 Чего у нас пока нет ────────────────────────────────────────────── */
function Gaps() {
  const { lang, tr } = useTr();
  return (
    <Chapter
      id="yoq"
      num="04"
      kicker={tr("Ochiq aytamiz", "Честно")}
      title={tr("Bizda hozircha nima yo'q", "Чего у нас пока нет")}
      lead={tr(
        "Bular boshqalarda ochiq ko'rsatilgan, bizda — rejada. Agar sizga hozir kerak bo'lsa — buni sotib olishdan oldin aytamiz.",
        "Это у других показано публично, у нас — в планах. Если вам это нужно уже сейчас, скажем об этом до покупки.",
      )}
      testId="compare-gaps"
    >
      <ul style={{ listStyle: "none", margin: 0, padding: 0, borderTop: "1px solid var(--rule)" }}>
        {GAPS.map(g => (
          <li key={g.ru} className="p-row" data-testid="compare-gap" style={{ padding: "18px 0", fontSize: 16.5, lineHeight: 1.5 }}>
            {pick(lang, g)}
          </li>
        ))}
      </ul>
    </Chapter>
  );
}

/* ── 05 Как перейти ────────────────────────────────────────────────────── */
function Steps() {
  const { lang, tr } = useTr();
  return (
    <Chapter id="otish" num="05" kicker={tr("O'tish", "Переход")} title={tr("Qanday o'tish mumkin", "Как перейти")} band testId="compare-steps">
      <ol className="grid sm:grid-cols-2 lg:grid-cols-5" style={{ listStyle: "none", margin: 0, padding: 0, gap: 20 }}>
        {STEPS.map((s, i) => (
          <li key={s.t.ru} data-testid="compare-step" style={{ borderTop: "2px solid var(--accent)", paddingTop: 16 }}>
            {/* Номер и время шага — те же, что в «Как начать» на лендинге (site-content). */}
            <Mono>{String(i + 1).padStart(2, "0")} · <span data-testid="compare-step-time">{pick(lang, s.time)}</span></Mono>
            <div style={{ fontWeight: 800, fontSize: 18, marginTop: 8 }}>{pick(lang, s.t)}</div>
            <p style={{ margin: "6px 0 0", color: "var(--soft)", fontSize: 15, lineHeight: 1.55 }}>{pick(lang, s.d)}</p>
          </li>
        ))}
      </ol>
      <div className="p-cta" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 40 }}>
        <ArrowLink to="/register" solid>{tr("14 kun bepul sinab ko'rish", "Попробовать 14 дней бесплатно")}</ArrowLink>
        {/* Демо — на языке этой страницы: у /demo по умолчанию узбекский. */}
        <ArrowLink to={`/demo?lang=${lang}`}>{tr("Ro'yxatdan o'tmasdan demo", "Демо без регистрации")}</ArrowLink>
      </div>
    </Chapter>
  );
}
