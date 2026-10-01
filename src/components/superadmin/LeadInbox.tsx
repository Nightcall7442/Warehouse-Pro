import { useState } from "react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { Chip, Empty, Pill } from "@/components/superadmin/console/ui";
import { format } from "date-fns";
import { Check, Inbox, PhoneCall } from "lucide-react";
import { formatUzPhone } from "@contracts/signup";

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
    <div data-testid="lead-inbox">
      <div className="flex gap-2" style={{ marginBottom: 14 }}>
        <Chip active={onlyNew} onClick={() => setOnlyNew(true)} testId="leads-only-new">Новые</Chip>
        <Chip active={!onlyNew} onClick={() => setOnlyNew(false)} testId="leads-all">Все</Chip>
      </div>

      {listQ.isLoading ? (
        <div className="neo-card neo-card-static" style={{ height: 96, borderRadius: 20 }} />
      ) : rows.length === 0 ? (
        <div className="neo-card neo-card-static" style={{ padding: 0, borderRadius: 20 }}>
          <Empty icon={Inbox} title={onlyNew ? "Неразобранных заявок нет" : "Заявок нет"} hint="Заявки приходят с формы на сайте: имя, телефон и комментарий." />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map(l => (
            <div key={l.id} className="neo-card neo-card-static" style={{ padding: 16, borderRadius: 20 }} data-testid="lead-row">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", overflowWrap: "anywhere" }}>
                    {l.name}
                    {l.company ? <span style={{ color: "var(--color-text-secondary)", fontWeight: 500 }}> · {l.company}</span> : null}
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--color-text-tertiary)", marginTop: 3 }}>
                    {l.createdAt ? format(new Date(l.createdAt), "dd.MM.yyyy HH:mm") : ""}
                    {l.source ? ` · ${l.source}` : ""}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {/* Не дошло в телеграм — значит канал сломан, и это другая
                      беда, чем «не успели позвонить». */}
                  {l.notified === false && <Pill tone="danger">в телеграм не ушло</Pill>}
                  {l.handledAt && <Pill tone="success">разобрана {format(new Date(l.handledAt), "dd.MM.yyyy")}</Pill>}
                </div>
              </div>
              {l.comment ? (
                <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "10px 0 0", lineHeight: 1.5, overflowWrap: "anywhere" }}>{l.comment}</p>
              ) : null}
              <div className="flex gap-2 flex-wrap" style={{ marginTop: 12 }}>
                <a href={`tel:${l.phone.replace(/[^\d+]/g, "")}`} className="neo-btn" data-testid="lead-call"
                  style={{ minHeight: 44, padding: "0 14px", fontSize: 13.5, color: "var(--color-primary-text)", textDecoration: "none", fontVariantNumeric: "tabular-nums" }}>
                  <PhoneCall size={15} /> {formatUzPhone(l.phone)}
                </a>
                {!l.handledAt && (
                  <button type="button" onClick={() => markHandled.mutate({ id: l.id })} disabled={markHandled.isPending}
                    className="neo-btn" style={{ minHeight: 44, padding: "0 14px", fontSize: 13.5 }} data-testid="lead-handled">
                    <Check size={15} /> Разобрана
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
