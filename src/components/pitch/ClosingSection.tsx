import { useLang } from "@/i18n";
import { FIELD_PRICE_UZS, formatSum } from "@contracts/pricing";
import { CONTACT, tgLink } from "@/components/landing/landing-tokens";
import { Chapter, ArrowLink } from "./pitch-ui";
import { pick, PROBLEMS, TRACTION, HIRING, NEXT_STEPS, fmtNum, mrrMln } from "./pitch-content";

/* ── 09 Итог ───────────────────────────────────────────────────────────────
   Страница кончалась справочником API — кодами ошибок и примером JSON.
   Последнее, что видел член жюри, было «429 Daqiqalik chegara», а не то,
   ради чего он читал: что за продукт, работает ли, сколько стоит, что
   дальше и куда писать. Здесь — то же самое в пяти строках, из тех же
   источников, что и главы выше (PROBLEMS, TRACTION, contracts/pricing,
   HIRING, NEXT_STEPS), и кнопки. API остаётся приложением после итога.

   Отдельным файлом в components/pitch, а не в pages/Pitch.tsx: здесь цена
   самой платформы в сумах, и страж printing-is-usable пропускает её только
   из components/pitch — там же, где «Рынок» (MarketSection). */
export default function ClosingSection() {
  const { lang } = useLang();
  const tr = (uz: string, ru: string) => (lang === "uz" ? uz : ru);
  const tg = tgLink();
  const rows: Array<{ term: string; text: string }> = [
    {
      term: tr("Muammo", "Проблема"),
      text: tr(
        `Distribyutorning kuni qog'oz, Telegram, Excel, qarz daftari va 1C orasida bo'lingan: ${PROBLEMS.length} ta muammo — har biri yo'qolgan pul.`,
        `День дистрибьютора разорван между бумагой, Telegram, Excel, тетрадью долгов и 1С: ${PROBLEMS.length} задач, каждая — потерянные деньги.`,
      ),
    },
    {
      term: tr("Yechim", "Решение"),
      text: tr(
        "Bitta tizim: agentning oflayn ilovasi, ofis, ombor, kuryer, direktor hisobotlari va 1C bilan almashinuv.",
        "Одна система: офлайн-приложение агента, офис, склад, курьер, отчёты директора и обмен с 1С.",
      ),
    },
    {
      term: tr("Natija", "Результат"),
      text: tr(
        `${TRACTION.paying} ta pullik distribyutor, ${mrrMln()} mln so'm oylik tushum, 30 kunda ${fmtNum(TRACTION.deliveredOrders30d)} ta yetkazilgan buyurtma — ${TRACTION.asOf} holatiga.`,
        `${TRACTION.paying} платящих дистрибьютора, ${mrrMln()} млн сум выручки в месяц, ${fmtNum(TRACTION.deliveredOrders30d)} доставленных заказов за 30 дней — на ${TRACTION.asOf}.`,
      ),
    },
    {
      term: tr("Biznes model", "Бизнес-модель"),
      text: tr(
        `${formatSum(FIELD_PRICE_UZS)} so'm dala xodimi uchun oyiga; ofis, ombor va rahbariyat — bepul.`,
        `${formatSum(FIELD_PRICE_UZS)} сум за сотрудника в поле в месяц; офис, склад и руководство — бесплатно.`,
      ),
    },
    {
      term: tr("Keyingi qadam", "Следующий шаг"),
      text: [
        `${tr("Yollash", "Найм")}: ${HIRING.map(h => pick(lang, h.role).toLowerCase()).join(", ")}`,
        pick(lang, NEXT_STEPS[0]),
        pick(lang, NEXT_STEPS[1]),
      ].join(" · "),
    },
  ];
  return (
    <Chapter
      id="xulosa"
      num="09"
      kicker={tr("Xulosa", "Итог")}
      title={tr("Bir qarashda", "Коротко")}
      lead={tr(
        "Butun sahifa — besh qatorda. Har bir raqam yuqoridagi boblardan olingan.",
        "Вся страница — в пяти строках. Каждое число — из глав выше.",
      )}
      band
    >
      <dl data-testid="pitch-closing" style={{ margin: 0, borderTop: "1px solid var(--rule-strong)" }}>
        {rows.map(r => (
          <div key={r.term} className="p-row grid md:grid-cols-[minmax(140px,2fr)_10fr]" style={{ gap: "6px 32px", padding: "20px 0" }}>
            <dt className="p-mono" style={{ fontSize: 11.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--accent-text)", paddingTop: 4 }}>{r.term}</dt>
            <dd style={{ margin: 0, fontSize: 17, lineHeight: 1.55, fontWeight: 600 }}>{r.text}</dd>
          </div>
        ))}
      </dl>
      <div className="p-cta" style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 36, alignItems: "center" }}>
        <ArrowLink to="/demo" solid testId="pitch-closing-demo">{tr("Demo va prototip", "Демо и прототип")}</ArrowLink>
        <ArrowLink to="/register" testId="pitch-closing-trial">{tr("14 kun bepul sinash", "14 дней бесплатно")}</ArrowLink>
        {/* Почта — та же, что в подвале сайта (CONTACT): одна точка правды. */}
        {CONTACT.email && (
          <a href={`mailto:${CONTACT.email}`} data-testid="pitch-closing-email" className="p-mono p-focus"
            style={{ fontSize: 13, color: "var(--accent-text)", textDecoration: "underline", textUnderlineOffset: 4, padding: "10px 4px" }}>
            {CONTACT.email}
          </a>
        )}
        {tg && (
          <a href={tg} target="_blank" rel="noopener noreferrer" className="p-mono p-focus"
            style={{ fontSize: 13, color: "var(--accent-text)", textDecoration: "underline", textUnderlineOffset: 4, padding: "10px 4px" }}>
            Telegram ↗
          </a>
        )}
      </div>
    </Chapter>
  );
}
