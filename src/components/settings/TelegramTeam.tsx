import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { useLang } from "@/i18n";
import { notify } from "@/lib/toast";
import { Users, Copy, Check, Loader2, BellRing, Unlink, Link2, X } from "lucide-react";
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

  /*
    Подключение сотрудника директором — по его номеру в Telegram.

    Личная ссылка требует, чтобы человек сам зашёл в приложение и нажал
    кнопку. Половина смены этого не сделает никогда: агент работает с
    телефона, в настройки веба не заходит. Номер сотрудник узнаёт у самого
    бота: нажал «Запустить» — бот ответил номером, — и пересылает директору.
    В списке участников группы номера не видно: Telegram его не показывает.

    Ответ приходит РАЗНЫЙ, и это важнее удобства: пока человек не нажал
    «Запустить» в самом боте, Telegram не даёт боту написать первым. Тогда
    запись остаётся, а доставки нет — и сказать об этом надо сразу, иначе
    директор считает, что подключил, а человек не получает ничего.
  */
  const [editing, setEditing] = useState<number | null>(null);
  const [idInput, setIdInput] = useState("");

  const setChat = trpc.telegram.setUserChatId.useMutation({
    onSuccess: (r) => {
      utils.telegram.teamStatus.invalidate();
      setEditing(null);
      setIdInput("");
      if (!r.linked) return notify.success(t("Отвязано", "Uzildi"));
      if (r.delivered) return notify.success(t("Подключено — сообщение дошло", "Ulandi — xabar yetdi"));
      notify.error(t(
        "Записано, но сообщение не дошло: сотрудник ещё не нажал «Запустить» в боте",
        "Yozildi, lekin xabar yetmadi: xodim botda «Ishga tushirish»ni bosmagan",
      ));
    },
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
                  className="rounded-xl px-3 py-2"
                  style={{ background: "var(--color-surface-light)" }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div style={{ minWidth: 0 }}>
                      <p className="text-sm text-primary truncate">{r.name}</p>
                      <p className="text-xs text-tertiary">{labelled(ROLE_LABEL, r.role, lang)}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className="text-xs"
                        style={{ color: r.connected ? "var(--color-success-text)" : "var(--color-text-tertiary)" }}
                      >
                        {r.connected ? t("подключён", "ulangan") : t("нет", "yo'q")}
                      </span>
                      <button
                        type="button"
                        className="neo-btn"
                        style={{ fontSize: "12px", padding: "5px 9px" }}
                        aria-label={t(`Telegram сотрудника: ${r.name}`, `Xodim Telegrami: ${r.name}`)}
                        onClick={() => {
                          setEditing(editing === r.id ? null : r.id);
                          setIdInput("");
                        }}
                      >
                        {r.connected ? <X size={13} /> : <Link2 size={13} />}
                      </button>
                    </div>
                  </div>

                  {editing === r.id && (
                    <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--color-border)" }}>
                      {r.connected ? (
                        <button
                          type="button"
                          className="neo-btn"
                          style={{ fontSize: "12px", padding: "6px 12px" }}
                          disabled={setChat.isPending}
                          onClick={() => setChat.mutate({ userId: r.id, chatId: "" })}
                        >
                          {t("Отвязать Telegram", "Telegramni uzish")}
                        </button>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 flex-wrap">
                            <input
                              className="neo-input"
                              inputMode="numeric"
                              /*
                                «Telegram ID», а не «номер»: под номером
                                человек понимает телефон и вписывает его —
                                а это другое число, и подключение молча не
                                сработает.
                              */
                              placeholder={t("Telegram ID (не телефон), только цифры", "Telegram ID (telefon emas), faqat raqamlar")}
                              aria-label={t("Telegram ID сотрудника", "Xodimning Telegram ID'si")}
                              value={idInput}
                              onChange={e => setIdInput(e.target.value.replace(/\D/g, ""))}
                              style={{ flex: "1 1 200px" }}
                            />
                            <button
                              type="button"
                              className="neo-btn-primary"
                              style={{ fontSize: "12px", padding: "8px 14px" }}
                              disabled={setChat.isPending || idInput.length < 5}
                              onClick={() => setChat.mutate({ userId: r.id, chatId: idInput })}
                            >
                              {t("Подключить", "Ulash")}
                            </button>
                          </div>
                          {/*
                            Сказано прямо, а не мелким шрифтом внизу: без этого
                            шага доставки не будет, и директор решит, что
                            сломалось у нас.
                          */}
                          <p className="text-xs text-tertiary mt-1.5">
                            {t(
                              "Где взять: сотрудник открывает бота и нажимает «Запустить» — бот в ответ пишет его Telegram ID. Пусть перешлёт это сообщение вам. Это не номер телефона. Пока он не нажал «Запустить», Telegram не даёт боту написать первым.",
                              "Qayerdan olish: xodim botni ochib «Ishga tushirish»ni bosadi — bot javobida uning Telegram ID'sini yozadi. O'sha xabarni sizga yuborsin. Bu telefon raqami emas. U bosmaguncha Telegram botga birinchi bo'lib yozishga ruxsat bermaydi.",
                            )}
                          </p>
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </FieldGroup>
    </>
  );
}
