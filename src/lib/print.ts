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
        @media print {
          body { padding: 10mm 10mm; }
          @page { margin: 10mm; }
        }
      </style>
    </head>
    <body>
      <div id="print-content"></div>
      <script>
        window.onload = function() {
          window.print();
          setTimeout(function() { window.close(); }, 500);
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
