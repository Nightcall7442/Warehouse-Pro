/**
 * Document templates for СНГ market.
 * Each function returns an HTML string suitable for window.print().
 * Styles are embedded inline for maximum print compatibility.
 */
import { colorMix } from "@/lib/color-mix";

/**
 * Правила печати, общие для всех документов.
 *
 * ── Почему из @page убран size ──────────────────────────────────────────────
 *
 * В правиле страницы рядом с полями стоял ещё и размер бумаги. Казалось бы,
 * безобидно — но
 * Chrome, увидев объявленный size, ОТКЛЮЧАЕТ выбор ориентации в окне печати:
 * страница сказала, чего хочет, и человеку выбирать нечего. Отсюда и жалоба,
 * что альбомную поставить нельзя ни на одном документе.
 *
 * Размер бумаги задаёт тот, кто печатает: у него A4, Letter или рулон
 * термопринтера, и знать это лучше него мы не можем. Поля остаются: без них
 * браузер берёт свои, и они разные у разных.
 *
 * ── Почему шапка объявлена группой ──────────────────────────────────────────
 *
 * `thead { display: table-header-group }` заставляет браузер повторять шапку
 * таблицы на КАЖДОЙ странице. Без этого накладная на сорок позиций со второй
 * страницы превращалась в столбцы безымянных чисел: где количество, где цена,
 * где сумма — непонятно.
 *
 * ── Почему строки не рвутся ─────────────────────────────────────────────────
 *
 * Строка товара, разорванная между страницами, — это половина названия
 * наверху одного листа и цифры внизу другого. break-inside держит её целой.
 *
 * ── Почему заливки печатаются ───────────────────────────────────────────────
 *
 * Браузер по умолчанию не печатает фоны, экономя краску. В документе заливка
 * шапки таблицы — не украшение, а граница между заголовком и данными: без неё
 * лист выглядит плоской сеткой цифр. Оттенки здесь светло-серые, краски берут
 * немного.
 */
const PRINT_RULES = `
  @page { margin: 10mm; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  .meta-box, .totals-box, .doc-fill {
    print-color-adjust: exact; -webkit-print-color-adjust: exact;
  }
`;

function escapeHtml(str: string | null | undefined): string {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Translate unit codes to Russian labels */
// Подписи единиц — общие, из src/lib/units.ts. Здесь была своя таблица, и
// в ней `box` печатался «блоком»: в накладной ящик от блока не отличить.
import { unitShort as unitLabel } from "./units";
import { openPrintWindowOrExplain } from "./print";

/** Format number without trailing zeros: 70.00 → 70, 60.00 → 60, 12.50 → 12.5 */
function cleanNum(val: string | number | null | undefined): string {
  const n = Number(val ?? 0);
  if (n === 0) return "0";
  if (n === Math.floor(n)) return n.toLocaleString("ru-RU");
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
  ${PRINT_RULES}
  /*
    На бумаге поля задаёт только @page.

    Отступ body в 15 мм складывался с полем страницы в 10 мм: на А4 шириной
    210 мм под документ оставалось 160. Колонки жались, длинные названия
    переносились в три строки, накладная на семь позиций уезжала на второй
    лист. В экранном окне отступ нужен — там страницы нет; в печати он лишний.
    В GRID_STYLES это уже было, здесь — нет, поэтому расходная накладная,
    приходная и ТОРГ-12 печатались с двойными полями.
  */
  @media print {
    body { padding: 0; }
    .no-print { display: none !important; }
  }
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
  ${PRINT_RULES}
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
    margin-bottom: 6px;
    padding-bottom: 4px;
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
    width: 220px;
    margin-left: auto;
    margin-top: 4px;
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
    margin-bottom: 4mm;
    padding: 6mm 10mm;
    border-bottom: 1px dashed #ccc;
  }
`;

function openPrintWindow(html: string, title: string, customStyles?: string) {
  /*
    Заблокированное окно объясняется словами, а не печатает экран.

    Стояло `if (!w) { window.print(); return; }` — то есть на принтер уходила
    сама страница приложения: тёмная заливка во весь лист, боковое меню,
    кнопки. Человек нажимал «печать накладной» и получал снимок экрана.
  */
  const w = openPrintWindowOrExplain();
  if (!w) return;
  const styles = customStyles ?? BASE_STYLES;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${styles}</style></head><body>${html}</body></html>`);
  w.document.close();

  /*
    Окно закрывается ПОСЛЕ печати, а не через восемьсот миллисекунд.

    Стоял таймер на восемьсот миллисекунд, закрывавший окно. Оно открывается
    асинхронно, и человек в нём выбирает принтер, ориентацию, «Сохранить как
    PDF» — на это уходит куда больше восьмисот миллисекунд. Окно закрывалось
    у него под руками вместе с диалогом: документ не печатался и не
    сохранялся, а выглядело это как «кнопка не работает».

    afterprint срабатывает и когда напечатали, и когда отказались, — в обоих
    случаях окно уже не нужно. Если событие не придёт вовсе (так ведут себя
    некоторые сборки), окно просто останется открытым: это неудобно, но не
    отнимает у человека документ.
  */
  w.onload = () => {
    w.focus();
    w.onafterprint = () => w.close();
    w.print();
  };
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
  phone?:     string;
  /** Знак арендатора строкой data:image/… — печатается в шапке счёта. */
  logoUrl?:   string;
};

/**
 * Подпись внизу документа.
 *
 * Здесь стояло «Документ сформирован автоматически в системе Warehouse Pro» —
 * на расходной накладной, на ТОРГ-12 и в подвале счёта. Эти три бумаги
 * арендатор отдаёт СВОЕМУ покупателю, и имя поставщика системы на них не
 * должно стоять вовсе: покупатель видит чужую компанию в документе своей.
 *
 * Что печатается вместо: текст, который арендатор задал в «Брендинге», а
 * если не задал — ничего. Пустая строка честнее чужого имени.
 */
function docFooter(note: string | undefined, size: string, color: string): string {
  const text = (note ?? "").trim();
  if (!text) return "";
  return `<p style="margin-top:12px;font-size:${size};color:${color}">${escapeHtml(text)}</p>`;
}

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
  /** Текст в подвале — из «Брендинга» арендатора. Пусто — подписи нет. */
  footerNote?: string;
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
  footerNote?: string;
};

/**
 * Строка реквизита. Пусто — строки нет вовсе.
 *
 * ── Почему это про «некомпактно» ────────────────────────────────────────────
 *
 * Реквизиты печатались всегда, все шесть: «ИНН / СТИР:», «Адрес:», «Банк:»,
 * «Р/с:», «МФО:». У арендатора, заполнившего только название, накладная
 * выходила с пятью строками, после двоеточия в которых не было ничего.
 * Документ занимал место, ничего им не говоря, и выглядел брошенным.
 *
 * Пустая строка на бумаге — не «нейтрально»: человек читает её как «данных
 * нет» и ищет, где они. Строки, которой нет, он не ищет.
 */
