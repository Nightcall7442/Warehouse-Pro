import { useLang } from "@/i18n";
import { FIELD_PRICE_UZS, MIN_FIELD_USERS, ANNUAL_DISCOUNT, formatSum, monthlyPrice } from "@contracts/pricing";
import { Chapter, Mono } from "./pitch-ui";
import { pick, MARKET_PROOF, ALTERNATIVES, DIFFERENTIATORS, PARITY, IDEAS, GAPS } from "./pitch-content";

/**
 * 03 · Рынок, конкуренты и бизнес-модель (09.10.2026).
 *
 * Второй вопрос жюри после «сколько клиентов» — «чем вы лучше тех, кто уже
 * есть, и как зарабатываете». Про чужие продукты — только что они такое и со
 * ссылкой на источник, без «у них нет»: изнутри мы их не видели.
 *
 * Цена — платформы, а не арендатора: берётся из contracts/pricing.ts, а не
 * числом в тексте (страж plans-have-one-source), и подписана сумами словом —
 * платформа берёт только сумы (исключение в printing-is-usable названо).
 */
export default function MarketSection() {
  const { lang } = useLang();
  const tr = (uz: string, ru: string) => (lang === "uz" ? uz : ru);
  const example = 10;
  return (
    <Chapter
      id="bozor"
      num="03"
      kicker={tr("Bozor · raqobat · biznes model", "Рынок · конкуренты · бизнес-модель")}
      title={tr("Kim bilan raqobatlashamiz va qanday pul topamiz", "С кем конкурируем и как зарабатываем")}
      lead={<>
        {pick(lang, MARKET_PROOF.text)}{" "}
        <a href={MARKET_PROOF.source.href} target="_blank" rel="noopener noreferrer" className="p-mono p-focus" data-testid="pitch-market-source"
          style={{ fontSize: 13, color: "var(--accent-text)", textDecoration: "underline", textUnderlineOffset: 4 }}>
          {MARKET_PROOF.source.label} ↗
        </a>
      </>}
      band
    >
      <div className="grid lg:grid-cols-12" style={{ gap: "48px 64px" }}>
        <div className="lg:col-span-5" data-testid="pitch-business-model">
          <Mono style={{ color: "var(--accent-text)" }}>{tr("BIZNES MODEL", "БИЗНЕС-МОДЕЛЬ")}</Mono>
          <div style={{ marginTop: 16, display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "4px 12px" }}>
            <span data-testid="pitch-price" style={{ fontSize: "clamp(40px, 6vw, 64px)", fontWeight: 800, letterSpacing: "-0.045em", lineHeight: 1, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {formatSum(FIELD_PRICE_UZS)}
            </span>
            <span style={{ fontSize: 15, color: "var(--soft)" }}>{tr("so'm / dala xodimi / oy", "сум / сотрудник в поле / мес")}</span>
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: "20px 0 0", borderTop: "1px solid var(--rule-strong)" }}>
            {[
              tr("Ofis, ombor, supervayzer va direktor — bepul", "Офис, склад, супервайзеры и директор — бесплатно"),
              tr(`Kamida ${MIN_FIELD_USERS} ta dala xodimi; buyurtma va tovarlar cheklanmagan`, `Минимум ${MIN_FIELD_USERS} сотрудника в поле; заказы и товары без ограничений`),
              tr(`Yillik to'lovda −${Math.round(ANNUAL_DISCOUNT * 100)}%`, `При оплате за год −${Math.round(ANNUAL_DISCOUNT * 100)}%`),
              tr("14 kun bepul sinov, barcha funksiyalar", "14 дней бесплатно, все функции"),
              tr("Joriy etish va ma'lumot ko'chirish — xizmat sifatida", "Внедрение и перенос данных — услугой"),
            ].map(x => (
              <li key={x} className="p-row" style={{ padding: "12px 0", fontSize: 15, display: "flex", gap: 12 }}>
                <span aria-hidden="true" style={{ color: "var(--accent)" }}>→</span>{x}
              </li>
            ))}
          </ul>
          <p style={{ margin: "16px 0 0", fontSize: 14.5, lineHeight: 1.6, color: "var(--soft)" }}>
            <Mono style={{ color: "var(--accent-text)", marginRight: 10 }}>{tr("MISOL", "ПРИМЕР")}</Mono>
            {tr(
              `${example} ta agentli distribyutor — ${formatSum(monthlyPrice(example))} so'm oyiga.`,
              `Дистрибьютор с ${example} агентами — ${formatSum(monthlyPrice(example))} сум в месяц.`,
            )}
          </p>
        </div>

        <div className="lg:col-span-7">
          <Mono style={{ color: "var(--accent-text)" }}>{tr("MUQOBILLAR", "АЛЬТЕРНАТИВЫ")}</Mono>
          <dl data-testid="pitch-alternatives" style={{ margin: "12px 0 0", borderTop: "1px solid var(--rule-strong)" }}>
            {ALTERNATIVES.map(a => (
              <div key={a.name.ru} className="p-row grid sm:grid-cols-[180px_minmax(0,1fr)]" style={{ gap: "4px 24px", padding: "14px 0" }}>
                <dt style={{ fontWeight: 800, fontSize: 15.5 }}>{pick(lang, a.name)}</dt>
                <dd style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "var(--soft)" }}>{pick(lang, a.what)}</dd>
              </div>
            ))}
          </dl>
          <div style={{ marginTop: 32 }}>
            <Mono style={{ color: "var(--accent-text)" }}>{tr("FARQIMIZ", "ЧЕМ МЫ ОТЛИЧАЕМСЯ")}</Mono>
            <ul data-testid="pitch-differentiators" style={{ listStyle: "none", padding: 0, margin: "12px 0 0", borderTop: "1px solid var(--rule-strong)" }}>
              {DIFFERENTIATORS.map(d => (
                <li key={d.ru} className="p-row" style={{ padding: "12px 0", fontSize: 15, lineHeight: 1.6, display: "grid", gridTemplateColumns: "14px minmax(0,1fr)", gap: 12 }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, marginTop: 8, background: "var(--teal)" }} />
                  {pick(lang, d)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/*
        Функции — наравне, задумка — своя, пробелы — названы. Отдельно от
        «Альтернатив»: там — что такое чужие продукты, здесь — что умеем мы.
      */}
      <div data-testid="pitch-parity" style={{ marginTop: 64 }}>
        <div className="grid lg:grid-cols-12" style={{ gap: "16px 64px", alignItems: "end" }}>
          <h3 className="lg:col-span-6" style={{ margin: 0, fontSize: "clamp(24px, 3vw, 34px)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.15 }}>
            {tr("Funksiyalar bo'yicha — Smartup va Sales Doctor bilan bir qatorda", "По функциям — наравне со Smartup и Sales Doctor")}
          </h3>
          <p className="lg:col-span-6" style={{ margin: 0, fontSize: 15.5, lineHeight: 1.6, color: "var(--soft)", maxWidth: "58ch" }}>
            {tr(
              "Distribyutorning asosiy jarayonlari to'liq qamrab olingan — har bir band ishlab turgan funksiya, demoda tekshirish mumkin. Ustiga — o'zimiz o'ylab topgan yechimlar.",
              "Основные процессы дистрибьютора закрыты полностью — каждый пункт работающая функция, её можно проверить в демо. Сверху — решения, которые мы придумали сами.",
            )}
          </p>
        </div>

        <ul data-testid="pitch-parity-list" className="grid sm:grid-cols-2 lg:grid-cols-3" style={{ listStyle: "none", padding: 0, margin: "28px 0 0", gap: "0 40px", borderTop: "1px solid var(--rule-strong)" }}>
          {PARITY.map(x => (
            <li key={x.ru} className="p-row" style={{ padding: "12px 0", fontSize: 15, lineHeight: 1.5, display: "grid", gridTemplateColumns: "20px minmax(0,1fr)", gap: 10 }}>
              <span aria-hidden="true" style={{ color: "var(--teal)", fontWeight: 800 }}>✓</span>
              {pick(lang, x)}
            </li>
          ))}
        </ul>

        <div style={{ marginTop: 40 }}>
          <Mono style={{ color: "var(--accent-text)" }}>{tr("O'ZIMIZNING G'OYALAR", "СВОИ НАХОДКИ")}</Mono>
          <ol data-testid="pitch-ideas" className="grid md:grid-cols-2 lg:grid-cols-3" style={{ listStyle: "none", padding: 0, margin: "12px 0 0", gap: "0 40px", borderTop: "1px solid var(--rule-strong)" }}>
            {IDEAS.map((it, i) => (
              <li key={it.t.ru} className="p-row" style={{ display: "grid", gridTemplateColumns: "32px minmax(0,1fr)", gap: 12, padding: "18px 0" }}>
                <span className="p-mono" style={{ fontSize: 12, color: "var(--accent-text)", paddingTop: 4 }}>{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: "-0.01em" }}>{pick(lang, it.t)}</div>
                  <p style={{ margin: "6px 0 0", fontSize: 14.5, lineHeight: 1.6, color: "var(--soft)" }}>{pick(lang, it.d)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <p data-testid="pitch-gaps" style={{ margin: "28px 0 0", fontSize: 14.5, lineHeight: 1.7, color: "var(--soft)" }}>
          <Mono style={{ color: "var(--faint)", marginRight: 10 }}>{tr("OCHIQ AYTAMIZ — REJADA", "ГОВОРИМ ПРЯМО — В ПЛАНАХ")}</Mono>
          {GAPS.map(g => pick(lang, g)).join(" · ")}
        </p>
      </div>
    </Chapter>
  );
}
