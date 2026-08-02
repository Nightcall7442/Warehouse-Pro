/**
 * Document templates for СНГ market.
 * Each function returns an HTML string suitable for window.print().
 * Styles are embedded inline for maximum print compatibility.
 */

function escapeHtml(str: string | null | undefined): string {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BASE_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Times New Roman", Times, serif;
    font-size: 11pt;
    color: #000;
    background: #fff;
    padding: 15mm 15mm 10mm;
  }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 3px 5px; font-size: 10pt; vertical-align: top; }
  th { background: #f5f5f5; font-weight: bold; text-align: center; }
  .no-border td, .no-border th { border: none; }
  .center { text-align: center; }
  .right  { text-align: right; }
  .bold   { font-weight: bold; }
  .title  { font-size: 14pt; font-weight: bold; text-align: center; margin: 8px 0; }
  .subtitle { font-size: 11pt; text-align: center; margin-bottom: 10px; }
  .meta   { margin: 8px 0; font-size: 10pt; }
  .meta-row { display: flex; justify-content: space-between; margin-bottom: 3px; }
  .meta-label { min-width: 180px; }
  .meta-value { flex: 1; border-bottom: 1px solid #000; padding-bottom: 1px; }
  .signature-block { margin-top: 20px; }
  .sig-row { display: flex; gap: 40px; margin-top: 16px; }
  .sig-col { flex: 1; }
  .sig-line { border-bottom: 1px solid #000; margin-bottom: 3px; min-height: 20px; }
  .sig-label { font-size: 9pt; color: #333; }
  .totals-table { margin-top: 4px; }
  .totals-table td { border: none; padding: 2px 5px; }
  .totals-table .total-row td { font-weight: bold; border-top: 2px solid #000; }
  h3 { font-size: 12pt; margin: 8px 0 4px; }
  .page-break { page-break-before: always; }
  @page { margin: 10mm; size: A4; }
`;

/** Professional grid styles for modern documents (invoices, loading lists) */
const GRID_STYLES = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    font-size: 10pt;
    color: #1e293b;
    background: #fff;
    padding: 12mm 15mm 10mm;
    line-height: 1.4;
  }
  @page { margin: 8mm; size: A4; }
  @media print {
    body { padding: 0; }
    .no-print { display: none !important; }
    .page-container { page-break-inside: avoid; }
  }
  table { width: 100%; border-collapse: collapse; }
  th, td {
    border: 1px solid #333;
    padding: 5px 7px;
    font-size: 9.5pt;
    vertical-align: top;
  }
  th {
    background: #f0f0f0;
    font-weight: 600;
    text-align: center;
    font-size: 8.5pt;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #333;
  }
  .no-border td, .no-border th { border: none; }
  .center { text-align: center; }
  .right { text-align: right; }
  .bold { font-weight: bold; }
  .header-block {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 14px;
    padding-bottom: 10px;
    border-bottom: 2px solid #333;
  }
  .meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 12px;
  }
  .meta-box {
    padding: 8px 10px;
    border: 1px solid #ddd;
    border-radius: 4px;
    background: #fafafa;
  }
  .meta-box-title {
    font-size: 7.5pt;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #666;
    margin-bottom: 4px;
    font-weight: 600;
  }
  .totals-box {
    width: 260px;
    margin-left: auto;
    margin-top: 8px;
  }
  .totals-box td { border: none; padding: 3px 6px; font-size: 9.5pt; }
  .totals-box .total-row td {
    font-weight: bold;
    font-size: 11pt;
    border-top: 2px solid #333;
    padding-top: 6px;
  }
  .signature-block {
    display: flex;
    gap: 30px;
    margin-top: 20px;
    padding-top: 12px;
    border-top: 1px solid #ddd;
  }
  .sig-col { flex: 1; }
  .sig-label { font-size: 7.5pt; color: #666; margin-bottom: 4px; }
  .sig-line { border-bottom: 1px solid #999; min-height: 18px; margin-bottom: 2px; }
  .page-break { page-break-before: always; }
  .invoice-container {
    page-break-inside: avoid;
    margin-bottom: 10mm;
    padding: 12mm 15mm;
  }
`;

function openPrintWindow(html: string, title: string, customStyles?: string) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) { window.print(); return; }
  const styles = customStyles ?? BASE_STYLES;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${styles}</style></head><body>${html}</body></html>`);
  w.document.close();
  w.onload = () => { w.print(); setTimeout(() => w.close(), 800); };
}

// ── Types ────────────────────────────────────────────────────────────────────
export type CompanyInfo = {
  name:       string;
  address?:   string;
  inn?:       string;
  director?:  string;
  bank?:      string;
  account?:   string;
  mfo?:       string;
};

export type DocItem = {
  name:     string;
  code?:    string;
  unit?:    string;
  qty:      number;
  price:    number;
  total:    number;
  // Partial delivery support
  orderedQty?: number;
  deliveredQty?: number;
  returnReason?: string;
};

export type OrderDocData = {
  number:    string;
  date:      string;
  seller:    CompanyInfo;
  buyer:     CompanyInfo;
  items:     DocItem[];
  subtotal:  number;
  discount?: number;
  total:     number;
  notes?:    string;
  currency:  string;
  paymentMethodLabel?: string;
  paymentMethodColor?: string;
  shopOwner?: string;
  shopPhone?: string;
  territoryName?: string;
};

export type ArrivalDocData = {
  number:    string;
  date:      string;
  supplier:  CompanyInfo;
  receiver:  CompanyInfo;
  items:     DocItem[];
  totalQty:  number;
  expenses?: { fuel?: number; toll?: number; other?: number; total?: number };
  notes?:    string;
  currency:  string;
};

// ── 1. РАСХОДНАЯ НАКЛАДНАЯ (Uzbekistan standard) — 2 копии на листе ──────────
export function printUzWaybill(data: OrderDocData) {
  const itemRows = data.items.map((item, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${escapeHtml(item.name)}${item.code ? ` (${escapeHtml(item.code)})` : ""}</td>
      <td class="center">${item.unit ?? "кг"}</td>
      <td class="center">${item.qty.toFixed(2)}</td>
      <td class="right">${item.price.toLocaleString("ru-RU")}</td>
      <td class="right">${item.total.toLocaleString("ru-RU")}</td>
    </tr>`).join("");

  function buildCopy(label: string) {
    return `
      <div class="copy-label" style="text-align:center;font-size:12pt;font-weight:bold;margin-bottom:6px;padding:4px;background:#f0f0f0;border:1px solid #999">${label}</div>
      <table class="no-border" style="margin-bottom:8px">
        <tr>
          <td style="width:50%">
            <div class="meta">
              <div class="meta-row"><span class="meta-label">Поставщик:</span><span class="meta-value bold">${escapeHtml(data.seller.name)}</span></div>
              <div class="meta-row"><span class="meta-label">ИНН / СТИР:</span><span class="meta-value">${escapeHtml(data.seller.inn ?? "")}</span></div>
              <div class="meta-row"><span class="meta-label">Адрес:</span><span class="meta-value">${escapeHtml(data.seller.address ?? "")}</span></div>
              <div class="meta-row"><span class="meta-label">Банк:</span><span class="meta-value">${escapeHtml(data.seller.bank ?? "")}</span></div>
              <div class="meta-row"><span class="meta-label">Р/с:</span><span class="meta-value">${escapeHtml(data.seller.account ?? "")}</span></div>
              <div class="meta-row"><span class="meta-label">МФО:</span><span class="meta-value">${escapeHtml(data.seller.mfo ?? "")}</span></div>
            </div>
          </td>
          <td style="width:50%">
            <div class="meta">
              <div class="meta-row"><span class="meta-label">Покупатель:</span><span class="meta-value bold">${escapeHtml(data.buyer.name)}</span></div>
              <div class="meta-row"><span class="meta-label">ИНН / СТИР:</span><span class="meta-value">${escapeHtml(data.buyer.inn ?? "")}</span></div>
              <div class="meta-row"><span class="meta-label">Адрес:</span><span class="meta-value">${escapeHtml(data.buyer.address ?? "")}</span></div>
            </div>
          </td>
        </tr>
      </table>

      <div class="title">РАСХОДНАЯ НАКЛАДНАЯ</div>
      <div class="subtitle">№ ${data.number} от ${data.date}</div>

      <table>
        <thead>
          <tr>
            <th style="width:4%">№</th>
            <th>Наименование товара</th>
            <th style="width:8%">Ед.изм.</th>
            <th style="width:10%">Кол-во</th>
            <th style="width:14%">Цена (${data.currency})</th>
            <th style="width:16%">Сумма (${data.currency})</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
          <tr>
            <td colspan="3" class="right bold">ИТОГО:</td>
            <td class="center bold">${data.items.reduce((s,i) => s+i.qty, 0).toFixed(2)}</td>
            <td></td>
            <td class="right bold">${data.subtotal.toLocaleString("ru-RU")} ${data.currency}</td>
          </tr>
          ${data.discount && data.discount > 0 ? `
          <tr>
            <td colspan="5" class="right">Скидка:</td>
            <td class="right">−${data.discount.toLocaleString("ru-RU")} ${data.currency}</td>
          </tr>` : ""}
          <tr>
            <td colspan="5" class="right bold">К ОПЛАТЕ:</td>
            <td class="right bold">${data.total.toLocaleString("ru-RU")} ${data.currency}</td>
          </tr>
        </tbody>
      </table>

      ${data.notes ? `<p style="margin-top:8px;font-size:10pt"><b>Примечание:</b> ${escapeHtml(data.notes)}</p>` : ""}

      <div class="signature-block">
        <div class="sig-row">
          <div class="sig-col">
            <div class="sig-label">Отпустил (Сдал)</div>
            <div class="sig-line"></div>
            <div class="sig-label">${data.seller.director ? `Директор: ${escapeHtml(data.seller.director)}` : "___________________________"}</div>
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
      </div>
    `;
  }

  const html = `
    ${buildCopy("КОПИЯ ДЛЯ СКЛАДЧИКА")}
    <div class="page-break"></div>
    ${buildCopy("КОПИЯ ДЛЯ ШОФЁРА")}

    <p style="margin-top:12px;font-size:9pt;color:#555">Документ сформирован автоматически в системе Warehouse Pro</p>
  `;

  openPrintWindow(html, `Расходная накладная № ${data.number}`);
}

// ── 2. ПРИХОДНАЯ НАКЛАДНАЯ (Goods Receipt) ────────────────────────────────────
export function printArrivalReceipt(data: ArrivalDocData) {
  const itemRows = data.items.map((item, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${escapeHtml(item.name)}${item.code ? ` (${escapeHtml(item.code)})` : ""}</td>
      <td class="center">${item.unit ?? "кг"}</td>
      <td class="center">${item.qty.toFixed(2)}</td>
      <td class="center">${(item as Record<string, unknown>).condition ?? "Хорошее"}</td>
    </tr>`).join("");

  const html = `
    <table class="no-border" style="margin-bottom:8px">
      <tr>
        <td style="width:50%">
          <div class="meta">
            <div class="meta-row"><span class="meta-label">Поставщик:</span><span class="meta-value bold">${escapeHtml(data.supplier.name)}</span></div>
            <div class="meta-row"><span class="meta-label">ИНН / СТИР:</span><span class="meta-value">${escapeHtml(data.supplier.inn ?? "")}</span></div>
            <div class="meta-row"><span class="meta-label">Адрес:</span><span class="meta-value">${escapeHtml(data.supplier.address ?? "")}</span></div>
          </div>
        </td>
        <td style="width:50%">
          <div class="meta">
            <div class="meta-row"><span class="meta-label">Получатель:</span><span class="meta-value bold">${escapeHtml(data.receiver.name)}</span></div>
            <div class="meta-row"><span class="meta-label">ИНН / СТИР:</span><span class="meta-value">${escapeHtml(data.receiver.inn ?? "")}</span></div>
            <div class="meta-row"><span class="meta-label">Адрес:</span><span class="meta-value">${escapeHtml(data.receiver.address ?? "")}</span></div>
          </div>
        </td>
      </tr>
    </table>

    <div class="title">ПРИХОДНАЯ НАКЛАДНАЯ</div>
    <div class="subtitle">№ ${data.number} от ${data.date}</div>

    <table>
      <thead>
        <tr>
          <th style="width:4%">№</th>
          <th>Наименование товара</th>
          <th style="width:8%">Ед.изм.</th>
          <th style="width:12%">Кол-во</th>
          <th style="width:16%">Состояние</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        <tr>
          <td colspan="2" class="right bold">ИТОГО:</td>
          <td class="center">кг</td>
          <td class="center bold">${data.totalQty.toFixed(2)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>

    ${data.expenses?.total ? `
    <h3 style="margin-top:12px">Транспортные расходы</h3>
    <table style="width:300px">
      <tr><td>Топливо</td><td class="right">${(data.expenses.fuel ?? 0).toLocaleString("ru-RU")} ${data.currency}</td></tr>
      <tr><td>Дорожные расходы</td><td class="right">${(data.expenses.toll ?? 0).toLocaleString("ru-RU")} ${data.currency}</td></tr>
      <tr><td>Прочие расходы</td><td class="right">${(data.expenses.other ?? 0).toLocaleString("ru-RU")} ${data.currency}</td></tr>
      <tr class="bold"><td><b>ИТОГО расходы</b></td><td class="right bold">${data.expenses.total.toLocaleString("ru-RU")} ${data.currency}</td></tr>
    </table>` : ""}

    ${data.notes ? `<p style="margin-top:8px;font-size:10pt"><b>Примечание:</b> ${escapeHtml(data.notes)}</p>` : ""}

    <div class="signature-block">
      <div class="sig-row">
        <div class="sig-col">
          <div class="sig-label">Сдал (Водитель)</div>
          <div class="sig-line"></div>
          <div class="sig-label">___________________________</div>
        </div>
        <div class="sig-col">
          <div class="sig-label">Принял (Кладовщик)</div>
          <div class="sig-line"></div>
          <div class="sig-label">${escapeHtml(data.receiver.director ?? "___________________________")}</div>
        </div>
        <div class="sig-col">
          <div class="sig-label">Дата приёма</div>
          <div class="sig-line"></div>
          <div class="sig-label">"____" ____________ 20___ г.</div>
        </div>
      </div>
    </div>
  `;

  openPrintWindow(html, `Приходная накладная № ${data.number}`);
}

// ── 3. ТОРГ-12 (Russian standard) ────────────────────────────────────────────
export function printTorg12(data: OrderDocData) {
  const itemRows = data.items.map((item, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td></td>
      <td>${escapeHtml(item.name)}</td>
      <td class="center">${escapeHtml(item.code ?? "")}</td>
      <td class="center">${item.unit ?? "кг"}</td>
      <td class="center">796</td>
      <td class="center">${item.qty.toFixed(3)}</td>
      <td class="center">${item.qty.toFixed(3)}</td>
      <td class="right">${item.price.toLocaleString("ru-RU", {minimumFractionDigits:2})}</td>
      <td class="center">Без НДС</td>
      <td class="right">—</td>
      <td class="right">${item.total.toLocaleString("ru-RU", {minimumFractionDigits:2})}</td>
    </tr>`).join("");

  const html = `
    <div style="font-size:9pt;text-align:right;margin-bottom:4px">
      Унифицированная форма № ТОРГ-12<br>
      Утверждена постановлением Госкомстата России от 25.12.98 № 132
    </div>

    <table class="no-border" style="margin-bottom:6px">
      <tr>
        <td style="width:40%">
          <b>Организация:</b> ${escapeHtml(data.seller.name)}<br>
          <b>ИНН/КПП:</b> ${data.seller.inn ?? "_______________"}<br>
          <b>Адрес:</b> ${escapeHtml(data.seller.address ?? "")}
        </td>
        <td style="width:30%;vertical-align:bottom">
          <table style="width:100%;font-size:9pt">
            <tr><td>Коды</td></tr>
            <tr><td>ОКПО</td><td class="right">__________</td></tr>
          </table>
        </td>
        <td style="width:30%;vertical-align:bottom">
          <table style="width:100%;border:1px solid #000;font-size:9pt">
            <tr><th colspan="2">Номер документа</th><th>Дата составления</th></tr>
            <tr><td colspan="2" class="center bold">${data.number}</td><td class="center">${data.date}</td></tr>
          </table>
        </td>
      </tr>
    </table>

    <div class="title" style="font-size:16pt">ТОВАРНАЯ НАКЛАДНАЯ</div>

    <table class="no-border" style="margin:6px 0">
      <tr>
        <td style="width:50%">
          <b>Грузоотправитель</b> и его адрес: ${escapeHtml(data.seller.name)}, ${escapeHtml(data.seller.address ?? "")}
        </td>
        <td style="width:50%">
          <b>Грузополучатель</b> и его адрес: ${escapeHtml(data.buyer.name)}, ${escapeHtml(data.buyer.address ?? "")}
        </td>
      </tr>
      <tr>
        <td>Поставщик: ${escapeHtml(data.seller.name)}</td>
        <td>Покупатель: ${escapeHtml(data.buyer.name)}, ИНН ${escapeHtml(data.buyer.inn ?? "")}</td>
      </tr>
    </table>

    <table style="font-size:9pt">
      <thead>
        <tr>
          <th rowspan="2" style="width:3%">№</th>
          <th rowspan="2" style="width:5%">Код товара</th>
          <th rowspan="2">Наименование, характеристика, сорт, артикул товара</th>
          <th rowspan="2" style="width:7%">Код по ОКЕИ</th>
          <th colspan="2" style="width:16%">Единица измерения</th>
          <th colspan="2" style="width:16%">Количество</th>
          <th rowspan="2" style="width:10%">Цена, руб.</th>
          <th colspan="2" style="width:16%">НДС</th>
          <th rowspan="2" style="width:12%">Сумма с учётом НДС, руб.</th>
        </tr>
        <tr>
          <th>наименование</th><th>код</th>
          <th>в одном месте</th><th>мест, штук</th>
          <th>ставка, %</th><th>сумма, руб.</th>
        </tr>
        <tr>
          ${Array.from({length:12},(_,i)=>`<th class="center">${i+1}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        <tr>
          <td colspan="7" class="right bold">Итого</td>
          <td class="center bold">${data.items.reduce((s,i)=>s+i.qty,0).toFixed(3)}</td>
          <td></td>
          <td colspan="2" class="center">Без НДС</td>
          <td class="right bold">${data.subtotal.toLocaleString("ru-RU",{minimumFractionDigits:2})}</td>
        </tr>
      </tbody>
    </table>

    <table class="no-border" style="margin-top:4px;font-size:10pt">
      <tr>
        <td>Итого мест: <b>1</b></td>
        <td class="right">Итого отпущено на сумму: <b>${data.total.toLocaleString("ru-RU",{minimumFractionDigits:2})} руб.</b></td>
      </tr>
    </table>

    <div class="signature-block" style="margin-top:16px">
      <div class="sig-row">
        <div class="sig-col">
          Отпуск разрешил<br>
          <div class="sig-label">должность</div><div class="sig-line"></div>
          <div class="sig-label">подпись / расшифровка</div><div class="sig-line"></div>
        </div>
        <div class="sig-col">
          Главный (старший) бухгалтер<br>
          <div class="sig-line"></div>
          <div class="sig-label">подпись / расшифровка</div>
        </div>
        <div class="sig-col">
          Отпуск произвёл<br>
          <div class="sig-line"></div>
          <div class="sig-label">подпись / расшифровка</div>
        </div>
      </div>
      <div class="sig-row" style="margin-top:16px">
        <div class="sig-col">
          По доверенности №_____ от «___»____________20___г., выданной____________
        </div>
        <div class="sig-col">
          Груз получил<br>
          <div class="sig-line"></div>
          <div class="sig-label">должность / подпись / расшифровка</div>
        </div>
      </div>
    </div>

    <p style="margin-top:12px;font-size:8pt;color:#666">Сформировано автоматически в системе Warehouse Pro</p>
  `;

  openPrintWindow(html, `ТОРГ-12 № ${data.number}`);
}

// ── 4. СЧЁТ-ФАКТУРА (Invoice for payment) — professional template ───────────
export function printInvoice(data: OrderDocData) {
  const itemRows = data.items.map((item, i) => `
    <tr>
      <td style="text-align:center;padding:8px 6px;color:#64748b;font-size:9pt">${i + 1}</td>
      <td style="padding:8px 10px">${escapeHtml(item.name)}${item.code ? `<br><span style="font-size:8pt;color:#94a3b8">Арт: ${escapeHtml(item.code)}</span>` : ""}</td>
      <td style="text-align:center;padding:8px 6px;color:#64748b">${item.unit ?? "кг"}</td>
      <td style="text-align:right;padding:8px 10px;font-variant-numeric:tabular-nums">${item.qty.toFixed(2)}</td>
      <td style="text-align:right;padding:8px 10px;color:#64748b;font-variant-numeric:tabular-nums">${item.price.toLocaleString("ru-RU")}</td>
      <td style="text-align:right;padding:8px 10px;font-weight:600;font-variant-numeric:tabular-nums">${item.total.toLocaleString("ru-RU")}</td>
    </tr>`).join("");

  const sellerInitials = (data.seller.name || "WP")
    .split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);

  const pmBadge = data.paymentMethodLabel
    ? `<span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:9pt;font-weight:600;background:${data.paymentMethodColor ?? "#5b6d8a"}18;color:${data.paymentMethodColor ?? "#5b6d8a"};border:1px solid ${data.paymentMethodColor ?? "#5b6d8a"}30">${escapeHtml(data.paymentMethodLabel)}</span>`
    : "";

  const INVOICE_STYLES = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
      font-size: 10pt;
      color: #1e293b;
      background: #fff;
      padding: 12mm 15mm 10mm;
      line-height: 1.5;
    }
    @page { margin: 8mm; size: A4; }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
    }
    table { width: 100%; border-collapse: collapse; }
  `;

  const html = `
    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #e2e8f0">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="width:48px;height:48px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:16pt;letter-spacing:1px">${sellerInitials}</div>
        <div>
          <div style="font-size:14pt;font-weight:700;color:#0f172a;letter-spacing:-0.3px">${escapeHtml(data.seller.name)}</div>
          <div style="font-size:8.5pt;color:#94a3b8;margin-top:2px">${data.seller.address ? escapeHtml(data.seller.address) : ""}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:8pt;text-transform:uppercase;letter-spacing:2px;color:#94a3b8;margin-bottom:2px">Счёт на оплату</div>
        <div style="font-size:20pt;font-weight:800;color:#0f172a;letter-spacing:-0.5px">№ ${escapeHtml(data.number)}</div>
        <div style="font-size:9pt;color:#64748b;margin-top:2px">${data.date}</div>
      </div>
    </div>

    <!-- Payment method & order badge -->
    <div style="display:flex;gap:8px;margin-bottom:18px;align-items:center">
      ${pmBadge}
      <span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:8.5pt;color:#64748b;background:#f1f5f9;border:1px solid #e2e8f0">Заказ № ${escapeHtml(data.number)}</span>
    </div>

    <!-- Parties -->
    <div style="display:flex;gap:16px;margin-bottom:20px">
      <div style="flex:1;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
        <div style="font-size:7.5pt;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;margin-bottom:6px;font-weight:600">Поставщик</div>
        <div style="font-size:10.5pt;font-weight:600;color:#0f172a;margin-bottom:6px">${escapeHtml(data.seller.name)}</div>
        <div style="font-size:8.5pt;color:#64748b;line-height:1.7">
          ${data.seller.inn ? `ИНН/СТИР: ${escapeHtml(data.seller.inn)}<br>` : ""}
          ${data.seller.bank ? `Банк: ${escapeHtml(data.seller.bank)}<br>` : ""}
          ${data.seller.account ? `Р/с: ${escapeHtml(data.seller.account)}<br>` : ""}
          ${data.seller.mfo ? `МФО: ${escapeHtml(data.seller.mfo)}` : ""}
        </div>
      </div>
      <div style="flex:1;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
        <div style="font-size:7.5pt;text-transform:uppercase;letter-spacing:1.5px;color:#94a3b8;margin-bottom:6px;font-weight:600">Покупатель</div>
        <div style="font-size:10.5pt;font-weight:600;color:#0f172a;margin-bottom:6px">${escapeHtml(data.buyer.name)}</div>
        <div style="font-size:8.5pt;color:#64748b;line-height:1.7">
          ${data.buyer.inn ? `ИНН/СТИР: ${escapeHtml(data.buyer.inn)}<br>` : ""}
          ${data.buyer.address ? `Адрес: ${escapeHtml(data.buyer.address)}<br>` : ""}
          ${data.shopOwner ? `Владелец: ${escapeHtml(data.shopOwner)}<br>` : ""}
          ${data.shopPhone ? `Тел: ${escapeHtml(data.shopPhone)}` : ""}
        </div>
      </div>
    </div>

    <!-- Items table -->
    <table style="margin-bottom:16px">
      <thead>
        <tr style="background:#f1f5f9">
          <th style="width:4%;text-align:center;padding:8px 6px;font-size:8pt;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0">№</th>
          <th style="text-align:left;padding:8px 10px;font-size:8pt;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0">Наименование</th>
          <th style="width:7%;text-align:center;padding:8px 6px;font-size:8pt;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0">Ед.</th>
          <th style="width:10%;text-align:right;padding:8px 10px;font-size:8pt;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0">Кол-во</th>
          <th style="width:14%;text-align:right;padding:8px 10px;font-size:8pt;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0">Цена (${data.currency})</th>
          <th style="width:16%;text-align:right;padding:8px 10px;font-size:8pt;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0">Сумма (${data.currency})</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>

    <!-- Totals -->
    <div style="display:flex;justify-content:flex-end">
      <div style="width:280px">
        <table style="font-size:9.5pt">
          <tr>
            <td style="padding:6px 0;color:#64748b">Итого</td>
            <td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums">${data.subtotal.toLocaleString("ru-RU")} ${data.currency}</td>
          </tr>
          ${data.discount && data.discount > 0 ? `<tr>
            <td style="padding:6px 0;color:#64748b">Скидка</td>
            <td style="padding:6px 0;text-align:right;color:#16a34a;font-weight:600;font-variant-numeric:tabular-nums">−${data.discount.toLocaleString("ru-RU")} ${data.currency}</td>
          </tr>` : ""}
          <tr>
            <td style="padding:6px 0;color:#64748b">НДС</td>
            <td style="padding:6px 0;text-align:right;color:#64748b">Без НДС</td>
          </tr>
          <tr>
            <td colspan="2" style="padding:2px 0"><div style="border-top:2px solid #0f172a"></div></td>
          </tr>
          <tr>
            <td style="padding:8px 0;font-size:11pt;font-weight:700;color:#0f172a">К ОПЛАТЕ</td>
            <td style="padding:8px 0;text-align:right;font-size:13pt;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums">${data.total.toLocaleString("ru-RU")} ${data.currency}</td>
          </tr>
        </table>
      </div>
    </div>

    <!-- Notes -->
    ${data.notes ? `<div style="margin-top:16px;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:9pt;color:#92400e">
      <b>Примечание:</b> ${escapeHtml(data.notes)}
    </div>` : ""}

    <!-- Payment terms -->
    <div style="margin-top:18px;padding:12px 14px;border:1px solid #e2e8f0;border-radius:8px;font-size:8.5pt;color:#64748b;line-height:1.6">
      <b style="color:#1e293b">Условия оплаты:</b> Оплата данного счёта означает согласие с условиями поставки.
      Уведомление об оплате обязательно. Счёт действителен в течение 5 банковских дней.
    </div>

    <!-- Signatures -->
    <div style="display:flex;gap:40px;margin-top:28px;padding-top:16px;border-top:1px solid #e2e8f0">
      <div style="flex:1">
        <div style="font-size:8pt;color:#94a3b8;margin-bottom:4px">Руководитель</div>
        <div style="display:flex;align-items:baseline;gap:8px">
          <div style="flex:1;border-bottom:1px solid #cbd5e1;min-height:20px"></div>
          <span style="font-size:8.5pt;color:#64748b;white-space:nowrap">${escapeHtml(data.seller.director ?? "")}</span>
        </div>
      </div>
      <div style="flex:1">
        <div style="font-size:8pt;color:#94a3b8;margin-bottom:4px">Бухгалтер</div>
        <div style="border-bottom:1px solid #cbd5e1;min-height:20px"></div>
      </div>
      <div style="flex:1">
        <div style="font-size:8pt;color:#94a3b8;margin-bottom:4px">М.П.</div>
        <div style="border-bottom:1px solid #cbd5e1;min-height:20px"></div>
      </div>
    </div>

    <!-- Footer -->
    <div style="margin-top:24px;text-align:center;font-size:7.5pt;color:#cbd5e1;padding-top:10px;border-top:1px solid #f1f5f9">
      Документ сформирован автоматически в системе Warehouse Pro &bull; ${data.date}
    </div>
  `;

  openPrintWindow(html, `Счёт № ${data.number}`, INVOICE_STYLES);
}

// ── 5. BATCH INVOICES — mass print with debt info ──────────────────────────

export type BatchOrderData = {
  id: number;
  orderNumber: string;
  status: string;
  total: string;
  subtotal: string;
  discount: string;
  notes: string | null;
  createdAt: Date;
  shopId: number;
  shopName: string | null;
  shopAddress: string | null;
  shopCity: string | null;
  shopPhone: string | null;
  shopDebt: string;
  shopDebtAmount: number;
  agentName: string | null;
  territoryName: string | null;
  paymentMethod: string;
  invoicePrintedAt: Date | null;
  isPartial?: boolean;
  items: Array<{
    productId: number;
    quantity: string;
    unitPrice: string;
    costPrice: string;
    subtotal: string;
    productName: string;
    productCode: string | null;
    unit: string;
  }>;
  paymentHistory: Array<{
    amount: string;
    type: string;
    createdAt: Date;
  }>;
};

export type BatchPrintOptions = {
  includeQrCode: boolean;
  includeBarcodes: boolean;
  includeCostPrice: boolean;
  includeSignature: boolean;
  includeNotes: boolean;
  pageBreakPerOrder: boolean;
  sortBy: "orderNumber" | "shop" | "agentRoute";
};

function debtStatusColor(amount: number): string {
  if (amount <= 0) return "#16a34a";
  if (amount <= 500_000) return "#ca8a04";
  if (amount <= 1_000_000) return "#dc2626";
  return "#dc2626";
}

function debtStatusLabel(amount: number): string {
  if (amount <= 0) return "Оплачено полностью";
  if (amount <= 500_000) return "Небольшая задолженность";
  if (amount <= 1_000_000) return "Крупная задолженность! Обратите внимание";
  return "КРИТИЧЕСКИЙ ДОЛГ! Требуется срочная оплата";
}

function buildDebtBlock(order: BatchOrderData, currency: string): string {
  const debt = order.shopDebtAmount;
  const color = debtStatusColor(debt);
  const label = debtStatusLabel(debt);

  const paymentsHtml = order.paymentHistory.length > 0
    ? order.paymentHistory.slice(0, 5).map(p => `
        <tr>
          <td style="padding:2px 6px;font-size:8pt">${new Date(p.createdAt).toLocaleDateString("ru-RU")}</td>
          <td style="padding:2px 6px;font-size:8pt;text-align:right">${Number(p.amount).toLocaleString("ru-RU")} ${currency}</td>
          <td style="padding:2px 6px;font-size:8pt">${p.type === "payment" ? "Оплата" : "Долг"}</td>
        </tr>`).join("")
    : '<tr><td colspan="3" style="padding:4px 6px;font-size:8pt;color:#94a3b8;text-align:center">Нет платежей за 30 дней</td></tr>';

  return `
    <div style="margin:10px 0;padding:10px 12px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc">
      <div style="font-size:9pt;font-weight:700;margin-bottom:6px">Информация о задолженности магазина</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:14pt;font-weight:800;color:${color}">${debt.toLocaleString("ru-RU")} ${currency}</span>
        <span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:7.5pt;font-weight:600;background:${color}18;color:${color};border:1px solid ${color}30">${label}</span>
      </div>
      ${debt > 0 && Number(order.total) > 0 ? `
        <div style="font-size:8.5pt;color:#64748b;margin-bottom:6px">
          В том числе по текущему заказу: <b>${Number(order.total).toLocaleString("ru-RU")} ${currency}</b><br>
          Рекомендуемая сумма к оплате: <b style="color:${color}">${(debt + Number(order.total)).toLocaleString("ru-RU")} ${currency}</b>
        </div>` : ""}
      <table style="width:100%;border-collapse:collapse;margin-top:4px">
        <tr style="background:#f1f5f9">
          <th style="padding:3px 6px;font-size:7.5pt;text-align:left;color:#64748b;font-weight:600">Дата</th>
          <th style="padding:3px 6px;font-size:7.5pt;text-align:right;color:#64748b;font-weight:600">Сумма</th>
          <th style="padding:3px 6px;font-size:7.5pt;text-align:left;color:#64748b;font-weight:600">Тип</th>
        </tr>
        ${paymentsHtml}
      </table>
      <div style="font-size:7pt;color:#94a3b8;margin-top:6px">Данные актуальны на ${new Date().toLocaleString("ru-RU")}. Для уточнения обращайтесь в офис.</div>
    </div>`;
}

function buildSingleInvoice(order: BatchOrderData, opts: BatchPrintOptions, company: CompanyInfo, currency: string): string {
  const itemRows = order.items.map((item, i) => {
    const costCol = opts.includeCostPrice ? `<td class="right">${Number(item.costPrice).toLocaleString("ru-RU")}</td>` : "";
    const qtyCol = order.isPartial
      ? `<td class="right" style="text-decoration:line-through;color:#999">${Number(item.quantity).toFixed(2)}</td>
         <td class="right bold">${Number(item.quantity).toFixed(2)}</td>`
      : `<td class="right">${Number(item.quantity).toFixed(2)}</td>`;
    return `
      <tr>
        <td class="center">${i + 1}</td>
        <td>${escapeHtml(item.productName)}${item.productCode ? ` <span style="color:#666;font-size:8pt">(${escapeHtml(item.productCode)})</span>` : ""}</td>
        <td class="center">${escapeHtml(item.unit)}</td>
        ${qtyCol}
        <td class="right">${Number(item.unitPrice).toLocaleString("ru-RU")}</td>
        ${costCol}
        <td class="right bold">${Number(item.subtotal).toLocaleString("ru-RU")}</td>
      </tr>`;
  }).join("");

  const costHeader = opts.includeCostPrice ? '<th style="width:10%">Себест.</th>' : "";

  // Show ordered vs delivered columns if partial delivery
  const qtyHeader = order.isPartial
    ? '<th style="width:9%">Заказ</th><th style="width:9%">Отдали</th>'
    : '<th style="width:9%">Кол-во</th>';

  const partialBanner = order.isPartial
    ? `<div style="margin-bottom:10px;padding:8px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:9pt;color:#92400e;font-weight:600">
        ⚠️ СКОРРЕКТИРОВАНА: частичная доставка
      </div>`
    : "";

  return `
      ${partialBanner}
      <div class="header-block">
        <div>
          <div style="font-size:12pt;font-weight:700">${escapeHtml(company.name)}</div>
          ${company.inn ? `<div style="font-size:8pt;color:#666">ИНН/СТИР: ${escapeHtml(company.inn)}</div>` : ""}
          ${company.address ? `<div style="font-size:8pt;color:#666">${escapeHtml(company.address)}</div>` : ""}
          ${order.territoryName ? `<div style="font-size:8pt;color:#666">Территория: ${escapeHtml(order.territoryName)}</div>` : ""}
        </div>
        <div style="text-align:right">
          <div style="font-size:7pt;text-transform:uppercase;letter-spacing:2px;color:#666">Накладная</div>
          <div style="font-size:14pt;font-weight:800">№ ${escapeHtml(order.orderNumber)}</div>
          <div style="font-size:8pt;color:#666">от ${new Date(order.createdAt).toLocaleDateString("ru-RU")}</div>
        </div>
      </div>

      ${buildDebtBlock(order, currency)}

      <table>
        <thead>
          <tr>
            <th style="width:4%">№</th>
            <th style="text-align:left">Наименование</th>
            <th style="width:7%">Ед.</th>
            ${qtyHeader}
            <th style="width:12%">Цена</th>
            ${costHeader}
            <th style="width:14%">Сумма</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <div class="totals-box">
        <table>
          <tr><td>Итого позиций:</td><td class="right">${order.items.length}</td></tr>
          <tr><td>Сумма:</td><td class="right">${Number(order.subtotal).toLocaleString("ru-RU")} ${currency}</td></tr>
          ${Number(order.discount) > 0 ? `<tr><td>Скидка:</td><td class="right" style="color:#16a34a">−${Number(order.discount).toLocaleString("ru-RU")} ${currency}</td></tr>` : ""}
          <tr class="total-row"><td>ИТОГО:</td><td class="right">${Number(order.total).toLocaleString("ru-RU")} ${currency}</td></tr>
        </table>
      </div>

      ${opts.includeNotes && order.notes ? `<div style="margin-top:10px;padding:8px 10px;background:#fffbeb;border:1px solid #fde68a;font-size:8pt"><b>Примечание:</b> ${escapeHtml(order.notes)}</div>` : ""}

      ${opts.includeSignature ? `
      <div class="signature-block">
        <div class="sig-col"><div class="sig-label">Отпустил</div><div class="sig-line"></div></div>
        <div class="sig-col"><div class="sig-label">Получил</div><div class="sig-line"></div></div>
        <div class="sig-col"><div class="sig-label">Дата</div><div class="sig-line"></div></div>
      </div>` : ""}`;
}

export function printBatchInvoices(orders: BatchOrderData[], opts: BatchPrintOptions, company: CompanyInfo, currency: string = "сум") {
  // Sort orders
  const sorted = [...orders];
  if (opts.sortBy === "shop") sorted.sort((a, b) => (a.shopName ?? "").localeCompare(b.shopName ?? ""));
  else if (opts.sortBy === "agentRoute") sorted.sort((a, b) => (a.agentName ?? "").localeCompare(b.agentName ?? ""));
  else if (opts.sortBy === "territory") sorted.sort((a, b) => (a.territoryName ?? "").localeCompare(b.territoryName ?? ""));
  else sorted.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));

  const pages = sorted.map(o => `<div class="invoice-container">${buildSingleInvoice(o, opts, company, currency)}</div>`);
  const separator = opts.pageBreakPerOrder ? '<div style="page-break-before:always"></div>' : '<div style="margin-bottom:10mm"></div>';
  const html = pages.join(separator);

  openPrintWindow(html, `Накладные — ${orders.length} заказ(ов)`, GRID_STYLES);
}

// ── 6. LOADING LIST — for warehouse workers ────────────────────────────────

export type LoadingListData = {
  listId: number;
  listNumber: string;
  totalOrders: number;
  totalItems: number;
  totalWeight: number;
  orders: Array<{
    id: number;
    orderNumber: string;
    shopName: string | null;
    shopAddress: string | null;
    shopCity: string | null;
    shopPhone: string | null;
    shopGpsLat: string | null;
    shopGpsLng: string | null;
    shopDebt: string;
    agentName: string | null;
    territoryName: string | null;
    total: string;
  }>;
  items: Array<{
    productId: number;
    productName: string;
    productCode: string | null;
    unit: string;
    unitWeight: string;
    totalQty: string;
    totalPrice: string;
  }>;
};

function buildLoadingListAggregated(data: LoadingListData, currency: string): string {
  const itemRows = data.items.map((item, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${escapeHtml(item.productCode ?? "")}</td>
      <td>${escapeHtml(item.productName)}</td>
      <td class="center">${escapeHtml(item.unit)}</td>
      <td class="right bold">${Number(item.totalQty).toFixed(2)}</td>
      <td class="right">${(Number(item.totalQty) * Number(item.unitWeight)).toFixed(1)}</td>
    </tr>`).join("");

  // Aggregate by agent
  const agentMap = new Map<string, { count: number; total: number }>();
  for (const o of data.orders) {
    const name = o.agentName ?? "Не назначен";
    const entry = agentMap.get(name) ?? { count: 0, total: 0 };
    entry.count++;
    entry.total += Number(o.total);
    agentMap.set(name, entry);
  }
  const agentLines = [...agentMap.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, { count, total }]) => `<div>• ${escapeHtml(name)} — ${count} заказ(ов) — ${total.toLocaleString("ru-RU")} ${currency}</div>`)
    .join("");

  // Territory
  const territories = [...new Set(data.orders.map(o => o.territoryName).filter(Boolean))];
  const territoryLine = territories.length > 0 ? `<div>Территория: <b>${territories.join(", ")}</b></div>` : "";

  const totalSum = data.orders.reduce((s, o) => s + Number(o.total), 0);

  return `
    <div style="text-align:center;margin-bottom:10px">
      <div style="font-size:16pt;font-weight:800">ЗАГРУЗОЧНЫЙ ЛИСТ</div>
      <div style="font-size:11pt;color:#666">№ ${escapeHtml(data.listNumber)}</div>
    </div>
    <table class="no-border" style="margin-bottom:12px;font-size:9pt">
      <tr>
        <td>Дата: <b>${new Date().toLocaleDateString("ru-RU")}</b></td>
        <td>Заказов: <b>${data.totalOrders}</b></td>
        <td>Позиций: <b>${data.totalItems}</b></td>
        <td>Общий вес: <b>${data.totalWeight.toFixed(1)} кг</b></td>
        <td>Сумма: <b>${totalSum.toLocaleString("ru-RU")} ${currency}</b></td>
      </tr>
      ${territoryLine ? `<tr><td colspan="5">${territoryLine}</td></tr>` : ""}
    </table>
    <table>
      <thead>
        <tr>
          <th style="width:4%">№</th>
          <th style="width:10%;text-align:left">Код</th>
          <th style="text-align:left">Наименование</th>
          <th style="width:8%">Ед.</th>
          <th style="width:12%">Кол-во</th>
          <th style="width:12%">Вес (кг)</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div style="margin-top:12px;font-size:9pt">
      <b>Торговые агенты:</b>
      ${agentLines}
    </div>
    <div class="signature-block">
      <div class="sig-col"><div class="sig-label">Проверил кладовщик</div><div class="sig-line"></div></div>
      <div class="sig-col"><div class="sig-label">Отпустил</div><div class="sig-line"></div></div>
      <div class="sig-col"><div class="sig-label">Дата</div><div class="sig-line"></div></div>
    </div>`;
}

