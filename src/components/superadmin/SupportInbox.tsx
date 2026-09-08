import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Inbox, LifeBuoy, Loader2, Send } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { labelled, ROLE_LABEL } from "@/lib/entity-labels";
import { buildThread } from "@/lib/chat-thread";
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
 *
 * ── Оформление ──────────────────────────────────────────────────────────────
 *
 * Разговор разбирается тем же расчётом, что и у клиента (src/lib/chat-thread),
 * и рисуется теми же классами. Иначе одна и та же переписка выглядела бы у
 * поддержки и у клиента по-разному — вплоть до «Вчера» против «Сегодня» на
 * одном и том же сообщении.
 */
export function SupportInbox() {
  const utils = trpc.useUtils();
  const [openThread, setOpenThread] = useState<{ tenantId: number; userId: number; name: string; tenant: string; plan: string } | null>(null);
  const [draft, setDraft] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

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

  const messages = useMemo(() => thread?.messages ?? [], [thread?.messages]);
  const pending = reply.isPending ? (reply.variables?.body ?? "") : "";

  useLayoutEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending]);

  // Поле ответа растёт по тексту: ответ поддержки редко умещается в две строки,
  // а набирать его в щёлку с прокруткой — верный способ не перечитать перед
  // отправкой. Потолок держит CSS (.chat-input).
  const fit = useCallback(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useEffect(fit, [draft, fit]);

  const list = threads ?? [];
  const waiting = list.filter(t => t.unread > 0).length;
  const rows = useMemo(() => buildThread(messages, new Date()), [messages]);

  const send = () => {
    const body = draft.trim();
    if (!body || !openThread || reply.isPending) return;
    reply.mutate({ tenantId: openThread.tenantId, userId: openThread.userId, body });
  };

  return (
    <Section title={waiting > 0 ? `Обращения — ждут ответа: ${waiting}` : "Обращения"} icon={LifeBuoy}>
      {isLoading ? (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: COLORS.textTertiary }}>
          <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Загрузка…
        </div>
      ) : list.length === 0 ? (
        <EmptyInbox />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(270px, 340px) 1fr", gap: "16px", alignItems: "start" }}>
          {/* ── Очередь ─────────────────────────────────────────────────── */}
          <div className="premium-scrollbar" style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "520px", overflowY: "auto", padding: "2px" }}>
            {list.map(t => {
              const active = openThread?.tenantId === t.tenantId && openThread?.userId === t.userId;
              return (
                <button
                  key={`${t.tenantId}:${t.userId}`}
                  onClick={() => setOpenThread({
                    tenantId: t.tenantId, userId: t.userId,
                    name: t.userName, tenant: t.tenantName, plan: t.plan,
                  })}
                  style={{
                    textAlign: "left", padding: "12px 14px", borderRadius: "16px", cursor: "pointer",
                    border: "none", fontFamily: F.body, position: "relative", overflow: "hidden",
                    background: active ? "var(--color-primary-subtle)" : COLORS.surfaceLight,
                    // Выбранная строка вдавлена, остальные приподняты. Раньше
                    // выбор отличался только заливкой и терялся среди прочих.
                    boxShadow: active ? "var(--shadow-pressed)" : "var(--shadow-sm)",
                    transition: "box-shadow 0.2s ease, background 0.15s ease",
                  }}
                >
                  {/* Полоса у края — там, где ждут ответа. Видно на просмотр
                      всего списка, не вчитываясь в каждую строку. */}
                  {t.unread > 0 && (
                    <span style={{
                      position: "absolute", left: 0, top: "10px", bottom: "10px", width: "3px",
                      borderRadius: "0 3px 3px 0", background: "var(--color-danger-strong)",
                    }} />
                  )}

                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <Avatar name={t.userName} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span style={{ fontSize: "13px", fontWeight: 600, color: COLORS.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.userName}
                        </span>
                        {/* Сколько вопросов без ответа. Ноль не рисуется:
                            пустой кружок в каждой строке — шум, а не сведения. */}
                        {t.unread > 0 && (
                          <span style={{
                            marginLeft: "auto", minWidth: "18px", height: "18px", borderRadius: "9px", padding: "0 5px",
                            background: "var(--color-danger-strong)", color: "#fff", fontSize: "10px", fontWeight: 700,
                            display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                          }}>{t.unread}</span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "3px" }}>
                        <span style={{ fontSize: "11px", color: COLORS.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                          {t.tenantName}
                        </span>
                        <span style={{ fontSize: "10.5px", color: COLORS.textTertiary, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                          {ago(new Date(t.lastAt))}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "6px", margin: "8px 0 5px" }}>
                    <PlanBadge plan={t.plan} />
                    <span style={{ fontSize: "10.5px", color: COLORS.textTertiary }}>{labelled(ROLE_LABEL, t.userRole)}</span>
                  </div>

                  <p style={{ fontSize: "11.5px", lineHeight: 1.45, color: COLORS.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.lastFromPlatform ? "Вы: " : ""}{t.lastMessage}
                  </p>
                </button>
              );
            })}
          </div>

          {/* ── Разговор ────────────────────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", minHeight: "380px", maxHeight: "520px", borderRadius: "18px", overflow: "hidden", boxShadow: "var(--shadow-sm)" }}>
            {!openThread ? (
              <div className="chat-well" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ textAlign: "center", color: COLORS.textTertiary }}>
                  <Inbox size={30} style={{ opacity: 0.5, marginBottom: "10px" }} />
                  <p style={{ fontSize: "13px" }}>Выберите обращение слева</p>
                </div>
              </div>
            ) : (
              <>
                <div style={{ padding: "12px 16px", background: COLORS.surface, display: "flex", alignItems: "center", gap: "10px" }}>
                  <Avatar name={openThread.name} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p style={{ fontSize: "13.5px", fontWeight: 700, color: COLORS.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {openThread.name}
                    </p>
                    <p style={{ fontSize: "11px", color: COLORS.textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {openThread.tenant}
                    </p>
                  </div>
                  <PlanBadge plan={openThread.plan} />
                </div>

                <div className="chat-well premium-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "3px" }}>
                  {rows.map(row => {
                    if (row.kind === "day") {
                      return (
                        <div key={row.key} className="chat-day" style={{ margin: "8px 0 4px" }}>
                          {row.when === "today" ? "Сегодня" : row.when === "yesterday" ? "Вчера" : dayName(row.at)}
                        </div>
                      );
                    }
                    const m = row.msg;
                    // Здесь «моё» — это реплика платформы: экран смотрит поддержка.
                    const mine = m.fromPlatform;
                    return (
                      <div
                        key={row.key}
                        style={{
                          display: "flex", justifyContent: mine ? "flex-end" : "flex-start",
                          marginTop: row.first ? "12px" : "2px",
                        }}
                      >
                        {/* Лицо и пузырь — в одной строке внутри столбика:
                            иначе лицо равняется по строке времени, а не по
                            реплике, к которой относится. */}
                        <div className="chat-stack" style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
                          <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", maxWidth: "100%" }}>
                            {!mine && (row.first
                              ? <Avatar name={openThread.name} size={26} />
                              : <div style={{ width: "26px", flexShrink: 0 }} />
                            )}
                            <div className={[
                              "chat-bubble",
                              mine ? "chat-bubble-mine" : "chat-bubble-theirs",
                              row.last ? (mine ? "chat-bubble-tail-right" : "chat-bubble-tail-left") : "",
                            ].join(" ")} style={{ fontSize: "13px" }}>
                              {m.body}
                            </div>
                          </div>
                          {row.last && (
                            <div style={{ display: "flex", alignItems: "center", gap: "4px", margin: "4px 4px 0", marginLeft: mine ? undefined : "34px" }}>
                              <span style={{ fontSize: "10.5px", color: COLORS.textTertiary, fontVariantNumeric: "tabular-nums" }}>
                                {time(row.at)}
                              </span>
                              {/* Прочитал ли клиент наш ответ. Отметка уже
                                  ставилась в базе и никуда не выводилась. */}
                              {mine && (m.readAt
                                ? <CheckCheck size={12} style={{ color: "var(--color-primary-text)" }} />
                                : <Check size={12} style={{ color: COLORS.textTertiary }} />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {pending && (
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
                      <div className="chat-bubble chat-bubble-mine chat-bubble-tail-right chat-bubble-pending" style={{ fontSize: "13px" }}>
                        {pending}
                      </div>
                    </div>
                  )}
                  <div ref={bottom} />
                </div>

                <div style={{ padding: "12px", background: COLORS.surface, display: "flex", gap: "8px", alignItems: "flex-end" }}>
                  <textarea
                    ref={field}
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
                    placeholder="Ответить…"
                    rows={1}
                    maxLength={4000}
                    className="chat-input"
                    style={{ fontSize: "13px" }}
                  />
                  <button
                    onClick={send}
                    disabled={!draft.trim() || reply.isPending}
                    aria-label="Отправить ответ"
                    className="neo-btn-primary"
                    style={{ height: "42px", padding: "0 16px", borderRadius: "14px", flexShrink: 0 }}
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

// ── Мелочи ──────────────────────────────────────────────────────────────────

/**
 * Лицо собеседника.
 *
 * Фотографий у нас нет, но и безымянный кружок не нужен: две буквы имени
 * позволяют вести взглядом по очереди, не вчитываясь в каждую строку.
 */
function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? "").join("").toUpperCase() || "?";
  return (
    <div style={{
      width: `${size}px`, height: `${size}px`, borderRadius: `${Math.round(size / 2.8)}px`, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, var(--accent-teal, #3a9a8a), var(--color-primary))",
      color: "#fff", fontSize: `${Math.round(size / 2.9)}px`, fontWeight: 700, fontFamily: F.body,
      letterSpacing: "0.02em",
    }}>
      {initials}
    </div>
  );
}

function EmptyInbox() {
  return (
    <div style={{ textAlign: "center", padding: "22px 0" }}>
      <div style={{
        width: "52px", height: "52px", borderRadius: "18px", margin: "0 auto 14px",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: COLORS.surfaceLight, color: COLORS.textTertiary, boxShadow: "var(--shadow-sm)",
      }}>
        <Inbox size={24} />
      </div>
      <p style={{ fontSize: "13.5px", fontWeight: 600, color: COLORS.textPrimary, marginBottom: "4px" }}>Пока никто не писал</p>
      <p style={{ fontSize: "12px", color: COLORS.textTertiary, margin: 0 }}>
        Чат доступен организациям на тарифе Exclusive.
      </p>
    </div>
  );
}

const time = (d: Date) => d.toLocaleTimeString("ru", { hour: "2-digit", minute: "2-digit" });
const dayName = (d: Date) => d.toLocaleDateString("ru", { day: "numeric", month: "long" });

/**
 * Давность в списке очереди.
 *
 * Поддержке важно «сколько уже ждут», а не «когда именно написали»: полная дата
 * в каждой строке заставляла бы считать разницу в уме на каждом обращении.
 */
function ago(at: Date): string {
  const min = Math.round((Date.now() - at.getTime()) / 60_000);
  if (!Number.isFinite(min) || min < 1) return "только что";
  if (min < 60) return `${min} мин`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} ч`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} дн` : at.toLocaleDateString("ru", { day: "2-digit", month: "2-digit" });
}
