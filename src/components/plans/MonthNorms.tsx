import { useMemo, useState } from "react";
import { Loader2, Save, Wand2 } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { notify } from "@/lib/toast";
import { useCurrency } from "@/hooks/useCurrency";
import { monthEnd, monthLabel } from "./month";

/*
  ── Нормы на месяц ──────────────────────────────────────────────────────────

  Норма — это три числа на сотрудника на месяц: сумма продаж, число заказов и
  доля закрытых визитов. Всё это на сервере было целиком: и запись
  (salesTarget.upsert, bulkUpsert), и подсказка по трёхмесячной истории
  (autoSuggest), и живой подсчёт выполнения. Не было только экрана — из веба
  вызывался ровно один метод, summary, и то ради полоски на карте слежения.
  То есть нормы поставить было НЕЧЕМ, и «выполнение плана» на всех экранах
  честно показывало прочерк.

  Здесь они ставятся так же, как визиты — на месяц и всем сразу: таблица,
  правки прямо в ячейках, одно сохранение. Рядом с нормой стоит план визитов
  за тот же месяц (из расстановки на соседней вкладке): норма «закрыть 90 %»
  без числа визитов — это процент неизвестно от чего.
*/

type Row = {
  userId: number;
  userName: string;
  /** Сколько визитов расставлено на месяц — из плана, не из нормы. */
  plannedVisits: number;
  amount: string;
  orders: string;
  visitPct: string;
  factAmount: number;
  factOrders: number;
  factVisitPct: number;
  saved: boolean;
};

/** Целое из поля ввода: пусто и мусор — это ноль, а не NaN в базе. */
const num = (v: string) => {
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function Cell({ value, onChange, suffix, width = "104px" }: {
  value: string; onChange: (v: string) => void; suffix?: string; width?: string;
}) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
      <input
        className="neo-input font-data"
        inputMode="numeric"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width, textAlign: "right", fontSize: "12px", padding: "6px 8px" }}
      />
      {suffix && <span style={{ fontSize: "11px", color: "var(--color-text-tertiary)" }}>{suffix}</span>}
    </span>
  );
}

function Fact({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.2 }}>
      <span className="font-data" style={{
        fontSize: "12px", fontWeight: 700,
        color: ok ? "var(--color-text-primary)" : "var(--color-text-secondary)",
      }}>
        {value}
      </span>
      <span style={{ fontSize: "10px", color: "var(--color-text-tertiary)" }}>{label}</span>
    </span>
  );
}

