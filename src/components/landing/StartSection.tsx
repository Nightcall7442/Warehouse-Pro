import { ArrowRight } from "lucide-react";
import { useTranslate } from "@/i18n";
import { LX, MONO } from "./landing-tokens";
import { SectionHead, BtnInk } from "./landing-shared";
import LeadForm from "./LeadForm";
import { START_STEPS, PILOT } from "./site-content";

/* ═══════════════════════════════════════════════════════════════════════════
   14 / КАК НАЧАТЬ — сразу за тарифами.

   ── Что было ────────────────────────────────────────────────────────────────

   После цены шёл FAQ, и вопрос «а что дальше, если я нажму» оставался без
   ответа: сколько это займёт, кто переносит товары, что будет на
   пятнадцатый день. Шаги перехода стояли только на сравнении (/compare), и
   там был свой «пилот с двумя-тремя агентами».

   ── Что стало ───────────────────────────────────────────────────────────────

   Пять шагов со временем на каждый — от регистрации до решения — одним
   списком с /compare (site-content.START_STEPS). Для крупного дистрибьютора
   (от PILOT_MIN_AGENTS агентов) — пилот: одна команда, две недели внутри
   бесплатного периода и три мерила из самой программы. Заявка на пилот
   уходит той же формой с источником «pilot» — в разборе заявок её видно
   отдельно.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function StartSection() {
  const tr = useTranslate();
  return (
    <section id="start" className="py-16 md:py-24 scroll-mt-16" style={{ background: LX.paper }} data-testid="landing-start">
      <div className="max-w-[1240px] mx-auto px-6 lg:pl-[136px]">
        <SectionHead
          index="14"
          label={tr("Как начать", "Qanday boshlash")}
          title={tr("От регистрации до первого рейса", "Ro'yxatdan o'tishdan birinchi reysgacha")}
        />

        <ol className="mt-12 grid sm:grid-cols-2 lg:grid-cols-5 gap-x-6 gap-y-8">
          {START_STEPS.map((s, i) => (
            <li key={s.t.ru} data-testid="start-step" className="pt-4" style={{ borderTop: `2px solid ${LX.brass}` }}>
              <div className="text-[12px] uppercase" style={{ ...MONO, fontWeight: 500, letterSpacing: "0.08em", color: LX.brassText }}>
                {String(i + 1).padStart(2, "0")} · <span data-testid="start-step-time">{tr(s.time.ru, s.time.uz)}</span>
              </div>
              <h3 className="mt-2 text-[18px] font-bold" style={{ color: LX.ink }}>{tr(s.t.ru, s.t.uz)}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed" style={{ color: LX.inkSoft }}>{tr(s.d.ru, s.d.uz)}</p>
            </li>
          ))}
        </ol>

        <div className="mt-10">
          <BtnInk href="/register">
            {tr("Начать бесплатно", "Bepul boshlash")}
            <ArrowRight size={15} />
          </BtnInk>
        </div>

        {/* Пилот — для тех, кто не переведёт сорок агентов за один день. */}
        <div
          data-testid="start-pilot"
          className="mt-16 rounded-xl p-6 md:p-10 grid lg:grid-cols-12 gap-x-12 gap-y-8"
          style={{ background: LX.verso, border: `1px solid ${LX.ruleStrong}` }}
        >
          <div className="lg:col-span-7">
            <h3 className="text-[22px] md:text-[26px] font-extrabold leading-tight" style={{ color: LX.ink, letterSpacing: "-0.02em" }}>
              {tr(PILOT.title.ru, PILOT.title.uz)}
            </h3>
            <p className="mt-3 text-[16px] leading-relaxed" style={{ color: LX.inkSoft }}>{tr(PILOT.lead.ru, PILOT.lead.uz)}</p>
            <dl className="mt-5" style={{ borderTop: `1px solid ${LX.ruleStrong}` }}>
              {PILOT.criteria.map(c => (
                <div key={c.t.ru} data-testid="pilot-criterion" className="grid grid-cols-[112px_1fr] gap-x-4 py-3" style={{ borderBottom: `1px solid ${LX.ruleStrong}` }}>
                  <dt className="text-[15px] font-semibold" style={{ color: LX.ink }}>{tr(c.t.ru, c.t.uz)}</dt>
                  <dd className="text-[15px] leading-snug" style={{ color: LX.inkSoft }}>{tr(c.d.ru, c.d.uz)}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="lg:col-span-5">
            <p className="text-[15px] mb-3" style={{ color: LX.inkSoft }}>
              {tr("Оставьте номер — согласуем команду и даты пилота.", "Raqamingizni qoldiring — sinov jamoasi va sanalarini kelishib olamiz.")}
            </p>
            <LeadForm source="pilot" />
          </div>
        </div>
      </div>
    </section>
  );
}
