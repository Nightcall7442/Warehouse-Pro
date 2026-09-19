// @vitest-environment jsdom
/**
 * Шаблоны накладных — выбор арендатора.
 *
 * Владелец (19.09.2026): «накладные занимают больше места на бумаге и нет
 * номера магазинов; сделай настройки, где можно кастомизировать накладные
 * полностью, и два-три готовых шаблона» — с образцом конкурента: полстраницы
 * на экземпляр, два рядом, телефон магазина, агент, знак поставщика системы.
 *
 * Нарочная поломка: в renderCompact убери `opts.showShopPhone ?` — упадёт
 * «галочка снимает телефон»; в composeInvoicePages сделай side-раскладку
 * такой же, как stack, — упадёт «рядом»; в resolveInvoiceOptions перестань
 * читать saved — упадут «отличия поверх умолчаний».
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INVOICE_DEFAULTS, INVOICE_TEMPLATES, resolveInvoiceOptions } from "@contracts/invoice-template";
import { renderInvoiceCopy, composeInvoicePages, sampleInvoiceView, COPY_LABELS, type InvoiceView } from "@/lib/invoice-templates";
import { printUzWaybill, printBatchInvoices, type OrderDocData, type BatchOrderData } from "@/lib/documents";

const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
const count = (s: string, needle: string) => s.split(needle).length - 1;
const view = (): InvoiceView => sampleInvoiceView({ name: "ООО Ромашка", inn: "301234567", logoUrl: "data:image/png;base64,AAAA" }, "сум");

describe("умолчания шаблонов и отличия поверх них", () => {
  it("у каждого шаблона свои умолчания; «Компактная» — с телефоном магазина, агентом и знаком Warehouse Pro, как на образце", () => {
    expect(INVOICE_TEMPLATES).toEqual(["classic", "compact", "detailed"]);
    expect(INVOICE_DEFAULTS.compact).toMatchObject({ logo: "warehouse-pro", showShopPhone: true, showAgent: true, showAgentPhone: true, copies: 2, copiesLayout: "side" });
    // «Классическая» — как печаталось до выбора: без знака и телефона, два экземпляра друг под другом.
    expect(INVOICE_DEFAULTS.classic).toMatchObject({ logo: "none", showShopPhone: false, copies: 2, copiesLayout: "stack" });
    expect(INVOICE_DEFAULTS.detailed).toMatchObject({ showDebt: true, showBarcode: true });
  });

  it("сохранённые отличия ложатся поверх умолчаний; чужие ключи и null не пролезают", () => {
    const o = resolveInvoiceOptions("compact", { showShopPhone: false, copies: 1, ...( { junk: 1, showAgent: null } as unknown as object) });
    expect(o.showShopPhone).toBe(false);
    expect(o.copies).toBe(1);
    expect(o.showAgent).toBe(true);
    expect((o as unknown as Record<string, unknown>).junk).toBeUndefined();
    expect(resolveInvoiceOptions("classic", null)).toEqual(INVOICE_DEFAULTS.classic);
  });
});

describe("компактная — образец владельца", () => {
  const opts = INVOICE_DEFAULTS.compact;
  it("номер, телефон магазина, агент с телефоном, артикул, итог по количеству и сумме, подписи, знак Warehouse Pro", () => {
    const html = renderInvoiceCopy(view(), "compact", opts);
    const t = text(html);
    expect(t).toContain("Накладная №: ORD-01042");
    expect(t).toContain("Телефон: +998 90 123 45 67");
    expect(t).toContain("Агент: Эшмуродов Жасур (+998 99 967 17 71)");
    expect(t).toContain("Артикул");
    expect(t).toContain("0557");
    expect(t).toMatch(/Итого кол\..*44/);
    expect(t).toContain("1 288 000 сум");
    expect(t).toContain("Отправил:");
    expect(t).toContain("Принял:");
    expect(html).toContain("Warehouse Pro");
    expect(html).toContain("<svg");
  });
  it("галочка снимает телефон, агента, артикул и знак", () => {
    const t = text(renderInvoiceCopy(view(), "compact", { ...opts, showShopPhone: false, showAgent: false, showProductCode: false, logo: "none" }));
    expect(t).not.toContain("Телефон:");
    expect(t).not.toContain("Агент:");
    expect(t).not.toContain("Артикул");
    expect(t).not.toContain("Warehouse Pro");
  });
  it("логотип организации — только когда он загружен; без него шапка без знака", () => {
    expect(renderInvoiceCopy(view(), "compact", { ...opts, logo: "company" })).toContain('<img class="inv-logo" src="data:image/png;base64,AAAA"');
    const v = view(); v.company.logoUrl = undefined;
    expect(renderInvoiceCopy(v, "compact", { ...opts, logo: "company" })).not.toContain("inv-logo");
  });
  it("название магазина экранируется", () => {
    const v = view(); v.shop.name = "<script>alert(1)</script>";
    const html = renderInvoiceCopy(v, "compact", opts);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("классическая и подробная слушают галочки", () => {
  it("классическая: без единицы — нет колонки «Ед.»; с телефоном — есть строка", () => {
    const a = text(renderInvoiceCopy(view(), "classic", INVOICE_DEFAULTS.classic));
    expect(a).toContain("Ед.");
    expect(a).not.toContain("Телефон:");
    expect(a).not.toContain("Warehouse Pro");
    const b = text(renderInvoiceCopy(view(), "classic", { ...INVOICE_DEFAULTS.classic, showUnit: false, showShopPhone: true }));
    expect(b).not.toContain("Ед.");
    expect(b).toContain("Телефон: +998 90 123 45 67");
  });
  it("подробная: долг и штрих-код печатаются по галочке", () => {
    const on = renderInvoiceCopy(view(), "detailed", INVOICE_DEFAULTS.detailed);
    expect(text(on)).toContain("Долг магазина: 350 000 сум");
    expect(on).toContain("<svg");
    const off = renderInvoiceCopy(view(), "detailed", { ...INVOICE_DEFAULTS.detailed, showDebt: false, showBarcode: false });
    expect(text(off)).not.toContain("Долг магазина");
    expect(off).not.toContain("<svg");
  });
});

describe("шапка и строки одной ширины", () => {
  /*
    Раньше это считалось по исходнику documents.ts (documents-are-honest);
    здесь графы включаются галочками, поэтому меряем готовую разметку при
    каждом сочетании: столбцы «Ед.», «Артикул», «Заказ/Отдали» у частичной.
  */
  const span = (cell: string) => Number(/colspan="(\d+)"/.exec(cell)?.[1] ?? 1);
  const width = (row: string) => (row.match(/<t[hd][\s\S]*?<\/t[hd]>/g) ?? []).reduce((s, c) => s + span(c), 0);
  const partial = (): InvoiceView => {
    const v = view();
    return { ...v, isPartial: true, items: v.items.map(i => ({ ...i, orderedQty: i.qty + 1 })) };
  };
  for (const tpl of INVOICE_TEMPLATES) {
    for (const flip of [{}, { showUnit: false, showProductCode: false }, { showUnit: true, showProductCode: true, showDiscount: true }]) {
      for (const [name, v] of [["полная", view], ["частичная", partial]] as const) {
        it(`${tpl}, ${name}, ${JSON.stringify(flip)}`, () => {
          const html = renderInvoiceCopy(v(), tpl, { ...INVOICE_DEFAULTS[tpl], ...flip });
          const tables = html.match(/<table[\s\S]*?<\/table>/g) ?? [];
          expect(tables.length).toBeGreaterThan(0);
          for (const table of tables) {
            const rows = table.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
            const widths = rows.map(width).filter(w => w > 0);
            expect(new Set(widths).size, `${table.replace(/\s+/g, " ").slice(0, 120)}
ширины строк: ${widths.join(",")}`).toBe(1);
          }
        });
      }
    }
  }
});

