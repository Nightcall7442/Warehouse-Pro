import { format } from "date-fns";
import { amountInWords } from "@contracts/amount-in-words";
import { dayToRu, localDay } from "@contracts/statement-period";

/* ═══════════════════════════════════════════════════════════════════════════
   Печатный акт сверки — по образцу 1С.

   Прежняя печать была таблицей «Дата / Операция / Документ / Долг + / Оплата − /
   Остаток» с двумя линиями подписи. Для экрана это удобно, а как документ
   бухгалтер магазина его не принимал (09.10.2026, «не полно функциональный»):
   он сверяет акт со своей 1С и ждёт привычный бланк —

     · шапку «Акт сверки взаимных расчётов за период … между … и …»;
     · вступление «Мы, нижеподписавшиеся…»;
     · две половины таблицы: «По данным» нашей стороны и «По данным» его
       стороны. Вторую он заполняет сам, потому она пустая;
     · Дебет/Кредит вместо «Долг +/Оплата −», сальдо начальное, обороты,
       сальдо конечное — сальдо в том столбце, на чьей оно стороне;
     · итоговую фразу «на дату задолженность в пользу … составляет … (прописью)»;
     · подписи сторон и места для печатей.

   Дебет — то, что увеличивает долг покупателя перед нами (отгрузка,
   начисление), кредит — то, что уменьшает (оплата, возврат). Ровно как у
   строк акта на экране, только словами бухгалтера.

   Бумага — по-русски, как все печатные формы в системе.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ReconciliationRow {
  date: Date | string;
  kind: string;
  doc: string | null;
  note: string | null;
  debit: number;
  credit: number;
}

export interface ReconciliationPrintInput {
  shop: { name: string; ownerName: string | null; taxId: string | null; address: string | null };
  company: { name: string; inn?: string; director?: string };
  /** Даты периода так, как их выбрал человек («ГГГГ-ММ-ДД»); пустая — открыт. */
  period: { from: string; to: string };
  opening: number;
  rows: ReconciliationRow[];
  totals: { debit: number; credit: number };
  closing: number;
  /** Слово валюты для бумаги — по-русски («сум», «$»). */
  currency: string;
  /** Сумма прописью — только для сумов: склонять доллары по-русски этим кодом нельзя. */
  inWords: boolean;
  today?: Date;
}

const KIND_RU: Record<string, string> = {
  order:   "Отгрузка",
  payment: "Оплата",
  debt:    "Начисление долга",
  return:  "Возврат от покупателя",
};

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

