import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Clock3, Headset, LifeBuoy, Loader2, Send, Sparkles } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { buildThread } from "@/lib/chat-thread";

/**
 * Чат с поддержкой платформы — возможность тарифа Exclusive.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * «24/7 поддержка» стоит в списке возможностей тарифа на экране оплаты и до сих
 * пор не была подкреплена ничем: организация платила за прямую линию, а
 * написать могла только на общий адрес почты.
 *
 * ── Почему экран переписан ──────────────────────────────────────────────────
 *
 * Первый заход был собран инлайновыми стилями мимо системы оформления
 * приложения: обводки `1px solid`, пузыри без теней, поле ввода с рамкой вместо
 * вдавленного, время под каждой репликой, границы суток не показаны нигде.
 * Владелец сказал прямо — выглядит дёшево. Он прав, и дело было не в цветах:
 * в разговоре не было видно ни разговора, ни времени.
 *
 * Что изменилось по существу:
 *   • реплики собираются в группы (src/lib/chat-thread.ts) — имя и лицо у
 *     первой, время и хвостик у последней, у остальных ничего;
 *   • появились разделители суток;
 *   • поле разговора вдавлено, пузыри приподняты — тот же приём, что у всей
 *     остальной вёрстки, и именно он делал её дорогой на вид;
 *   • отправленное показывается сразу, приглушённым, а не после ответа сервера;
 *   • у своей реплики видно, прочитана ли она — эти сведения уже приходили,
 *     но нигде не показывались.
 *
 * Действия остались прежние: написать, отправить, отметить прочтённым.
 *
 * ── Про чужой тариф ─────────────────────────────────────────────────────────
 *
 * Экран открывается на любом тарифе и на не-Exclusive показывает, что даёт
 * Exclusive, — а не отказ. Отказ здесь был бы вредным вдвойне: человек не
 * понял бы, поломка это или так задумано, и не узнал бы, как получить нужное.
 */
