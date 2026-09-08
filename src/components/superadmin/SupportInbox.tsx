import { useEffect, useRef, useState } from "react";
import { LifeBuoy, Send, Loader2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { F, COLORS } from "./types";
import { Section, PlanBadge } from "./ui";

/**
 * Обращения в поддержку — сторона платформы.
 *
 * ── Почему список и разговор рядом ──────────────────────────────────────────
 *
 * Поддержка работает очередью: посмотреть, кто ждёт дольше всех, ответить,
 * вернуться к списку. Отдельная страница на каждый разговор заставляла бы
 * ходить туда-обратно и терять место в очереди.
 *
 * ── Порядок ─────────────────────────────────────────────────────────────────
 *
 * Сначала те, где ждут ответа. Сортировка только по свежести уводила бы вниз
 * молчащий разговор с непрочитанным вопросом — ровно потому, что на него не
 * ответили.
 */
export function SupportInbox() {
  const utils = trpc.useUtils();
  const [openThread, setOpenThread] = useState<{ tenantId: number; userId: number; name: string } | null>(null);
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);

  const { data: threads, isLoading } = trpc.support.inbox.useQuery(undefined, {
    // Поддержка держит этот экран открытым, а обращения приходят без спроса:
    // живого события у неё нет — она сидит вне организации.
    refetchInterval: 20_000,
  });

  const { data: thread } = trpc.support.threadOf.useQuery(
    openThread ? { tenantId: openThread.tenantId, userId: openThread.userId } : { tenantId: 0, userId: 0 },
    { enabled: !!openThread, refetchInterval: openThread ? 15_000 : false },
  );

  const markRead = trpc.support.markThreadRead.useMutation({
    onSuccess: () => utils.support.inbox.invalidate(),
  });
  const reply = trpc.support.reply.useMutation({
    onSuccess: () => {
      setDraft("");
      utils.support.threadOf.invalidate();
      utils.support.inbox.invalidate();
    },
    onError: (e) => notify.error(e.message),
  });

  // Открыли разговор — обращения этого человека прочитаны.
  useEffect(() => {
    if (openThread) markRead.mutate({ tenantId: openThread.tenantId, userId: openThread.userId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThread?.tenantId, openThread?.userId]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [thread?.messages.length]);

  const list = threads ?? [];
  const waiting = list.filter(t => t.unread > 0).length;

  const send = () => {
    const body = draft.trim();
    if (!body || !openThread || reply.isPending) return;
    reply.mutate({ tenantId: openThread.tenantId, userId: openThread.userId, body });
  };

  return (
    <Section title={waiting > 0 ? `Обращения — ждут ответа: ${waiting}` : "Обращения"} icon={LifeBuoy}>
      {isLoading ? (
        <p style={{ fontSize: "13px", color: COLORS.textTertiary }}>Загрузка…</p>
      ) : list.length === 0 ? (
        <p style={{ fontSize: "13px", color: COLORS.textSecondary, margin: 0 }}>
          Пока никто не писал. Чат доступен организациям на тарифе Exclusive.
        </p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 320px) 1fr", gap: "16px", alignItems: "start" }}>
          {/* Очередь */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "440px", overflowY: "auto" }}>
            {list.map(t => {
              const active = openThread?.tenantId === t.tenantId && openThread?.userId === t.userId;
              return (
                <button
                  key={`${t.tenantId}:${t.userId}`}
                  onClick={() => setOpenThread({ tenantId: t.tenantId, userId: t.userId, name: `${t.userName} · ${t.tenantName}` })}
                  style={{
                    textAlign: "left", padding: "12px 14px", borderRadius: "14px", border: "none", cursor: "pointer",
                    background: active ? "var(--color-primary-subtle)" : COLORS.surfaceLight,
                    fontFamily: F.body, transition: "background 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.userName}
                    </span>
                    {/* Сколько вопросов без ответа. Ноль не рисуется: пустой
                        кружок в каждой строке — шум, а не сведения. */}
                    {t.unread > 0 && (
                      <span style={{
                        marginLeft: "auto", minWidth: "18px", height: "18px", borderRadius: "9px", padding: "0 5px",
                        background: "var(--color-danger-strong)", color: "#fff", fontSize: "10px", fontWeight: 700,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                      }}>{t.unread}</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", margin: "4px 0" }}>
                    <PlanBadge plan={t.plan} />
                    <span style={{ fontSize: "11px", color: COLORS.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.tenantName}
                    </span>
                  </div>
                  <p style={{ fontSize: "11px", color: COLORS.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.lastFromPlatform ? "Вы: " : ""}{t.lastMessage}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Разговор */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: "320px", maxHeight: "440px", background: COLORS.surfaceLight, borderRadius: "16px", overflow: "hidden" }}>
            {!openThread ? (
              <p style={{ margin: "auto", fontSize: "13px", color: COLORS.textTertiary }}>Выберите обращение слева</p>
            ) : (
              <>
                <div style={{ padding: "12px 16px", borderBottom: `1px solid ${COLORS.border}`, fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary }}>
                  {openThread.name}
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  {(thread?.messages ?? []).map(m => (
                    <div key={m.id} style={{ display: "flex", justifyContent: m.fromPlatform ? "flex-end" : "flex-start" }}>
                      <div style={{
                        maxWidth: "78%", padding: "9px 13px", borderRadius: "14px",
                        background: m.fromPlatform ? "var(--color-primary)" : COLORS.surface,
                        color: m.fromPlatform ? "var(--color-on-primary)" : COLORS.textPrimary,
                      }}>
                        <p style={{ fontSize: "13px", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</p>
                        <p style={{ fontSize: "10px", opacity: 0.7, marginTop: "4px", textAlign: "right" }}>
                          {new Date(m.createdAt).toLocaleString("ru", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={bottom} />
                </div>
                <div style={{ borderTop: `1px solid ${COLORS.border}`, padding: "10px", display: "flex", gap: "8px", alignItems: "flex-end" }}>
                  <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
                    placeholder="Ответить…"
                    rows={2}
                    maxLength={4000}
                    style={{
                      flex: 1, resize: "none", padding: "9px 12px", borderRadius: "10px",
                      border: `1px solid ${COLORS.border}`, background: COLORS.surface,
                      color: COLORS.textPrimary, fontSize: "13px", fontFamily: F.body, outline: "none",
                    }}
                  />
                  <button
                    onClick={send}
                    disabled={!draft.trim() || reply.isPending}
                    aria-label="Отправить ответ"
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "6px",
                      height: "40px", padding: "0 16px", borderRadius: "10px", border: "none",
                      background: "var(--color-primary)", color: "var(--color-on-primary)",
                      fontSize: "13px", fontWeight: 600, fontFamily: F.body,
                      cursor: draft.trim() ? "pointer" : "not-allowed",
                      opacity: !draft.trim() || reply.isPending ? 0.5 : 1,
                    }}
                  >
                    {reply.isPending ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={14} />}
                    Ответить
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
