import { useTranslate } from "@/i18n";
import { LX, MONO } from "./landing-tokens";
import { SectionHead } from "./landing-shared";
import { PROMISES } from "./site-content";

/* ═══════════════════════════════════════════════════════════════════════════
   12 / ОБЕЩАНИЯ, КОТОРЫЕ МОЖНО ПРОВЕРИТЬ — перед тарифами.

   ── Зачем ───────────────────────────────────────────────────────────────────

   Перед ценой человек решает, верить ли всему, что прочитал выше. «Надёжно»
   и «удобно» ему ничего не дают: так пишут все. Здесь пять вещей, которые
   программа делает всегда, и к каждой — как убедиться самому за пробные
   две недели, своими руками и на своих данных. Обещание без способа
   проверки сюда не попадает; за каждым стоит код (см. site-content.ts).

   Сроков ответа поддержки и «гарантий» здесь нет намеренно: их не держит
   код, и проверить их за две недели нельзя.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function PromisesSection() {
  const tr = useTranslate();
  return (
    <section id="promises" className="py-16 md:py-24 scroll-mt-16" style={{ background: LX.paper, borderTop: `1px solid ${LX.rule}` }} data-testid="landing-promises">
      <div className="max-w-[1240px] mx-auto px-6 lg:pl-[136px]">
        <SectionHead
          index="12"
          label={tr("Обещания", "Va'dalar")}
          title={tr("Обещания, которые можно проверить", "Tekshirsa bo'ladigan va'dalar")}
          lead={tr(
            "Не «надёжно и удобно», а пять вещей, которые программа делает всегда. К каждой — как убедиться самому за 14 бесплатных дней.",
            "«Ishonchli va qulay» emas, balki dastur doim qiladigan beshta narsa. Har biriga — 14 bepul kunda o'zingiz qanday ishonch hosil qilishingiz.",
          )}
        />
        <ol className="mt-12" style={{ borderTop: `2px solid ${LX.ink}` }}>
          {PROMISES.map((p, i) => (
            <li
              key={p.key}
              data-testid="promise"
              data-promise={p.key}
              className="grid md:grid-cols-12 gap-x-10 gap-y-4 py-7"
              style={{ borderBottom: `1px solid ${LX.rule}` }}
            >
              <div className="md:col-span-6 grid grid-cols-[40px_1fr] gap-x-3">
                <span className="text-[14px] pt-1" style={{ ...MONO, color: LX.brassText }}>{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="text-[19px] font-bold leading-snug" style={{ color: LX.ink, letterSpacing: "-0.01em" }}>{tr(p.t.ru, p.t.uz)}</h3>
                  <p className="mt-2 text-[16px] leading-relaxed" style={{ color: LX.inkSoft }}>{tr(p.d.ru, p.d.uz)}</p>
                </div>
              </div>
              <div
                data-testid="promise-check"
                className="md:col-span-6 pl-4 md:pl-6 ml-[52px] md:ml-0 self-start"
                style={{ borderLeft: `2px solid ${LX.brass}` }}
              >
                <div className="text-[12px] uppercase" style={{ ...MONO, fontWeight: 500, letterSpacing: "0.08em", color: LX.brassText }}>
                  {tr("Как проверить за 14 дней", "14 kunda qanday tekshirish")}
                </div>
                <p className="mt-1.5 text-[15px] leading-relaxed" style={{ color: LX.ink }}>{tr(p.check.ru, p.check.uz)}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