describe("раскладка экземпляров", () => {
  const body = "<div>X</div>";
  it("один экземпляр — без подписей экземпляров и отреза", () => {
    const html = composeInvoicePages([body], { ...INVOICE_DEFAULTS.classic, copies: 1 });
    expect(html).not.toContain(COPY_LABELS[0]);
    expect(html).not.toContain("линия отреза");
  });
  it("два друг под другом — отрез между ними; два рядом — одна строка с вертикальным отрезом", () => {
    const stack = composeInvoicePages([body], INVOICE_DEFAULTS.classic);
    expect(count(stack, "линия отреза")).toBe(1);
    expect(stack).toContain(COPY_LABELS[0]);
    expect(stack).toContain(COPY_LABELS[1]);
    const side = composeInvoicePages([body], INVOICE_DEFAULTS.compact);
    expect(side).toContain("side-by-side");
    expect(side).toContain("cut-line-v");
    expect(side).not.toContain("линия отреза");
    expect(count(side, "<div>X</div>")).toBe(2);
  });
  it("каждый заказ — на своём листе", () => {
    expect(count(composeInvoicePages([body, body, body], INVOICE_DEFAULTS.compact), "page-break-before:always")).toBe(2);
  });
});

describe("печать из карточки и из пачки идёт по шаблону", () => {
  let written = "";
  beforeEach(() => {
    written = "";
    vi.stubGlobal("open", () => ({ document: { write: (h: string) => { written += h; }, close: () => {} }, print: () => {}, close: () => {}, onload: null }));
  });
  const doc = (): OrderDocData => ({
    number: "ORD-7", date: "01.09.2026", seller: { name: "ООО Ромашка" }, buyer: { name: "Альфа" }, shopPhone: "+998 90 000 00 00",
    items: [{ name: "Печенье", code: "P-1", unit: "pcs", qty: 10, price: 12000, total: 120000 }], subtotal: 120000, total: 120000, currency: "сум",
  });
  it("карточка: без шаблона — классическая, с «compact» — компактная и галочки", () => {
    printUzWaybill(doc());
    expect(count(text(written), "РАСХОДНАЯ НАКЛАДНАЯ")).toBe(2);
    expect(text(written)).not.toContain("Warehouse Pro");
    written = "";
    printUzWaybill(doc(), "compact", { showShopPhone: false });
    expect(count(text(written), "Накладная №: ORD-7")).toBe(2);
    expect(text(written)).not.toContain("+998 90 000 00 00");
    expect(written).toContain('class="fs-small"');
  });
  it("пачка: без шаблона — подробная, с «compact» — компактная", () => {
    const o = (id: number): BatchOrderData => ({
      id, orderNumber: `ORD-${id}`, status: "delivered", total: "1000", subtotal: "1000", discount: "0", notes: null, createdAt: new Date("2026-09-01T10:00:00Z"),
      shopId: id, shopName: "Альфа", shopAddress: null, shopCity: null, shopPhone: "+998 90 111 22 33", shopDebt: "0", shopDebtAmount: 0,
      agentName: "Агент А", agentPhone: "+998 90 999 99 99", territoryName: null, courierName: null, paymentMethod: "cash", invoicePrintedAt: null,
      items: [{ productId: 1, quantity: "2", unitPrice: "500", costPrice: "300", subtotal: "1000", productName: "Товар", productCode: "T1", unit: "pcs" }],
      paymentHistory: [],
    });
    const opts = { includeQrCode: true, includeBarcodes: true, includeCostPrice: false, includeSignature: true, includeNotes: true, pageBreakPerOrder: false, sortBy: "orderNumber" as const };
    printBatchInvoices([o(1), o(2)], opts, { name: "ООО Ромашка" }, "сум");
    expect(count(text(written), "Накладная № ORD-1")).toBe(2);
    expect(count(written, "page-break-before:always")).toBe(1);
    written = "";
    printBatchInvoices([o(1)], opts, { name: "ООО Ромашка" }, "сум", "simple", "compact", null);
    expect(count(text(written), "Накладная №: ORD-1")).toBe(2);
    expect(text(written)).toContain("Агент: Агент А (+998 90 999 99 99)");
    expect(written).toContain("side-by-side");
  });
});

