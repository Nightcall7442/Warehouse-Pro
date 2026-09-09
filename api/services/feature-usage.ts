import { and, eq, gte, isNotNull, sql } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  agentLocations, apiKeys, onecConfig, products, salesTargets,
  supportMessages, syncStatus, tenantBranding, tenants,
} from "@db/schema";
import { planHas, SERVICE_FEATURES, type FeatureKey, type PlanKey } from "../../contracts/constants";

/* ═══════════════════════════════════════════════════════════════════════════
   Кто чем пользуется — до того, как включать проверку тарифов.

   ── Зачем ──────────────────────────────────────────────────────────────────

   Тарифы обещают GPS, обмен с 1С, полную аналитику и брендирование как платные
   возможности, а код их не проверяет: разграничены только чат поддержки и API.
   Обещание, за которое берут деньги, должно быть подкреплено — но включать
   проверку вслепую на работающем продукте нельзя.

   Тринадцать организаций уже работают, и часть из них может пользоваться тем,
   чего их тариф не даёт. Для них включение проверки — не «восстановление
   справедливости», а отнятая посреди рабочего дня функция. Сначала надо
   увидеть, кто именно и чем, и только потом решать: поднять тариф, оставить
   как есть или закрыть.

   ── Чем меряется «пользуется» ──────────────────────────────────────────────

   Следом в данных, а не журналом обращений: журнала чтений у нас нет.

   След прямой там, где функция что-то ЗАПИСЫВАЕТ: точки GPS, настройки обмена
   с 1С, оформление под бренд, ключи API, сообщения в чат. Такому следу можно
   верить: он появился только потому, что функцией пользовались.

   С аналитикой сложнее: читать отчёт — значит не оставлять следа. Здесь честно
   стоит «следа нет», а рядом — косвенные признаки: заполнена ли себестоимость
   (без неё P&L пуст) и заведены ли планы продаж (без них KPI не с чем
   сравнивать). Косвенный признак назван косвенным, чтобы его не считали
   доказательством.
   ═══════════════════════════════════════════════════════════════════════════ */

/** За какой срок считаем функцию «в ходу». */
const RECENT_DAYS = 30;

export interface FeatureTrace {
  feature: FeatureKey;
  /** Есть ли прямой след: функция что-то записала. */
  used: boolean;
  /** Косвенный признак — намерение пользоваться, но не доказательство. */
  indirect: boolean;
  /** Что именно нашли: «412 точек за 30 дней», «ключей: 2». */
  evidence: string;
  /** Даёт ли эту возможность нынешний тариф. */
  allowed: boolean;
}

export interface TenantFeatureUsage {
  tenantId: number;
  tenantName: string;
  plan: PlanKey;
  traces: FeatureTrace[];
  /** Возможности в ходу, которых тариф не даёт. Ради них всё и затевалось. */
  overreach: FeatureKey[];
}

/** Сгруппированный счётчик: tenantId → число. */
type Counts = Map<number, number>;

function toCounts(rows: Array<{ tenantId: number | null; n: unknown }>): Counts {
  const m: Counts = new Map();
  for (const r of rows) {
    if (r.tenantId === null) continue;
    m.set(Number(r.tenantId), Number(r.n ?? 0));
  }
  return m;
}

/**
 * Собрать отчёт по всем организациям.
 *
 * Запросов ровно столько, сколько признаков, — и каждый сразу с группировкой по
 * организации. Обход «по тенанту в цикле» дал бы тринадцать раз по семь
 * запросов, и это при том, что список организаций растёт.
 */
