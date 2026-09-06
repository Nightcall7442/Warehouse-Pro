/**
 * Print utility — injects print-only CSS and triggers window.print().
 * The printed content is rendered into a hidden div that becomes visible
 * only during print via @media print rules.
 */

function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function printElement(elementId: string, title: string) {
  const el = document.getElementById(elementId);
  if (!el) return;

  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) {
    // Fallback if popup blocked
    window.print();
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8"/>
      <title>${sanitizeHtml(title)}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: "Inter", -apple-system, sans-serif;
          font-size: 12px;
          color: #111;
          background: #fff;
          padding: 20mm 15mm;
        }
        h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
        h2 { font-size: 14px; font-weight: 600; margin: 16px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        .meta { display: flex; gap: 32px; margin-bottom: 16px; font-size: 12px; color: #555; }
        .meta span b { color: #111; }
        table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        th { background: #f5f5f5; text-align: left; padding: 8px 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; border: 1px solid #e0e0e0; }
        td { padding: 7px 10px; border: 1px solid #e0e0e0; font-size: 12px; }
        tr:nth-child(even) td { background: #fafafa; }
        .text-right { text-align: right; }
        .total-row td { font-weight: 700; background: #f0f0f0; border-top: 2px solid #aaa; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: 600; text-transform: uppercase; }
        .badge-new        { background: #dbeafe; color: #1e40af; }
        .badge-processing { background: #fef3c7; color: #92400e; }
        .badge-completed  { background: #d1fae5; color: #065f46; }
        .badge-cancelled  { background: #fee2e2; color: #991b1b; }
        .badge-pending    { background: #fef3c7; color: #92400e; }
        .badge-unloading  { background: #dbeafe; color: #1e40af; }
        .signature-block { margin-top: 40px; display: flex; justify-content: space-between; }
        .signature-line  { width: 200px; border-top: 1px solid #000; padding-top: 4px; font-size: 11px; color: #555; }
        .footer { margin-top: 32px; font-size: 10px; color: #999; text-align: center; border-top: 1px solid #eee; padding-top: 8px; }
        /*
          Поля задаёт @page, а не отступ у body: отступ применяется к потоку
          один раз и на второй странице не повторяется — верхнее поле там
          пропадало. Размер бумаги намеренно не объявлен: объявленный size
          отключает в Chrome выбор ориентации, а этот бланк печатают и
          альбомом.
        */
        @page { margin: 10mm; }
        thead { display: table-header-group; }
        tfoot { display: table-footer-group; }
        tr { break-inside: avoid; page-break-inside: avoid; }
        @media print {
          body { padding: 0; }
          /* Заливки состояний и итоговой строки несут смысл: без них бланк
             печатается плоской сеткой. Браузер фоны сам не печатает. */
          th, .total-row td, .badge {
            print-color-adjust: exact; -webkit-print-color-adjust: exact;
          }
        }
      </style>
    </head>
    <body>
      <div id="print-content"></div>
      <script>
        /*
          Окно закрывается ПОСЛЕ печати. Стоял таймер на полсекунды: человек
          не успевал даже выбрать принтер, окно закрывалось у него под руками
          вместе с диалогом, и это выглядело как «кнопка не работает».
        */
        window.onload = function() {
          window.focus();
          window.onafterprint = function() { window.close(); };
          window.print();
        };
      </script>
    </body>
    </html>
  `);
  printWindow.document.close();

  const container = printWindow.document.getElementById("print-content");
  if (container) {
    container.appendChild(el.cloneNode(true));
  }
}

/**
 * Напечатать простую таблицу: заголовок, подзаголовок, шапка и строки.
 *
 * ── Зачем отдельно от printElement ──────────────────────────────────────────
 *
 * printElement переносит на бумагу кусок экрана как есть — со всеми его
 * кнопками, отступами и цветами интерфейса. Для списка должников нужно
 * другое: те же строки, что уходят в файл, и ничего лишнего. Два способа
 * забрать один ответ не должны показывать разное.
 *
 * Стили берутся те же, что у printElement выше: одно правило страницы, одна
 * шапка, повторяющаяся на каждом листе. Дублировать их незачем — функция
 * собирает разметку и отдаёт её тому же окну печати.
 */
export function printSimpleReport(opts: {
  title: string;
  subtitle?: string;
  headers: string[];
  rows: string[][];
  /** С какого столбца числа: они выравниваются по правому краю. */
  numericFrom?: number;
}) {
  const { title, subtitle, headers, rows, numericFrom = 1 } = opts;
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) { window.print(); return; }

  const right = (i: number) => (i >= numericFrom ? ' class="text-right"' : "");
  const head = headers.map((h, i) => `<th${right(i)}>${sanitizeHtml(h)}</th>`).join("");
  const body = rows
    .map(r => `<tr>${r.map((c, i) => `<td${right(i)}>${sanitizeHtml(c)}</td>`).join("")}</tr>`)
    .join("");

  w.document.write(`<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"/>
    <title>${sanitizeHtml(title)}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: "Inter", -apple-system, sans-serif; font-size: 12px; color: #111; background: #fff; }
      h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
      .meta { font-size: 12px; color: #555; margin-bottom: 14px; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th { background: #f5f5f5; text-align: left; padding: 8px 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; border: 1px solid #e0e0e0; }
      td { padding: 7px 10px; border: 1px solid #e0e0e0; font-size: 12px; }
      .text-right { text-align: right; white-space: nowrap; }
      /* Размер бумаги не объявлен намеренно: объявленный size отключает в
         Chrome выбор ориентации, а список должников печатают и альбомом. */
      @page { margin: 12mm; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; page-break-inside: avoid; }
      @media print { th { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
    </style></head><body>
    <h1>${sanitizeHtml(title)}</h1>
    ${subtitle ? `<div class="meta">${sanitizeHtml(subtitle)}</div>` : ""}
    <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    <script>
      window.onload = function() {
        window.focus();
        window.onafterprint = function() { window.close(); };
        window.print();
      };
    </script>
    </body></html>`);
  w.document.close();
}
