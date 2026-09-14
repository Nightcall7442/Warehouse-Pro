import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { onecConfig } from "@db/schema";
import { safeFetch } from "./safe-fetch";
import { open } from "./secret-box";
import { resolveNames, type OnecNames, type OnecPreset } from "./onec-presets";

/**
 * Клиент стандартного интерфейса OData 1С:Предприятия 8.3.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Класс назывался «1С Bridge» и разговаривал с прослойкой, которой не
 * существует: /health, POST …/Провести, ответ {id}. К настоящей базе 1С это
 * не подключалось никак, и обмен, проданный в тарифе, не работал ни у кого.
 *
 * ── Что теперь ──────────────────────────────────────────────────────────────
 *
 * Адрес — публикация базы с включённым OData: http://сервер/база/odata/standard.odata.
 * Чтение: GET {Набор}?$format=json&$filter=…&$select=…&$top=…&$skip=… → { value: [...] }.
 * Один объект: GET {Набор}(guid'…'). Создание: POST {Набор} — ответ сам объект
 * с Ref_Key. Проведение: POST {Набор}(guid'…')/Post. Срез последних регистра
 * сведений: {Регистр}/SliceLast(Period=datetime'…', Condition='…').
 * Ошибка 1С приходит как { "odata.error": { message: { value } } } — её текст
 * и показываем человеку, а не «500».
 *
 * Адрес вводит директор арендатора, поэтому все запросы идут через safeFetch:
 * во внутреннюю сеть площадки отсюда не попасть.
 */

export interface OneCBridgeConfig {
  url: string;
  username: string;
  password: string;
  timeout?: number;
  preset?: OnecPreset;
  overrides?: unknown;
}

export class OneCError extends Error {
  readonly status?: number;
  readonly code?: string;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "OneCError";
    this.status = status;
    this.code = code;
  }
}

/** Привести введённый адрес к адресу OData: с публикации базы — дописать /odata/standard.odata. */
export function normalizeOdataUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (!/\/odata\/standard\.odata$/i.test(u)) {
    u = u.replace(/\/odata$/i, "") + "/odata/standard.odata";
  }
  return u;
}

/** guid'…' для $filter и ключей. */
export const guid = (key: string) => `guid'${key}'`;
/** Строка в $filter: одинарные кавычки удваиваются. */
export const str = (s: string) => `'${s.replace(/'/g, "''")}'`;

export type MetadataMap = Record<string, Set<string>>;

export class OneCBridge {
  readonly base: string;
  readonly names: OnecNames;
  private metadataCache: MetadataMap | null = null;
  private readonly config: OneCBridgeConfig;

