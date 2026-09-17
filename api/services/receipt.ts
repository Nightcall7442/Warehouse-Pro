import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import QRCode from "qrcode";
import { orders, orderItems, products, shops, users, settings, warehouses, payments } from "@db/schema";
import { env } from "../lib/env";
import { appLink } from "../lib/telegram";
import { viewerScope, type OrderViewer } from "./order-shared";

/*
  Чек — документ продажи, а не картинка.

  ── Что это ────────────────────────────────────────────────────────────────

  Заказ доставлен — есть чек: фирма, №, дата, магазин, строки, итого, чем
  заплатили, кто выдал, и QR со ссылкой на этот же чек на сервере. Один и
  тот же HTML печатается на 58-мм ленте (веб, телефон через системную
  печать), уходит магазину PDF-ом или ссылкой и открывается по QR.

  ── QR — защита, не украшение ──────────────────────────────────────────────

  Ссылка подписана HMAC от секрета приложения: подделать чек за продажу,
  которой нет в системе, нельзя — по QR откроется «такого чека нет». Магазин
  или проверяющий сканирует и видит, что продажа записана, с теми же
  строками и суммой. Страница публичная, но не перечисляемая: номер заказа
  без подписи ничего не открывает.

  Бумага — по-русски всегда (см. memory: paper-stays-russian).

  ── Слово магазина ─────────────────────────────────────────────────────────

  При включённом контроле (services/control.ts) публичная страница по QR
  несёт две кнопки: «получил» и «не сходится». Они есть ТОЛЬКО на странице
  по ссылке — в HTML для печати и для телефона сотрудника их нет: слово
  должно быть словом магазина, а не курьера в своём же приложении.
*/

type Db = ReturnType<typeof import("../queries/connection").getDb>;
const PAY: Record<string, string> = { cash: "Наличные", card: "Карта", transfer: "Перевод", debt: "В долг" };

const sig = (orderId: number) => createHmac("sha256", env.appSecret).update(`receipt:${orderId}`).digest("base64url").slice(0, 22);

/** Подписанная метка чека: номер заказа и подпись, которую нельзя подобрать. */
export function receiptToken(orderId: number): string {
  return `${orderId}.${sig(orderId)}`;
}

/** Номер заказа из метки — или null, если подпись не сходится. */
export function parseReceiptToken(token: string): number | null {
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m) return null;
  const id = Number(m[1]);
  const a = Buffer.from(m[2]), b = Buffer.from(sig(id));
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

export const receiptUrl = (orderId: number) => appLink(`/r/${receiptToken(orderId)}`);

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));
// Разряды — обычным пробелом: toLocaleString даёт неразрывный, а лента моноширинного принтера его не знает.
const money = (n: number | string, cur: string) => `${Math.round(Number(n)).toLocaleString("ru-RU").replace(/[\u00a0\u202f]/g, " ")}${cur ? ` ${cur}` : ""}`;
const qty = (n: number | string) => String(Number(n)).replace(".", ",");
const ddmm = (d: Date) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Tashkent", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);

export interface ReceiptData {
  orderId: number; number: string; date: Date; company: string; phone: string | null; inn: string | null;
  shop: string; seller: string | null; van: string | null; method: string; paid: number; total: number; currency: string;
  items: Array<{ name: string; qty: string; price: string; sum: string }>; url: string;
}

/** Данные чека по заказу — в пределах того, что этот человек вправе видеть. */
export async function receiptData(db: Db, tenantId: number, orderId: number, viewer: OrderViewer | null): Promise<ReceiptData | null> {
  const [o] = await db.select({
    id: orders.id, number: orders.orderNumber, status: orders.status, total: orders.total, method: orders.paymentMethod,
    deliveredAt: orders.deliveredAt, createdAt: orders.createdAt, shop: shops.name, seller: users.name, van: warehouses.name,
  }).from(orders)
    .innerJoin(shops, eq(shops.id, orders.shopId))
    .leftJoin(users, eq(users.id, orders.agentId))
    .leftJoin(warehouses, eq(warehouses.id, orders.warehouseId))
    .where(and(eq(orders.id, orderId), eq(orders.tenantId, tenantId), ...(viewer ? viewerScope(viewer) : [])))
    .limit(1);
  if (!o) return null;
  const [cfg] = await db.select({ company: settings.companyName, phone: settings.companyPhone, inn: settings.companyInn, cur: settings.currencySymbol })
    .from(settings).where(eq(settings.tenantId, tenantId)).limit(1);
  const rows = await db.select({ name: products.name, qty: orderItems.quantity, delivered: orderItems.deliveredQuantity, price: orderItems.unitPrice })
    .from(orderItems).innerJoin(products, eq(products.id, orderItems.productId)).where(eq(orderItems.orderId, orderId));
  const pays = await db.select({ amount: payments.amount, method: payments.paymentMethod }).from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.tenantId, tenantId), eq(payments.type, "payment")));
  const cur = cfg?.cur ?? "сум";
  const paid = pays.reduce((s, p) => s + Number(p.amount), 0);
  return {
    orderId: o.id, number: o.number, date: o.deliveredAt ?? o.createdAt, company: cfg?.company ?? "", phone: cfg?.phone ?? null, inn: cfg?.inn ?? null,
    shop: o.shop, seller: o.seller ?? null, van: o.van ?? null, method: PAY[o.method] ?? o.method, paid, total: Number(o.total), currency: cur,
    items: rows.map(r => {
      const q = Number(r.delivered ?? r.qty);
      return { name: r.name, qty: qty(q), price: money(r.price, ""), sum: money(q * Number(r.price), "") };
    }),
    url: receiptUrl(o.id),
  };
}