/* ── Экран настроек ──────────────────────────────────────────────────────── */
const stub = vi.hoisted(() => {
  const state = { template: null as string | null, options: null as Record<string, unknown> | null, update: vi.fn() };
  return {
    state,
    trpc: {
      branding: {
        get: { useQuery: () => ({ data: { invoiceTemplate: state.template, invoiceOptions: state.options, logoUrl: null, footerText: null } }) },
        update: { useMutation: (o?: { onSuccess?: () => void }) => ({ mutate: (input: unknown) => { state.update(input); o?.onSuccess?.(); }, isPending: false }) },
      },
      settings: { get: { useQuery: () => ({ data: { companyName: "ООО Ромашка", currencySymbol: "сум" } }) } },
      useUtils: () => ({ branding: { get: { invalidate: vi.fn() } } }),
    },
  };
});
vi.mock("@/providers/trpc", () => ({ trpc: stub.trpc }));
vi.mock("@/lib/toast", () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

describe("настройки → «Накладные»", () => {
  afterEach(cleanup);
  beforeEach(() => { stub.state.template = null; stub.state.options = null; stub.state.update.mockReset(); });
  const mount = async () => {
    const { InvoiceSettings } = await import("@/components/settings/InvoiceSettings");
    const { LangProvider } = await import("@/i18n");
    return render(<LangProvider><InvoiceSettings /></LangProvider>);
  };
  const preview = () => (screen.getByTestId("invoice-preview") as HTMLIFrameElement).getAttribute("srcdoc") ?? "";

  it("три шаблона; пока не выбрали — «Классическая»; выбор меняет предпросмотр", async () => {
    await mount();
    expect(screen.getAllByRole("radio", { name: /Классическая|Компактная|Подробная/ })).toHaveLength(3);
    expect(screen.getByTestId("invoice-template-classic").getAttribute("aria-checked")).toBe("true");
    expect(text(preview())).toContain("РАСХОДНАЯ НАКЛАДНАЯ");
    fireEvent.click(screen.getByTestId("invoice-template-compact"));
    expect(text(preview())).toContain("Накладная №: ORD-01042");
    expect(text(preview())).toContain("Телефон: +998 90 123 45 67");
  });

  it("галочка меняет предпросмотр сразу, а в базу уходят только отличия от умолчаний", async () => {
    await mount();
    fireEvent.click(screen.getByTestId("invoice-template-compact"));
    fireEvent.click(screen.getByTestId("invoice-showShopPhone"));
    expect(text(preview())).not.toContain("Телефон:");
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(stub.state.update).toHaveBeenLastCalledWith({ invoiceTemplate: "compact", invoiceOptions: { showShopPhone: false } });
    // Вернули как было — отличий нет, хранить нечего.
    fireEvent.click(screen.getByTestId("invoice-showShopPhone"));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(stub.state.update).toHaveBeenLastCalledWith({ invoiceTemplate: "compact", invoiceOptions: null });
  });

  it("сохранённый выбор читается из базы", async () => {
    stub.state.template = "detailed"; stub.state.options = { showDebt: false };
    await mount();
    expect(screen.getByTestId("invoice-template-detailed").getAttribute("aria-checked")).toBe("true");
    expect((screen.getByTestId("invoice-showDebt") as HTMLInputElement).checked).toBe(false);
    expect(text(preview())).not.toContain("Долг магазина");
  });

  it("раздел «Накладные» есть в настройках директора, а карточка и пачка печатают по выбору", () => {
    const settings = readFileSync(join(process.cwd(), "src/pages/Settings.tsx"), "utf8");
    expect(settings).toContain('key: "invoices", Icon: FileText, roles: ["ceo"],');
    expect(readFileSync(join(process.cwd(), "src/pages/OrderDetail.tsx"), "utf8")).toContain('printUzWaybill(d, invoice.template ?? "classic", invoice.options)');
    expect(readFileSync(join(process.cwd(), "src/components/orders/InvoicePrintModal.tsx"), "utf8")).toContain('docType, invoice.template ?? "detailed", invoice.options)');
    // Телефон агента едет с сервера — иначе «Компактной» нечего печатать.
    expect(readFileSync(join(process.cwd(), "api/services/order-read.ts"), "utf8")).toContain("agentPhone: users.phone,");
  });
});
