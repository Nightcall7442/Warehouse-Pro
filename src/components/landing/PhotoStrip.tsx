import { useTranslate } from "@/i18n";
import { LX } from "./landing-tokens";

/* ═══════════════════════════════════════════════════════════════════════════
   ОДНА ФОТОГРАФИЯ ВО ВСЮ ШИРИНУ.

   Три одинаковых скруглённых прямоугольника в ряд — шаблон, который можно
   поставить на любой сайт. Один кадр, обрезанный краем экрана сверху и снизу,
   без скруглений — воздух между главами, а не иллюстрация к ним. Подпись
   снаружи объекта, словами, а не разрежённым моно.

   Сток честно приводится к языку страницы: тёплый дуотон под латунь.
   Фото — Pexels (бесплатная лицензия).
   ═══════════════════════════════════════════════════════════════════════════ */

const px = (id: string, w: number) =>
  `https://images.pexels.com/photos/${id}.jpeg?auto=compress&cs=tinysrgb&w=${w}`;

export const CTA_PHOTO = px("30341205/pexels-photo-30341205/free-photo-of-dimly-lit-warehouse-aisle-with-tall-shelves", 1600);

export default function PhotoStrip() {
  const tr = useTranslate();
  return (
    <figure className="relative" data-reveal="photo">
      <div className="relative h-[240px] md:h-[320px] overflow-hidden" style={{ background: LX.ink }}>
        <img
          src={px("4277794/pexels-photo-4277794", 1800)}
          alt={tr("Проход склада со стеллажами", "Ombor yo'lagi va javonlar")}
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ objectPosition: "50% 55%", filter: "grayscale(0.45) sepia(0.22) contrast(1.04) brightness(0.98)" }}
        />
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none" style={{ background: "rgba(168,118,62,0.16)", mixBlendMode: "multiply" }} />
      </div>
      <figcaption className="max-w-[1240px] mx-auto px-6 py-3 text-[13px] font-medium" style={{ color: LX.inkSoft }}>
        {tr("Склад · приёмка и остатки", "Ombor · qabul va qoldiqlar")}
      </figcaption>
    </figure>
  );
}