/** HTML чека: 58 мм лента, моноширинные цифры, QR внизу. Один источник для печати, PDF и страницы по ссылке. */
export async function receiptHtml(d: ReceiptData, extra = ""): Promise<string> {
  const qr = await QRCode.toString(d.url, { type: "svg", margin: 0, width: 132, errorCorrectionLevel: "M" });
  const debt = Math.max(0, d.total - d.paid);
  const lines = d.items.map(i => `<tr><td colspan="3" class="n">${esc(i.name)}</td></tr><tr><td class="q">${esc(i.qty)} × ${esc(i.price)}</td><td></td><td class="s">${esc(i.sum)}</td></tr>`).join("");
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Чек ${esc(d.number)}</title>
<style>
  @page { size: 58mm auto; margin: 3mm; }
  body { margin: 0; background: #fff; color: #111; font-family: "Manrope", "Segoe UI", system-ui, sans-serif; }
  .r { width: 52mm; margin: 0 auto; padding: 4mm 0; font-size: 11px; line-height: 1.35; }
  h1 { font-size: 14px; margin: 0; text-align: center; letter-spacing: .02em; }
  .c { text-align: center; color: #444; font-size: 10px; }
  .m { font-variant-numeric: tabular-nums; font-family: "JetBrains Mono", ui-monospace, monospace; }
  hr { border: 0; border-top: 1px dashed #999; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 0; vertical-align: top; }
  td.n { font-weight: 600; }
  td.q { color: #444; white-space: nowrap; }
  td.s { text-align: right; white-space: nowrap; }
  .t td { font-size: 13px; font-weight: 800; padding-top: 3px; }
  .qr { text-align: center; margin-top: 8px; }
  .qr svg { width: 34mm; height: 34mm; }
  .f { text-align: center; font-size: 9px; color: #555; margin-top: 4px; }
  .w { margin-top: 12px; padding-top: 8px; border-top: 1px dashed #999; font-size: 12px; }
  .w b { display: block; margin-bottom: 6px; }
  .w button { width: 100%; padding: 10px; margin-top: 6px; border: 0; border-radius: 8px; font: inherit; font-weight: 700; cursor: pointer; }
  .w .ok { background: #1f7a4d; color: #fff; }
  .w .no { background: #eee; color: #333; }
  .w textarea { width: 100%; box-sizing: border-box; margin-top: 6px; padding: 8px; border: 1px solid #bbb; border-radius: 8px; font: inherit; font-size: 12px; }
  .w .done { color: #1f7a4d; font-weight: 700; }
  .w .bad { color: #a33; font-weight: 700; }
  .w .err { color: #a33; font-size: 11px; margin-top: 4px; }
  @media print { .w { display: none; } }
  @media screen { body { background: #e8e6e1; } .r { background: #fff; margin: 16px auto; padding: 6mm 3mm; border-radius: 6px; box-shadow: 0 2px 12px rgba(0,0,0,.12); } }
</style></head><body><div class="r">
  <h1>${esc(d.company)}</h1>
  ${d.phone || d.inn ? `<div class="c">${d.inn ? `ИНН ${esc(d.inn)}` : ""}${d.inn && d.phone ? " · " : ""}${esc(d.phone ?? "")}</div>` : ""}
  <hr>
  <table class="m"><tr><td>Чек</td><td class="s"><b>${esc(d.number)}</b></td></tr>
  <tr><td>Дата</td><td class="s">${esc(ddmm(d.date))}</td></tr>
  <tr><td>Покупатель</td><td class="s">${esc(d.shop)}</td></tr>
  ${d.van ? `<tr><td>Машина</td><td class="s">${esc(d.van)}</td></tr>` : ""}
  ${d.seller ? `<tr><td>Выдал</td><td class="s">${esc(d.seller)}</td></tr>` : ""}</table>
  <hr>
  <table class="m">${lines}</table>
  <hr>
  <table class="m t"><tr><td>ИТОГО</td><td class="s">${esc(money(d.total, d.currency))}</td></tr></table>
  <table class="m"><tr><td>${esc(d.method)}</td><td class="s">${esc(money(d.paid, d.currency))}</td></tr>
  ${debt > 0 ? `<tr><td>Остаток в долг</td><td class="s">${esc(money(debt, d.currency))}</td></tr>` : ""}</table>
  <div class="qr">${qr}</div>
  <div class="f">Проверить чек: сканируйте QR — откроется эта же продажа из учёта.</div>
  ${extra}
</div></body></html>`;
}

/** Блок «слово магазина» под чеком: кнопки, пока слова нет; итог — когда есть. */
export function shopWordBlock(token: string, o: { status: string; shopConfirmedAt: Date | null; shopDisputedAt: Date | null; shopDisputeNote: string | null }, error?: string | null): string {
  if (o.shopDisputedAt) return `<div class="w"><div class="bad">Замечание отправлено поставщику ${esc(ddmm(o.shopDisputedAt))}</div><div>«${esc(o.shopDisputeNote ?? "")}»</div></div>`;
  if (o.shopConfirmedAt) return `<div class="w"><div class="done">✓ Получение подтверждено ${esc(ddmm(o.shopConfirmedAt))}</div></div>`;
  if (o.status !== "delivered") return "";
  return `<div class="w"><b>Товар получен по этому чеку?</b>
  <form method="post" action="/r/${esc(token)}/word"><button class="ok" name="action" value="confirm" type="submit">Да, всё верно — получил</button></form>
  <form method="post" action="/r/${esc(token)}/word"><textarea name="note" maxlength="300" rows="2" placeholder="Что не сходится: чего нет, чего лишнее, сумма…"></textarea>
  ${error ? `<div class="err">${esc(error)}</div>` : ""}<button class="no" name="action" value="dispute" type="submit">Не сходится — сообщить поставщику</button></form></div>`;
}

/** Страница по QR: чек по метке или «такого чека нет». */
export async function receiptPage(db: Db, token: string, error?: string | null): Promise<{ status: number; html: string }> {
  const id = parseReceiptToken(token);
  const missing = { status: 404, html: `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Чека нет</title></head><body style="font-family:system-ui;padding:32px;text-align:center;color:#333"><h2>Такого чека в учёте нет</h2><p>Ссылка испорчена или продажа не была записана. Свяжитесь с поставщиком.</p></body></html>` };
  if (!id) return missing;
  const [row] = await db.select({ tenantId: orders.tenantId }).from(orders).where(eq(orders.id, id)).limit(1);
  if (!row) return missing;
  const d = await receiptData(db, row.tenantId, id, null);
  if (!d) return missing;
  const { controlEnabled } = await import("./control");
  let extra = "";
  if (await controlEnabled(db, row.tenantId)) {
    const [o] = await db.select({ status: orders.status, shopConfirmedAt: orders.shopConfirmedAt, shopDisputedAt: orders.shopDisputedAt, shopDisputeNote: orders.shopDisputeNote })
      .from(orders).where(eq(orders.id, id)).limit(1);
    if (o) extra = shopWordBlock(token, o, error);
  }
  return { status: 200, html: await receiptHtml(d, extra) };
}

/** Слово магазина с публичной страницы: по подписанной метке, один раз. Возвращает, куда вернуть человека. */
export async function receiptWord(db: Db, token: string, input: { action: string; note?: string | null }): Promise<{ redirect: string }> {
  const id = parseReceiptToken(token);
  if (!id) return { redirect: `/r/${encodeURIComponent(token)}` };
  const { shopWord } = await import("./control");
  try {
    await shopWord(db, id, { action: input.action === "dispute" ? "dispute" : "confirm", note: input.note ?? null });
    return { redirect: `/r/${token}` };
  } catch (e) {
    return { redirect: `/r/${token}?e=${encodeURIComponent(e instanceof Error ? e.message : "Не получилось")}` };
  }
}