function buildLoadingListByOrder(data: LoadingListData, currency: string): string {
  const orderSections = data.orders.map(order => {
    const orderItems = data.items; // In byOrder mode, items are already per-order
    const itemRows = orderItems.map((item, i) => `
      <tr>
        <td style="text-align:center;padding:4px 6px;font-size:8.5pt">${i + 1}</td>
        <td style="padding:4px 6px;font-size:8.5pt">${escapeHtml(item.productName)}</td>
        <td style="text-align:right;padding:4px 6px;font-size:8.5pt">${Number(item.totalQty).toFixed(2)}</td>
        <td style="text-align:right;padding:4px 6px;font-size:8.5pt">${Number(item.totalPrice).toLocaleString("ru-RU")}</td>
      </tr>`).join("");

    const debt = Number(order.shopDebt);
    const debtColor = debtStatusColor(debt);

    return `
      <div style="margin-bottom:16px;padding:12px;border:1px solid #e2e8f0;border-radius:8px;page-break-inside:avoid">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <div style="font-size:11pt;font-weight:700;color:#0f172a">ЗАКАЗ № ${escapeHtml(order.orderNumber)}</div>
            <div style="font-size:9pt;color:#64748b">→ ${escapeHtml(order.shopName ?? "Магазин")}</div>
            <div style="font-size:8pt;color:#94a3b8">${escapeHtml(order.shopAddress ?? "")} ${order.shopCity ? `, ${escapeHtml(order.shopCity)}` : ""}</div>
            ${order.shopPhone ? `<div style="font-size:8pt;color:#94a3b8">Тел: ${escapeHtml(order.shopPhone)}</div>` : ""}
          </div>
          <div style="text-align:right">
            <div style="font-size:11pt;font-weight:700">${Number(order.total).toLocaleString("ru-RU")} ${currency}</div>
            ${debt > 0 ? `<div style="font-size:8pt;color:${debtColor};font-weight:600">Долг: ${debt.toLocaleString("ru-RU")} ${currency}</div>` : ""}
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f8fafc">
            <th style="width:4%;padding:4px 6px;font-size:7.5pt;color:#64748b;border-bottom:1px solid #e2e8f0">№</th>
            <th style="padding:4px 6px;font-size:7.5pt;color:#64748b;border-bottom:1px solid #e2e8f0;text-align:left">Товар</th>
            <th style="width:12%;padding:4px 6px;font-size:7.5pt;color:#64748b;border-bottom:1px solid #e2e8f0;text-align:right">Кол-во</th>
            <th style="width:14%;padding:4px 6px;font-size:7.5pt;color:#64748b;border-bottom:1px solid #e2e8f0;text-align:right">Сумма</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <div style="display:flex;gap:16px;margin-top:10px;font-size:8pt">
          <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" style="width:14px;height:14px"> Товар проверен</label>
          <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" style="width:14px;height:14px"> Упаковка целая</label>
          <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" style="width:14px;height:14px"> Документы переданы</label>
        </div>
        <div style="display:flex;gap:20px;margin-top:10px;font-size:8pt;color:#94a3b8">
          <div>Подпись получателя: _______________</div>
          <div>Дата/время: _______________</div>
        </div>
      </div>`;
  }).join("");

  return `
    <div style="text-align:center;margin-bottom:10px">
      <div style="font-size:16pt;font-weight:800;color:#0f172a">ЗАГРУЗОЧНЫЙ ЛИСТ</div>
      <div style="font-size:11pt;color:#64748b">№ ${escapeHtml(data.listNumber)} — По заказам</div>
    </div>
    <div style="display:flex;gap:20px;margin-bottom:12px;font-size:9pt;color:#64748b">
      <div>Заказов: <b>${data.totalOrders}</b></div>
      <div>Позиций: <b>${data.totalItems}</b></div>
      <div>Общий вес: <b>${data.totalWeight.toFixed(1)} кг</b></div>
    </div>
    ${orderSections}`;
}

export function printLoadingList(data: LoadingListData, format: "aggregated" | "byOrder" | "byRoute", currency: string = "сум") {
  const html = format === "aggregated"
    ? buildLoadingListAggregated(data, currency)
    : buildLoadingListByOrder(data, currency);

  openPrintWindow(html, `Загрузочный лист № ${data.listNumber}`, GRID_STYLES);
}
