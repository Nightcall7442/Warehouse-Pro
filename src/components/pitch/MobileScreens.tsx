import { Chapter, Mono } from "@/components/pitch/pitch-ui";
import { useLang } from "@/i18n";
import { LX } from "@/components/landing/landing-tokens";
import { WARM_SHADOW } from "@/components/landing/landing-anime";
import { MOBILE_SCREENS } from "@/components/pitch/mobile-screens";

function useTr() {
  const { lang } = useLang();
  return { tr: (uz: string, ru: string) => (lang === "uz" ? uz : ru) };
}

export function MobileScreens() {
  const { tr } = useTr();
  return (
    <Chapter
      id="ilova"
      num="01"
      kicker={tr("Yechim · mobil ilova", "Решение · мобильное приложение")}
      title={tr("Agent, kuryer va supervayzer — telefonda", "Агент, курьер и супервайзер — в телефоне")}
      lead={tr(
        "iOS va Android uchun ilova: buyurtma, tashrif, qarz va xarita. Internet yo'qolsa ham ishlaydi — ma'lumot telefonda saqlanadi va aloqa tiklanganda o'zi jo'natiladi.",
        "Приложение для iOS и Android: заказ, визит, долг и карта. Работает и без интернета — данные сохраняются на телефоне и уходят сами, когда связь вернётся.",
      )}
      band
    >
      <div
        data-testid="pitch-mobile-screens"
        role="list"
        style={{ display: "flex", alignItems: "flex-start", gap: 20, overflowX: "auto", scrollSnapType: "x mandatory", overscrollBehaviorX: "contain", paddingBottom: 12, margin: "0 -4px", paddingInline: 4 }}
      >
        {MOBILE_SCREENS.map(s => (
          <figure key={s.src} role="listitem" style={{ flex: "0 0 auto", width: "min(62vw, 232px)", margin: 0, scrollSnapAlign: "start", display: "grid", alignContent: "start", gap: 12 }}>
            <div style={{ borderRadius: 30, padding: 7, background: LX.deviceBody, boxShadow: `${WARM_SHADOW}, inset 0 0 0 1px ${LX.whiteHalo}` }}>
              <img src={s.src} width={520} height={1016} loading="lazy" decoding="async"
                alt={tr(`${s.uz} — ilova ekrani`, `${s.ru} — экран приложения`)}
                style={{ display: "block", width: "100%", height: "auto", borderRadius: 24 }} />
            </div>
            <figcaption style={{ display: "grid", gap: 4 }}>
              <strong style={{ fontSize: 15, lineHeight: 1.3 }}>{tr(s.uz, s.ru)}</strong>
              <span style={{ fontSize: 13.5, lineHeight: 1.45, color: "var(--soft)" }}>{tr(s.noteUz, s.noteRu)}</span>
            </figcaption>
          </figure>
        ))}
      </div>
      <Mono style={{ display: "block", marginTop: 20, fontSize: 11, color: "var(--faint)", letterSpacing: "0.06em" }}>
        {tr("ILOVANING HAQIQIY EKRANLARI, NAMUNAVIY MA'LUMOTLAR BILAN", "НАСТОЯЩИЕ ЭКРАНЫ ПРИЛОЖЕНИЯ, НА ДЕМО-ДАННЫХ")}
      </Mono>
    </Chapter>
  );
}
