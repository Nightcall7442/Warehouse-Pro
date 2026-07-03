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

function openPrintWindow(html: string, title: string) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) { window.print(); return; }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${BASE_STYLES}</style></head><body>${html}</body></html>`);
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
      <td>${item.name}${item.code ? ` (${item.code})` : ""}</td>
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
            <div class="sig-label">${data.seller.director ? `Директор: ${data.seller.director}` : "___________________________"}</div>
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
      <td>${item.name}${item.code ? ` (${item.code})` : ""}</td>
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
      <td>${item.name}</td>
      <td class="center">${item.code ?? ""}</td>
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

// ── 4. СЧЁТ-ФАКТУРА (Invoice for payment) ────────────────────────────────────
export function printInvoice(data: OrderDocData) {
  const itemRows = data.items.map((item, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${item.name}</td>
      <td class="center">${item.unit ?? "кг"}</td>
      <td class="right">${item.qty.toFixed(2)}</td>
      <td class="right">${item.price.toLocaleString("ru-RU")}</td>
      <td class="right">${item.total.toLocaleString("ru-RU")}</td>
    </tr>`).join("");

  const html = `
    <div style="background:#f0f0f0;padding:8px;margin-bottom:12px;text-align:center">
      <div style="font-size:16pt;font-weight:bold">СЧЁТ НА ОПЛАТУ № ${data.number}</div>
      <div>от ${data.date}</div>
    </div>

    <table class="no-border" style="margin-bottom:10px">
      <tr>
        <td style="width:15%;font-weight:bold">Поставщик:</td>
        <td>
          <b>${escapeHtml(data.seller.name)}</b><br>
          ИНН/СТИР: ${escapeHtml(data.seller.inn ?? "")} &nbsp;|&nbsp;
          Банк: ${escapeHtml(data.seller.bank ?? "")} &nbsp;|&nbsp;
          Р/с: ${escapeHtml(data.seller.account ?? "")} &nbsp;|&nbsp;
          МФО: ${escapeHtml(data.seller.mfo ?? "")}<br>
          Адрес: ${escapeHtml(data.seller.address ?? "")}
        </td>
      </tr>
      <tr><td style="font-weight:bold">Покупатель:</td><td><b>${escapeHtml(data.buyer.name)}</b></td></tr>
    </table>

    <table>
      <thead>
        <tr>
          <th style="width:4%">№</th>
          <th>Наименование</th>
          <th style="width:8%">Ед.</th>
          <th style="width:10%">Кол-во</th>
          <th style="width:14%">Цена (${data.currency})</th>
          <th style="width:16%">Сумма (${data.currency})</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
      </tbody>
    </table>

    <table class="no-border totals-table" style="width:300px;margin-left:auto;margin-top:4px">
      <tr><td>Итого:</td><td class="right">${data.subtotal.toLocaleString("ru-RU")} ${data.currency}</td></tr>
      ${data.discount && data.discount > 0 ? `<tr><td>Скидка:</td><td class="right">−${data.discount.toLocaleString("ru-RU")} ${data.currency}</td></tr>` : ""}
      <tr><td>НДС:</td><td class="right">Без НДС</td></tr>
      <tr class="total-row"><td><b>К ОПЛАТЕ:</b></td><td class="right bold">${data.total.toLocaleString("ru-RU")} ${data.currency}</td></tr>
    </table>

    <div style="margin-top:16px;padding:8px;border:1px solid #000;font-size:10pt">
      <b>Оплата данного счёта означает согласие с условиями поставки.</b><br>
      Уведомление об оплате обязательно. Счёт действителен в течение 5 банковских дней.
    </div>

    <div class="sig-row" style="margin-top:20px;display:flex;gap:40px">
      <div>Руководитель: <span style="display:inline-block;width:200px;border-bottom:1px solid #000">&nbsp;</span> ${escapeHtml(data.seller.director ?? "")}</div>
      <div>Бухгалтер: <span style="display:inline-block;width:200px;border-bottom:1px solid #000">&nbsp;</span></div>
    </div>
  `;

  openPrintWindow(html, `Счёт № ${data.number}`);
}
