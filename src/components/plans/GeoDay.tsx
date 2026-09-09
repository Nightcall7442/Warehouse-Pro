import { AlertTriangle, Camera, ClipboardList, Loader2, MapPin, Navigation, Timer } from "lucide-react";
import { trpc } from "@/providers/trpc";

/*
  ── Как прошёл день ─────────────────────────────────────────────────────────

  Координаты агента пишутся давно, а читались ровно в одном месте: «где все
  сейчас» на карте. Здесь из тех же точек собирается день целиком — во сколько
  вышел, где стоял и сколько, сколько намотал между точками, и какие отметки
  ничем не подтверждены.

  Шаги визита восстановлены, а не записаны: кнопок «пришёл / ушёл» в мобильном
  приложении нет, и заводить ручку под них раньше самого приложения значило бы
  добавить седьмую написанную и никем не вызываемую. Приезд — первый пинг в
  зоне магазина, уход — последний. Нажать «пришёл» сидя дома можно; подделать
  след труднее.
*/

const hhmm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—";

/** Минуты человеческим языком: 95 → «1 ч 35 мин». */
function dur(min: number | null, lang: string): string {
  if (min == null) return "—";
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  if (min < 60) return `${min} ${t("мин", "daq")}`;
  return `${Math.floor(min / 60)} ${t("ч", "s")} ${min % 60} ${t("мин", "daq")}`;
}

function Tile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
      <span style={{
        width: "30px", height: "30px", borderRadius: "9px", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--color-surface-light)", color: tone ?? "var(--color-text-secondary)",
      }}>
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <p className="font-data" style={{ fontSize: "13px", fontWeight: 700, color: tone ?? "var(--color-text-primary)", margin: 0, whiteSpace: "nowrap" }}>
          {value}
        </p>
        <p style={{ fontSize: "10px", color: "var(--color-text-tertiary)", margin: 0, whiteSpace: "nowrap" }}>{label}</p>
      </div>
    </div>
  );
}

export function GeoDay({ agentId, day, lang }: { agentId: number; day: string; lang: string }) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { data, isLoading, isError } = trpc.geo.day.useQuery({ agentId, day });

  if (isLoading) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        <Loader2 size={16} style={{ animation: "spin 1s linear infinite", color: "var(--color-primary-text)" }} />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", margin: 0, padding: "12px 0" }}>
        {t("Не удалось собрать день", "Kunni yig'ib bo'lmadi")}
      </p>
    );
  }

  /*
    Точек нет вовсе — это не «ноль километров», а «не знаем».

    Отдельным сообщением, потому что причин ровно две и обе действия требуют:
    приложение не отправляло координаты или человек не выходил на маршрут.
  */
  if (data.pings === 0) {
    return (
      <div style={{ padding: "16px", borderRadius: "10px", background: "var(--color-surface-light)" }}>
        <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", margin: 0 }}>
          {t("За этот день от приложения не пришло ни одной точки GPS.",
             "Bu kunda ilovadan bironta GPS nuqtasi kelmadi.")}
        </p>
        <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "6px 0 0" }}>
          {t("Значит, подтвердить визиты нечем — ни один из них не проверен по координатам.",
             "Demak, tashriflarni tasdiqlash uchun hech narsa yo'q.")}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      {/* Числа дня */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: "12px" }}>
        <Tile
          icon={<Navigation size={14} />}
          label={t("пробег за день", "kunlik masofa")}
          value={data.distanceKm == null ? "—" : `${data.distanceKm.toFixed(1)} ${t("км", "km")}`}
        />
        <Tile
          icon={<MapPin size={14} />}
          label={t("в точках", "nuqtalarda")}
          value={dur(data.minutesInShops, lang)}
        />
        <Tile
          icon={<Timer size={14} />}
          label={t("в дороге", "yo'lda")}
          value={dur(data.minutesOnRoad, lang)}
        />
        <Tile
          icon={<Timer size={14} />}
          label={t("вышел — закончил", "chiqdi — tugatdi")}
          value={`${hhmm(data.firstPingAt)} — ${hhmm(data.lastPingAt)}`}
        />
        {data.problems > 0 && (
          <Tile
            icon={<AlertTriangle size={14} />}
            label={t("визитов с замечаниями", "izohli tashriflar")}
            value={String(data.problems)}
            tone="var(--color-danger-text)"
          />
        )}
      </div>

      {/* Шаги по точкам */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {data.steps.map(step => {
          const wasThere = !!step.arrivedAt;
          return (
            <div
              key={step.planId}
              style={{
                display: "flex", flexDirection: "column", gap: "6px",
                padding: "10px 12px", borderRadius: "10px",
                background: "var(--color-surface-light)",
                borderLeft: `3px solid ${
                  step.flags.length > 0 ? "var(--color-danger)"
                    : wasThere ? "var(--color-success)"
                    : "var(--color-border)"
                }`,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-text-primary)" }}>
                  {step.shopName}
                </span>
                {wasThere ? (
                  <span className="font-data" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                    {hhmm(step.arrivedAt)} — {hhmm(step.leftAt)}
                    <span style={{ color: "var(--color-text-tertiary)" }}> · {dur(step.minutes, lang)}</span>
                  </span>
                ) : (
                  <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                    {step.closestM == null
                      ? t("координат магазина нет", "do'kon koordinatasi yo'q")
                      : t(`не подходил ближе ${step.closestM} м`, `${step.closestM} m dan yaqin kelmadi`)}
                  </span>
                )}
              </div>

              {/* Чем визит подтверждён. Отметка сама по себе — не доказательство. */}
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", fontSize: "11px", color: "var(--color-text-tertiary)" }}>
                {step.visitedAt && (
                  <span>{t("отметил", "belgiladi")} {hhmm(step.visitedAt)}</span>
                )}
                {step.hasPhoto && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                    <Camera size={11} />{t("фото", "surat")}
                  </span>
                )}
                {step.reportedAt && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                    <ClipboardList size={11} />{t("отчёт", "hisobot")} {hhmm(step.reportedAt)}
                  </span>
                )}
                {!step.visitedAt && !wasThere && (
                  <span>{t("не посещён", "tashrif bo'lmadi")}</span>
                )}
              </div>

              {step.flags.map(flag => (
                <p key={flag} style={{ fontSize: "11px", color: "var(--color-danger-text)", margin: 0, lineHeight: 1.4 }}>
                  {flag}
                </p>
              ))}
            </div>
          );
        })}
        {data.steps.length === 0 && (
          <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", margin: 0 }}>
            {t("На этот день планов визитов не было.", "Bu kunga tashrif rejalari yo'q edi.")}
          </p>
        )}
      </div>

      <p style={{ fontSize: "10px", color: "var(--color-text-tertiary)", margin: 0, lineHeight: 1.45 }}>
        {t(
          "Приход и уход восстановлены по координатам: первая и последняя точка ближе 500 м к магазину. Отметка в приложении сама по себе визит не подтверждает.",
          "Kelish va ketish koordinatalar bo'yicha tiklandi: do'konga 500 m dan yaqin birinchi va oxirgi nuqta.",
        )}
      </p>
    </div>
  );
}