const num = (v: number) => (Math.round(v * 100) / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Название операции для столбца «Документ»: вид, номер, а у ручных записей — примечание. */
export function reconciliationDocLabel(r: Pick<ReconciliationRow, "kind" | "doc" | "note">): string {
  const base = KIND_RU[r.kind] ?? r.kind;
  if (r.doc) return `${base} № ${r.doc}`;
  const note = (r.note ?? "").trim();
  return note ? `${base} (${note.length > 60 ? `${note.slice(0, 57)}…` : note})` : base;
}

/** Сальдо — в своём столбце: долг покупателя в дебете, переплата в кредите. */
function saldoCells(v: number): string {
  return v > 0 ? `<td class="num">${num(v)}</td><td></td>`
       : v < 0 ? `<td></td><td class="num">${num(-v)}</td>`
       : `<td></td><td></td>`;
}

/** Итоговая фраза: в чью пользу и сколько. */
export function reconciliationConclusion(input: Pick<ReconciliationPrintInput, "closing" | "company" | "shop" | "inWords" | "currency">, onDay: string): string {
  const ours = input.company.name || "нашей организации";
  if (Math.round(input.closing * 100) === 0) return `на ${onDay} задолженность отсутствует.`;
  const inFavor = input.closing > 0 ? ours : input.shop.name;
  const sum = `${num(Math.abs(input.closing))} ${input.currency}`;
  return `на ${onDay} задолженность в пользу ${inFavor} составляет ${sum}${input.inWords ? ` (${amountInWords(input.closing)})` : ""}.`;
}

export function reconciliationHtml(input: ReconciliationPrintInput): string {
  const today = input.today ?? new Date();
  const ours = input.company.name || "Наша организация";
  const fromRu = input.period.from ? dayToRu(input.period.from) : "";
  const toRu = dayToRu(input.period.to || localDay(today));
  const periodText = fromRu ? `${fromRu} — ${toRu}` : `весь период по ${toRu}`;

  const blank = `<td></td><td></td><td></td><td></td>`;
  const lines = input.rows.map(r => `<tr>
      <td>${esc(format(new Date(r.date), "dd.MM.yyyy"))}</td>
      <td>${esc(reconciliationDocLabel(r))}</td>
      <td class="num">${r.debit ? num(r.debit) : ""}</td>
      <td class="num">${r.credit ? num(r.credit) : ""}</td>
      ${blank}
    </tr>`).join("");

  const party = (name: string, inn: string | null | undefined) =>
    `<b>${esc(name)}</b>${inn ? `, ИНН ${esc(inn)}` : ""}`;

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>Акт сверки — ${esc(input.shop.name)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:#111;padding:14mm}
  h1{font-size:17px;text-align:center;margin:0}
  .center{text-align:center}
  .sub{text-align:center;margin:1.5mm 0 4mm;line-height:1.5}
  p{margin:2mm 0;line-height:1.45}
  table{width:100%;border-collapse:collapse;margin-top:3mm}
  th,td{border:1px solid #777;padding:1.6mm 2mm;text-align:left;vertical-align:top}
  th{background:#eee;font-weight:bold;text-align:center}
  .num{text-align:right;white-space:nowrap}
  .b td{font-weight:bold;background:#f4f4f4}
  .side{width:50%}
  .conclusion{margin-top:4mm}
  .sign{display:flex;justify-content:space-between;gap:10mm;margin-top:10mm}
  .sign>div{width:48%;line-height:2}
  .line{display:inline-block;min-width:38mm;border-bottom:1px solid #333}
  .mp{margin-top:4mm;color:#555}
  @page{margin:10mm}
  thead{display:table-header-group}
  tr{break-inside:avoid;page-break-inside:avoid}
  @media print{body{padding:0}th,.b td{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head><body>
<h1>Акт сверки</h1>
<div class="sub">взаимных расчётов за ${esc(periodText)}<br>
между ${esc(ours)} и ${esc(input.shop.name)}</div>
<p>Мы, нижеподписавшиеся, ${party(ours, input.company.inn)}, с одной стороны, и ${party(input.shop.name, input.shop.taxId)}, с другой стороны,
составили настоящий акт сверки в том, что состояние взаимных расчётов по данным учёта следующее:</p>
<table>
  <thead>
    <tr><th colspan="4" class="side">По данным ${esc(ours)}, ${esc(input.currency)}</th><th colspan="4" class="side">По данным ${esc(input.shop.name)}, ${esc(input.currency)}</th></tr>
    <tr><th>Дата</th><th>Документ</th><th>Дебет</th><th>Кредит</th><th>Дата</th><th>Документ</th><th>Дебет</th><th>Кредит</th></tr>
  </thead>
  <tbody>
    <tr class="b"><td colspan="2">Сальдо начальное</td>${saldoCells(input.opening)}<td colspan="2">Сальдо начальное</td><td></td><td></td></tr>
    ${lines || `<tr><td colspan="4">Движений за период не было.</td>${blank}</tr>`}
    <tr class="b"><td colspan="2">Обороты за период</td><td class="num">${num(input.totals.debit)}</td><td class="num">${num(input.totals.credit)}</td><td colspan="2">Обороты за период</td><td></td><td></td></tr>
    <tr class="b"><td colspan="2">Сальдо конечное</td>${saldoCells(input.closing)}<td colspan="2">Сальдо конечное</td><td></td><td></td></tr>
  </tbody>
</table>
<p class="conclusion">По данным <b>${esc(ours)}</b><br><b>${esc(reconciliationConclusion(input, toRu))}</b></p>
<div class="sign">
  <div>От ${esc(ours)}<br>
    Руководитель <span class="line"></span> ${input.company.director ? `(${esc(input.company.director)})` : "(<span class=\"line\" style=\"min-width:28mm\"></span>)"}<br>
    <span class="mp">М.П.</span></div>
  <div>От ${esc(input.shop.name)}<br>
    <span class="line"></span> ${input.shop.ownerName ? `(${esc(input.shop.ownerName)})` : "(<span class=\"line\" style=\"min-width:28mm\"></span>)"}<br>
    <span class="mp">М.П.</span></div>
</div>
<script>window.onload=()=>{window.focus();window.onafterprint=()=>window.close();window.print()}</script>
</body></html>`;
}
