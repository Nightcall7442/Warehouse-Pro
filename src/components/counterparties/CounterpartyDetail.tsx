import { useState } from "react";
import { format } from "date-fns";
import { Printer, Pencil, Loader2, AlertTriangle } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { AppModal } from "@/components/ui/AppModal";
import { COLORS, F, money, PAYMENT_METHODS } from "./constants";
import type { PayableSupply } from "./PaymentForm";

type Tab = "debts" | "payments" | "reconciliation";

const th: React.CSSProperties = {
  fontFamily: F.display, fontSize: "10px", fontWeight: 600, textTransform: "uppercase",
  letterSpacing: "0.06em", color: COLORS.textTertiary, padding: "10px 12px",
  textAlign: "left", borderBottom: `1px solid ${COLORS.border}`,
  background: COLORS.surfaceLight, whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "11px 12px", borderBottom: `1px solid ${COLORS.border}`,
  fontSize: "13px", color: COLORS.textPrimary,
};

const esc = (s: string | null | undefined) =>
  (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Карточка контрагента: долги, платежи и акт сверки.
 *
 * Три вкладки, а не один длинный свиток: у них разные вопросы. «Сколько
 * должны и по каким партиям» — вкладка долгов, «когда и чем платили» —
 * платежей, «сойдёмся ли мы с заводом» — акт сверки. Смешать их в одну ленту
 * значит заставить искать нужное в чужих строках.
 */
export function CounterpartyDetail({ supplierId, lang, onClose, onEdit, onPay }: {
  supplierId: number;
  lang: string;
  onClose: () => void;
  onEdit: () => void;
  onPay: (supply: PayableSupply) => void;
}) {
  const t = (ru: string, uz: string) => lang === "uz" ? uz : ru;
  const [tab, setTab] = useState<Tab>("debts");
  // Период акта сверки. Пусто — за всё время: так документ открывается с
  // полной картиной, а сузить период — осознанное действие.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: supplies, isLoading: suppliesLoading } =
    trpc.supplier.supplies.useQuery({ supplierId, pageSize: 200 });
  const { data: payments, isLoading: paymentsLoading } =
    trpc.supplier.payments.useQuery({ supplierId, limit: 200 }, { enabled: tab === "payments" });
  const { data: reconciliation, isLoading: reconLoading } =
    trpc.supplier.reconciliation.useQuery(
      { supplierId, from: from || undefined, to: to || undefined },
      { enabled: tab === "reconciliation" },
    );

  const rows = supplies?.data ?? [];
  const name = rows[0]?.supplierName ?? reconciliation?.supplier?.name ?? "";
  const unpaid = rows.filter(r => r.debt > 0);

  const debtUzs = unpaid.filter(r => r.currency === "UZS").reduce((s, r) => s + r.debt, 0);
  const debtUsd = unpaid.filter(r => r.currency === "USD").reduce((s, r) => s + r.debt, 0);

  function printReconciliation() {
    if (!reconciliation) return;
    const w = window.open("", "_blank");
    if (!w) return;

    const period = reconciliation.from || reconciliation.to
      ? `за период ${reconciliation.from ? format(new Date(reconciliation.from), "dd.MM.yyyy") : "начала"} — ${reconciliation.to ? format(new Date(reconciliation.to), "dd.MM.yyyy") : "сегодня"}`
      : "за всё время";

    const blocks = reconciliation.byCurrency.map(block => {
      if (!block) return "";
      const lines = block.rows.map(r => `<tr>
        <td>${format(new Date(r.date), "dd.MM.yyyy")}</td>
        <td>${r.kind === "supply" ? "Поставка" : "Оплата"}</td>
        <td>${esc(r.docNumber)}</td>
        <td class="num">${r.debit ? r.debit.toLocaleString("ru-RU") : ""}</td>
        <td class="num">${r.credit ? r.credit.toLocaleString("ru-RU") : ""}</td>
        <td class="num b">${r.balance.toLocaleString("ru-RU")}</td>
      </tr>`).join("");

      return `<h3>Расчёты в ${block.currency}</h3>
      <table>
        <thead><tr>
          <th>Дата</th><th>Операция</th><th>Документ</th>
          <th class="num">Долг +</th><th class="num">Оплата −</th><th class="num">Остаток</th>
        </tr></thead>
        <tbody>
          <tr class="opening"><td colspan="5">Входящий остаток</td><td class="num b">${block.opening.toLocaleString("ru-RU")}</td></tr>
          ${lines}
          <tr class="closing">
            <td colspan="3">Обороты за период</td>
            <td class="num">${block.turnoverDebit.toLocaleString("ru-RU")}</td>
            <td class="num">${block.turnoverCredit.toLocaleString("ru-RU")}</td>
            <td class="num b">${block.closing.toLocaleString("ru-RU")}</td>
          </tr>
        </tbody>
      </table>
      <p class="total">Задолженность на конец периода: <b>${block.closing.toLocaleString("ru-RU")} ${block.currency}</b></p>`;
    }).join("");

    w.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8">
      <title>Акт сверки — ${esc(reconciliation.supplier?.name)}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:28px}
        h1{font-size:18px;margin:0 0 4px}
        h3{font-size:13px;margin:22px 0 8px}
        .meta{color:#555;margin-bottom:6px}
        table{width:100%;border-collapse:collapse;margin-bottom:8px}
        th,td{border:1px solid #bbb;padding:6px 8px;text-align:left}
        th{background:#f0f0f0}
        .num{text-align:right;white-space:nowrap}
        .b{font-weight:700}
        .opening td,.closing td{background:#f7f7f7;font-weight:600}
        .total{font-size:13px;margin:0 0 18px}
        .sign{margin-top:36px;display:flex;justify-content:space-between}
        .sign div{width:45%;border-top:1px solid #333;padding-top:6px}
      </style></head><body>
      <h1>Акт сверки взаимных расчётов</h1>
      <div class="meta">Контрагент: <b>${esc(reconciliation.supplier?.name)}</b>${reconciliation.supplier?.inn ? ` · ИНН ${esc(reconciliation.supplier.inn)}` : ""}</div>
      <div class="meta">Период: ${period}</div>
      <div class="meta">Составлен: ${format(new Date(), "dd.MM.yyyy")}</div>
      ${blocks || "<p>Движений за период не было.</p>"}
      <div class="sign"><div>От нашей организации</div><div>От контрагента</div></div>
      <script>window.onload=()=>window.print()</script>
      </body></html>`);
    w.document.close();
  }

  return (
    <AppModal
      open
      onClose={onClose}
      maxWidth={860}
      title={name || t("Контрагент", "Kontragent")}
      subtitle={t("Расчёты и задолженность", "Hisob-kitob va qarzdorlik")}
      headerActions={
        <button
          onClick={onEdit}
          className="neo-btn-icon"
          aria-label={t("Изменить", "O'zgartirish")}
          style={{ width: "40px", height: "40px", background: "color-mix(in srgb, var(--color-on-primary, #ffffff) 18%, transparent)", color: "var(--color-on-primary, #ffffff)", borderRadius: "12px" }}
        >
          <Pencil size={17} />
        </button>
      }
    >
      {/* Сводка долга — всегда наверху, независимо от вкладки: это главный
          вопрос к карточке, и он не должен зависеть от того, куда человек
          успел переключиться. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "12px", marginBottom: "4px" }}>
        {[
          { label: t("Долг, сум", "Qarz, so'm"), value: money(debtUzs, "UZS"), danger: debtUzs > 0 },
          ...(debtUsd > 0 ? [{ label: t("Долг, $", "Qarz, $"), value: money(debtUsd, "USD"), danger: true }] : []),
          { label: t("Непогашенных поставок", "To'lanmagan yetkazishlar"), value: String(unpaid.length), danger: false },
        ].map(card => (
          <div key={card.label} style={{ padding: "14px 16px", borderRadius: "12px", background: COLORS.surfaceLight }}>
            <p style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: COLORS.textTertiary, margin: "0 0 6px" }}>{card.label}</p>
            <p style={{ fontSize: "18px", fontWeight: 700, color: card.danger ? COLORS.dangerText : COLORS.textPrimary, margin: 0 }}>{card.value}</p>
          </div>
        ))}
      </div>

      {/* Вкладки */}
      <div style={{ display: "flex", gap: "6px", borderBottom: `1px solid ${COLORS.border}`, marginBottom: "4px" }}>
        {([
          { key: "debts" as const,          label: t("Долги", "Qarzlar") },
          { key: "payments" as const,       label: t("Платежи", "To'lovlar") },
          { key: "reconciliation" as const, label: t("Акт сверки", "Solishtirma dalolatnoma") },
        ]).map(x => (
          <button
            key={x.key}
            data-testid={`cp-tab-${x.key}`}
            onClick={() => setTab(x.key)}
            style={{
              padding: "10px 16px", border: "none", background: "none", cursor: "pointer",
              fontFamily: F.body, fontSize: "13px",
              fontWeight: tab === x.key ? 700 : 500,
              color: tab === x.key ? COLORS.primaryText : COLORS.textSecondary,
              borderBottom: `2px solid ${tab === x.key ? "var(--color-primary)" : "transparent"}`,
              marginBottom: "-1px",
            }}
          >
            {x.label}
          </button>
        ))}
      </div>

      {/* ── Долги ── */}
      {tab === "debts" && (
        suppliesLoading ? <Loading /> : rows.length === 0 ? (
          <Empty text={t("Поставок нет", "Yetkazib berishlar yo'q")} />
        ) : (
          <div style={{ overflowX: "auto", borderRadius: "12px", border: `1px solid ${COLORS.border}` }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: "620px" }}>
              <thead>
                <tr>{[t("Документ", "Hujjat"), t("Дата", "Sana"), t("Срок", "Muddat"), t("Сумма", "Summa"), t("Оплачено", "To'langan"), t("Остаток", "Qoldiq"), ""].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id}>
                    <td style={td}>
                      <div style={{ fontWeight: 500 }}>{r.supplyNumber}</div>
                      {r.arrivalNumber && <div style={{ fontSize: "11px", color: COLORS.textTertiary }}>{r.arrivalNumber}</div>}
                    </td>
                    <td style={{ ...td, color: COLORS.textSecondary, whiteSpace: "nowrap" }}>{format(new Date(r.supplyDate), "dd.MM.yyyy")}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: r.overdue ? COLORS.dangerText : COLORS.textSecondary, fontWeight: r.overdue ? 600 : 400 }}>
                      {r.dueDate ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                          {r.overdue && <AlertTriangle size={12} />}
                          {format(new Date(r.dueDate), "dd.MM.yyyy")}
                        </span>
                      ) : "—"}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{money(r.amount, r.currency)}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", color: COLORS.successText }}>{money(r.paid, r.currency)}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 700, color: r.debt > 0 ? COLORS.dangerText : COLORS.textTertiary }}>
                      {money(r.debt, r.currency)}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {r.debt > 0 && (
                        <button
                          data-testid={`cp-pay-${r.id}`}
                          onClick={() => onPay({ id: r.id, supplyNumber: r.supplyNumber, supplierName: r.supplierName, currency: r.currency, debt: r.debt })}
                          className="neo-btn-primary neo-btn-sm"
                          style={{ whiteSpace: "nowrap" }}
                        >
                          {t("Оплатить", "To'lash")}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Платежи ── */}
      {tab === "payments" && (
        paymentsLoading ? <Loading /> : (payments ?? []).length === 0 ? (
          <Empty text={t("Платежей не было", "To'lovlar bo'lmagan")} />
        ) : (
          <div style={{ overflowX: "auto", borderRadius: "12px", border: `1px solid ${COLORS.border}` }}>
            <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: "560px" }}>
              <thead>
                <tr>{[t("Дата", "Sana"), t("Документ", "Hujjat"), t("Способ", "Usul"), t("Кто внёс", "Kim kiritdi"), t("Сумма", "Summa")].map(h => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {(payments ?? []).map(p => (
                  <tr key={p.id}>
                    <td style={{ ...td, whiteSpace: "nowrap", color: COLORS.textSecondary }}>{format(new Date(p.paidAt), "dd.MM.yyyy")}</td>
                    <td style={td}>{p.supplyNumber}</td>
                    <td style={{ ...td, color: COLORS.textSecondary }}>{PAYMENT_METHODS[p.paymentMethod]?.[lang === "uz" ? "uz" : "ru"] ?? p.paymentMethod}</td>
                    <td style={{ ...td, color: COLORS.textSecondary }}>{p.authorName ?? "—"}</td>
                    <td style={{ ...td, whiteSpace: "nowrap", fontWeight: 700, color: COLORS.successText }}>{money(p.amount, p.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Акт сверки ── */}
      {tab === "reconciliation" && (
        <div>
          <div style={{ display: "flex", gap: "10px", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "14px" }}>
            <div>
              <label style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: COLORS.textTertiary, display: "block", marginBottom: "4px" }}>{t("С", "Dan")}</label>
              <input type="date" className="neo-input" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: COLORS.textTertiary, display: "block", marginBottom: "4px" }}>{t("По", "Gacha")}</label>
              <input type="date" className="neo-input" value={to} onChange={e => setTo(e.target.value)} />
            </div>
            <button
              onClick={printReconciliation}
              disabled={!reconciliation}
              className="neo-btn"
              style={{ height: "42px", display: "flex", alignItems: "center", gap: "6px", opacity: reconciliation ? 1 : 0.5 }}
            >
              <Printer size={15} /> {t("Печать", "Chop etish")}
            </button>
          </div>

          {reconLoading ? <Loading /> : !reconciliation || reconciliation.byCurrency.length === 0 ? (
            <Empty text={t("Движений за период не было", "Davr uchun harakat bo'lmagan")} />
          ) : reconciliation.byCurrency.map(block => block && (
            <div key={block.currency} style={{ marginBottom: "20px" }}>
              <p style={{ fontSize: "12px", fontWeight: 700, color: COLORS.textPrimary, margin: "0 0 8px" }}>
                {t("Расчёты в", "Hisob-kitob")} {block.currency}
              </p>
              <div style={{ overflowX: "auto", borderRadius: "12px", border: `1px solid ${COLORS.border}` }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: "600px" }}>
                  <thead>
                    <tr>{[t("Дата", "Sana"), t("Операция", "Amal"), t("Документ", "Hujjat"), t("Долг +", "Qarz +"), t("Оплата −", "To'lov −"), t("Остаток", "Qoldiq")].map(h => <th key={h} style={th}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    <tr style={{ background: COLORS.surfaceLight }}>
                      <td style={{ ...td, fontWeight: 600 }} colSpan={5}>{t("Входящий остаток", "Kirish qoldig'i")}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{block.opening.toLocaleString("ru-RU")}</td>
                    </tr>
                    {block.rows.map((r, i) => (
                      <tr key={i}>
                        <td style={{ ...td, whiteSpace: "nowrap", color: COLORS.textSecondary }}>{format(new Date(r.date), "dd.MM.yyyy")}</td>
                        <td style={td}>{r.kind === "supply" ? t("Поставка", "Yetkazish") : t("Оплата", "To'lov")}</td>
                        <td style={{ ...td, color: COLORS.textSecondary }}>{r.docNumber}</td>
                        <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>{r.debit ? r.debit.toLocaleString("ru-RU") : ""}</td>
                        <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap", color: COLORS.successText }}>{r.credit ? r.credit.toLocaleString("ru-RU") : ""}</td>
                        <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap", fontWeight: 600 }}>{r.balance.toLocaleString("ru-RU")}</td>
                      </tr>
                    ))}
                    <tr style={{ background: COLORS.surfaceLight }}>
                      <td style={{ ...td, fontWeight: 600 }} colSpan={3}>{t("Обороты за период", "Davr aylanmasi")}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{block.turnoverDebit.toLocaleString("ru-RU")}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600, whiteSpace: "nowrap" }}>{block.turnoverCredit.toLocaleString("ru-RU")}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700, whiteSpace: "nowrap", color: block.closing > 0 ? COLORS.dangerText : COLORS.textPrimary }}>
                        {block.closing.toLocaleString("ru-RU")}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppModal>
  );
}

function Loading() {
  return (
    <div style={{ padding: "40px", textAlign: "center" }}>
      <Loader2 size={26} className="animate-spin" style={{ color: "var(--color-primary-text)" }} />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: "40px", textAlign: "center", color: COLORS.textTertiary, fontSize: "13px" }}>
      {text}
    </div>
  );
}
