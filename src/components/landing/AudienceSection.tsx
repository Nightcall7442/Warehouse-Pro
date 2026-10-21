import { Check, X } from "lucide-react";
import { useTranslate } from "@/i18n";
import { LX, MONO } from "./landing-tokens";
import { SectionHead } from "./landing-shared";
import { AUDIENCE_FIT, AUDIENCE_NOT_FIT } from "./site-content";

/* ═══════════════════════════════════════════════════════════════════════════
   01 / ДЛЯ КОГО — сразу за первым экраном.

   ── Что было ────────────────────────────────────────────────────────────────

   Страница говорила «для дистрибьюторов» одним словом в подвале. Директор,
   у которого пять агентов и двести магазинов в долг, и директор аптечной
   сети с маркировкой видели одно и то же — и оба должны были дочитать до
   тарифов, чтобы понять, про них ли это. Второй узнавал, что нет, уже после
   регистрации.

   ── Что стало ───────────────────────────────────────────────────────────────

   Четыре признака, по которым человек узнаёт себя за секунду: сколько людей
   в поле, сколько магазинов, продаёт ли в долг, сколько складов. И рядом —
   кому не подойдём, словами «чего в программе нет»: так честнее, и тот, кому
   не подходит, не тратит две недели. Тексты — в site-content.ts.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function AudienceSection() {
  const tr = useTranslate();
  return (
    <section id="audience" className="py-16 md:py-24 scroll-mt-16" style={{ background: LX.paper, borderTop: `1px solid ${LX.rule}` }} data-testid="landing-audience">
      <div className="max-w-[1240px] mx-auto px-6 lg:pl-[136px]">
        <SectionHead
          index="01"
          label={tr("Для кого", "Kim uchun")}
          title={tr("Для дистрибьютора, у которого агенты в поле", "Agentlari dalada ishlaydigan distribyutor uchun")}
          lead={tr(
            "Узнаёте себя в трёх строках из четырёх слева — программа сделана под вас. Справа — то, чего в ней нет: лучше сказать до покупки.",
            "Chapdagi to'rt qatordan uchtasida o'zingizni tanisangiz — dastur siz uchun qilingan. O'ngda — unda yo'q narsalar: buni sotib olishdan oldin aytgan ma'qul.",
          )}
        />

        <div className="mt-12 grid lg:grid-cols-12 gap-x-16 gap-y-12">
          <div className="lg:col-span-7">
            <h3 className="text-[12px] uppercase mb-2" style={{ ...MONO, fontWeight: 500, letterSpacing: "0.08em", color: LX.brassText }}>
              {tr("Подойдём, если", "Mos kelamiz, agar")}
            </h3>
            <ul style={{ borderTop: `2px solid ${LX.ink}` }}>
              {AUDIENCE_FIT.map(a => (
                <li
                  key={a.key.ru}
                  data-testid="audience-fit"
                  className="grid grid-cols-[88px_1fr] sm:grid-cols-[112px_1fr] gap-x-4 py-5"
                  style={{ borderBottom: `1px solid ${LX.rule}` }}
                >
                  <span className="text-[24px] sm:text-[28px] leading-none pt-0.5" style={{ ...MONO, letterSpacing: "-0.02em", color: LX.ink }}>
                    {tr(a.key.ru, a.key.uz)}
                  </span>
                  <span>
                    <span className="flex items-center gap-2 text-[17px] font-semibold" style={{ color: LX.ink }}>
                      <Check size={16} aria-hidden="true" style={{ color: LX.good }} />
                      {tr(a.t.ru, a.t.uz)}
                    </span>
                    <p className="mt-1.5 text-[15px] leading-relaxed" style={{ color: LX.inkSoft }}>{tr(a.d.ru, a.d.uz)}</p>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="lg:col-span-5">
            <h3 className="text-[12px] uppercase mb-2" style={{ ...MONO, fontWeight: 500, letterSpacing: "0.08em", color: LX.bad }}>
              {tr("Не подойдём, если нужно", "Mos kelmaymiz, agar kerak bo'lsa")}
            </h3>
            <ul style={{ borderTop: `2px solid ${LX.ruleStrong}` }}>
              {AUDIENCE_NOT_FIT.map(a => (
                <li key={a.t.ru} data-testid="audience-not-fit" className="py-5" style={{ borderBottom: `1px solid ${LX.rule}` }}>
                  <span className="flex items-center gap-2 text-[16px] font-semibold" style={{ color: LX.ink }}>
                    <X size={16} aria-hidden="true" style={{ color: LX.bad }} />
                    {tr(a.t.ru, a.t.uz)}
                  </span>
                  <p className="mt-1.5 text-[15px] leading-relaxed" style={{ color: LX.inkSoft }}>{tr(a.d.ru, a.d.uz)}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