export default function Support() {
  const { lang } = useLang();
  const t = (ru: string, uz: string) => (lang === "uz" ? uz : ru);
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const { data, isLoading } = trpc.support.thread.useQuery(undefined, {
    // Ответ приходит живым событием, но опрос раз в полминуты страхует случай,
    // когда поток событий оборвался и переподключиться ещё не успел.
    refetchInterval: 30_000,
  });

  const send = trpc.support.send.useMutation({
    onSuccess: () => { setDraft(""); utils.support.thread.invalidate(); utils.support.unread.invalidate(); },
    onError: (e) => notify.error(e.message),
  });
  const markRead = trpc.support.markRead.useMutation({
    onSuccess: () => utils.support.unread.invalidate(),
  });

  const available = data?.available ?? false;
  const messages = useMemo(() => data?.messages ?? [], [data?.messages]);

  // Открыли экран — значит прочитали. Отметка ставится один раз на порцию
  // непрочитанного, а не на каждую отрисовку.
  const unread = data?.unread ?? 0;
  useEffect(() => {
    if (available && unread > 0) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [available, unread]);

  /*
    Разговор всегда открывается на последней реплике.

    useLayoutEffect, а не useEffect: обычный сработал бы после того, как браузер
    уже нарисовал кадр, и при каждом входе на экран было бы видно, как переписка
    дёргается снизу вверх.
  */
  const pending = send.isPending ? (send.variables?.body ?? "") : "";
  useLayoutEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending]);

  /*
    Поле растёт по тексту.

    Жёсткие две строки означали, что длинное обращение — а в поддержку пишут
    именно длинные — набирается в щёлку с прокруткой и не перечитывается перед
    отправкой. Потолок держит CSS (.chat-input, max-height), поэтому здесь
    достаточно сбросить высоту и взять фактическую.
  */
  const fit = useCallback(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useEffect(fit, [draft, fit]);

  const submit = () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    send.mutate({ body });
  };

  const prefill = (text: string) => {
    setDraft(text);
    field.current?.focus();
  };

  const rows = useMemo(() => buildThread(messages, new Date()), [messages]);

  // Последнее слово наше и ответа ещё нет — единственное состояние ожидания,
  // которое мы знаем наверняка. Выдумывать «поддержка в сети» не из чего.
  const last = messages[messages.length - 1];
  const awaiting = Boolean(last && !last.fromPlatform) || send.isPending;

  const time = (d: Date) => d.toLocaleTimeString(lang === "uz" ? "uz" : "ru", { hour: "2-digit", minute: "2-digit" });
  const dayName = (d: Date) => d.toLocaleDateString(lang === "uz" ? "uz" : "ru", { day: "numeric", month: "long" });

  // ── Тариф не тот ──────────────────────────────────────────────────────────
  if (!isLoading && !available) {
    const perks: Array<[string, string]> = [
      [
        "Переписка прямо здесь, без почты и номера обращения",
        "Shu yerda yozishish — pochtasiz va murojaat raqamisiz",
      ],
      [
        "Ответ приходит в это же окно и в значок в меню",
        "Javob shu oynaga va menyudagi belgiga keladi",
      ],
      [
        "Разговор виден только вам — не всей организации",
        "Suhbat faqat sizga ko'rinadi — butun tashkilotga emas",
      ],
    ];
    return (
      <div style={{ maxWidth: "620px", margin: "0 auto", padding: "40px 20px", width: "100%" }}>
        <div className="neo-card neo-card-static" style={{ padding: "36px 28px", textAlign: "center" }}>
          <div style={{
            width: "68px", height: "68px", borderRadius: "22px", margin: "0 auto 20px",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "linear-gradient(135deg, var(--color-primary), var(--accent-teal, #3a9a8a))",
            color: "var(--color-on-primary)", boxShadow: "var(--shadow-raised)",
          }}>
            <Sparkles size={30} />
          </div>

          <span style={{
            display: "inline-block", marginBottom: "12px", padding: "4px 12px", borderRadius: "999px",
            background: "var(--color-primary-subtle)", color: "var(--color-primary-text)",
            fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
          }}>
            Exclusive
          </span>

          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "var(--color-text-primary)", letterSpacing: "-0.02em", marginBottom: "10px" }}>
            {t("Прямая линия с поддержкой", "Qo'llab-quvvatlash bilan to'g'ridan-to'g'ri aloqa")}
          </h1>
          <p style={{ fontSize: "14px", lineHeight: 1.6, color: "var(--color-text-secondary)", maxWidth: "420px", margin: "0 auto 24px" }}>
            {t(
              "Переписка с нашей поддержкой прямо здесь, без почты и ожидания, входит в тариф Exclusive.",
              "Bizning qo'llab-quvvatlash xizmatimiz bilan shu yerda, pochtasiz va kutishsiz yozishish Exclusive tarifiga kiradi.",
            )}
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px", textAlign: "left", maxWidth: "420px", margin: "0 auto" }}>
            {perks.map(([ru, uz]) => (
              <div key={ru} style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                <div style={{
                  width: "22px", height: "22px", borderRadius: "8px", flexShrink: 0, marginTop: "1px",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: "var(--color-success-subtle)", color: "var(--color-success-text, var(--color-success))",
                }}>
                  <Check size={13} />
                </div>
                <span style={{ fontSize: "13px", lineHeight: 1.5, color: "var(--color-text-secondary)" }}>{t(ru, uz)}</span>
              </div>
            ))}
          </div>

          {/*
            Кнопки «перейти к оплате» здесь нет намеренно: тариф меняет
            руководитель, и остальным она вела бы на экран, закрытый по роли.
            Строка ниже говорит, к кому идти, — это полезнее неработающей кнопки.
          */}
          <p style={{ fontSize: "12px", color: "var(--color-text-tertiary)", marginTop: "24px" }}>
            {user?.role === "ceo"
              ? t("Тариф меняется в разделе «Оплата».", "Tarif «To'lov» bo'limida o'zgartiriladi.")
              : t("Тариф меняет руководитель организации.", "Tarifni tashkilot rahbari o'zgartiradi.")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", maxWidth: "820px", margin: "0 auto", width: "100%", minHeight: 0 }}>
      {/* ── Шапка ────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "16px" }}>
        <div style={{
          width: "46px", height: "46px", borderRadius: "16px", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "linear-gradient(135deg, var(--color-primary), var(--accent-teal, #3a9a8a))",
          color: "var(--color-on-primary)", boxShadow: "var(--shadow-sm)",
        }}>
          <LifeBuoy size={22} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ fontSize: "21px", fontWeight: 700, color: "var(--color-text-primary)", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
            {t("Поддержка", "Qo'llab-quvvatlash")}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: "7px", marginTop: "3px" }}>
            {awaiting && <span className="chat-waiting-dot" />}
            <p style={{ fontSize: "12.5px", color: "var(--color-text-secondary)" }}>
              {awaiting
                ? t("Ждём ответа поддержки", "Qo'llab-quvvatlash javobini kutmoqdamiz")
                : t("Пишите прямо здесь — ответим в это же окно", "Shu yerda yozing — javob shu oynaga keladi")}
            </p>
          </div>
        </div>
        <span style={{
          flexShrink: 0, padding: "5px 12px", borderRadius: "999px",
          background: "var(--color-primary-subtle)", color: "var(--color-primary-text)",
          fontSize: "10px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          Exclusive
        </span>
      </div>

      {/* ── Разговор ─────────────────────────────────────────────────────── */}
      <div className="neo-card neo-card-static" style={{ flex: 1, minHeight: "340px", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
        <div className="chat-well premium-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: "3px" }}>
          {isLoading ? (
            <div style={{ margin: "auto", display: "flex", alignItems: "center", gap: "9px", color: "var(--color-text-tertiary)", fontSize: "13px" }}>
              <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />
              {t("Загрузка…", "Yuklanmoqda…")}
            </div>
          ) : rows.length === 0 && !pending ? (
            <EmptyThread t={t} onPick={prefill} />
          ) : (
            rows.map(row => {
              if (row.kind === "day") {
                return (
                  <div key={row.key} className="chat-day" style={{ margin: "10px 0 6px" }}>
                    {row.when === "today" ? t("Сегодня", "Bugun")
                      : row.when === "yesterday" ? t("Вчера", "Kecha")
                        : dayName(row.at)}
                  </div>
                );
              }

              const m = row.msg;
              const mine = !m.fromPlatform;
              return (
                <div
                  key={row.key}
                  style={{
                    display: "flex",
                    justifyContent: mine ? "flex-end" : "flex-start",
                    // Между группами воздуха больше, чем внутри группы: именно
                    // этот перепад и читается как «разные реплики».
                    marginTop: row.first ? "12px" : "2px",
                  }}
                >
                  {/* Лицо и пузырь стоят в одной строке ВНУТРИ столбика, а не
                      рядом с ним: иначе лицо равняется по нижнему краю всего
                      столбика, то есть по строке времени, и отрывается от
                      реплики, к которой относится. */}
                  <div className="chat-stack" style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
                    {/* Кто ответил: у поддержки это живой человек, и его имя
                        меняет тон разговора сильнее любого оформления. */}
                    {!mine && row.first && m.authorName && (
                      <span style={{ fontSize: "11.5px", fontWeight: 700, color: "var(--color-primary-text)", margin: "0 0 4px 43px" }}>
                        {m.authorName}
                      </span>
                    )}

                    <div style={{ display: "flex", alignItems: "flex-end", gap: "9px", maxWidth: "100%" }}>
                      {/* Лицо — только у первой реплики группы. Дальше стоит
                          распорка той же ширины, иначе пузыри разъезжаются. */}
                      {!mine && (row.first
                        ? (
                          <div style={{
                            width: "30px", height: "30px", borderRadius: "11px", flexShrink: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: "linear-gradient(135deg, var(--accent-teal, #3a9a8a), var(--color-primary))",
                            color: "#fff", boxShadow: "var(--shadow-sm)",
                          }}>
                            <Headset size={15} />
                          </div>
                        )
                        : <div style={{ width: "30px", flexShrink: 0 }} />
                      )}
                      <div className={[
                        "chat-bubble",
                        mine ? "chat-bubble-mine" : "chat-bubble-theirs",
                        row.last ? (mine ? "chat-bubble-tail-right" : "chat-bubble-tail-left") : "",
                      ].join(" ")}>
                        {m.body}
                      </div>
                    </div>

                    {/* Время — у последней реплики группы. На каждой это был
                        столбик одинаковых подписей вместо сведений. */}
                    {row.last && (
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", margin: "4px 4px 0", marginLeft: mine ? undefined : "43px" }}>
                        <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
                          {time(row.at)}
                        </span>
                        {/* Прочитано ли. Эти сведения приходили с сервера и
                            раньше просто пропадали. */}
                        {mine && (m.readAt
                          ? <CheckCheck size={13} style={{ color: "var(--color-primary-text)" }} />
                          : <Check size={13} style={{ color: "var(--color-text-tertiary)" }} />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Отправляемое сообщение — сразу, не дожидаясь ответа сервера. */}
          {pending && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
              <div className="chat-stack" style={{ alignItems: "flex-end" }}>
                <div className="chat-bubble chat-bubble-mine chat-bubble-tail-right chat-bubble-pending">
                  {pending}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px", margin: "4px 4px 0", color: "var(--color-text-tertiary)" }}>
                  <Clock3 size={12} />
                  <span style={{ fontSize: "11px" }}>{t("Отправляется", "Yuborilmoqda")}</span>
                </div>
              </div>
            </div>
          )}
          <div ref={bottom} />
        </div>

        {/* ── Ввод ───────────────────────────────────────────────────────── */}
        <div style={{ padding: "14px", display: "flex", flexDirection: "column", gap: "8px", background: "var(--color-surface)" }}>
          <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
            <textarea
              ref={field}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
              placeholder={t("Опишите, что случилось…", "Nima bo'lganini yozing…")}
              rows={1}
              maxLength={4000}
              className="chat-input"
            />
            <button
              onClick={submit}
              disabled={!draft.trim() || send.isPending}
              aria-label={t("Отправить", "Yuborish")}
              className="neo-btn-primary"
              style={{ height: "46px", padding: "0 20px", borderRadius: "16px", flexShrink: 0 }}
            >
              {send.isPending ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={16} />}
              {t("Отправить", "Yuborish")}
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "0 4px" }}>
            <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>
              {t("Ctrl + Enter — отправить", "Ctrl + Enter — yuborish")}
            </span>
            {/* Счётчик появляется у предела, а не висит всегда: пока до него
                далеко, это цифра ни о чём. */}
            {draft.length > 3600 && (
              <span style={{
                fontSize: "11px", fontVariantNumeric: "tabular-nums",
                color: draft.length >= 4000 ? "var(--color-danger-text, var(--color-danger))" : "var(--color-warning-text, var(--color-warning))",
              }}>
                {draft.length} / 4000
              </span>
            )}
          </div>
        </div>
      </div>

      <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "10px", textAlign: "center" }}>
        {t("Разговор виден только вам", "Suhbat faqat sizga ko'rinadi")}
        {user?.name ? ` · ${user.name}` : ""}
      </p>
    </div>
  );
}

/**
 * Пустой разговор.
 *
 * Одна серая строка посреди пустого поля — это не «чисто», это «здесь ничего
 * нет и непонятно, что делать». Подсказки подставляют тему в поле ввода и
 * НЕ отправляют её: человек дописывает своими словами, а первый шаг перестаёт
 * быть чистым листом.
 */
function EmptyThread({ t, onPick }: { t: (ru: string, uz: string) => string; onPick: (text: string) => void }) {
  const topics: Array<[string, string]> = [
    ["Не сходится остаток", "Qoldiq to'g'ri kelmayapti"],
    ["Вопрос по оплате", "To'lov bo'yicha savol"],
    ["Ошибка при проведении заказа", "Buyurtmani o'tkazishda xatolik"],
  ];
  return (
    <div style={{ margin: "auto", textAlign: "center", maxWidth: "420px", padding: "20px 0" }}>
      <div style={{
        width: "58px", height: "58px", borderRadius: "20px", margin: "0 auto 16px",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--color-surface)", color: "var(--color-primary-text)",
        boxShadow: "var(--shadow-raised)",
      }}>
        <Headset size={26} />
      </div>
      <p style={{ fontSize: "15px", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "6px" }}>
        {t("Чем помочь?", "Nimada yordam beray?")}
      </p>
      <p style={{ fontSize: "13px", lineHeight: 1.6, color: "var(--color-text-tertiary)", marginBottom: "18px" }}>
        {t(
          "Опишите, что случилось, — чем подробнее, тем быстрее разберёмся.",
          "Nima bo'lganini yozing — qanchalik batafsil bo'lsa, shunchalik tez hal qilamiz.",
        )}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
        {topics.map(([ru, uz]) => (
          <button key={ru} type="button" className="chat-chip" onClick={() => onPick(t(ru, uz))}>
            {t(ru, uz)}
          </button>
        ))}
      </div>
    </div>
  );
}
