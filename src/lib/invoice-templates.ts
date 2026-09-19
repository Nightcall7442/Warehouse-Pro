/*
  Накладная — три шаблона и одна раскладка экземпляров.

  ── Зачем ───────────────────────────────────────────────────────────────────

  Владелец (19.09.2026): «накладные занимают больше места на бумаге и нет
  номера магазинов; сделай настройки, где накладную можно кастомизировать
  полностью, и два-три готовых шаблона» — и принёс образец конкурента:
  полстраницы на экземпляр, два рядом на альбомном листе, телефон магазина,
  агент с телефоном, знак поставщика системы в углу.

  До этого накладных было две и обе без выбора: карточка заказа печатала
  «Классическую» (реквизиты, Times, два экземпляра друг под другом), пачка из
  «Заказов» — «Подробную» (сетка, долг магазина, штрих-код). Здесь обе живут
  как шаблоны рядом с «Компактной», а что печатать (телефон, агент, код
  товара, долг, подписи…) — галочки поверх умолчаний шаблона
  (contracts/invoice-template.ts).

  ── Как устроено ────────────────────────────────────────────────────────────

  InvoiceView — одна форма данных для всех шаблонов; в неё приводятся и
  OrderDocData из карточки заказа, и BatchOrderData из пачки (адаптеры в
  documents.ts). Шаблон рисует ОДИН экземпляр; раскладку экземпляров —
  один или два, друг под другом или рядом — делает composeInvoicePages, и
  она одна на все шаблоны. Бумага — по-русски всегда (memory:
  paper-stays-russian): подписи здесь не переводятся.
*/
import type { InvoiceOptions, InvoiceTemplateId } from "@contracts/invoice-template";
import { unitShort as unitLabel } from "./units";
import { code128Svg } from "./code128";

export type InvoiceView = {
  number: string;
  /** «01.09.2026» — дата заказа. */
  date: string;
  /** «19.09.2026 12:53» — когда напечатали. */
  printedAt: string;
  currency: string;
  company: { name: string; inn?: string; address?: string; phone?: string; bank?: string; account?: string; mfo?: string; director?: string; logoUrl?: string };
  shop: { name: string; phone?: string; address?: string; owner?: string; inn?: string };
  agent?: { name: string; phone?: string };
  courier?: { name: string };
  territory?: string;
  items: Array<{ code?: string; name: string; unit?: string; qty: number; orderedQty?: number; price: number; total: number; returnReason?: string }>;
  subtotal: number;
  discount: number;
  total: number;
  paymentLabel?: string;
  /** Довезли не всё: печатаются заказанное и отпущенное. */
  isPartial: boolean;
  notes?: string;
  /** Долг магазина на момент печати и последняя оплата за 30 дней — для экспедитора. */
  debt?: { current: number; lastPayment?: { amount: number; date: string } };
  /** Текст в подвале — из «Брендинга» арендатора. */
  footerNote?: string;
};

export const COPY_LABELS = [
  "ЭКЗЕМПЛЯР 1 ИЗ 2 — ПОКУПАТЕЛЮ",
  "ЭКЗЕМПЛЯР 2 ИЗ 2 — ВОЗВРАЩАЕТСЯ ПОСТАВЩИКУ С ПОДПИСЬЮ ПОКУПАТЕЛЯ",
] as const;

