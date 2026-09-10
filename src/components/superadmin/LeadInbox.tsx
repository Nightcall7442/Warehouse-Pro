import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { F, COLORS } from "@/components/superadmin/types";
import { format } from "date-fns";
import { Check, Inbox, PhoneCall } from "lucide-react";

/**
 * Заявки с лендинга.
 *
 * ── Зачем появилось ─────────────────────────────────────────────────────────
 *
 * Форма на сайте пишет заявку в базу и шлёт уведомление в телеграм. Уведомление
 * — попытка, а не условие: бот отключили, токен просрочили, чат переименовали —
 * человек видит «спасибо», а к вам ничего не приходит. Ровно для этого случая
 * заявка и сохраняется, а у неё стоит `notified = false`, по которому её можно
 * найти.
 *
 * Найти было НЕЧЕМ: обе ручки — список и отметка «разобрана» — написаны и не
 * вызывались ниоткуда. То есть страховка от потери обращений существовала, а
 * посмотреть страховку было невозможно.
 *
 * ── Почему «не дошло в телеграм» видно отдельно ─────────────────────────────
 *
 * Это единственный признак, по которому отличают «мы просто не успели
 * позвонить» от «мы об этой заявке вообще не знали». Первое — вопрос
 * расторопности, второе — сломанный канал, и чинить надо разное.
 */
export function LeadInbox() {
  const [onlyNew, setOnlyNew] = useState(true);
  const utils = trpc.useUtils();

  const listQ = trpc.lead.list.useQuery({ onlyNew });

  const markHandled = trpc.lead.markHandled.useMutation({
    onSuccess: () => {
      notify.success("Заявка отмечена разобранной");
      utils.lead.list.invalidate();
    },
    onError: (e) => notify.error(e.message),
  });

  const rows = listQ.data ?? [];

  return (
    <div style={{ background: COLORS.surface, borderRadius: "20px", padding: "20px", boxShadow: "var(--shadow-sm)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", marginBottom: "14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Inbox size={18} style={{ color: COLORS.textTertiary }} />
          <div>
            <h2 style={{ fontFamily: F.display, fontSize: "16px", fontWeight: 700, color: COLORS.textPrimary }}>
              Заявки с сайта
            </h2>
            <p style={{ fontSize: "12px", color: COLORS.textSecondary }}>
              Оставили телефон и ждут звонка
            </p>
          </div>
        </div>
        <button
          onClick={() => setOnlyNew(v => !v)}
          style={{
            padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
            fontFamily: F.body, cursor: "pointer", border: `1px solid ${COLORS.border}`,
            background: onlyNew ? "var(--color-primary)" : COLORS.surfaceLight,
            color: onlyNew ? "#fff" : COLORS.textSecondary,
          }}
        >
          {onlyNew ? "Только новые" : "Все"}
        </button>
      </div>

      {listQ.isLoading ? (
        <div style={{ height: "60px", background: COLORS.surfaceLight, borderRadius: "12px" }} />
      ) : rows.length === 0 ? (
        <p style={{ fontSize: "13px", color: COLORS.textTertiary }}>
          {onlyNew ? "Неразобранных заявок нет" : "Заявок нет"}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {rows.map(l => (
            <div key={l.id} style={{
              background: COLORS.surfaceLight, borderRadius: "14px", padding: "12px 14px",
              display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px",
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: F.display, fontWeight: 600, color: COLORS.textPrimary }}>
                  {l.name}
                  {l.company ? <span style={{ color: COLORS.textSecondary, fontWeight: 400 }}> · {l.company}</span> : null}
                </div>
                <a href={`tel:${l.phone}`} style={{
                  display: "inline-flex", alignItems: "center", gap: "5px",
                  fontSize: "13px", color: "var(--color-primary-text)", fontVariantNumeric: "tabular-nums",
                }}>
                  <PhoneCall size={12} />{l.phone}
                </a>
                {l.comment ? (
                  <p style={{ fontSize: "12px", color: COLORS.textSecondary, marginTop: "4px" }}>{l.comment}</p>
                ) : null}
                <div style={{ fontSize: "11px", color: COLORS.textTertiary, marginTop: "4px" }}>
                  {l.createdAt ? format(new Date(l.createdAt), "dd.MM.yyyy HH:mm") : ""}
                  {l.source ? ` · ${l.source}` : ""}
                  {/*
                    Не дошло в телеграм — значит канал сломан, и это другая
                    беда, чем «не успели позвонить».
                  */}
                  {l.notified === false ? (
                    <span style={{ color: "var(--color-danger-text)" }}> · в телеграм не ушло</span>
                  ) : null}
                  {l.handledAt ? (
                    <span style={{ color: "var(--color-success-text)" }}>
                      {" "}· разобрана {format(new Date(l.handledAt), "dd.MM.yyyy")}
                    </span>
                  ) : null}
                </div>
              </div>
              {!l.handledAt && (
                <button
                  onClick={() => markHandled.mutate({ id: l.id })}
                  disabled={markHandled.isPending}
                  style={{
                    flexShrink: 0, display: "flex", alignItems: "center", gap: "5px",
                    padding: "6px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600,
                    fontFamily: F.body, cursor: "pointer", border: `1px solid ${COLORS.border}`,
                    background: COLORS.surface, color: COLORS.textSecondary,
                  }}
                >
                  <Check size={13} /> Разобрана
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