  constructor(config: OneCBridgeConfig) {
    this.config = config;
    this.base = normalizeOdataUrl(config.url);
    this.names = resolveNames(config.preset ?? "bp_uz", config.overrides);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")}`,
      Accept: "application/json",
      ...extra,
    };
  }

  private timeout(): number { return this.config.timeout ?? 15_000; }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${this.base}/${path}${path.endsWith("$metadata") ? "" : `${sep}$format=json`}`;
    const response = await safeFetch(url, {
      ...init,
      headers: this.headers((init.headers as Record<string, string>) ?? {}),
      signal: init.signal ?? AbortSignal.timeout(this.timeout()),
    });
    if (!response.ok) throw await this.toError(response, path);
    return response;
  }

  private async toError(response: Response, path: string): Promise<OneCError> {
    let text = "";
    try {
      const body = await response.json() as { "odata.error"?: { code?: string; message?: { value?: string } } };
      text = body["odata.error"]?.message?.value ?? "";
      if (text) return new OneCError(`1С: ${text}`, response.status, body["odata.error"]?.code);
    } catch { /* тело не JSON */ }
    const hint = response.status === 401 ? "неверный логин или пароль" :
      response.status === 404 ? `нет такого объекта или OData не включён для него (${path.split("?")[0]})` :
      response.status === 403 ? "у пользователя нет прав" : `HTTP ${response.status}`;
    return new OneCError(`1С: ${hint}`, response.status);
  }

  /** Выборка с параметрами OData ($filter, $select, $top, $skip, $orderby, $expand). */
  async query<T = Record<string, unknown>>(set: string, params: Record<string, string> = {}): Promise<T[]> {
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    const res = await this.request(`${set}${qs ? `?${qs}` : ""}`);
    const data = await res.json() as { value?: T[] };
    return data.value ?? [];
  }

  /** Вся выборка постранично: у 1С нет своего предела, но у нас — есть, чтобы не тянуть базу целиком в память за раз. */
  async queryAll<T = Record<string, unknown>>(set: string, params: Record<string, string> = {}, pageSize = 500, maxPages = 400): Promise<T[]> {
    const out: T[] = [];
    for (let page = 0; page < maxPages; page++) {
      const rows = await this.query<T>(set, { ...params, $top: String(pageSize), $skip: String(page * pageSize) });
      out.push(...rows);
      if (rows.length < pageSize) break;
    }
    return out;
  }

  async getOne<T = Record<string, unknown>>(set: string, key: string, select?: string): Promise<T | null> {
    try {
      const res = await this.request(`${set}(${guid(key)})${select ? `?$select=${encodeURIComponent(select)}` : ""}`);
      return await res.json() as T;
    } catch (e) {
      if (e instanceof OneCError && e.status === 404) return null;
      throw e;
    }
  }

  /** Срез последних регистра сведений по условию (например, цены выбранного типа). */
  async sliceLast<T = Record<string, unknown>>(register: string, condition: string, params: Record<string, string> = {}): Promise<T[]> {
    const period = new Date().toISOString().slice(0, 19);
    const cond = condition.replace(/'/g, "''");
    const path = `${register}/SliceLast(Period=datetime'${period}', Condition='${cond}')`;
    const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    const res = await this.request(`${path}${qs ? `?${qs}` : ""}`);
    const data = await res.json() as { value?: T[] };
    return data.value ?? [];
  }

  /** Создать объект; 1С возвращает его целиком, нам нужен Ref_Key. */
  async create<T extends { Ref_Key?: string } = { Ref_Key: string }>(set: string, body: Record<string, unknown>): Promise<T> {
    const res = await this.request(set, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json() as T;
  }

  async patch(set: string, key: string, body: Record<string, unknown>): Promise<void> {
    await this.request(`${set}(${guid(key)})`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** Провести документ. Оперативное проведение выключено: документы прошлых дней иначе отказывают. */
  async post(set: string, key: string): Promise<void> {
    await this.request(`${set}(${guid(key)})/Post?PostingModeOperational=false`, { method: "POST" });
  }

  /**
   * Структура базы: наборы и их поля из $metadata (EDMX). Разбор нарочно
   * простой — регулярками по EntityType/Property/EntitySet: нам нужны только
   * имена, чтобы сверить пресет с тем, что в этой базе есть на самом деле.
   */
  async metadata(): Promise<MetadataMap> {
    if (this.metadataCache) return this.metadataCache;
    const res = await this.request("$metadata", { headers: { Accept: "application/xml" } });
    const xml = await res.text();
    const types: Record<string, Set<string>> = {};
    for (const m of xml.matchAll(/<EntityType\s+Name="([^"]+)"[^>]*>([\s\S]*?)<\/EntityType>/g)) {
      const props = new Set<string>();
      for (const p of m[2].matchAll(/<(?:Property|NavigationProperty)\s+Name="([^"]+)"/g)) props.add(p[1]);
      types[m[1]] = props;
    }
    const sets: MetadataMap = {};
    for (const m of xml.matchAll(/<EntitySet\s+Name="([^"]+)"\s+EntityType="([^"]+)"/g)) {
      const typeName = m[2].split(".").pop() ?? m[2];
      sets[m[1]] = types[typeName] ?? new Set();
    }
    this.metadataCache = sets;
    return sets;
  }

  /** Связь есть, логин подходит, OData отвечает: читаем один объект самого простого набора. */
  async healthCheck(): Promise<{ ok: true; sets: number } | { ok: false; error: string }> {
    try {
      const sets = await this.metadata();
      return { ok: true, sets: Object.keys(sets).length };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

// ── Клиент по организации ──────────────────────────────────────────────────
const bridgeCache = new Map<number, OneCBridge>();

export async function getBridgeForTenant(tenantId: number): Promise<OneCBridge> {
  const cached = bridgeCache.get(tenantId);
  if (cached) return cached;
  const db = getDb();
  const [config] = await db.select().from(onecConfig).where(eq(onecConfig.tenantId, tenantId)).limit(1);
  if (!config) throw new OneCError("1С не подключена: заполните подключение в настройках");
  const bridge = new OneCBridge({
    url: config.url,
    username: config.username,
    password: open(config.password),
    preset: (config.preset ?? "bp_uz") as OnecPreset,
    overrides: config.nameOverrides ?? undefined,
  });
  bridgeCache.set(tenantId, bridge);
  return bridge;
}

export function clearBridgeCache(): void {
  bridgeCache.clear();
}
