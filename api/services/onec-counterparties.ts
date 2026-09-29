import { and, eq } from "drizzle-orm";
import { shops } from "@db/schema";
import { getDb } from "../queries/connection";
import { getBridgeForTenant, str } from "../lib/onec-bridge";
import { OneCMapper } from "./onec-mapper";
import { updateSyncStatus } from "./onec-status";
import { logger } from "../lib/logger";
import { isCompanyInn } from "@contracts/tax-requisites";

/*
  Магазины ↔ контрагенты 1С.

  ── Что было ────────────────────────────────────────────────────────────────

  Выгрузка заказа требовала связь магазина с контрагентом (id_mappings, тип
  "shop") — и ничто её не создавало. Каждая реализация падала с «Shop not
  mapped to 1C», то есть в 1С не ушёл бы ни один заказ, даже будь 1С
  подключена.

  ── Что теперь ──────────────────────────────────────────────────────────────

  1. syncCounterparties: контрагенты читаются из 1С целиком (без помеченных
     на удаление) и сопоставляются с магазинами автоматически — по точному
     названию, затем по телефону, если поле телефона есть в базе.
  2. Что не сопоставилось — экран «Магазины ↔ Контрагенты»: поиск в 1С по
     строке и выбор руками, либо «Создать в 1С» — контрагент заводится по
     карточке магазина и связывается сразу.
  Связь хранится в id_mappings ("shop" → Ref_Key контрагента).

  ── ИНН (29.09.2026) ────────────────────────────────────────────────────────

  У магазина появился ИНН, и он теперь первый ключ: точка с ИНН находит
  контрагента с тем же ИНН, даже если в 1С он записан другим названием. Не
  нашёлся — как раньше, по названию и телефону, но контрагент с ДРУГИМ ИНН
  не подходит: одинаковая вывеска у двух юрлиц — обычное дело, и связать
  точку с чужим юрлицом значит выписать ЭСФ не тому.
  «Создать в 1С» передаёт ИНН в поле контрагента и сначала ищет, нет ли
  уже контрагента с этим ИНН, — чтобы не завести дубль.
  В поле ИНН идёт только ИНН юрлица (9 цифр). ПИНФЛ (14 цифр) и признак
  плательщика НДС не передаются: подходящих полей контрагента ни пресет, ни
  эмулятор OData не подтверждают (см. docs/onec.md).
*/

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/["«»'’`]/g, "").replace(/\s+/g, " ").trim();
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-9);
const innOf = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

type Counterparty = { key: string; name: string; inn: string | null; phone: string | null };

async function loadCounterparties(tenantId: number): Promise<Counterparty[]> {
  const bridge = await getBridgeForTenant(tenantId);
  const n = bridge.names.counterparties;
  const select = ["Ref_Key", n.name, n.inn, n.deletion, n.phone].filter(Boolean).join(",");
  const rows = await bridge.queryAll<Record<string, unknown>>(n.set, { $select: select, $filter: `${n.deletion} eq false` });
  return rows.map(r => ({
    key: String(r.Ref_Key),
    name: String(r[n.name] ?? ""),
    inn: r[n.inn] ? String(r[n.inn]) : null,
    phone: n.phone && r[n.phone] ? String(r[n.phone]) : null,
  })).filter(c => c.name);
}

