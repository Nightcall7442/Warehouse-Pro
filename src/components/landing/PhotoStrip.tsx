import { useTranslate } from "@/i18n";
import { LX, MONO } from "./landing-tokens";

/* ═══════════════════════════════════════════════════════════════════════════
   АРХИВНАЯ ПОЛОСА — фотографии, вклеенные в реестр.

   Сток честно остаётся стоком, если положить его как есть, — поэтому каждый
   кадр приводится к языку страницы: тёплый дуотон под латунь (grayscale +
   sepia + латунная плашка в multiply), волосяная рамка и моно-подпись, как
   у снимка, подшитого к делу. Подписи намеренно общие («Склад», «Доставка»):
   выдавать чужой магазин за «точку в Чиланзаре» — тот же фейк, что
   выдуманные логотипы.

   Фото — Pexels (бесплатная лицензия, указание автора не обязательно).
   ═══════════════════════════════════════════════════════════════════════════ */

const px = (id: string, w: number) =>
  `https://images.pexels.com/photos/${id}.jpeg?auto=compress&cs=tinysrgb&w=${w}`;

export const CTA_PHOTO = px("30341205/pexels-photo-30341205/free-photo-of-dimly-lit-warehouse-aisle-with-tall-shelves", 1600);

export default function PhotoStrip() {
  const tr = useTranslate();
  const shots = [
    {
      src: px("4277794/pexels-photo-4277794", 900),
      alt: tr("Проход склада со стеллажами", "Ombor yo'lagi va javonlar"),
      code: "F-01",
      cap: tr("Склад · приёмка и остатки", "Ombor · qabul va qoldiqlar"),
    },
    {
      src: px("7843952/pexels-photo-7843952", 900),
      alt: tr("Коробки в кузове фургона", "Furgon ichidagi qutilar"),
      code: "F-02",
      cap: tr("Доставка · погрузка рейса", "Yetkazish · reys yuklanmoqda"),
    },
    {
      src: px("35704478/pexels-photo-35704478/free-photo-of-shopkeeper-standing-in-local-grocery-store", 900),
      alt: tr("Продавец в торговой точке", "Savdo nuqtasidagi sotuvchi"),
      code: "F-03",
      cap: tr("Торговая точка · визит агента", "Savdo nuqtasi · agent tashrifi"),
    },
  ];
  return (
    <section className="pb-14 md:pb-20">
      <div className="max-w-[1240px] mx-auto px-6">
        <div className="grid sm:grid-cols-3 gap-5">
          {shots.map(s => (
            <figure key={s.code} data-reveal="shot">
              <div
                className="relative rounded-xl overflow-hidden"
                style={{ border: `1px solid ${LX.ruleStrong}`, background: LX.ink }}
              >
                <img
                  src={s.src}
                  alt={s.alt}
                  loading="lazy"
                  className="w-full h-52 md:h-60 object-cover"
                  style={{ filter: "grayscale(0.45) sepia(0.22) contrast(1.04) brightness(0.98)" }}
                />
                {/* Латунная лессировка, приводящая все кадры к одному тону */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: "rgba(168,118,62,0.16)", mixBlendMode: "multiply" }}
                />
              </div>
              {/*
                shrink-0 на коде и подписи: без него на средних ширинах
                волосяная линия схлопывалась в ноль, а «F-01» переносилось
                по дефису на две строки.
              */}
              <figcaption
                className="flex items-center gap-3 mt-2.5 text-[10.5px] uppercase"
                style={{ ...MONO, color: LX.inkFaint, letterSpacing: "0.14em" }}
              >
                <span className="shrink-0 whitespace-nowrap" style={{ color: LX.brassText }}>{s.code}</span>
                <span aria-hidden="true" className="h-px flex-1 min-w-[12px]" style={{ background: LX.rule }} />
                <span className="shrink-0 truncate">{s.cap}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