export async function collectFeatureUsage(): Promise<TenantFeatureUsage[]> {
  const db = getDb();
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);

  const rows = await db.select({
    id: tenants.id,
    name: tenants.name,
    plan: tenants.plan,
  }).from(tenants).orderBy(tenants.name);

  // ── GPS: точки за последний месяц ────────────────────────────────────────
  const gps = toCounts(await db.select({
    tenantId: agentLocations.tenantId,
    n: sql<number>`count(*)`,
  }).from(agentLocations)
    .where(gte(agentLocations.recordedAt, since))
    .groupBy(agentLocations.tenantId));

  // ── 1С: настроен обмен ───────────────────────────────────────────────────
  const onec = toCounts(await db.select({
    tenantId: onecConfig.tenantId,
    n: sql<number>`count(*)`,
  }).from(onecConfig)
    .where(sql`${onecConfig.url} IS NOT NULL AND TRIM(${onecConfig.url}) <> ''`)
    .groupBy(onecConfig.tenantId));

  // ── 1С: обмен реально ходил ──────────────────────────────────────────────
  const onecSynced = toCounts(await db.select({
    tenantId: syncStatus.tenantId,
    n: sql<number>`count(*)`,
  }).from(syncStatus)
    .where(isNotNull(syncStatus.lastSuccessfulSync))
    .groupBy(syncStatus.tenantId));

  // ── Брендирование: заполнено хоть что-то ─────────────────────────────────
  const branding = toCounts(await db.select({
    tenantId: tenantBranding.tenantId,
    n: sql<number>`count(*)`,
  }).from(tenantBranding)
    .where(sql`
      (${tenantBranding.logoUrl}    IS NOT NULL AND TRIM(${tenantBranding.logoUrl})    <> '') OR
      (${tenantBranding.appName}    IS NOT NULL AND TRIM(${tenantBranding.appName})    <> '') OR
      (${tenantBranding.customDomain} IS NOT NULL AND TRIM(${tenantBranding.customDomain}) <> '') OR
      (${tenantBranding.faviconUrl} IS NOT NULL AND TRIM(${tenantBranding.faviconUrl}) <> '')
    `)
    .groupBy(tenantBranding.tenantId));

  // ── API: действующие ключи ───────────────────────────────────────────────
  const keys = toCounts(await db.select({
    tenantId: apiKeys.tenantId,
    n: sql<number>`count(*)`,
  }).from(apiKeys)
    .where(eq(apiKeys.status, "active"))
    .groupBy(apiKeys.tenantId));

  // ── API: ключом действительно пользовались ───────────────────────────────
  const keysUsed = toCounts(await db.select({
    tenantId: apiKeys.tenantId,
    n: sql<number>`count(*)`,
  }).from(apiKeys)
    .where(and(eq(apiKeys.status, "active"), isNotNull(apiKeys.lastUsedAt)))
    .groupBy(apiKeys.tenantId));

  // ── Чат поддержки: писали ────────────────────────────────────────────────
  const chat = toCounts(await db.select({
    tenantId: supportMessages.tenantId,
    n: sql<number>`count(*)`,
  }).from(supportMessages).groupBy(supportMessages.tenantId));

  /*
    ── Аналитика: следа нет ─────────────────────────────────────────────────

    Чтение отчёта ничего не записывает. Косвенно: заполненная себестоимость —
    единственное, ради чего её заполняют, это прибыль; заведённые планы продаж
    — то же для KPI.
  */
  const costs = toCounts(await db.select({
    tenantId: products.tenantId,
    n: sql<number>`count(*)`,
  }).from(products)
    .where(sql`CAST(${products.costPrice} AS DECIMAL(15,2)) > 0`)
    .groupBy(products.tenantId));

  const targets = toCounts(await db.select({
    tenantId: salesTargets.tenantId,
    n: sql<number>`count(*)`,
  }).from(salesTargets).groupBy(salesTargets.tenantId));

  return rows.map(t => {
    const id = Number(t.id);
    const plan = String(t.plan) as PlanKey;

    const gpsPoints = gps.get(id) ?? 0;
    const onecSet = (onec.get(id) ?? 0) > 0;
    const onecRan = (onecSynced.get(id) ?? 0) > 0;
    const brandSet = (branding.get(id) ?? 0) > 0;
    const keyCount = keys.get(id) ?? 0;
    const keyUsed = (keysUsed.get(id) ?? 0) > 0;
    const chatCount = chat.get(id) ?? 0;
    const costCount = costs.get(id) ?? 0;
    const targetCount = targets.get(id) ?? 0;

    const traces: FeatureTrace[] = [
      {
        feature: "gps",
        used: gpsPoints > 0,
        indirect: false,
        evidence: gpsPoints > 0 ? `${gpsPoints} точек за ${RECENT_DAYS} дней` : "точек нет",
        allowed: planHas(plan, "gps"),
      },
      {
        feature: "onec",
        used: onecSet || onecRan,
        indirect: false,
        evidence: onecRan ? "обмен настроен и ходил"
          : onecSet ? "обмен настроен, успешных синхронизаций нет"
          : "не настроен",
        allowed: planHas(plan, "onec"),
      },
      {
        feature: "analytics",
        // Прямого следа быть не может: чтение отчёта ничего не пишет.
        used: false,
        indirect: costCount > 0 || targetCount > 0,
        evidence: costCount > 0 || targetCount > 0
          ? `косвенно: себестоимость у ${costCount} товаров, планов продаж ${targetCount}`
          : "следа нет: ни себестоимости, ни планов",
        allowed: planHas(plan, "analytics"),
      },
      {
        feature: "whiteLabel",
        used: brandSet,
        indirect: false,
        evidence: brandSet ? "оформление заполнено" : "оформление по умолчанию",
        allowed: planHas(plan, "whiteLabel"),
      },
      {
        feature: "api",
        used: keyCount > 0,
        indirect: false,
        evidence: keyCount === 0 ? "ключей нет"
          : keyUsed ? `ключей: ${keyCount}, ими пользовались`
          : `ключей: ${keyCount}, ни одним не пользовались`,
        allowed: planHas(plan, "api"),
      },
      {
        feature: "supportChat",
        used: chatCount > 0,
        indirect: false,
        evidence: chatCount > 0 ? `сообщений: ${chatCount}` : "не писали",
        allowed: planHas(plan, "supportChat"),
      },
    ];

    /*
      В перебор идёт только ПРЯМОЙ след.

      Косвенный признак означает «похоже, собирались», а не «пользуются»: по
      нему нельзя ни поднимать тариф, ни отнимать функцию. Услуги здесь не
      участвуют вовсе — их не включает и не отнимает код.
    */
    const overreach = traces
      .filter(x => x.used && !x.allowed && !SERVICE_FEATURES.includes(x.feature))
      .map(x => x.feature);

    return { tenantId: id, tenantName: String(t.name), plan, traces, overreach };
  });
}
