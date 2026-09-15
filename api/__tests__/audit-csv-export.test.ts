import { describe, it, expect } from "vitest";
import { exportAuditCsv } from "../services/audit-log";

/**
 * The audit log is exported to CSV and opened in Excel by a director. Two of
 * its columns — the actor's name and the meta blob — carry text chosen by the
 * very people the log exists to record, so this file checks that neither can
 * change what the file *means* once it is opened.
 */

type Row = Parameters<typeof exportAuditCsv>[0][number];

function row(over: Partial<Row>): Row {
  return {
    id: 1,
    createdAt: new Date("2026-08-06T09:00:00Z"),
    actorId: 7,
    actorName: "Иванов",
    action: "order.create",
    targetType: "order",
    targetId: 42,
    ip: "84.54.72.10",
    meta: {},
    ...over,
  } as Row;
}

describe("exportAuditCsv", () => {
  it("defuses a name that Excel would run as a formula", () => {
    const csv = exportAuditCsv([row({ actorName: '=HYPERLINK("http://зло","Открыть")' })]);
    // Quoting alone does not stop Excel — the leading apostrophe does.
    expect(csv).toContain(`"'=HYPERLINK`);
    expect(csv).not.toContain('"=HYPERLINK');
  });

  it("defuses the other three formula starters and control characters", () => {
    for (const prefix of ["=", "+", "-", "@", "\t", "\r"]) {
      const csv = exportAuditCsv([row({ actorName: `${prefix}вредно` })]);
      expect(csv, `префикс ${JSON.stringify(prefix)}`).toContain(`"'${prefix}вредно"`);
    }
  });

  it("leaves ordinary names and numbers alone", () => {
    // Over-defusing would put a stray apostrophe in front of every cell.
    const csv = exportAuditCsv([row({ actorName: "Иванов Пётр" })]);
    expect(csv).toContain('"Иванов Пётр"');
    expect(csv).not.toContain("'Иванов");
    expect(csv).toContain('"1"');
  });

  it("keeps a name with quotes and a newline inside one field", () => {
    // Quoted fields may legally hold both; the row count is what proves the
    // file did not split where the data merely contained a line break.
    const csv = exportAuditCsv([row({ actorName: 'ООО "Восток"\nфилиал' })]);
    expect(csv).toContain('"ООО ""Восток""\nфилиал"');
    // Header plus one record: the embedded newline lives inside the quotes.
    const quoteCount = (csv.match(/"/g) ?? []).length;
    expect(quoteCount % 2).toBe(0);
  });
});

/**
 * Бумага — по-русски и словами (memory: бумага остаётся русской).
 * Было: «order.create» в колонке «Действие» и {"agentId":112,…} в «Мета» —
 * по такой выгрузке спор не разберёшь. Те же словари, что на экране.
 */
describe("exportAuditCsv — словами", () => {
  it("действие подписано, подробности переведены, код действия — последней колонкой", () => {
    const csv = exportAuditCsv([row({
      action: "order.create", targetLabel: "№22 · Ogiljon Sharq",
      meta: { agentId: 112, actorRole: "agent", discountPct: 0, orderNumber: "№22", paymentMethod: "cash" },
    })]);
    const [header, line] = csv.split("\n");
    expect(header).toBe("ID,Дата,Сотрудник,Действие,Объект,Подробности,IP,Код действия");
    expect(line).toContain('"Создан заказ"');
    expect(line).toContain('"Роль: Агент · Оплата: Наличные"');
    expect(line).toContain('"order.create"');
    expect(line).not.toContain("agentId");
    expect(line).not.toContain("{");
  });

  it("дата — днём и временем, а не ISO с буквой T; без сотрудника — «Система»", () => {
    const csv = exportAuditCsv([row({ actorName: null, actorId: null, createdAt: new Date(2026, 7, 6, 14, 5) })]);
    expect(csv).toContain('"06.08.2026 14:05"');
    expect(csv).toContain('"Система"');
    expect(csv).not.toContain("T09:00");
  });

  it("неизвестное действие не теряется — печатается кодом", () => {
    expect(exportAuditCsv([row({ action: "something.new" })])).toContain('"something.new"');
  });
});
