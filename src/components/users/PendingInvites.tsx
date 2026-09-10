import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { F, COLORS, ROLE_LABELS } from "@/components/users/types";
import { format } from "date-fns";
import { MailCheck, MailWarning, Mails } from "lucide-react";

/**
 * Приглашения: кого позвали и кто дошёл.
 *
 * ── Зачем появилось ─────────────────────────────────────────────────────────
 *
 * Приглашения рассылаются при настройке организации (экран «Onboarding»,
 * invite.send). Дальше они жили в базе, и посмотреть их было НЕЧЕМ: ручка
 * списка написана и не вызывалась ниоткуда.
 *
 * Вопрос, на который никто не мог ответить: «я звал троих, пришёл один — где
 * остальные?». Приглашение могло не дойти письмом, могло протухнуть, могло
 * лежать непринятым. Все три случая выглядели одинаково — человека просто нет
 * в списке сотрудников.
 *
 * ── Почему принятые не прячутся ─────────────────────────────────────────────
 *
 * Принятое приглашение отвечает на другой вопрос: «этот человек пришёл сам по
 * ссылке или его завели руками». При разборе прав это важно, а стоит оно
 * одной строки.
 */
export function PendingInvites() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);

  /*
    «Сейчас» берётся один раз при первой отрисовке, а не на каждой.

    Date.now() прямо в разметке делает отрисовку неповторяемой: один и тот же
    набор данных даёт разный результат, и React справедливо на это ругается.
    Для срока, который меряется днями, момент открытия страницы — ровно та
    точность, что нужна.
  */
  const [now] = useState(() => Date.now());

  const q = trpc.invite.list.useQuery();
  const rows = q.data ?? [];

  // Ни одного приглашения — блока нет: в организации, где всех заводят руками,
  // пустая таблица только занимает экран.
  if (q.isLoading || rows.length === 0) return null;

  return (
    <div className="neo-card neo-card-static" style={{ borderRadius: "20px", padding: "18px" }}>
      <div className="flex items-center gap-2 mb-3">
        <Mails size={16} style={{ color: COLORS.textTertiary }} />
        <h3 style={{ fontFamily: F.display, fontSize: "14px", fontWeight: 700, color: COLORS.textPrimary }}>
          {t("Приглашения", "Takliflar")}
        </h3>
      </div>

      <div className="space-y-1.5">
        {rows.map(i => {
          const accepted = Boolean(i.acceptedAt);
          const expired = !accepted && i.expiresAt != null && new Date(i.expiresAt).getTime() < now;
          return (
            <div key={i.id} className="flex items-center justify-between gap-3" style={{ fontSize: "13px" }}>
              <span className="truncate" style={{ color: COLORS.textPrimary, minWidth: 0 }}>
                {i.email}
                <span style={{ color: COLORS.textTertiary }}> · {ROLE_LABELS[i.role]?.[lang === "uz" ? "uz" : "ru"] ?? i.role}</span>
              </span>
              <span className="shrink-0 inline-flex items-center gap-1.5" style={{
                color: accepted ? "var(--color-success-text)"
                  : expired ? "var(--color-danger-text)"
                  : COLORS.textSecondary,
              }}>
                {accepted ? <MailCheck size={13} /> : <MailWarning size={13} />}
                {accepted
                  ? `${t("принято", "qabul qilindi")} ${format(new Date(i.acceptedAt!), "dd.MM.yyyy")}`
                  : expired
                    /*
                      Протухшее приглашение — не «ждём»: ссылка уже не
                      работает, и человек по ней не придёт, сколько ни ждать.
                      Не сказать этого значит оставить его висеть навсегда.
                    */
                    ? t("срок вышел — позовите заново", "muddati tugadi — qayta chaqiring")
                    : i.expiresAt
                      ? `${t("ждём до", "kutamiz")} ${format(new Date(i.expiresAt), "dd.MM.yyyy")}`
                      : t("ждём", "kutamiz")}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
