import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { Users, Copy, Check, Loader2, BellRing, Unlink } from "lucide-react";
import { labelled, ROLE_LABEL } from "@/lib/entity-labels";
import { FieldGroup } from "./ui";

/**
 * Подключение сотрудников к Telegram — то, чего директору не хватало.
 *
 * ── Чего не хватало ─────────────────────────────────────────────────────────
 *
 * Подключиться к боту сотрудник может только САМ: ссылка подписана его
 * идентификатором и живёт четверть часа. Это правильно — иначе пересланная
 * ссылка стала бы способом читать чужие уведомления.
 *
 * Но из этого следовало неудобное: директор, подключивший организацию, не мог
 * узнать ничего. Ни кто уже подключился, ни кому напомнить. Уведомления
 * уходили половине людей, и почему именно этой половине — было не выяснить.
 *
 * ── Два ответа, и второй важнее ─────────────────────────────────────────────
 *
 * Первый — список: видно, кто подключён, и можно напомнить остальным.
 *
 * Второй — ОБЩАЯ ГРУППА. Уговаривать двадцать человек проделать настройку по
 * одному не выходит никогда; вместо этого директор заводит чат, добавляет туда
 * бота и вставляет код. Дальше рабочие события видит вся смена, включая тех,
 * кто ничего не настраивал.
 *
 * Личное в группу не уходит: зарплата и персональные задачи адресованы одному
 * человеку, и в общем чате это разглашение, а не удобство.
 */
export function TelegramTeam() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const utils = trpc.useUtils();

  const team = trpc.telegram.teamStatus.useQuery();
  const group = trpc.telegram.groupStatus.useQuery();
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const code = trpc.telegram.groupCode.useQuery(undefined, { enabled: showCode });

  const remind = trpc.telegram.remindToConnect.useMutation({
    onSuccess: (r) =>
      notify.success(
        r.sent === 0
          ? t("Напоминать некому — подключены все", "Eslatadigan odam yo'q — hammasi ulangan")
          : t(`Напоминание отправлено: ${r.sent}`, `Eslatma yuborildi: ${r.sent}`),
      ),
    onError: (e) => notify.error(e.message),
  });

  const unlink = trpc.telegram.unlinkGroup.useMutation({
    onSuccess: () => {
      utils.telegram.groupStatus.invalidate();
      notify.success(t("Группа отключена", "Guruh uzildi"));
    },
    onError: (e) => notify.error(e.message),
  });

  const rows = team.data ?? [];
  const connected = rows.filter(r => r.connected);
  const pending = rows.filter(r => !r.connected);

  return (
    <>
      {/* ── Общий чат смены ─────────────────────────────────────────────── */}
      <FieldGroup title={t("Группа сотрудников", "Xodimlar guruhi")}>
        <p className="text-[13px] text-secondary mb-3" style={{ maxWidth: "62ch" }}>
          {t(
            "Подключать людей по одному не нужно. Заведите чат в Telegram, добавьте туда бота и вставьте код — рабочие события увидит вся смена. Личное (зарплата, свои задачи) в общий чат не уходит.",
            "Odamlarni bittalab ulash shart emas. Telegramda chat yarating, botni qo'shing va kodni joylang — ish hodisalarini butun smena ko'radi. Shaxsiy narsalar umumiy chatga bormaydi.",
          )}
        </p>

        {group.data?.linked ? (
          <div className="rounded-xl px-3.5 py-3" style={{ background: "var(--color-surface-light)" }}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-medium text-primary">
                  {group.data.title || t("Группа подключена", "Guruh ulangan")}
                </p>
                <p className="text-xs text-secondary mt-0.5">
                  {t("События приходят в этот чат", "Hodisalar shu chatga keladi")}
                </p>
              </div>
              <button
                type="button"
                className="neo-btn"
                style={{ fontSize: "12px", padding: "6px 12px" }}
                disabled={unlink.isPending}
                onClick={() => unlink.mutate()}
              >
                <Unlink size={13} /> {t("Отключить", "Uzish")}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="neo-btn-primary" onClick={() => setShowCode(true)}>
            {t("Получить код для группы", "Guruh uchun kod olish")}
          </button>
        )}

        {showCode && !group.data?.linked && (
          <div className="rounded-xl px-3.5 py-3.5 mt-3" style={{ background: "var(--color-surface-light)" }}>
            {code.isLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                <ol className="text-[13px] text-secondary" style={{ paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px" }}>
                  <li>{t("Создайте группу в Telegram и добавьте в неё сотрудников", "Telegramda guruh yarating va xodimlarni qo'shing")}</li>
                  <li>{t("Добавьте туда бота Warehouse Pro", "Warehouse Pro botini qo'shing")}</li>
                  <li>{t("Отправьте в группе:", "Guruhga yuboring:")} <code>/link {code.data?.code?.slice(0, 12)}…</code></li>
                </ol>

                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  <code className="text-xs" style={{ wordBreak: "break-all", flex: "1 1 260px", color: "var(--color-text-primary)" }}>
                    /link {code.data?.code}
                  </code>
                  <button
                    type="button"
                    className="neo-btn"
                    style={{ fontSize: "12px", padding: "6px 12px" }}
                    onClick={() => {
                      navigator.clipboard.writeText(`/link ${code.data?.code ?? ""}`)
                        .then(() => { setCopied(true); notify.success(t("Скопировано", "Nusxalandi")); })
                        .catch(() => notify.error(t("Скопируйте вручную", "Qo'lda nusxalang")));
                    }}
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                    {t("Скопировать", "Nusxalash")}
                  </button>
                </div>

                <p className="text-xs text-tertiary mt-2">
                  {t(
                    `Код действует ${code.data?.minutes ?? 15} минут. Он даёт право слать события организации в тот чат, куда его вставят, — не пересылайте его посторонним.`,
                    `Kod ${code.data?.minutes ?? 15} daqiqa amal qiladi. Uni begonalarga yubormang.`,
                  )}
                </p>
              </>
            )}
          </div>
        )}
      </FieldGroup>

      {/* ── Кто подключён лично ─────────────────────────────────────────── */}
      <FieldGroup title={t("Сотрудники", "Xodimlar")}>
        {team.isLoading ? (
          <div className="h-12 bg-surface-light animate-pulse rounded-xl" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-tertiary">{t("Сотрудников нет", "Xodimlar yo'q")}</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <p className="text-[13px] text-secondary">
                <Users size={13} style={{ display: "inline", marginRight: "6px" }} />
                {t(
                  `Подключены ${connected.length} из ${rows.length}`,
                  `${rows.length} dan ${connected.length} ulangan`,
                )}
              </p>
              {pending.length > 0 && (
                <button
                  type="button"
                  className="neo-btn"
                  style={{ fontSize: "12px", padding: "6px 12px" }}
                  disabled={remind.isPending}
                  onClick={() => remind.mutate()}
                >
                  <BellRing size={13} /> {t("Напомнить неподключённым", "Ulanmaganlarga eslatish")}
                </button>
              )}
            </div>

            <div className="space-y-1.5">
              {rows.map(r => (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-xl px-3 py-2"
                  style={{ background: "var(--color-surface-light)" }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p className="text-sm text-primary truncate">{r.name}</p>
                    <p className="text-xs text-tertiary">{labelled(ROLE_LABEL, r.role, lang)}</p>
                  </div>
                  <span
                    className="text-xs shrink-0"
                    style={{ color: r.connected ? "var(--color-success-text)" : "var(--color-text-tertiary)" }}
                  >
                    {r.connected ? t("подключён", "ulangan") : t("нет", "yo'q")}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </FieldGroup>
    </>
  );
}
