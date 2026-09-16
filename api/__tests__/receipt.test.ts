/**
 * Чек с QR.
 *
 *   · метка подписана: номер без подписи и с чужой подписью не открывает
 *     чек; своя — открывает; сравнение подписей постоянное по времени;
 *   · HTML чека: 58 мм, по-русски, строки, итого, чем заплатили, остаток в
 *     долг, QR — ссылка на этот же чек; всё пользовательское экранировано;
 *   · разряды сумм — обычным пробелом, не неразрывным (лента принтера);
 *   · публичная страница смонтирована без сессии; ручка order.receipt — тем
 *     же правом, что чтение заказа; в карточке заказа — «Чек 58 мм (QR)».
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../lib/env", () => ({ env: { appSecret: "test-secret-for-receipts", appUrl: "https://app.example.test" } }));
import { receiptToken, parseReceiptToken, receiptUrl, receiptHtml, type ReceiptData } from "../services/receipt";

const ROOT = join(__dirname, "..", "..");
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\r\n]*\/\/.*$/gm, "");
const read = (p: string) => strip(readFileSync(join(ROOT, p), "utf8"));

describe("подписанная метка", () => {
  it("своя подпись открывает, чужая и голый номер — нет", () => {
    const t = receiptToken(42);
    expect(t).toMatch(/^42\.[A-Za-z0-9_-]{22}$/);
    expect(parseReceiptToken(t)).toBe(42);
    expect(parseReceiptToken("42")).toBeNull();
    expect(parseReceiptToken("43." + t.split(".")[1])).toBeNull();
    expect(parseReceiptToken(t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(receiptUrl(42)).toBe(`https://app.example.test/r/${t}`);
  });
});

describe("HTML чека", () => {
  const data: ReceiptData = {
    orderId: 7, number: "№150", date: new Date("2026-09-16T05:04:00Z"), company: "ООО «Ромашка» <b>", phone: "+998 90 000 00 00", inn: "301111111",
    shop: "Магазин «Альфа»", seller: "Курьер", van: "Газель 1", method: "Наличные", paid: 900000, total: 1250000, currency: "сум",
    items: [{ name: "Вода 1,5 л <script>", qty: "10", price: "12 500", sum: "125 000" }], url: "https://app.example.test/r/7.x",
  };
  it("58 мм, по-русски, строки, итого, оплата, долг, QR на ту же ссылку; экранирование", async () => {
    const html = await receiptHtml(data);
    expect(html).toContain("@page { size: 58mm auto;");
    expect(html).toContain('<html lang="ru">');
    for (const s of ["ООО «Ромашка» &lt;b&gt;", "ИНН 301111111", "№150", "16.09.2026, 10:04", "Магазин «Альфа»", "Газель 1", "Выдал", "Вода 1,5 л &lt;script&gt;", "10 × 12 500", "125 000", "ИТОГО", "1 250 000 сум", "Наличные", "900 000 сум", "Остаток в долг", "350 000 сум", "<svg", "Проверить чек"]) {
      expect(html, s).toContain(s);
    }
    expect(html).not.toContain("<script>");
    expect(html).not.toContain(" ");
  });
  it("без долга строки «остаток» нет; без машины — строки «Машина» нет", async () => {
    const html = await receiptHtml({ ...data, paid: 1250000, van: null });
    expect(html).not.toContain("Остаток в долг");
    expect(html).not.toContain("Машина");
  });
});

describe("монтаж и экраны", () => {
  it("страница по QR — без сессии; ручка чека — правом чтения заказа; в карточке — пункт печати", () => {
    expect(read("api/boot.ts")).toContain('app.get("/r/:token", async (c) => {');
    expect(read("api/order-router.ts")).toMatch(/receipt: orderReaderQuery/);
    const page = read("src/pages/OrderDetail.tsx");
    expect(page).toContain('"Чек 58 мм (QR)"');
    expect(page).toContain("printReceiptHtml(r.data.html)");
    expect(page).toContain('order?.status === "delivered"');
  });
});