export function MonthNorms({ month, lang }: { month: string; lang: string }) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const { fmt } = useCurrency();
  const utils = trpc.useUtils();

  const monthStart = `${month}-01`;
  const periodEnd = monthEnd(month);

  /** Правки, ещё не сохранённые. Ключ — id сотрудника. */
  const [edits, setEdits] = useState<Record<number, { amount?: string; orders?: string; visitPct?: string }>>({});
  const [editedMonth, setEditedMonth] = useState(month);
  // Смена месяца сбрасывает правки без эффекта: держим рядом месяц, к которому
  // они относятся, и при несовпадении просто не читаем их (тот же приём, что
  // у исключённых магазинов в форме дневного плана).
  const pending = useMemo(() => editedMonth === month ? edits : {}, [editedMonth, month, edits]);

  const { data: targets = [], isLoading } = trpc.salesTarget.list.useQuery({
    periodType: "monthly", dateFrom: monthStart, dateTo: periodEnd,
  });
  const { data: overview } = trpc.schedule.monthOverview.useQuery({ month });
  const suggest = trpc.salesTarget.autoSuggest.useQuery(
    { targetMonth: monthStart },
    { enabled: false },
  );

  const rows: Row[] = useMemo(() => {
    const byUser = new Map(targets.map(tg => [tg.userId, tg]));
    return (overview?.rows ?? []).map(agent => {
      const tg = byUser.get(agent.agentId);
      const edit = pending[agent.agentId] ?? {};
      return {
        userId: agent.agentId,
        userName: agent.agentName,
        plannedVisits: agent.planned,
        amount:   edit.amount   ?? (tg ? String(Math.round(Number(tg.targetAmount))) : ""),
        orders:   edit.orders   ?? (tg?.orderCountTarget != null ? String(tg.orderCountTarget) : ""),
        visitPct: edit.visitPct ?? (tg?.visitTarget != null ? String(Math.round(Number(tg.visitTarget))) : ""),
        factAmount:   Number(tg?.actualAmount ?? 0),
        factOrders:   Number(tg?.actualOrderCount ?? 0),
        factVisitPct: Number(tg?.actualVisitPct ?? 0),
        saved: !!tg,
      };
    });
  }, [targets, overview, pending]);

  const setEdit = (userId: number, patch: { amount?: string; orders?: string; visitPct?: string }) => {
    // Первая правка в новом месяце начинает с чистого листа: иначе
    // несохранённые числа прошлого месяца, лежащие в edits у ДРУГИХ
    // сотрудников, стали бы видимыми здесь, как только editedMonth сравняется.
    const fresh = editedMonth !== month;
    setEditedMonth(month);
    setEdits(prev => fresh ? { [userId]: patch } : { ...prev, [userId]: { ...prev[userId], ...patch } });
  };

  const bulk = trpc.salesTarget.bulkUpsert.useMutation({
    onSuccess: (r) => {
      utils.salesTarget.list.invalidate();
      utils.salesTarget.summary.invalidate();
      setEdits({});
      notify.success(t(
        `Нормы сохранены: новых ${r.created}, обновлено ${r.updated}`,
        `Normalar saqlandi: ${r.created} yangi, ${r.updated} yangilandi`,
      ));
    },
    onError: (e) => notify.error(e.message),
  });

  const dirty = Object.keys(pending).length > 0;

  const save = () => {
    /*
      Отправляются только заполненные строки. Пустая строка означает «норму
      этому человеку не ставим», и отправить её нулями значило бы завести
      норму «продать на ноль» — она потом честно показывала бы стопроцентное
      выполнение у того, кто не сделал ничего.
    */
    const payload = rows
      .filter(r => num(r.amount) > 0 || num(r.orders) > 0 || num(r.visitPct) > 0)
      .map(r => ({
        userId: r.userId,
        targetAmount: num(r.amount),
        orderCountTarget: num(r.orders) || undefined,
        visitTarget: Math.min(100, num(r.visitPct)) || undefined,
      }));
    if (payload.length === 0) {
      notify.error(t("Нечего сохранять — все поля пустые", "Saqlashga narsa yo'q"));
      return;
    }
    bulk.mutate({ periodStart: monthStart, periodEnd, targets: payload });
  };

  const applySuggestions = async () => {
    const { data } = await suggest.refetch();
    if (!data || data.length === 0) {
      notify.error(t("По истории подсказать нечего — мало данных", "Tarix bo'yicha taklif yo'q"));
      return;
    }
    setEditedMonth(month);
    setEdits(Object.fromEntries(data.map(s => [s.userId, {
      amount:   String(s.suggestedRevenue),
      orders:   String(s.suggestedOrderCount),
      visitPct: String(s.suggestedVisitPct),
    }])));
    notify.success(t(
      "Подставлено по трём последним месяцам — проверьте и сохраните",
      "Oxirgi uch oy bo'yicha qo'yildi — tekshiring va saqlang",
    ));
  };

  return (
    <div className="neo-card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
        <div>
          <h3 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-text-primary)", margin: 0 }}>
            {t("Нормы на", "Norma")} {monthLabel(month, lang).toLowerCase()}
          </h3>
          <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: "4px 0 0" }}>
            {t("Сумма продаж, число заказов и доля закрытых визитов. Пустое поле — нормы нет.",
               "Savdo summasi, buyurtmalar soni va yopilgan tashriflar ulushi.")}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            onClick={applySuggestions}
            disabled={suggest.isFetching}
            className="neo-btn flex items-center gap-2"
            style={{ fontSize: "12px", padding: "8px 14px" }}
          >
            {suggest.isFetching ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Wand2 size={13} />}
            {t("Подсказать по истории", "Tarix bo'yicha taklif")}
          </button>
          <button
            onClick={save}
            disabled={bulk.isPending || !dirty}
            className="neo-btn-primary flex items-center gap-2"
            style={{ fontSize: "12px", padding: "8px 16px", opacity: dirty && !bulk.isPending ? 1 : 0.5 }}
          >
            {bulk.isPending ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={13} />}
            {t("Сохранить нормы", "Normalarni saqlash")}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: "32px", textAlign: "center" }}>
          <Loader2 size={20} style={{ animation: "spin 1s linear infinite", color: "var(--color-primary-text)" }} />
        </div>
      ) : rows.length === 0 ? (
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", margin: 0, padding: "24px 0", textAlign: "center" }}>
          {t("В организации нет активных агентов.", "Tashkilotda faol agentlar yo'q.")}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ minWidth: "760px" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>{t("Сотрудник", "Xodim")}</th>
                <th style={{ textAlign: "right" }}>{t("Визитов в плане", "Rejadagi tashrif")}</th>
                <th style={{ textAlign: "right" }}>{t("Сумма продаж", "Savdo summasi")}</th>
                <th style={{ textAlign: "right" }}>{t("Заказов", "Buyurtma")}</th>
                <th style={{ textAlign: "right" }}>{t("Визиты", "Tashrif")}</th>
                <th style={{ textAlign: "right" }}>{t("Факт за месяц", "Oylik fakt")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const amountTarget = num(r.amount);
                const pct = amountTarget > 0 ? Math.round((r.factAmount / amountTarget) * 100) : null;
                return (
                  <tr key={r.userId} className="row-hover">
                    <td style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>
                      {r.userName}
                      {!r.saved && (
                        <span style={{ display: "block", fontSize: "10px", fontWeight: 500, color: "var(--color-text-tertiary)" }}>
                          {t("нормы нет", "norma yo'q")}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span className="font-data" style={{ fontSize: "12px", color: r.plannedVisits > 0 ? "var(--color-text-primary)" : "var(--color-text-tertiary)" }}>
                        {r.plannedVisits || "—"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Cell value={r.amount} onChange={v => setEdit(r.userId, { amount: v })} width="128px" />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Cell value={r.orders} onChange={v => setEdit(r.userId, { orders: v })} width="72px" />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Cell value={r.visitPct} onChange={v => setEdit(r.userId, { visitPct: v })} suffix="%" width="64px" />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <span style={{ display: "inline-flex", gap: "14px", alignItems: "flex-start" }}>
                        <Fact label={t("продано", "sotilgan")} value={fmt(r.factAmount)} ok={pct != null && pct >= 100} />
                        <Fact label={t("заказов", "buyurtma")} value={String(r.factOrders)} ok={r.factOrders > 0} />
                        <Fact label={t("визитов", "tashrif")} value={`${Math.round(r.factVisitPct)}%`} ok={r.factVisitPct >= num(r.visitPct) && num(r.visitPct) > 0} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: "11px", color: "var(--color-text-tertiary)", margin: 0 }}>
        {t(
          "«Визиты» — какую долю расставленных визитов сотрудник обязан закрыть. Сам список визитов задаётся на вкладке «Месяц».",
          "«Tashrif» — joylashtirilgan tashriflarning qancha ulushi yopilishi kerak. Ro'yxatning o'zi «Oy» bo'limida.",
        )}
      </p>
    </div>
  );
}