export async function syncCounterparties(tenantId: number): Promise<{ total: number; matched: number; alreadyMapped: number; unmatched: number }> {
  const db = getDb();
  await updateSyncStatus(tenantId, "shop", "from1c", "processing");
  try {
    const list = await loadCounterparties(tenantId);
    const byName = new Map<string, Counterparty>();
    const byPhone = new Map<string, Counterparty>();
    const byInn = new Map<string, Counterparty>();
    for (const c of list) {
      const inn = innOf(c.inn);
      if (inn && !byInn.has(inn)) byInn.set(inn, c);
      const k = norm(c.name);
      if (k && !byName.has(k)) byName.set(k, c);
      const p = digits(c.phone);
      if (p.length >= 7 && !byPhone.has(p)) byPhone.set(p, c);
    }
    const existing = await OneCMapper.getAll(db, tenantId, "shop");
    const mappedShops = new Set(existing.map(m => m.internalId));
    const takenKeys = new Set(existing.map(m => m.externalId));
    const rows = await db.select({ id: shops.id, name: shops.name, phone: shops.phone, taxId: shops.taxId })
      .from(shops).where(and(eq(shops.tenantId, tenantId), eq(shops.status, "active")));
    let matched = 0, unmatched = 0;
    for (const s of rows) {
      if (mappedShops.has(s.id)) continue;
      const inn = isCompanyInn(s.taxId) ? s.taxId : null;
      // Контрагент с другим ИНН — другое юрлицо, даже под той же вывеской.
      const sameEntity = (c: Counterparty | undefined) => c && (!inn || !innOf(c.inn) || innOf(c.inn) === inn) ? c : undefined;
      const cand = (inn ? byInn.get(inn) : undefined)
        ?? sameEntity(byName.get(norm(s.name)))
        ?? (digits(s.phone).length >= 7 ? sameEntity(byPhone.get(digits(s.phone))) : undefined);
      if (cand && !takenKeys.has(cand.key)) {
        await OneCMapper.upsert(db, tenantId, "shop", cand.key, s.id);
        takenKeys.add(cand.key);
        matched++;
      } else {
        unmatched++;
      }
    }
    await updateSyncStatus(tenantId, "shop", "from1c", "completed", matched);
    logger.info("1C counterparties synced", { tenantId, total: list.length, matched, unmatched });
    return { total: list.length, matched, alreadyMapped: mappedShops.size, unmatched };
  } catch (e) {
    await updateSyncStatus(tenantId, "shop", "from1c", "failed", 0, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** Магазины без связи — для экрана сопоставления, с готовыми кандидатами по названию. */
export async function unmappedShops(tenantId: number) {
  const db = getDb();
  const existing = await OneCMapper.getAll(db, tenantId, "shop");
  const mapped = new Set(existing.map(m => m.internalId));
  const rows = await db.select({ id: shops.id, name: shops.name, phone: shops.phone, address: shops.address })
    .from(shops).where(and(eq(shops.tenantId, tenantId), eq(shops.status, "active"))).orderBy(shops.name);
  return { unmapped: rows.filter(r => !mapped.has(r.id)), mappedCount: mapped.size, total: rows.length };
}

/** Поиск контрагентов в 1С по подстроке названия — подстановка в $filter экранируется. */
export async function matchCandidates(tenantId: number, q: string): Promise<Counterparty[]> {
  const bridge = await getBridgeForTenant(tenantId);
  const n = bridge.names.counterparties;
  const select = ["Ref_Key", n.name, n.inn, n.phone].filter(Boolean).join(",");
  const rows = await bridge.query<Record<string, unknown>>(n.set, {
    $select: select, $top: "20",
    $filter: `substringof(${str(q)}, ${n.name}) and ${n.deletion} eq false`,
  });
  return rows.map(r => ({ key: String(r.Ref_Key), name: String(r[n.name] ?? ""), inn: r[n.inn] ? String(r[n.inn]) : null, phone: n.phone && r[n.phone] ? String(r[n.phone]) : null }));
}

export async function mapShop(tenantId: number, shopId: number, externalId: string): Promise<{ success: true }> {
  const db = getDb();
  const [shop] = await db.select({ id: shops.id }).from(shops).where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId))).limit(1);
  if (!shop) throw new Error("Магазин не найден");
  await OneCMapper.upsert(db, tenantId, "shop", externalId, shopId);
  return { success: true };
}

/** Контрагент в 1С по карточке магазина: название, ИНН юрлица и, если есть куда, телефон. */
export async function createCounterpartyFor(tenantId: number, shopId: number): Promise<{ externalId: string }> {
  const db = getDb();
  const [shop] = await db.select({ id: shops.id, name: shops.name, phone: shops.phone, taxId: shops.taxId })
    .from(shops).where(and(eq(shops.id, shopId), eq(shops.tenantId, tenantId))).limit(1);
  if (!shop) throw new Error("Магазин не найден");
  const already = await OneCMapper.getExternalId(db, tenantId, "shop", shopId);
  if (already) return { externalId: already };
  const bridge = await getBridgeForTenant(tenantId);
  const n = bridge.names.counterparties;
  const inn = isCompanyInn(shop.taxId) ? shop.taxId : null;
  if (inn) {
    // Контрагент с этим ИНН уже есть в 1С — связываем с ним, а не заводим дубль.
    // Занятый другой точкой не берём: одна связь на контрагента, как при сверке.
    const [same] = await bridge.query<Record<string, unknown>>(n.set, {
      $select: "Ref_Key", $top: "1", $filter: `${n.inn} eq ${str(inn)} and ${n.deletion} eq false`,
    });
    const key = same ? String(same.Ref_Key) : null;
    if (key && !(await OneCMapper.getInternalId(db, tenantId, "shop", key))) {
      await OneCMapper.upsert(db, tenantId, "shop", key, shopId);
      logger.info("1C counterparty matched by INN", { tenantId, shopId, key });
      return { externalId: key };
    }
  }
  const body: Record<string, unknown> = { [n.name]: shop.name };
  if (inn) body[n.inn] = inn;
  if (n.phone && shop.phone) body[n.phone] = shop.phone;
  const created = await bridge.create<{ Ref_Key: string }>(n.set, body);
  await OneCMapper.upsert(db, tenantId, "shop", created.Ref_Key, shopId);
  logger.info("1C counterparty created", { tenantId, shopId, key: created.Ref_Key });
  return { externalId: created.Ref_Key };
}
