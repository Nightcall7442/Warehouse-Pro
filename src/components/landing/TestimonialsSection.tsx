import { useMemo } from "react";
import { useTranslate } from "@/i18n";
import { SectionHead } from "./landing-shared";
import { LX, MONO } from "./landing-tokens";

/* ═══════════════════════════════════════════════════════════════════════════
   06 / Отзывы — подписанные записи реестра.

   Без звёзд, без стоковых лиц, без автопрокрутки: пять жёлтых звёзд и
   аватар из фотобанка прагматик с двадцатью годами в дистрибуции опознаёт
   как фейк мгновенно. Цитата на линовке + моно-подпись читается как
   запись в журнале — и работает на доверие, а не против него.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function TestimonialsSection() {
  const tr = useTranslate();
  const items = useMemo(
    () => [
      {
        text: tr(
          "Раньше все заказы велись в Excel и тетрадях. Теперь агенты работают в приложении, а я вижу день целиком — ошибок стало в разы меньше.",
          "Avval hamma buyurtmalar Excel va daftarlarda edi. Endi agentlar ilovada ishlaydi, men esa kunni to'liq ko'raman — xatolar ancha kamaydi.",
        ),
        name: "А. Расулов",
        role: tr("директор · LogiMax", "direktor · LogiMax"),
      },
      {
        text: tr(
          "Самое ценное — долги магазинов. Каждая точка на виду: сколько взяла, сколько оплатила, что вернула. Утро начинается со списка должников, а не со звонков.",
          "Eng qimmatlisi — do'kon qarzlari. Har bir nuqta ko'z oldida: qancha oldi, qancha to'ladi, nima qaytardi. Tong qo'ng'iroqlardan emas, qarzdorlar ro'yxatidan boshlanadi.",
        ),
        name: "Д. Камолдинов",
        role: tr("оператор · TradeHub", "operator · TradeHub"),
      },
      {
        text: tr(
          "Офлайн-режим выручает каждый день: в половине точек связи нет, заказы всё равно принимаются и уходят, когда появляется сеть.",
          "Oflayn rejim har kuni asqotadi: nuqtalarning yarmida aloqa yo'q, buyurtmalar baribir qabul qilinadi va tarmoq paydo bo'lganda jo'naydi.",
        ),
        name: "Ш. Абдуллаев",
        role: tr("торговый агент · SupplyPro", "savdo agenti · SupplyPro"),
      },
    ],
    [tr],
  );

  return (
    <section className="py-16 md:py-24" style={{ borderTop: `1px solid ${LX.rule}` }}>
      <div className="max-w-[1240px] mx-auto px-6">
        <SectionHead
          id="testimonials"
          index="06"
          label={tr("Отзывы", "Sharhlar")}
          title={tr("Записи от первых лиц", "Birinchi shaxslardan yozuvlar")}
        />
        <div className="mt-12 grid md:grid-cols-3 gap-x-10 gap-y-10">
          {items.map(t => (
            <figure key={t.name} className="flex flex-col">
              <blockquote
                className="flex-1 text-[15px] leading-[1.75] pl-5"
                style={{ color: LX.ink, borderLeft: `2px solid ${LX.brass}` }}
              >
                {t.text}
              </blockquote>
              <figcaption
                className="mt-5 pl-5 text-[11.5px] uppercase"
                style={{ ...MONO, color: LX.inkFaint, letterSpacing: "0.1em" }}
              >
                <span style={{ color: LX.brassText }}>{t.name}</span> · {t.role}
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
