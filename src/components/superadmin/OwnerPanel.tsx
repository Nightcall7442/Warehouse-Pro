import { format } from "date-fns";
import { Wallet, TrendingUp, Activity, PhoneOff, PhoneCall, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { trpc } from "@/providers/trpc";
import { useLang, useTranslate } from "@/i18n";
import { formatUzPhone, describeSignupSource } from "@contracts/signup";
import { F, COLORS, money } from "./types";
import { KpiCard, PlanBadge } from "./ui";

/**
 * Кто платит и кто уходит — панель владельца платформы.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Наверху страницы стояли «Организаций», «Пользователей», «Заказов» и
 * «Выручка» по всей платформе — числа про клиентов, а не про бизнес самой
 * платформы. Сколько денег в месяц, кто из платящих замолчал, у кого на неделе
 * кончается срок, на каком шаге застревают пробные — узнать было негде, а
 * телефон владельца организации лежал только в её карточке, в двух щелчках от
 * списка.
 *
 * ── Что здесь ───────────────────────────────────────────────────────────────
 *
 * Четыре числа и четыре списка «кому позвонить», у каждой строки — телефон
 * ссылкой: нажал и звонишь. Правила счёта — в api/services/owner-panel.ts, те
 * же, что у калитки подписки; экран только показывает.
 *
 * На двух языках, хотя остальная суперадминка русская: это рабочее место
 * человека, который звонит клиентам, а не служебная бумага.
 */

const STAGE_LABEL: Record<string, { ru: string; uz: string }> = {
  registered:    { ru: "Регистрация",          uz: "Ro'yxatdan o'tdi" },
  emailVerified: { ru: "Почта подтверждена",   uz: "Pochta tasdiqlandi" },
  products:      { ru: "Есть товары",          uz: "Mahsulotlar bor" },
  agent:         { ru: "Заведён агент",        uz: "Agent qo'shildi" },
  agentOrder:    { ru: "Первый заказ агентом", uz: "Agentning birinchi buyurtmasi" },
  delivered:     { ru: "Первая доставка",      uz: "Birinchi yetkazish" },
  paid:          { ru: "Перешёл на платный",   uz: "Pullik tarifga o'tdi" },
};

const day = (d: Date | string | null | undefined) => (d ? format(new Date(d), "dd.MM.yyyy") : "—");

export function OwnerPanel() {
  const tr = useTranslate();
  const { lang } = useLang();
  const { data, isLoading, isError } = trpc.tenant.ownerPanel.useQuery();
  const sum = tr("сум", "so'm");

  return (
    <div className="neo-card neo-card-static" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: "16px" }} data-testid="owner-panel">
      <div>
        <h3 style={{ fontFamily: F.display, fontSize: "15px", fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>
          {tr("Кто платит и кто уходит", "Kim to'layapti va kim ketyapti")}
        </h3>
        <p className="text-xs" style={{ color: COLORS.textSecondary, margin: "4px 0 0" }}>
          {tr(
            "Без системной организации и песочниц интеграторов. Обновляется раз в минуту.",
            "Tizim tashkiloti va integrator qumdonlarisiz. Har daqiqada yangilanadi.",
          )}
        </p>
      </div>

      {isError ? (
        <p style={{ fontSize: "13px", color: "var(--color-danger-text)", margin: 0 }}>
          {tr("Не удалось собрать панель. Обновите страницу.", "Panelni yig'ib bo'lmadi. Sahifani yangilang.")}
        </p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "16px" }}>
            <KpiCard label={tr("Платят сейчас", "Hozir to'layapti")} value={data?.paying.count ?? 0}
              icon={Wallet} gradient="var(--color-success)" loading={isLoading} />
            <KpiCard label={tr("MRR по цене тарифа", "Tarif narxida MRR")} value={money(data?.paying.mrr ?? 0)} suffix={sum}
              icon={TrendingUp} gradient="var(--color-primary)" loading={isLoading} />
            <KpiCard label={tr("Активны за 7 дней", "7 kunda faol")} value={data?.activeLast7 ?? 0}
              suffix={data ? tr(`из ${data.clients}`, `${data.clients} dan`) : undefined}
              icon={Activity} gradient="var(--color-info)" loading={isLoading} />
            <KpiCard label={tr("Молчат 5+ дней", "5+ kun jim")} value={data?.silent.length ?? 0}
              icon={PhoneOff} gradient="var(--color-warning)" loading={isLoading} />
          </div>
          {/* Подпись к MRR честная: это прайс, а не деньги на счёте. */}
          <p className="text-xs" style={{ color: COLORS.textTertiary, margin: 0 }} data-testid="owner-mrr-note">
            {tr(
              "MRR — сумма месячных цен тарифов у платящих, по прайсу: без скидок и без докупленных мест. «Активны» — был заказ или вход.",
              "MRR — to'layotganlarning oylik tarif narxlari yig'indisi, prays bo'yicha: chegirmalar va qo'shimcha o'rinlarsiz. «Faol» — buyurtma yoki kirish bo'lgan.",
            )}
          </p>

          {isLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "12px", color: COLORS.textTertiary }}>
              <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> {tr("Считаю…", "Hisoblayapman…")}
            </div>
          ) : data && (
            <>
              <Block title={tr("Молчат 5+ дней — позвонить", "5+ kun jim — qo'ng'iroq qiling")}
                empty={tr("Все платящие и пробные работали за последние пять дней.", "Barcha to'lovchilar va sinovdagilar oxirgi besh kunda ishlagan.")}
                testId="owner-silent">
                {data.silent.map(r => (
                  <Row key={r.tenantId} name={r.name} phone={r.phone} email={r.email}
                    badge={<PlanBadge plan={r.plan} lang={lang} />}
                    meta={tr(
                      `${r.kind === "paying" ? "платит" : "пробный"} · последняя активность ${day(r.lastActivityAt)} · тишина ${r.silentDays} дн.`,
                      `${r.kind === "paying" ? "to'layapti" : "sinov"} · oxirgi faollik ${day(r.lastActivityAt)} · ${r.silentDays} kun jim`,
                    )} />
                ))}
              </Block>

              <Block title={tr("Продление в ближайшие 14 дней", "Yaqin 14 kunda uzaytirish")}
                empty={tr("В ближайшие две недели оплаченный срок не кончается ни у кого.", "Yaqin ikki haftada hech kimning to'langan muddati tugamaydi.")}
                testId="owner-renewals">
                {data.renewals.map(r => (
                  <Row key={r.tenantId} name={r.name} phone={r.phone} email={r.email}
                    badge={<PlanBadge plan={r.plan} lang={lang} />}
                    meta={tr(
                      `до ${day(r.periodEnds)} · осталось ${r.daysLeft} дн. · ${money(r.price)} ${sum}/мес`,
                      `${day(r.periodEnds)} gacha · ${r.daysLeft} kun qoldi · ${money(r.price)} ${sum}/oy`,
                    )} />
                ))}
              </Block>

              <Block title={tr("Платят сейчас", "Hozir to'layapti")}
                empty={tr("Платящих пока нет.", "Hozircha to'lovchilar yo'q.")}
                testId="owner-paying">
                {data.paying.list.map(r => (
                  <Row key={r.tenantId} name={r.name} phone={r.phone} email={r.email}
                    badge={<PlanBadge plan={r.plan} lang={lang} />}
                    meta={r.periodEnds
                      ? tr(`${money(r.price)} ${sum}/мес · оплачено до ${day(r.periodEnds)}`, `${money(r.price)} ${sum}/oy · ${day(r.periodEnds)} gacha to'langan`)
                      : tr(`${money(r.price)} ${sum}/мес · бессрочно`, `${money(r.price)} ${sum}/oy · muddatsiz`)} />
                ))}
              </Block>

              <Block title={tr("Пробные по этапам", "Sinovdagilar bosqichlar bo'yicha")}
                empty={tr("Пробных нет.", "Sinovdagilar yo'q.")}
                testId="owner-trials"
                head={
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))", gap: "8px", marginBottom: "10px" }} data-testid="owner-funnel">
                    {data.funnel.stages.map((s, i) => (
                      <div key={s.key} data-testid={`owner-stage-${s.key}`} style={{
                        display: "flex", flexDirection: "column", gap: "6px", padding: "10px 12px",
                        borderRadius: "12px", background: COLORS.surfaceLight,
                      }}>
                        <span style={{ fontSize: "11px", color: COLORS.textTertiary, lineHeight: 1.3 }}>
                          {i + 1}. {tr(STAGE_LABEL[s.key]?.ru ?? s.key, STAGE_LABEL[s.key]?.uz ?? s.key)}
                        </span>
                        <span style={{ fontFamily: F.display, fontSize: "20px", fontWeight: 700, color: COLORS.textPrimary, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                          {s.reached}
                        </span>
                      </div>
                    ))}
                  </div>
                }>
                {data.funnel.trials.map(r => {
                  const source = describeSignupSource(r.source, lang);
                  return (
                    <Row key={r.tenantId} name={r.name} phone={r.phone} email={r.email}
                      badge={<StageBadge label={tr(STAGE_LABEL[r.stage]?.ru ?? r.stage, STAGE_LABEL[r.stage]?.uz ?? r.stage)} />}
                      meta={
                        <>
                          <StageDots done={r.done} />{" "}
                          {tr(
                            `с ${day(r.createdAt)} · ${r.trialExpired ? "пробный истёк" : "пробный до"} ${day(r.trialEndsAt)}`,
                            `${day(r.createdAt)} dan · ${r.trialExpired ? "sinov tugagan" : "sinov"} ${day(r.trialEndsAt)}${r.trialExpired ? "" : " gacha"}`,
                          )}
                          {source ? ` · ${source}` : ""}
                        </>
                      } />
                  );
                })}
              </Block>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Раздел панели: заголовок, счёт строк и сами строки — или честное «пусто». */
function Block({ title, empty, testId, head, children }: {
  title: string; empty: string; testId: string; head?: ReactNode; children: ReactNode[];
}) {
  return (
    <section data-testid={testId}>
      <h4 style={{ fontFamily: F.display, fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary, margin: "0 0 8px" }}>
        {title} <span style={{ color: COLORS.textTertiary, fontWeight: 500 }}>· {children.length}</span>
      </h4>
      {head}
      {children.length === 0
        ? <p style={{ fontSize: "12.5px", color: COLORS.textTertiary, margin: 0 }}>{empty}</p>
        : <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>{children}</div>}
    </section>
  );
}

/**
 * Строка «кому звонить». На телефоне переносится: название и сведения сверху,
 * кнопка звонка под ними во всю ширину — цель касания не меньше 44 точек
 * (размеры в px, а не в rem: базовый шрифт 14, и rem мельче, чем кажется).
 */
function Row({ name, phone, email, badge, meta }: {
  name: string; phone: string | null; email: string | null; badge: ReactNode; meta: ReactNode;
}) {
  const tr = useTranslate();
  return (
    <div data-testid="owner-row" style={{
      display: "flex", alignItems: "center", flexWrap: "wrap", gap: "8px 12px",
      padding: "10px 14px", borderRadius: "12px", background: "var(--color-surface-light)",
      boxShadow: "inset 0 0 0 1px var(--color-border)",
    }}>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "13.5px", fontWeight: 600, color: COLORS.textPrimary }}>{name}</span>
          {badge}
        </div>
        <div style={{ fontSize: "12px", color: COLORS.textSecondary, marginTop: "3px", lineHeight: 1.45 }}>{meta}</div>
        {email ? <div style={{ fontSize: "11.5px", color: COLORS.textTertiary, marginTop: "2px", overflowWrap: "anywhere" }}>{email}</div> : null}
      </div>
      {phone ? (
        <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="neo-btn" data-testid="owner-call"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px",
            minHeight: "44px", padding: "0 14px", fontSize: "13px", fontWeight: 600,
            color: "var(--color-primary-text)", fontVariantNumeric: "tabular-nums", textDecoration: "none", whiteSpace: "nowrap",
          }}>
          <PhoneCall size={14} /> {formatUzPhone(phone)}
        </a>
      ) : (
        <span style={{ fontSize: "12px", color: COLORS.textTertiary }}>{tr("телефона нет", "telefon yo'q")}</span>
      )}
    </div>
  );
}

function StageBadge({ label }: { label: string }) {
  return (
    <span style={{
      padding: "3px 10px", borderRadius: "999px", fontSize: "11px", fontWeight: 600,
      background: "color-mix(in srgb, var(--color-primary) 10%, transparent)", color: "var(--color-primary-text)", whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

/** Семь точек — какие шаги пройдены. Пропуск виден сразу: товары не заведены, а агент уже есть. */
function StageDots({ done }: { done: string[] }) {
  const keys = Object.keys(STAGE_LABEL);
  return (
    <span aria-hidden style={{ display: "inline-flex", gap: "3px", verticalAlign: "middle" }}>
      {keys.map(k => (
        <span key={k} style={{
          width: "7px", height: "7px", borderRadius: "50%",
          background: done.includes(k) ? "var(--color-success)" : "var(--color-border)",
        }} />
      ))}
    </span>
  );
}
