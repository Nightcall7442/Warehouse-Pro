import { useEffect, useMemo, useRef, useState } from "react";
import { LifeBuoy, Send, Loader2, Sparkles } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useLang } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";

/**
 * Чат с поддержкой платформы — возможность тарифа Exclusive.
 *
 * ── Зачем ───────────────────────────────────────────────────────────────────
 *
 * «24/7 поддержка» стоит в списке возможностей тарифа на экране оплаты и до сих
 * пор не была подкреплена ничем: организация платила за прямую линию, а
 * написать могла только на общий адрес почты.
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

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const submit = () => {
    const body = draft.trim();
    if (!body || send.isPending) return;
    send.mutate({ body });
  };

  // ── Тариф не тот ──────────────────────────────────────────────────────────
  if (!isLoading && !available) {
    return (
      <div style={{ maxWidth: "560px", margin: "0 auto", textAlign: "center", padding: "48px 20px" }}>
        <div style={{
          width: "56px", height: "56px", borderRadius: "18px", margin: "0 auto 18px",
          display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--color-primary-subtle)", color: "var(--color-primary-text)",
        }}>
          <Sparkles size={26} />
        </div>
        <h1 style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-text-primary)", marginBottom: "10px" }}>
          {t("Прямая линия с поддержкой", "Qo'llab-quvvatlash bilan to'g'ridan-to'g'ri aloqa")}
        </h1>
        <p style={{ fontSize: "14px", lineHeight: 1.6, color: "var(--color-text-secondary)" }}>
          {t(
            "Переписка с нашей поддержкой прямо здесь, без почты и ожидания, входит в тариф Exclusive. Ответы приходят в это же окно.",
            "Bizning qo'llab-quvvatlash xizmatimiz bilan shu yerda, pochtasiz va kutishsiz yozishish Exclusive tarifiga kiradi. Javoblar shu oynaga keladi.",
          )}
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", maxWidth: "780px", margin: "0 auto", width: "100%" }}>
      {/* Шапка */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
        <div style={{
          width: "42px", height: "42px", borderRadius: "14px", display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--color-primary)", color: "var(--color-on-primary)",
        }}>
          <LifeBuoy size={21} />
        </div>
        <div>
          <h1 style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-text-primary)", letterSpacing: "-0.02em" }}>
            {t("Поддержка", "Qo'llab-quvvatlash")}
          </h1>
          <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
            {t("Пишите прямо здесь — ответим в это же окно", "Shu yerda yozing — javob shu oynaga keladi")}
          </p>
        </div>
      </div>

      {/* Разговор */}
      <div className="neo-card" style={{ flex: 1, minHeight: "320px", display: "flex", flexDirection: "column", padding: 0, overflow: "hidden" }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "18px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {isLoading ? (
            <p style={{ color: "var(--color-text-tertiary)", fontSize: "13px" }}>{t("Загрузка…", "Yuklanmoqda…")}</p>
          ) : messages.length === 0 ? (
            <div style={{ margin: "auto", textAlign: "center", color: "var(--color-text-tertiary)", fontSize: "13px", maxWidth: "360px", lineHeight: 1.6 }}>
              {t(
                "Здесь пока пусто. Опишите, что случилось, — чем подробнее, тем быстрее разберёмся.",
                "Hozircha bo'sh. Nima bo'lganini yozing — qanchalik batafsil bo'lsa, shunchalik tez hal qilamiz.",
              )}
            </div>
          ) : messages.map(m => {
            const mine = !m.fromPlatform;
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: mine ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "78%", padding: "10px 14px", borderRadius: "16px",
                  borderBottomRightRadius: mine ? "5px" : "16px",
                  borderBottomLeftRadius: mine ? "16px" : "5px",
                  background: mine ? "var(--color-primary)" : "var(--color-surface-light)",
                  color: mine ? "var(--color-on-primary)" : "var(--color-text-primary)",
                }}>
                  {/* Кто ответил: у поддержки это живой человек, и его имя
                      меняет тон разговора сильнее любого оформления. */}
                  {!mine && m.authorName && (
                    <p style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-primary-text)", marginBottom: "3px" }}>{m.authorName}</p>
                  )}
                  <p style={{ fontSize: "14px", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</p>
                  <p style={{ fontSize: "10px", opacity: 0.7, marginTop: "5px", textAlign: "right" }}>
                    {new Date(m.createdAt).toLocaleString("ru", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={bottom} />
        </div>

        {/* Ввод */}
        <div style={{ borderTop: "1px solid var(--color-border)", padding: "12px", display: "flex", gap: "10px", alignItems: "flex-end" }}>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
            placeholder={t("Опишите, что случилось…", "Nima bo'lganini yozing…")}
            rows={2}
            maxLength={4000}
            style={{
              flex: 1, resize: "none", padding: "10px 12px", borderRadius: "12px",
              border: "1px solid var(--color-border)", background: "var(--color-surface-light)",
              color: "var(--color-text-primary)", fontSize: "14px", fontFamily: "inherit", outline: "none",
            }}
          />
          <button
            onClick={submit}
            disabled={!draft.trim() || send.isPending}
            aria-label={t("Отправить", "Yuborish")}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px",
              padding: "0 18px", height: "44px", borderRadius: "12px", border: "none",
              background: "var(--color-primary)", color: "var(--color-on-primary)",
              fontSize: "14px", fontWeight: 600, cursor: draft.trim() ? "pointer" : "not-allowed",
              opacity: !draft.trim() || send.isPending ? 0.5 : 1,
            }}
          >
            {send.isPending ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={16} />}
            {t("Отправить", "Yuborish")}
          </button>
        </div>
      </div>

      <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", marginTop: "10px", textAlign: "center" }}>
        {t("Разговор виден только вам", "Suhbat faqat sizga ko'rinadi")}
        {user?.name ? ` · ${user.name}` : ""}
      </p>
    </div>
  );
}