function metaRow(label: string, value: string | null | undefined, bold = false): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  return `<div class="meta-row"><span class="meta-label">${escapeHtml(label)}</span>`
    + `<span class="meta-value${bold ? " bold" : ""}">${escapeHtml(v)}</span></div>`;
}

/**
 * Соединить части через запятую, пропуская пустые.
 *
 * В ТОРГ-12 стояло «${name}, ${address ?? ""}»: без адреса на бланке
 * оставалась висящая запятая — «ООО Ромашка, » и пустота до конца строки. На
 * товарной накладной, которую подписывают обе стороны, это выглядит как
 * незаполненный документ.
 */
function joinParts(...parts: (string | null | undefined)[]): string {
  return parts.map(p => (p ?? "").trim()).filter(Boolean).join(", ");
}

/**
 * Пометка «заказано → отпущено», когда довезли не всё.
 *
 * ── Почему без неё документ не сходится ─────────────────────────────────────
 *
 * При частичной доставке `quantity` строки остаётся заказанным, а `subtotal`
 * пересчитывается по отпущенному (см. applyPartialDelivery в api/services/
 * order.ts). Вызывающая сторона печатает qty = отпущено, и арифметика в
 * строке сходится, но из документа пропадает сам факт недостачи: магазин
 * видит «7 шт» там, где заказывал 10, без единого слова почему.
 *
 * Поля orderedQty / deliveredQty / returnReason в типе DocItem были, но их
 * не печатал ни один документ.
 */
function partialNote(item: DocItem, size = "8pt"): string {
  const ordered = item.orderedQty;
  const delivered = item.deliveredQty;
  if (ordered == null || delivered == null || delivered >= ordered) return "";
  const reason = (item.returnReason ?? "").trim();
  const tail = reason ? `, ${reason}` : "";
  return `<div style="font-size:${size};color:#666">заказано ${cleanNum(ordered)}, отпущено ${cleanNum(delivered)}${escapeHtml(tail)}</div>`;
}

