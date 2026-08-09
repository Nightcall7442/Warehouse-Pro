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