export function escapeHtml(str: string | null | undefined): string {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 70.00 → 70, 12.50 → 12,5 — без хвостовых нулей. */
export function cleanNum(val: string | number | null | undefined): string {
  const n = Number(val ?? 0);
  if (n === 0) return "0";
  if (n === Math.floor(n)) return n.toLocaleString("ru-RU");
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

const money = (n: number) => n.toLocaleString("ru-RU");

/*
  Знак Warehouse Pro для бумаги — тот же, что в шапке приложения
  (components/brand/Logo.tsx), только строкой и без градиентов: принтеру они
  ни к чему. Печатается ТОЛЬКО когда арендатор выбрал «Warehouse Pro» в
  графе «Логотип» — по умолчанию у «Компактной», как на образце владельца.
*/
const WP_MARK_SVG = `<svg width="22" height="22" viewBox="0 0 100 100" aria-hidden="true"><polygon points="2,24 18,24 38,80 22,80" fill="#0f766e"/><polygon points="22,80 38,80 58,42 42,42" fill="#14b8a6"/><polygon points="42,42 58,42 78,80 62,80" fill="#0f766e"/><polygon points="62,80 78,80 98,24 82,24" fill="#14b8a6"/><circle cx="90" cy="12" r="5.5" fill="#d97706"/></svg>`;

function logoBlock(view: InvoiceView, opts: InvoiceOptions, height = 22): string {
  if (opts.logo === "warehouse-pro") {
    // Единственное место, где имя поставщика системы попадает на бумагу арендатора, — по его же выбору (владелец, 19.09.2026).
    return `<span class="inv-logo" style="display:inline-flex;align-items:center;gap:5px;font-weight:700;font-size:9pt;letter-spacing:-0.02em;color:#2b2a28">${WP_MARK_SVG}Warehouse Pro</span>`;
  }
  if (opts.logo === "company" && view.company.logoUrl) {
    return `<img class="inv-logo" src="${escapeHtml(view.company.logoUrl)}" alt="" style="height:${height}px;max-width:120px;object-fit:contain">`;
  }
  return "";
}

function barcodeCell(value: string | null | undefined): string {
  if (!value) return "";
  try { return `<div style="height:9mm">${code128Svg(value, { height: 28, label: false }).replace(/ width="\d+" height="\d+"/, ' style="height:100%"')}</div>`; }
  catch { return ""; }
}

function partialNote(item: InvoiceView["items"][number], size = "8pt"): string {
  const ordered = item.orderedQty;
  if (ordered == null || item.qty >= ordered) return "";
  const reason = (item.returnReason ?? "").trim();
  return `<div style="font-size:${size};color:#666">заказано ${cleanNum(ordered)}, отпущено ${cleanNum(item.qty)}${escapeHtml(reason ? `, ${reason}` : "")}</div>`;
}

function metaRow(label: string, value: string | null | undefined, bold = false): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  return `<div class="meta-row"><span class="meta-label">${escapeHtml(label)}</span>`
    + `<span class="meta-value${bold ? " bold" : ""}">${escapeHtml(v)}</span></div>`;
}

const DEBT_ACCENT = "#b45309";
export function debtBlock(view: InvoiceView): string {
  const d = view.debt;
  if (!d || d.current <= 0) return "";
  const paymentLine = d.lastPayment
    ? `Последний платёж: ${escapeHtml(d.lastPayment.date)} — ${money(d.lastPayment.amount)} ${escapeHtml(view.currency)}`
    : "Платежей за 30 дней нет";
  return `
    <div class="debt-box" style="margin:4px 0;padding:4px 8px;border:1px solid rgba(180,83,9,.25);background:rgba(180,83,9,.03);font-size:8pt">
      <b style="color:${DEBT_ACCENT}">Долг магазина: ${money(d.current)} ${escapeHtml(view.currency)}</b>
      ${view.total > 0 ? `<span style="margin-left:8px">К оплате с этой поставкой: <b>${money(d.current + view.total)} ${escapeHtml(view.currency)}</b></span>` : ""}
      <span style="margin-left:8px;color:#666">${paymentLine}</span>
    </div>`;
}

const totalQty = (view: InvoiceView) => view.items.reduce((s, i) => s + i.qty, 0);

/* ── 1. Классическая ──────────────────────────────────────────────────────── */
function renderClassic(view: InvoiceView, opts: InvoiceOptions): string {
  const cur = escapeHtml(view.currency);
  const rows = view.items.map((item, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${escapeHtml(item.name)}${opts.showProductCode && item.code ? ` (${escapeHtml(item.code)})` : ""}${partialNote(item)}</td>
      ${opts.showUnit ? `<td class="center">${unitLabel(item.unit)}</td>` : ""}
      <td class="center">${cleanNum(item.qty)}</td>
      <td class="right">${money(item.price)}</td>
      <td class="right">${money(item.total)}</td>
    </tr>`).join("");
  const cols = opts.showUnit ? 6 : 5;
  const partyExtra = [
    opts.showShopPhone ? metaRow("Телефон:", view.shop.phone) : "",
    opts.showAgent && view.agent ? metaRow("Агент:", `${view.agent.name}${opts.showAgentPhone && view.agent.phone ? ` (${view.agent.phone})` : ""}`) : "",
    opts.showCourier && view.courier ? metaRow("Курьер:", view.courier.name) : "",
    opts.showPaymentMethod ? metaRow("Оплата:", view.paymentLabel) : "",
  ].join("");
  return `
      ${logoBlock(view, opts, 26) ? `<div style="display:flex;justify-content:flex-end;margin-bottom:2px">${logoBlock(view, opts, 26)}</div>` : ""}
      <table class="no-border" style="margin-bottom:4px">
        <tr>
          <td style="width:50%">
            <div class="meta">
              ${metaRow("Поставщик:", view.company.name, true)}
              ${metaRow("ИНН / СТИР:", view.company.inn)}
              ${metaRow("Адрес:", view.company.address)}
              ${metaRow("Банк:", view.company.bank)}
              ${metaRow("Р/с:", view.company.account)}
              ${metaRow("МФО:", view.company.mfo)}
            </div>
          </td>
          <td style="width:50%">
            <div class="meta">
              ${metaRow("Покупатель:", view.shop.name, true)}
              ${metaRow("ИНН / СТИР:", view.shop.inn)}
              ${opts.showShopAddress ? metaRow("Адрес:", view.shop.address) : ""}
              ${partyExtra}
            </div>
          </td>
        </tr>
      </table>

      <div class="title">РАСХОДНАЯ НАКЛАДНАЯ</div>
      <div class="subtitle">№ ${escapeHtml(view.number)} от ${escapeHtml(view.date)}${opts.showPrintedAt ? ` · напечатано ${escapeHtml(view.printedAt)}` : ""}</div>
      ${opts.showBarcode ? `<div style="display:flex;justify-content:center;margin-bottom:4px">${barcodeCell(view.number)}</div>` : ""}
      ${opts.showDebt ? debtBlock(view) : ""}

      <table>
        <thead>
          <tr>
            <th style="width:4%">№</th>
            <th>Наименование товара</th>
            ${opts.showUnit ? `<th style="width:7%">Ед.</th>` : ""}
            <th style="width:8%">Кол-во</th>
            <th style="width:12%">Цена (${cur})</th>
            <th style="width:15%">Сумма (${cur})</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr>
            <td colspan="${cols - 3}" class="right bold">ИТОГО:</td>
            <td class="center bold">${cleanNum(totalQty(view))}</td>
            <td></td>
            <td class="right bold">${money(view.subtotal)} ${cur}</td>
          </tr>
          ${opts.showDiscount && view.discount > 0 ? `
          <tr>
            <td colspan="${cols - 1}" class="right">Скидка:</td>
            <td class="right">−${money(view.discount)} ${cur}</td>
          </tr>` : ""}
          <tr>
            <td colspan="${cols - 1}" class="right bold">К ОПЛАТЕ:</td>
            <td class="right bold">${money(view.total)} ${cur}</td>
          </tr>
        </tbody>
      </table>

      ${opts.showNotes && view.notes ? `<p style="margin-top:8px;font-size:10pt"><b>Примечание:</b> ${escapeHtml(view.notes)}</p>` : ""}

      ${opts.showSignatures ? `
      <div class="signature-block">
        <div class="sig-row">
          <div class="sig-col">
            <div class="sig-label">Отпустил (Сдал)</div>
            <div class="sig-line"></div>
            <div class="sig-label">${view.company.director ? `Директор: ${escapeHtml(view.company.director)}` : "___________________________"}</div>
          </div>
          <div class="sig-col">
            <div class="sig-label">Получил (Принял)</div>
            <div class="sig-line"></div>
            <div class="sig-label">___________________________</div>
          </div>
          <div class="sig-col">
            <div class="sig-label">Дата</div>
            <div class="sig-line"></div>
            <div class="sig-label">"____" ____________ 20___ г.</div>
          </div>
        </div>
      </div>` : ""}
    `;
}

/* ── 2. Компактная — образец владельца ────────────────────────────────────── */
function renderCompact(view: InvoiceView, opts: InvoiceOptions): string {
  const cur = escapeHtml(view.currency);
  const rows = view.items.map(item => `
    <tr>
      ${opts.showProductCode ? `<td class="c-code">${escapeHtml(item.code ?? "")}</td>` : ""}
      <td>${escapeHtml(item.name)}${opts.showUnit ? ` <span class="c-unit">${unitLabel(item.unit)}</span>` : ""}${partialNote(item, "7pt")}</td>
      <td class="right">${cleanNum(item.qty)}</td>
      <td class="right">${money(item.price)}</td>
      <td class="right">${money(item.total)}</td>
    </tr>`).join("");
  const meta = (label: string, value: string | null | undefined) =>
    value && value.trim() ? `<div><span class="c-label">${escapeHtml(label)}:</span> <b>${escapeHtml(value)}</b></div>` : "";
  const left = [
    meta("Дата", view.date),
    meta("Клиент", view.shop.name),
    opts.showShopPhone ? meta("Телефон", view.shop.phone) : "",
    opts.showShopAddress ? meta("Адрес", view.shop.address) : "",
  ].join("");
  const right = [
    opts.showPrintedAt ? meta("Напечатано", view.printedAt) : "",
    opts.showAgent && view.agent ? meta("Агент", `${view.agent.name}${opts.showAgentPhone && view.agent.phone ? ` (${view.agent.phone})` : ""}`) : "",
    opts.showCourier && view.courier ? meta("Курьер", view.courier.name) : "",
    meta("Поставщик", view.company.name),
    opts.showPaymentMethod ? meta("Оплата", view.paymentLabel) : "",
  ].join("");
  return `
      <div class="c-head">
        <div class="c-title">Накладная №: ${escapeHtml(view.number)}</div>
        <div style="display:flex;align-items:center;gap:8px">${opts.showBarcode ? barcodeCell(view.number) : ""}${logoBlock(view, opts)}</div>
      </div>
      <div class="c-meta"><div>${left}</div><div>${right}</div></div>
      ${opts.showDebt ? debtBlock(view) : ""}
      <table class="c-table">
        <thead><tr>
          ${opts.showProductCode ? `<th style="width:11%">Артикул</th>` : ""}
          <th>Наименование товара</th>
          <th style="width:9%">Кол-во</th>
          <th style="width:15%">Цена</th>
          <th style="width:17%">Сумма</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <table class="c-table c-totals">
        <thead><tr>
          <th>Оплачено</th><th>Тип оплаты</th><th>Возвращено</th><th>Итого кол.</th><th>Общая сумма</th>
        </tr></thead>
        <tbody><tr>
          <td>&nbsp;</td>
          <td>${opts.showPaymentMethod ? escapeHtml(view.paymentLabel ?? "") : "&nbsp;"}</td>
          <td>&nbsp;</td>
          <td class="bold">${cleanNum(totalQty(view))}</td>
          <td class="bold">${money(view.total)} ${cur}${opts.showDiscount && view.discount > 0 ? `<div style="font-weight:400;font-size:7pt;color:#555">со скидкой −${money(view.discount)}</div>` : ""}</td>
        </tr></tbody>
      </table>
      ${opts.showNotes && view.notes ? `<div style="margin-top:3px;font-size:7.5pt"><b>Примечание:</b> ${escapeHtml(view.notes)}</div>` : ""}
      ${opts.showSignatures ? `<div class="c-sign"><span>Отправил: ____________________</span><span>Принял: ____________________</span></div>` : ""}
    `;
}

/* ── 3. Подробная — для экспедитора ───────────────────────────────────────── */
function renderDetailed(view: InvoiceView, opts: InvoiceOptions): string {
  const cur = escapeHtml(view.currency);
  const rows = view.items.map((item, i) => {
    const qtyCol = view.isPartial
      ? `<td class="right" style="text-decoration:line-through;color:#999">${cleanNum(item.orderedQty ?? item.qty)}</td><td class="right bold">${cleanNum(item.qty)}</td>`
      : `<td class="right">${cleanNum(item.qty)}</td>`;
    return `
      <tr>
        <td class="center">${i + 1}</td>
        <td>${escapeHtml(item.name)}${opts.showProductCode && item.code ? ` <span style="color:#666;font-size:8pt">(${escapeHtml(item.code)})</span>` : ""}</td>
        ${opts.showUnit ? `<td class="center">${unitLabel(item.unit)}</td>` : ""}
        ${qtyCol}
        <td class="right">${money(item.price)}</td>
        <td class="right bold">${money(item.total)}</td>
      </tr>`;
  }).join("");
  const qtyHeader = view.isPartial ? '<th style="width:9%">Заказ</th><th style="width:9%">Отдали</th>' : '<th style="width:9%">Кол-во</th>';
  const facts = [
    view.shop.name ? `<span>Магазин: <b>${escapeHtml(view.shop.name)}</b></span>` : "",
    opts.showShopPhone && view.shop.phone ? `<span>Тел.: ${escapeHtml(view.shop.phone)}</span>` : "",
    opts.showAgent && view.agent ? `<span>Агент: ${escapeHtml(view.agent.name)}${opts.showAgentPhone && view.agent.phone ? ` (${escapeHtml(view.agent.phone)})` : ""}</span>` : "",
    opts.showCourier && view.courier ? `<span>Курьер: ${escapeHtml(view.courier.name)}</span>` : "",
    view.territory ? `<span>Территория: ${escapeHtml(view.territory)}</span>` : "",
    opts.showShopAddress && view.shop.address ? `<span>Адрес: ${escapeHtml(view.shop.address)}</span>` : "",
    opts.showPaymentMethod && view.paymentLabel ? `<span>Оплата: ${escapeHtml(view.paymentLabel)}</span>` : "",
  ].filter(Boolean).join("");
  return `
      ${view.isPartial ? `<div style="margin-bottom:10px;padding:8px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:9pt;color:#92400e;font-weight:600">⚠️ СКОРРЕКТИРОВАНА: частичная доставка</div>` : ""}
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;padding-bottom:4px;border-bottom:2px solid #333">
        <div style="display:flex;align-items:center;gap:10px"><div style="font-size:10pt;font-weight:700">${escapeHtml(view.company.name)}${view.company.inn ? ` (ИНН: ${escapeHtml(view.company.inn)})` : ""}</div>${logoBlock(view, opts)}</div>
        <div style="text-align:right">
          <span style="font-size:10pt;font-weight:700">Накладная № ${escapeHtml(view.number)}</span>
          <span style="font-size:8pt;color:#666;margin-left:8px">от ${escapeHtml(view.date)}${opts.showPrintedAt ? ` · напечатано ${escapeHtml(view.printedAt)}` : ""}</span>
          ${opts.showBarcode ? `<div style="display:flex;justify-content:flex-end;margin-top:2px">${barcodeCell(view.number)}</div>` : ""}
        </div>
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:8pt;color:#666;margin-bottom:4px">${facts}</div>
      ${opts.showDebt ? debtBlock(view) : ""}
      <table>
        <thead>
          <tr>
            <th style="width:4%">№</th>
            <th style="text-align:left">Наименование</th>
            ${opts.showUnit ? `<th style="width:7%">Ед.</th>` : ""}
            ${qtyHeader}
            <th style="width:12%">Цена</th>
            <th style="width:14%">Сумма</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="totals-box">
        <table>
          <tr><td>Итого позиций:</td><td class="right">${view.items.length}</td></tr>
          <tr><td>Сумма:</td><td class="right">${money(view.subtotal)} ${cur}</td></tr>
          ${opts.showDiscount && view.discount > 0 ? `<tr><td>Скидка:</td><td class="right" style="color:#16a34a">−${money(view.discount)} ${cur}</td></tr>` : ""}
          <tr class="total-row"><td>ИТОГО:</td><td class="right">${money(view.total)} ${cur}</td></tr>
        </table>
      </div>
      ${opts.showNotes && view.notes ? `<div style="margin-top:10px;padding:8px 10px;background:#fffbeb;border:1px solid #fde68a;font-size:8pt"><b>Примечание:</b> ${escapeHtml(view.notes)}</div>` : ""}
      ${opts.showSignatures ? `
      <div style="display:flex;gap:20px;margin-top:8px;font-size:8pt">
        <div style="flex:1">Отпустил: _______________</div>
        <div style="flex:1">Получил: _______________</div>
        <div style="flex:1">Дата: _______________</div>
      </div>` : ""}`;
}

const RENDERERS: Record<InvoiceTemplateId, (v: InvoiceView, o: InvoiceOptions) => string> = {
  classic: renderClassic, compact: renderCompact, detailed: renderDetailed,
};

/** Один экземпляр накладной по шаблону — без раскладки и без обёртки страницы. */
export function renderInvoiceCopy(view: InvoiceView, template: InvoiceTemplateId, opts: InvoiceOptions): string {
  return RENDERERS[template](view, opts);
}

/* ── Раскладка экземпляров ────────────────────────────────────────────────── */

const CUT_LINE = `
    <div class="cut-line" style="margin:4mm 0;border-top:1px dashed #999;position:relative">
      <span style="position:absolute;top:-7px;left:0;background:#fff;padding-right:6px;font-size:8pt;color:#999">✂ линия отреза</span>
    </div>`;

function copyLabel(i: 0 | 1): string {
  return `<div class="copy-label" style="text-align:center;font-size:8pt;font-weight:bold;margin-bottom:4px;padding:2px;background:#f0f0f0;border:1px solid #999">${COPY_LABELS[i]}</div>`;
}

/**
 * Один заказ — один лист. Два экземпляра одной накладной друг под другом
 * (отрез между ними) или рядом на альбомном листе, как у образца владельца;
 * следующий заказ — с новой страницы. Сплошная лента невозможна: экспедитор
 * режет лист у магазина, и половина от соседнего заказа ушла бы не в те руки.
 */
export function composeInvoicePages(copies: string[], opts: InvoiceOptions, footerNote?: string): string {
  const pages = copies.map(body => {
    if (opts.copies === 1) return `<div class="invoice-container" style="page-break-inside:avoid">${body}</div>`;
    if (opts.copiesLayout === "side") {
      return `<div class="invoice-container side-by-side" style="display:flex;gap:6mm;align-items:flex-start;page-break-inside:avoid">
        <div style="flex:1;min-width:0">${copyLabel(0)}${body}</div>
        <div class="cut-line-v" style="width:0;border-left:1px dashed #999;align-self:stretch"></div>
        <div style="flex:1;min-width:0">${copyLabel(1)}${body}</div>
      </div>`;
    }
    return `<div class="invoice-container">
    <div style="page-break-inside:avoid">${copyLabel(0)}${body}</div>
    ${CUT_LINE}
    <div style="page-break-inside:avoid">${copyLabel(1)}${body}</div></div>`;
  });
  const note = (footerNote ?? "").trim();
  return pages.join('<div style="page-break-before:always"></div>')
    + (note ? `<p style="margin-top:12px;font-size:9pt;color:#555">${escapeHtml(note)}</p>` : "");
}

/* ── Стили ────────────────────────────────────────────────────────────────── */

const PRINT_RULES = `
  @page { margin: 8mm; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .meta-box, .totals-box, .doc-fill, .copy-label, .debt-box { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
`;

const CLASSIC_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Times New Roman", Times, serif; font-size: 11pt; color: #000; background: #fff; padding: 15mm 15mm 10mm; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 2px 4px; font-size: 9.5pt; vertical-align: top; }
  th { background: #f5f5f5; font-weight: bold; text-align: center; }
  .no-border td, .no-border th { border: none; }
  .center { text-align: center; } .right { text-align: right; } .bold { font-weight: bold; }
  .title { font-size: 13pt; font-weight: bold; text-align: center; margin: 4px 0 2px; }
  .subtitle { font-size: 10.5pt; text-align: center; margin-bottom: 6px; }
  .meta { margin: 4px 0; font-size: 9pt; }
  .meta-row { display: flex; justify-content: space-between; margin-bottom: 1px; }
  .meta-label { min-width: 90px; }
  .meta-value { flex: 1; border-bottom: 1px solid #000; padding-bottom: 0; }
  .signature-block { margin-top: 10px; }
  .sig-row { display: flex; gap: 30px; margin-top: 8px; }
  .sig-col { flex: 1; }
  .sig-line { border-bottom: 1px solid #000; margin-bottom: 2px; min-height: 16px; }
  .sig-label { font-size: 9pt; color: #333; }
  body.fs-small th, body.fs-small td { font-size: 8pt; padding: 1px 3px; }
  body.fs-small .meta { font-size: 8pt; }
  ${PRINT_RULES}
  @media print { body { padding: 0; } .no-print { display: none !important; } }
`;

const COMPACT_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, "Helvetica Neue", Helvetica, sans-serif; font-size: 8.5pt; color: #000; background: #fff; padding: 10mm 12mm; line-height: 1.25; }
  .c-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .c-title { font-size: 11pt; font-weight: 700; }
  .c-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; margin-bottom: 4px; font-size: 8pt; }
  .c-label { color: #333; }
  table.c-table { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
  .c-table th, .c-table td { border: 1px solid #000; padding: 1px 4px; font-size: 8pt; vertical-align: top; text-align: left; }
  .c-table th { font-weight: 700; background: #fff; }
  .c-code { color: #333; white-space: nowrap; }
  .c-unit { color: #555; font-size: 7pt; }
  .right { text-align: right !important; } .center { text-align: center; } .bold { font-weight: 700; }
  .c-totals th { font-weight: 700; }
  .c-sign { display: flex; justify-content: space-between; gap: 16px; margin-top: 8px; font-size: 8.5pt; }
  .copy-label { font-size: 7pt !important; }
  body.fs-normal, body.fs-normal .c-table th, body.fs-normal .c-table td, body.fs-normal .c-meta { font-size: 9.5pt; }
  ${PRINT_RULES}
  @page { margin: 6mm; }
  @media print { body { padding: 0; } }
`;

const DETAILED_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; font-size: 10pt; color: #1e293b; background: #fff; padding: 12mm 15mm 10mm; line-height: 1.4; }
  ${PRINT_RULES}
  @media print { body { padding: 0; } .no-print { display: none !important; } }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #333; padding: 5px 7px; font-size: 9.5pt; vertical-align: top; }
  th { background: #f0f0f0; font-weight: 600; text-align: center; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.5px; color: #333; }
  .center { text-align: center; } .right { text-align: right; } .bold { font-weight: bold; }
  .totals-box { width: 220px; margin-left: auto; margin-top: 4px; }
  .totals-box td { border: none; padding: 3px 6px; font-size: 9.5pt; }
  .totals-box .total-row td { font-weight: bold; font-size: 11pt; border-top: 2px solid #333; padding-top: 6px; }
  .invoice-container { page-break-inside: avoid; margin-bottom: 4mm; padding: 6mm 10mm; border-bottom: 1px dashed #ccc; }
  body.fs-small th, body.fs-small td { font-size: 8pt; padding: 3px 5px; }
`;

export function invoiceStyles(template: InvoiceTemplateId): string {
  return template === "compact" ? COMPACT_STYLES : template === "detailed" ? DETAILED_STYLES : CLASSIC_STYLES;
}

/** Класс на body по размеру шрифта — стили шаблона его читают. */
export function invoiceBodyClass(opts: InvoiceOptions): string {
  return opts.fontSize === "small" ? "fs-small" : "fs-normal";
}

/** Готовый документ: экземпляры каждого заказа, разложенные по листам. */
export function renderInvoiceDocument(views: InvoiceView[], template: InvoiceTemplateId, opts: InvoiceOptions): { html: string; styles: string; bodyClass: string; title: string } {
  const copies = views.map(v => renderInvoiceCopy(v, template, opts));
  const html = composeInvoicePages(copies, opts, views[0]?.footerNote);
  const title = views.length === 1 ? `Расходная накладная № ${escapeHtml(views[0].number)}` : `Накладные — ${views.length} заказ(ов)`;
  return { html, styles: invoiceStyles(template), bodyClass: invoiceBodyClass(opts), title };
}

/** Полный HTML для предпросмотра в настройках (iframe srcdoc). */
export function invoicePreviewHtml(view: InvoiceView, template: InvoiceTemplateId, opts: InvoiceOptions): string {
  const doc = renderInvoiceDocument([view], template, opts);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${doc.styles} body { padding: 8mm; }</style></head><body class="${doc.bodyClass}">${doc.html}</body></html>`;
}

/** Образец для предпросмотра — вымышленный магазин, не данные арендатора. */
export function sampleInvoiceView(company: InvoiceView["company"], currency: string): InvoiceView {
  return {
    number: "ORD-01042", date: "19.09.2026", printedAt: "19.09.2026 12:53", currency,
    company,
    shop: { name: "Дўкон «Барака Market»", phone: "+998 90 123 45 67", address: "Ургенч, ул. Ал-Хоразмий, 12", owner: "Ахмедов Б." },
    agent: { name: "Эшмуродов Жасур", phone: "+998 99 967 17 71" },
    courier: { name: "Каримов Азиз" },
    territory: "Центр",
    items: [
      { code: "0557", name: "Вода «Орол» 1.5 л", unit: "pcs", qty: 24, price: 4500, total: 108000 },
      { code: "1252", name: "Салфетки «Сабой» 3 кг", unit: "pack", qty: 10, price: 90000, total: 900000 },
      { code: "0321", name: "Fresh Gel 5 л для мытья посуды", unit: "pcs", qty: 10, price: 28000, total: 280000 },
    ],
    subtotal: 1288000, discount: 0, total: 1288000, paymentLabel: "Наличные", isPartial: false,
    notes: "Доставить до 11:00",
    debt: { current: 350000, lastPayment: { amount: 500000, date: "12.09.2026" } },
  };
}