// ── 1. РАСХОДНАЯ НАКЛАДНАЯ (Uzbekistan standard) — 2 копии на листе ──────────
export function printUzWaybill(data: OrderDocData) {
  const itemRows = data.items.map((item, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${escapeHtml(item.name)}${item.code ? ` (${escapeHtml(item.code)})` : ""}${partialNote(item)}</td>
      <td class="center">${unitLabel(item.unit)}</td>
      <td class="center">${cleanNum(item.qty)}</td>
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
              ${metaRow("Поставщик:", data.seller.name, true)}
              ${metaRow("ИНН / СТИР:", data.seller.inn)}
              ${metaRow("Адрес:", data.seller.address)}
              ${metaRow("Банк:", data.seller.bank)}
              ${metaRow("Р/с:", data.seller.account)}
              ${metaRow("МФО:", data.seller.mfo)}
            </div>
          </td>
          <td style="width:50%">
            <div class="meta">
              ${metaRow("Покупатель:", data.buyer.name, true)}
              ${metaRow("ИНН / СТИР:", data.buyer.inn)}
              ${metaRow("Адрес:", data.buyer.address)}
            </div>
          </td>
        </tr>
      </table>

      <div class="title">РАСХОДНАЯ НАКЛАДНАЯ</div>
      <div class="subtitle">№ ${escapeHtml(data.number)} от ${escapeHtml(data.date)}</div>

      <table>
        <thead>
          <tr>
            <th style="width:4%">№</th>
            <th>Наименование товара</th>
            <th style="width:8%">Ед.изм.</th>
            <th style="width:10%">Кол-во</th>
            <th style="width:14%">Цена (${escapeHtml(data.currency)})</th>
            <th style="width:16%">Сумма (${escapeHtml(data.currency)})</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
          <tr>
            <td colspan="3" class="right bold">ИТОГО:</td>
            <td class="center bold">${cleanNum(data.items.reduce((s,i) => s+i.qty, 0))}</td>
            <td></td>
            <td class="right bold">${data.subtotal.toLocaleString("ru-RU")} ${escapeHtml(data.currency)}</td>
          </tr>
          ${data.discount && data.discount > 0 ? `
          <tr>
            <td colspan="5" class="right">Скидка:</td>
            <td class="right">−${data.discount.toLocaleString("ru-RU")} ${escapeHtml(data.currency)}</td>
          </tr>` : ""}
          <tr>
            <td colspan="5" class="right bold">К ОПЛАТЕ:</td>
            <td class="right bold">${data.total.toLocaleString("ru-RU")} ${escapeHtml(data.currency)}</td>
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

  /*
    Две копии на одном листе — как и написано в заголовке раздела.

    Между копиями стоял разрыв страницы: на каждый заказ уходило два листа
    вместо одного. Накладная на семь позиций занимает меньше половины А4, и
    вторая половина уезжала в мусор. Дистрибьютор печатает их пачками по
    полсотни в день.

    Разрыва нет — есть линия отреза. Каждая копия целиком помещается на своей
    половине (page-break-inside), и если позиций окажется много, вторая копия
    сама перейдёт на следующий лист: это хуже, чем половина листа, но лучше,
    чем разорванная посередине накладная.
  */
  const CUT_LINE = `
    <div style="margin:6mm 0;border-top:1px dashed #999;position:relative">
      <span style="position:absolute;top:-7px;left:0;background:#fff;padding-right:6px;font-size:8pt;color:#999">✂ линия отреза</span>
    </div>`;

  const html = `
    <div style="page-break-inside:avoid">${buildCopy("КОПИЯ ДЛЯ СКЛАДЧИКА")}</div>
    ${CUT_LINE}
    <div style="page-break-inside:avoid">${buildCopy("КОПИЯ ДЛЯ ШОФЁРА")}</div>

    ${docFooter(data.footerNote, "9pt", "#555")}
  `;

  openPrintWindow(html, `Расходная накладная № ${escapeHtml(data.number)}`);
}

// ── 2. ПРИХОДНАЯ НАКЛАДНАЯ (Goods Receipt) ────────────────────────────────────
export function printArrivalReceipt(data: ArrivalDocData) {
  const itemRows = data.items.map((item, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${escapeHtml(item.name)}${item.code ? ` (${escapeHtml(item.code)})` : ""}</td>
      <td class="center">${unitLabel(item.unit)}</td>
      <td class="center">${cleanNum(item.qty)}</td>
      <td></td>
    </tr>`).join("");

  const html = `
    <table class="no-border" style="margin-bottom:8px">
      <tr>
        <td style="width:50%">
          <div class="meta">
            <div class="meta-row"><span class="meta-label">Поставщик:</span><span class="meta-value bold">${escapeHtml(data.supplier.name)}</span></div>
            ${metaRow("ИНН / СТИР:", data.supplier.inn)}
            ${metaRow("Адрес:", data.supplier.address)}
          </div>
        </td>
        <td style="width:50%">
          <div class="meta">
            <div class="meta-row"><span class="meta-label">Получатель:</span><span class="meta-value bold">${escapeHtml(data.receiver.name)}</span></div>
            ${metaRow("ИНН / СТИР:", data.receiver.inn)}
            ${metaRow("Адрес:", data.receiver.address)}
          </div>
        </td>
      </tr>
    </table>

    <div class="title">ПРИХОДНАЯ НАКЛАДНАЯ</div>
    <div class="subtitle">№ ${escapeHtml(data.number)} от ${escapeHtml(data.date)}</div>

    <table>
      <thead>
        <tr>
          <th style="width:4%">№</th>
          <th>Наименование товара</th>
          <th style="width:8%">Ед.изм.</th>
          <th style="width:12%">Кол-во</th>
          <!--
            Колонка состояния заполняется рукой при приёмке.

            Здесь печаталось «Хорошее» — в каждой строке, всегда: поля
            condition в DocItem нет, и приведение к Record<string, unknown>
            неизменно давало undefined. Приходная накладная утверждала, что
            весь груз пришёл целым, ещё до того, как кладовщик на него
            посмотрел, — а подписывает он именно эту графу.
          -->
          <th style="width:16%">Состояние</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        <tr>
          <!--
            Под графой «Ед.изм.» стояло «кг» — для любого прихода. Считают
            штуками, ящиками и литрами тоже, а общее количество по разным
            единицам всё равно складывается только как число позиций товара.
          -->
          <td colspan="3" class="right bold">ИТОГО:</td>
          <td class="center bold">${cleanNum(data.totalQty)}</td>
          <td></td>
        </tr>
      </tbody>
    </table>

    ${data.expenses?.total ? `
    <h3 style="margin-top:12px">Транспортные расходы</h3>
    <table style="width:300px">
      <tr><td>Топливо</td><td class="right">${(data.expenses.fuel ?? 0).toLocaleString("ru-RU")} ${escapeHtml(data.currency)}</td></tr>
      <tr><td>Дорожные расходы</td><td class="right">${(data.expenses.toll ?? 0).toLocaleString("ru-RU")} ${escapeHtml(data.currency)}</td></tr>
      <tr><td>Прочие расходы</td><td class="right">${(data.expenses.other ?? 0).toLocaleString("ru-RU")} ${escapeHtml(data.currency)}</td></tr>
      <tr class="bold"><td><b>ИТОГО расходы</b></td><td class="right bold">${data.expenses.total.toLocaleString("ru-RU")} ${escapeHtml(data.currency)}</td></tr>
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

  openPrintWindow(html, `Приходная накладная № ${escapeHtml(data.number)}`);
}

// ── 3. ТОРГ-12 (Russian standard) ────────────────────────────────────────────
export function printTorg12(data: OrderDocData) {
  /*
    ── Строка съехала относительно шапки ───────────────────────────────────────

    Шапка объявляла двенадцать граф, строка заполняла их так:

      2 «Код товара»    — пусто,
      4 «Код по ОКЕИ»   — артикул товара (P-1, а не код классификатора),
      6 «код единицы»   — 796 для каждой строки, независимо от единицы:
                          796 это «штука», а в накладную попадают литры,
                          килограммы и ящики,
      7 «в одном месте» и 8 «мест, штук» — одно и то же количество дважды.
                          Число мест это тарные единицы, система их не ведёт.

    То есть артикул стоял в графе классификатора, а количество мест бралось
    с потолка — по товарной накладной принимают груз и пересчитывают именно
    места.

    Что теперь: артикул в своей графе «Код товара», графы кодов ОКЕИ и «в
    одном месте» остаются пустыми под заполнение рукой (ТОРГ-12 — бланк), а
    отдельная графа «Код по ОКЕИ», дублировавшая подграфу единицы измерения,
    убрана. Граф стало одиннадцать.
  */
  const itemRows = data.items.map((item, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td class="center">${escapeHtml(item.code ?? "")}</td>
      <td>${escapeHtml(item.name)}${partialNote(item, "7.5pt")}</td>
      <td class="center">${unitLabel(item.unit)}</td>
      <td></td>
      <td></td>
      <td class="center">${cleanNum(item.qty)}</td>
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
          <b>ИНН/КПП:</b> ${escapeHtml(data.seller.inn) || "_______________"}<br>
          <!-- Прочерк, как у ИНН строкой выше: ТОРГ-12 — бланк, и поле без
               значения дозаполняют рукой. Пустое место после двоеточия
               выглядит забытым, а прочерк — оставленным намеренно. -->
          <b>Адрес:</b> ${escapeHtml(data.seller.address ?? "") || "_______________"}
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
            <tr><td colspan="2" class="center bold">${escapeHtml(data.number)}</td><td class="center">${escapeHtml(data.date)}</td></tr>
          </table>
        </td>
      </tr>
    </table>

    <div class="title" style="font-size:16pt">ТОВАРНАЯ НАКЛАДНАЯ</div>

    <table class="no-border" style="margin:6px 0">
      <tr>
        <td style="width:50%">
          <b>Грузоотправитель</b> и его адрес: ${escapeHtml(joinParts(data.seller.name, data.seller.address))}
        </td>
        <td style="width:50%">
          <b>Грузополучатель</b> и его адрес: ${escapeHtml(joinParts(data.buyer.name, data.buyer.address))}
        </td>
      </tr>
      <tr>
        <td>Поставщик: ${escapeHtml(data.seller.name)}</td>
        <td>Покупатель: ${escapeHtml(joinParts(data.buyer.name, data.buyer.inn ? "ИНН " + data.buyer.inn : ""))}</td>
      </tr>
    </table>

    <table style="font-size:9pt">
      <thead>
        <tr>
          <th rowspan="2" style="width:3%">№</th>
          <th rowspan="2" style="width:7%">Код товара</th>
          <th rowspan="2">Наименование, характеристика, сорт, артикул товара</th>
          <th colspan="2" style="width:14%">Единица измерения</th>
          <th colspan="2" style="width:16%">Количество</th>
          <th rowspan="2" style="width:10%">Цена, ${escapeHtml(data.currency)}</th>
          <th colspan="2" style="width:14%">НДС</th>
          <th rowspan="2" style="width:12%">Сумма с учётом НДС, ${escapeHtml(data.currency)}</th>
        </tr>
        <tr>
          <th>наименование</th><th>код по ОКЕИ</th>
          <th>в одном месте</th><th>мест, штук</th>
          <th>ставка, %</th><th>сумма, ${escapeHtml(data.currency)}</th>
        </tr>
        <tr>
          ${Array.from({length:11},(_,i)=>`<th class="center">${i+1}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        <tr>
          <td colspan="6" class="right bold">Итого</td>
          <td class="center bold">${cleanNum(data.items.reduce((s,i)=>s+i.qty,0))}</td>
          <td></td>
          <td colspan="2" class="center">Без НДС</td>
          <td class="right bold">${data.subtotal.toLocaleString("ru-RU",{minimumFractionDigits:2})}</td>
        </tr>
      </tbody>
    </table>

    <!--
      Здесь стояло «Итого мест: 1» — жёстко, для любого документа. Число мест
      это количество тарных единиц, и система его не знает: в данных документа
      такого поля нет вовсе. Печатать выдуманную единицу на товарной накладной
      нельзя — по ней принимают груз. Печатается то, что известно на самом
      деле: сколько наименований в документе.

      Валюта была вписана словом «руб.» — притом что двумя строками выше, в
      шапке таблицы, она берётся из настроек арендатора. Организация в
      Узбекистане печатала товарную накладную с рублями.
    -->
    <table class="no-border" style="margin-top:4px;font-size:10pt">
      <tr>
        <td>Всего наименований: <b>${data.items.length}</b></td>
        <td class="right">Итого отпущено на сумму: <b>${data.total.toLocaleString("ru-RU",{minimumFractionDigits:2})} ${escapeHtml(data.currency)}</b></td>
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

    ${docFooter(data.footerNote, "8pt", "#666")}
  `;

  openPrintWindow(html, `ТОРГ-12 № ${escapeHtml(data.number)}`);
}

// ── 4. СЧЁТ-ФАКТУРА (Invoice for payment) — professional template ───────────
export function printInvoice(data: OrderDocData) {
  const itemRows = data.items.map((item, i) => `
    <tr>
      <td style="text-align:center;padding:8px 6px;color:#64748b;font-size:9pt">${i + 1}</td>
      <td style="padding:8px 10px">${escapeHtml(item.name)}${item.code ? `<br><span style="font-size:8pt;color:#94a3b8">Арт: ${escapeHtml(item.code)}</span>` : ""}${partialNote(item)}</td>
      <td style="text-align:center;padding:8px 6px;color:#64748b">${unitLabel(item.unit)}</td>
      <td style="text-align:right;padding:8px 10px;font-variant-numeric:tabular-nums">${cleanNum(item.qty)}</td>
      <td style="text-align:right;padding:8px 10px;color:#64748b;font-variant-numeric:tabular-nums">${item.price.toLocaleString("ru-RU")}</td>
      <td style="text-align:right;padding:8px 10px;font-weight:600;font-variant-numeric:tabular-nums">${item.total.toLocaleString("ru-RU")}</td>
    </tr>`).join("");

  const sellerInitials = (data.seller.name || "WP")
    .split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);

  const pmBadge = data.paymentMethodLabel
    ? `<span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:9pt;font-weight:600;background:${colorMix(data.paymentMethodColor ?? "#5b6d8a", 9)};color:${data.paymentMethodColor ?? "#5b6d8a"};border:1px solid ${colorMix(data.paymentMethodColor ?? "#5b6d8a", 19)}">${escapeHtml(data.paymentMethodLabel)}</span>`
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
    ${PRINT_RULES}
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
        ${data.seller.logoUrl
          ? `<img src="${escapeHtml(data.seller.logoUrl)}" alt="" style="width:48px;height:48px;object-fit:contain;border-radius:12px">`
          /* Знака нет — квадрат с буквами. Он был залит синим #3b82f6:
             цветом, которого нет ни в палитре приложения, ни у арендатора.
             Серый ничьим не притворяется. */
          : `<div style="width:48px;height:48px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#475569;font-weight:700;font-size:16pt;letter-spacing:1px">${sellerInitials}</div>`}
        <div>
          <div style="font-size:14pt;font-weight:700;color:#0f172a;letter-spacing:-0.3px">${escapeHtml(data.seller.name)}</div>
          <div style="font-size:8.5pt;color:#94a3b8;margin-top:2px">${data.seller.address ? escapeHtml(data.seller.address) : ""}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:8pt;text-transform:uppercase;letter-spacing:2px;color:#94a3b8;margin-bottom:2px">Счёт на оплату</div>
        <div style="font-size:20pt;font-weight:800;color:#0f172a;letter-spacing:-0.5px">№ ${escapeHtml(data.number)}</div>
        <div style="font-size:9pt;color:#64748b;margin-top:2px">${escapeHtml(data.date)}</div>
      </div>
    </div>

    <!--
      Способ оплаты. Рядом стояла вторая метка «Заказ № …» — с тем же
      номером, что набран двадцатым кеглем на три сантиметра выше. Строка
      уходила целиком под повтор соседней строки.
    -->
    ${pmBadge ? `<div style="margin-bottom:18px">${pmBadge}</div>` : ""}

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
          <th style="width:14%;text-align:right;padding:8px 10px;font-size:8pt;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0">Цена (${escapeHtml(data.currency)})</th>
          <th style="width:16%;text-align:right;padding:8px 10px;font-size:8pt;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:600;border-bottom:2px solid #e2e8f0">Сумма (${escapeHtml(data.currency)})</th>
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
            <td style="padding:6px 0;text-align:right;font-variant-numeric:tabular-nums">${data.subtotal.toLocaleString("ru-RU")} ${escapeHtml(data.currency)}</td>
          </tr>
          ${data.discount && data.discount > 0 ? `<tr>
            <td style="padding:6px 0;color:#64748b">Скидка</td>
            <td style="padding:6px 0;text-align:right;color:#16a34a;font-weight:600;font-variant-numeric:tabular-nums">−${data.discount.toLocaleString("ru-RU")} ${escapeHtml(data.currency)}</td>
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
            <td style="padding:8px 0;text-align:right;font-size:13pt;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums">${data.total.toLocaleString("ru-RU")} ${escapeHtml(data.currency)}</td>
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
      ${[escapeHtml((data.footerNote ?? "").trim()), escapeHtml(data.date)].filter(Boolean).join(" &bull; ")}
    </div>
  `;

  openPrintWindow(html, `Счёт № ${escapeHtml(data.number)}`, INVOICE_STYLES);
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
  courierName: string | null;
  paymentMethod: string;
  invoicePrintedAt: Date | null;
  isPartial?: boolean;
  items: Array<{
    productId: number;
    quantity: string;
    /** Сколько отпустили по факту. null — доставки ещё не было. */
    deliveredQuantity?: string | null;
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
  /** Текст в подвале — из «Брендинга» арендатора. */
  footerNote?: string;
  includeQrCode: boolean;
  includeBarcodes: boolean;
  includeCostPrice: boolean;
  includeSignature: boolean;
  includeNotes: boolean;
  pageBreakPerOrder: boolean;
  sortBy: "orderNumber" | "shop" | "agentRoute" | "territory";
};

/**
 * Долг магазина в накладной — числом, без окриков.
 *
 * ── Что здесь было ──────────────────────────────────────────────────────────
 *
 * Долг раскрашивался и подписывался по трём порогам в абсолютных суммах:
 * 500 000 — «Небольшая задолженность», миллион — «Крупная задолженность!
 * Обратите внимание», выше — «КРИТИЧЕСКИЙ ДОЛГ! Требуется срочная оплата».
 *
 * Пороги ничего не значат без валюты: полмиллиона сумов и полмиллиона тенге
 * различаются на порядок, а валюта у каждого арендатора своя (она тут же,
 * параметром). К тому же две верхние ветки красили одним цветом — третья
 * ступень не существовала.
 *
 * И главное: эту бумагу экспедитор отдаёт в магазин. Крик капслоком в чужом
 * документе — не про деньги, а про тон; сумма и без него читается.
 *
 * Остаётся то, ради чего блок и нужен экспедитору: сколько магазин должен,
 * сколько забрать с учётом этой поставки и когда платили в последний раз.
 */
const DEBT_ACCENT = "#b45309";

function buildDebtBlock(order: BatchOrderData, currency: string): string {
  const debt = order.shopDebtAmount;
  if (debt <= 0) return ""; // Долга нет — блока нет.

  const recommended = debt + Number(order.total);

  // История платежей приходит за последние 30 дней (batchGetOrdersForPrint).
  const lastPayment = order.paymentHistory[0];
  const paymentLine = lastPayment
    ? `Последний платёж: ${new Date(lastPayment.createdAt).toLocaleDateString("ru-RU")} — ${Number(lastPayment.amount).toLocaleString("ru-RU")} ${escapeHtml(currency)}`
    : "Платежей за 30 дней нет";

  return `
    <div style="margin:4px 0;padding:4px 8px;border:1px solid ${colorMix(DEBT_ACCENT, 25)};background:${colorMix(DEBT_ACCENT, 3)};font-size:8pt">
      <b style="color:${DEBT_ACCENT}">Долг магазина: ${debt.toLocaleString("ru-RU")} ${escapeHtml(currency)}</b>
      ${Number(order.total) > 0 ? `<span style="margin-left:8px">К оплате с этой поставкой: <b>${recommended.toLocaleString("ru-RU")} ${escapeHtml(currency)}</b></span>` : ""}
      <span style="margin-left:8px;color:#666">${paymentLine}</span>
    </div>`;
}

function buildSingleInvoice(order: BatchOrderData, opts: BatchPrintOptions, company: CompanyInfo, currency: string): string {
  const itemRows = (order.items ?? []).map((item, i) => {
    const costCol = opts.includeCostPrice ? `<td class="right">${Number(item.costPrice).toLocaleString("ru-RU")}</td>` : "";
    /*
      ── Заказано и отпущено ───────────────────────────────────────────────────

      В обеих колонках стояло item.quantity: заказанное количество, зачёркнутое,
      и рядом оно же — как «отдали». Документ показывал недостачу, которой по
      его же числам не было.

      Отпущенное лежит в order_items.delivered_quantity: частичная доставка
      пишет его туда и пересчитывает subtotal строки, а quantity оставляет
      заказанным (applyPartialDelivery в api/services/order.ts). Без него
      строка не сходилась и в обычной накладной: цена × количество давала одно,
      а в графе «Сумма» стояло другое.
    */
    const delivered = item.deliveredQuantity != null ? Number(item.deliveredQuantity) : null;
    const qtyCol = order.isPartial
      ? `<td class="right" style="text-decoration:line-through;color:#999">${cleanNum(item.quantity)}</td>
         <td class="right bold">${cleanNum(delivered ?? item.quantity)}</td>`
      : `<td class="right">${cleanNum(delivered ?? item.quantity)}</td>`;
    return `
      <tr>
        <td class="center">${i + 1}</td>
        <td>${escapeHtml(item.productName)}${item.productCode ? ` <span style="color:#666;font-size:8pt">(${escapeHtml(item.productCode)})</span>` : ""}</td>
        <td class="center">${unitLabel(item.unit)}</td>
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
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;padding-bottom:4px;border-bottom:2px solid #333">
        <div style="font-size:10pt;font-weight:700">${escapeHtml(company.name)}${company.inn ? ` (ИНН: ${escapeHtml(company.inn)})` : ""}</div>
        <div style="text-align:right">
          <span style="font-size:10pt;font-weight:700">Накладная № ${escapeHtml(order.orderNumber)}</span>
          <span style="font-size:8pt;color:#666;margin-left:8px">от ${new Date(order.createdAt).toLocaleDateString("ru-RU")}</span>
          ${opts.includeBarcodes ? `<div style="display:flex;justify-content:flex-end;margin-top:2px">${barcodeCell(order.orderNumber)}</div>` : ""}
        </div>
      </div>
      <div style="display:flex;gap:16px;font-size:8pt;color:#666;margin-bottom:4px">
        ${order.shopName ? `<span>Магазин: <b>${escapeHtml(order.shopName)}</b></span>` : ""}
        ${order.agentName ? `<span>Агент: ${escapeHtml(order.agentName)}</span>` : ""}
        ${order.territoryName ? `<span>Территория: ${escapeHtml(order.territoryName)}</span>` : ""}
        ${order.shopAddress ? `<span>Адрес: ${escapeHtml(order.shopAddress)}</span>` : ""}
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
          <tr><td>Итого позиций:</td><td class="right">${(order.items ?? []).length}</td></tr>
          <tr><td>Сумма:</td><td class="right">${Number(order.subtotal).toLocaleString("ru-RU")} ${escapeHtml(currency)}</td></tr>
          ${Number(order.discount) > 0 ? `<tr><td>Скидка:</td><td class="right" style="color:#16a34a">−${Number(order.discount).toLocaleString("ru-RU")} ${escapeHtml(currency)}</td></tr>` : ""}
          <tr class="total-row"><td>ИТОГО:</td><td class="right">${Number(order.total).toLocaleString("ru-RU")} ${escapeHtml(currency)}</td></tr>
        </table>
      </div>

      ${opts.includeNotes && order.notes ? `<div style="margin-top:10px;padding:8px 10px;background:#fffbeb;border:1px solid #fde68a;font-size:8pt"><b>Примечание:</b> ${escapeHtml(order.notes)}</div>` : ""}

      ${opts.includeSignature ? `
      <div style="display:flex;gap:20px;margin-top:8px;font-size:8pt">
        <div style="flex:1">Отпустил: _______________</div>
        <div style="flex:1">Получил: _______________</div>
        <div style="flex:1">Дата: _______________</div>
      </div>` : ""}`;
}

/*
  ТТН — товарно-транспортная накладная.

  ── Что здесь было ────────────────────────────────────────────────────────────

  Три графы НДС: «Цена без НДС», «Цена с НДС» и «Ставка НДС». В первые две
  печаталась одна и та же unitPrice — то есть документ утверждал, что налога в
  цене нет; в третьей стояло «0%» для каждой строки, всегда.

  Система НДС не ведёт: api/services/onec-vat.ts к заказам не подключён (на
  него ссылаются только его собственные тесты). Ставку 0% нельзя подставлять за
  арендатора — на ТТН груз принимают и по ней же сверяются с налоговой, и
  плательщик НДС этой бумагой заявляет чужую ставку.

  Осталась цена и сумма — по одному разу, как их и знает система. Граф стало
  шесть вместо восьми: колонки шире, названия не переносятся.
*/
function buildTTNInvoice(order: BatchOrderData, company: CompanyInfo, currency: string): string {
  const itemRows = (order.items ?? []).map((item, i) => {
    const price = Number(item.unitPrice);
    const sum = Number(item.subtotal);
    const delivered = item.deliveredQuantity != null ? Number(item.deliveredQuantity) : null;
    return `
      <tr>
        <td class="center">${i + 1}</td>
        <td>${escapeHtml(item.productName)}${item.productCode ? ` <span style="color:#666;font-size:8pt">(${escapeHtml(item.productCode)})</span>` : ""}</td>
        <td class="center">${unitLabel(item.unit)}</td>
        <td class="right">${cleanNum(delivered ?? item.quantity)}</td>
        <td class="right">${price.toLocaleString("ru-RU")}</td>
        <td class="right bold">${sum.toLocaleString("ru-RU")}</td>
      </tr>`;
  }).join("");

  const total = Number(order.total);

  return `
      <div style="text-align:center;margin-bottom:8px">
        <div style="font-size:14pt;font-weight:800">ТОВАРНО-ТРАНСПОРТНАЯ НАКЛАДНАЯ</div>
        <div style="font-size:10pt;color:#666">№ ${escapeHtml(order.orderNumber)} от ${new Date(order.createdAt).toLocaleDateString("ru-RU")}</div>
      </div>

      <table class="no-border" style="margin-bottom:6px;font-size:9pt">
        <tr>
          <td style="width:50%">
            ${metaRow("Поставщик:", company.name, true)}
            ${metaRow("ИНН:", company.inn)}
            ${metaRow("Адрес:", company.address)}
          </td>
          <td style="width:50%">
            ${metaRow("Контрагент:", order.shopName, true)}
            ${metaRow("Адрес:", order.shopAddress)}
            ${metaRow("Телефон:", order.shopPhone)}
          </td>
        </tr>
        <tr>
          <td><span class="meta-label">Доставщик:</span> ${escapeHtml(order.courierName ?? "—")}</td>
          <td><span class="meta-label">Торговый представитель:</span> ${escapeHtml(order.agentName ?? "—")}</td>
        </tr>
      </table>

      ${buildDebtBlock(order, currency)}

      <table style="font-size:9pt">
        <thead>
          <tr>
            <th style="width:4%">№</th>
            <th style="text-align:left">Наименование</th>
            <th style="width:7%">Ед.</th>
            <th style="width:10%">Кол-во</th>
            <th style="width:14%">Цена, ${escapeHtml(currency)}</th>
            <th style="width:16%">Сумма, ${escapeHtml(currency)}</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <div class="totals-box">
        <table>
          <tr class="total-row"><td>Итого:</td><td class="right">${total.toLocaleString("ru-RU")} ${escapeHtml(currency)}</td></tr>
        </table>
      </div>

      <div style="display:flex;gap:20px;margin-top:14px;font-size:8pt">
        <div style="flex:1">Продавец: _______________</div>
        <div style="flex:1">Получатель: _______________</div>
        <div style="flex:1">Торговый представитель: _______________</div>
      </div>`;
}

// Валюта — параметр без запасного значения: стояло «сум», и забытый аргумент
// напечатал бы узбекскую валюту в документе казахстанского арендатора молча.
export function printBatchInvoices(orders: BatchOrderData[], opts: BatchPrintOptions, company: CompanyInfo, currency: string, docType: "simple" | "ttn" = "simple") {
  // Sort orders
  const sorted = [...orders];
  if (opts.sortBy === "shop") sorted.sort((a, b) => (a.shopName ?? "").localeCompare(b.shopName ?? ""));
  else if (opts.sortBy === "agentRoute") sorted.sort((a, b) => (a.agentName ?? "").localeCompare(b.agentName ?? ""));
  else if (opts.sortBy === "territory") sorted.sort((a, b) => (a.territoryName ?? "").localeCompare(b.territoryName ?? ""));
  else sorted.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));

  const pages = sorted.map(o => `<div class="invoice-container">${docType === "ttn" ? buildTTNInvoice(o, company, currency) : buildSingleInvoice(o, opts, company, currency)}</div>`);
  const separator = opts.pageBreakPerOrder ? '<div style="page-break-before:always"></div>' : '<div style="margin-bottom:10mm"></div>';
  const html = pages.join(separator);

  openPrintWindow(html, `Накладные — ${orders.length} заказ(ов)`, GRID_STYLES);
}

// ── 6. LOADING LIST — for warehouse workers ────────────────────────────────

import { code128Svg } from "./code128";

/** Штрих-код для бумаги; код с не-ASCII (кириллица) остаётся текстом. */
function barcodeCell(value: string | null | undefined): string {
  if (!value) return "";
  try { return `<div style="height:9mm">${code128Svg(value, { height: 28, label: false }).replace(/ width="\d+" height="\d+"/, ' style="height:100%"')}</div>`; }
  catch { return ""; }
}

/** Одна этикетка на бумаге. count — сколько штук печатать (по приходу: сколько пришло). */
export type LabelItem = { name: string; code: string; barcode?: string | null; price: string; currency: string; count?: number };

/** Не больше — иначе одна кнопка отправляет на принтер рулон. */
export const MAX_LABELS = 500;

/**
 * Этикетки 50×30 мм со штрих-кодом Code 128.
 *
 * До этого этикетки печатались только со страницы «Штрих-коды» по одной
 * очереди, а после прихода их печатали руками по количеству. Здесь: список
 * с числом штук — на приход это «сколько пришло, столько и наклеек».
 */
export function printLabels(items: LabelItem[]) {
  const labels: string[] = [];
  for (const it of items) {
    const n = Math.max(1, Math.floor(it.count ?? 1));
    let svg = "";
    try { svg = code128Svg(it.barcode || it.code, { height: 40, label: true }); } catch { svg = ""; }
    const one = `<div class="label">
      <div class="label-name">${escapeHtml(it.name)}</div>
      ${svg ? `<div class="label-bar">${svg}</div>` : `<div class="label-code">Код: ${escapeHtml(it.code)}</div>`}
      <div class="label-price">${Number(it.price).toLocaleString("ru-RU")} ${escapeHtml(it.currency)}</div>
    </div>`;
    for (let k = 0; k < n && labels.length < MAX_LABELS; k++) labels.push(one);
  }
  const styles = `
    @page { margin: 5mm; }
    body { margin: 0; font-family: Arial, sans-serif; }
    .label-grid { display: flex; flex-wrap: wrap; gap: 4mm; }
    .label { width: 50mm; height: 30mm; border: 0.5px solid #ccc; box-sizing: border-box; padding: 2mm;
      display: flex; flex-direction: column; align-items: center; justify-content: center; page-break-inside: avoid; }
    .label-name { font-size: 7pt; font-weight: bold; text-align: center; line-height: 1.1; max-height: 8mm; overflow: hidden; }
    .label-bar { width: 44mm; height: 11mm; margin: 1mm 0; } .label-bar svg { width: 100%; height: 100%; }
    .label-code { font-size: 7pt; color: #555; margin: 1mm 0; }
    .label-price { font-size: 10pt; font-weight: bold; }
  `;
  openPrintWindow(`<div class="label-grid">${labels.join("")}</div>`, "Этикетки", styles);
}

export type LoadingListData = {
  listId: number;
  listNumber: string;
  /** Чья это отгрузка. Лист уходит на склад и водителю без обратного адреса. */
  companyName?: string;
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
    agentId: number | null;
    agentName: string | null;
    territoryName: string | null;
    courierName: string | null;
    paymentMethod: string;
    total: string;
  }>;
  items: Array<{
    productId: number;
    productName: string;
    productCode: string | null;
    /** Штрих-код поставщика, если задан; на бумаге печатается он, иначе код. */
    barcode?: string | null;
    unit: string;
    unitWeight: string;
    totalQty: string;
    totalPrice: string;
  }>;
  itemsByAgent: Array<{
    productId: number;
    productName: string;
    productCode: string | null;
    unit: string;
    agentId: number | null;
    agentName: string | null;
    totalQty: string;
  }>;
};

function buildLoadingListAggregated(data: LoadingListData, currency: string): string {
  // Штрих-код в строке: кладовщик собирает по сканеру, а не по названию.
  const itemRows = data.items.map((item, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${escapeHtml(item.productCode ?? "")}${barcodeCell(item.barcode || item.productCode)}</td>
      <td>${escapeHtml(item.productName)}</td>
      <td class="center">${unitLabel(item.unit)}</td>
      <td class="right bold">${cleanNum(item.totalQty)}</td>
      <td class="right">${cleanNum(Number(item.totalQty) * Number(item.unitWeight))}</td>
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
    .map(([name, { count, total }]) => `<div>• ${escapeHtml(name)} — ${count} заказ(ов) — ${total.toLocaleString("ru-RU")} ${escapeHtml(currency)}</div>`)
    .join("");

  // Territory
  const territories = [...new Set(data.orders.map(o => o.territoryName).filter(Boolean))];
  const territoryLine = territories.length > 0 ? `<div>Территория: <b>${escapeHtml(territories.join(", "))}</b></div>` : "";

  const totalSum = data.orders.reduce((s, o) => s + Number(o.total), 0);

  return `
    <div style="text-align:center;margin-bottom:10px">
      ${data.companyName ? `<div style="font-size:10pt;font-weight:600;color:#334155">${escapeHtml(data.companyName)}</div>` : ""}
      <div style="font-size:16pt;font-weight:800">ЗАГРУЗОЧНЫЙ ЛИСТ</div>
      <div style="font-size:11pt;color:#666">№ ${escapeHtml(data.listNumber)}</div>
    </div>
    <table class="no-border" style="margin-bottom:12px;font-size:9pt">
      <tr>
        <td>Дата: <b>${new Date().toLocaleDateString("ru-RU")}</b></td>
        <td>Заказов: <b>${data.totalOrders}</b></td>
        <td>Позиций: <b>${data.totalItems}</b></td>
        <td>Общий вес: <b>${cleanNum(data.totalWeight)} кг</b></td>
        <td>Сумма: <b>${totalSum.toLocaleString("ru-RU")} ${escapeHtml(currency)}</b></td>
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

// Route/agent matrix — products × agents, with cash/debt/total money rows per agent
function buildLoadingListByRoute(data: LoadingListData, currency: string): string {
  const agents = [...new Map(
    data.orders.map(o => [o.agentId ?? o.agentName ?? "—", { id: o.agentId, name: o.agentName ?? "Не назначен" }] as const)
  ).values()];

  const territoriesByAgent = new Map<string, Set<string>>();
  for (const o of data.orders) {
    const key = o.agentName ?? "Не назначен";
    const set = territoriesByAgent.get(key) ?? new Set<string>();
    if (o.territoryName) set.add(o.territoryName);
    territoriesByAgent.set(key, set);
  }

  const couriers = [...new Set(data.orders.map(o => o.courierName).filter(Boolean))] as string[];
  const territories = [...new Set(data.orders.map(o => o.territoryName).filter(Boolean))] as string[];

  // productId -> agentKey -> qty
  const qtyMap = new Map<number, Map<string, number>>();
  const productMeta = new Map<number, { name: string; code: string | null; unit: string }>();
  for (const row of data.itemsByAgent) {
    productMeta.set(row.productId, { name: row.productName, code: row.productCode, unit: row.unit });
    const agentsForProduct = qtyMap.get(row.productId) ?? new Map<string, number>();
    agentsForProduct.set(row.agentName ?? "Не назначен", Number(row.totalQty));
    qtyMap.set(row.productId, agentsForProduct);
  }

  const agentHeaderCell = (name: string) => {
    const zones = [...(territoriesByAgent.get(name) ?? [])];
    return `${escapeHtml(name)}${zones.length ? `<div style="font-size:7pt;font-weight:400;color:#666">${escapeHtml(zones.join(", "))}</div>` : ""}`;
  };

  const itemRows = [...productMeta.entries()].map(([productId, meta], i) => {
    const agentCells = agents.map(a => {
      const qty = qtyMap.get(productId)?.get(a.name) ?? 0;
      return `<td class="right">${qty > 0 ? cleanNum(qty) : "—"}</td>`;
    }).join("");
    const rowTotal = [...(qtyMap.get(productId)?.values() ?? [])].reduce((s, v) => s + v, 0);
    return `
      <tr>
        <td class="center">${i + 1}</td>
        <td>${escapeHtml(meta.name)}${meta.code ? ` <span style="color:#666;font-size:8pt">(${escapeHtml(meta.code)})</span>` : ""}</td>
        <td class="center">${unitLabel(meta.unit)}</td>
        ${agentCells}
        <td class="right bold">${cleanNum(rowTotal)}</td>
      </tr>`;
  }).join("");

  // Money rows per agent
  const cashByAgent = new Map<string, number>();
  const debtByAgent = new Map<string, number>();
  for (const o of data.orders) {
    const key = o.agentName ?? "Не назначен";
    const target = o.paymentMethod === "debt" ? debtByAgent : cashByAgent;
    target.set(key, (target.get(key) ?? 0) + Number(o.total));
  }
  const qtyTotalCells = agents.map(a => {
    const total = [...productMeta.keys()].reduce((s, pid) => s + (qtyMap.get(pid)?.get(a.name) ?? 0), 0);
    return `<td class="right bold">${cleanNum(total)}</td>`;
  }).join("");
  const cashCells = agents.map(a => `<td class="right">${(cashByAgent.get(a.name) ?? 0).toLocaleString("ru-RU")}</td>`).join("");
  const debtCells = agents.map(a => `<td class="right">${(debtByAgent.get(a.name) ?? 0).toLocaleString("ru-RU")}</td>`).join("");
  const totalCells = agents.map(a => `<td class="right bold">${((cashByAgent.get(a.name) ?? 0) + (debtByAgent.get(a.name) ?? 0)).toLocaleString("ru-RU")}</td>`).join("");

  const grandQty = [...productMeta.keys()].reduce((s, pid) => s + [...(qtyMap.get(pid)?.values() ?? [])].reduce((a, b) => a + b, 0), 0);
  const grandCash = [...cashByAgent.values()].reduce((a, b) => a + b, 0);
  const grandDebt = [...debtByAgent.values()].reduce((a, b) => a + b, 0);

  return `
    <div style="text-align:center;margin-bottom:10px">
      ${data.companyName ? `<div style="font-size:10pt;font-weight:600;color:#334155">${escapeHtml(data.companyName)}</div>` : ""}
      <div style="font-size:16pt;font-weight:800">ЗАГРУЗОЧНЫЙ ЛИСТ</div>
      <div style="font-size:11pt;color:#666">№ ${escapeHtml(data.listNumber)} — По маршрутам</div>
    </div>
    <table class="no-border" style="margin-bottom:10px;font-size:9pt">
      <tr><td>Дата формирования:</td><td class="bold">${new Date().toLocaleDateString("ru-RU")}</td></tr>
      <tr><td>Торговые представители:</td><td class="bold">${agents.map(a => escapeHtml(a.name)).join(", ")}</td></tr>
      <tr><td>Рабочие зоны:</td><td class="bold">${territories.length ? escapeHtml(territories.join(", ")) : "—"}</td></tr>
      <tr><td>Экспедиторы:</td><td class="bold">${couriers.length ? escapeHtml(couriers.join(", ")) : "—"}</td></tr>
    </table>
    <table style="font-size:9pt">
      <thead>
        <tr>
          <th style="width:4%">№</th>
          <th style="text-align:left">Наименование</th>
          <th style="width:6%">Ед.</th>
          ${agents.map(a => `<th>${agentHeaderCell(a.name)}</th>`).join("")}
          <th style="width:8%">Итого</th>
        </tr>
      </thead>
      <tbody>
        ${itemRows}
        <tr>
          <td colspan="3" class="right bold">Общее кол-во:</td>
          ${qtyTotalCells}
          <td class="right bold">${cleanNum(grandQty)}</td>
        </tr>
        <!--
          Строки называются по тому, что в них считается.

          Делят заказы по одному признаку: paymentMethod === "debt" или нет.
          Значит в первой не «наличные деньги», а всё, за что платят при
          доставке, — и карта, и перечисление тоже. Экспедитор сдаёт по этой
          строке кассу, и лишние безналичные заказы в ней означают недостачу,
          которой нет.
        -->
        <tr>
          <td colspan="3" class="right">Оплата при доставке:</td>
          ${cashCells}
          <td class="right">${grandCash.toLocaleString("ru-RU")}</td>
        </tr>
        <tr>
          <td colspan="3" class="right">В долг:</td>
          ${debtCells}
          <td class="right">${grandDebt.toLocaleString("ru-RU")}</td>
        </tr>
        <tr>
          <td colspan="3" class="right bold">Итого:</td>
          ${totalCells}
          <td class="right bold">${(grandCash + grandDebt).toLocaleString("ru-RU")} ${escapeHtml(currency)}</td>
        </tr>
      </tbody>
    </table>
    <div class="signature-block">
      <div class="sig-col"><div class="sig-label">Проверил кладовщик</div><div class="sig-line"></div></div>
      <div class="sig-col"><div class="sig-label">Отпустил</div><div class="sig-line"></div></div>
      <div class="sig-col"><div class="sig-label">Дата</div><div class="sig-line"></div></div>
    </div>`;
}

/*
  Форматов два: сводный и по маршрутам.

  Был третий, «по заказам», и он печатал одно и то же под каждым заказом:

      const orderItems = data.items; // In byOrder mode, items are already per-order

  Комментарий обещал, что позиции придут по заказам, но createLoadingList
  складывает их по всем сразу — параметр format сервер только записывает в
  meta. Так что в разделе первого магазина, второго и десятого лежал полный
  список отгрузки, и экспедитор по такой бумаге завёз бы каждому всё.

  Печатать было неоткуда: окно предлагает только «Сводный» и «По маршруту».
  Формат убран вместе с полутора десятками граф, которые он рисовал.
*/
export function printLoadingList(data: LoadingListData, format: "aggregated" | "byRoute", currency: string) {
  const html = format === "byRoute"
    ? buildLoadingListByRoute(data, currency)
    : buildLoadingListAggregated(data, currency);

  openPrintWindow(html, `Загрузочный лист № ${escapeHtml(data.listNumber)}`, GRID_STYLES);
}
