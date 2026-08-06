import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { onecConfig } from "@db/schema";
import { safeFetch } from "./safe-fetch";

export interface OneCBridgeConfig {
  url: string;
  username: string;
  password: string;
  timeout?: number;
}

export class OneCBridge {
  private config: OneCBridgeConfig;
  private baseUrl: string;

  constructor(config: OneCBridgeConfig) {
    this.config = config;
    this.baseUrl = config.url;
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")}`,
    };
  }

  private timeout(): number {
    return this.config.timeout ?? 10000;
  }

  async odataQuery<T>(entitySet: string, params?: Record<string, string>): Promise<T[]> {
    const url = new URL(`/odata/${entitySet}`, this.baseUrl);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    url.searchParams.set("$format", "json");

    // safeFetch, not fetch: baseUrl is typed in by a tenant's director, so
    // every call out of here could otherwise be aimed at the private network
    // this server sits in. See lib/safe-fetch.ts.
    const response = await safeFetch(url.toString(), {
      headers: {
        ...this.authHeaders(),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(this.timeout()),
    });

    if (!response.ok) {
      throw new Error(`1C Bridge error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { value?: T[] };
    return data.value ?? [];
  }

  async createDocument(entitySet: string, document: unknown): Promise<{ id: string }> {
    const response = await safeFetch(`${this.baseUrl}/odata/${entitySet}?$format=json`, {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(document),
      signal: AbortSignal.timeout(this.timeout()),
    });

    if (!response.ok) {
      throw new Error(`1C Bridge create error: ${response.status}`);
    }

    return response.json() as Promise<{ id: string }>;
  }

  async postDocument(entitySet: string, id: string): Promise<void> {
    const response = await safeFetch(`${this.baseUrl}/odata/${entitySet}('${id}')/Провести`, {
      method: "POST",
      headers: this.authHeaders(),
      signal: AbortSignal.timeout(this.timeout()),
    });

    if (!response.ok) {
      throw new Error(`1C Bridge post error: ${response.status}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await safeFetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return true;
    } catch {
      // A blocked address lands here too, and returning false is the right
      // answer for it: "мы туда не пойдём" and "хост не ответил" are the same
      // thing as far as the caller's connection test is concerned.
      return false;
    }
  }
}

// ── Bridge cache (per-tenant) ─────────────────────────────────────────────────
const bridgeCache = new Map<number, { bridge: OneCBridge; config: OneCBridgeConfig }>();

/**
 * Get a 1C Bridge instance configured for a specific tenant.
 * Falls back to global env-based config if no per-tenant config is saved.
 */
export async function getBridgeForTenant(tenantId: number): Promise<OneCBridge> {
  const cached = bridgeCache.get(tenantId);
  if (cached) return cached.bridge;

  const db = getDb();
  const [config] = await db.select()
    .from(onecConfig)
    .where(eq(onecConfig.tenantId, tenantId))
    .limit(1);

  if (config) {
    const cfg: OneCBridgeConfig = {
      url: config.url,
      username: config.username,
      password: config.password,
      timeout: 10000,
    };
    const bridge = new OneCBridge(cfg);
    bridgeCache.set(tenantId, { bridge, config: cfg });
    return bridge;
  }

  // Fallback to global env config
  return getBridge();
}

let bridgeInstance: OneCBridge | null = null;

/**
 * Global fallback bridge — configured from environment variables.
 * Used only when no per-tenant config is saved, or for global operations.
 */
export function getBridge(): OneCBridge {
  if (!bridgeInstance) {
    const { ONEC_BRIDGE_URL, ONEC_USERNAME, ONEC_PASSWORD } = process.env;
    if (!ONEC_BRIDGE_URL) {
      throw new Error("ONEC_BRIDGE_URL not configured");
    }
    bridgeInstance = new OneCBridge({
      url: ONEC_BRIDGE_URL,
      username: ONEC_USERNAME ?? "",
      password: ONEC_PASSWORD ?? "",
    });
  }
  return bridgeInstance;
}

export function clearBridgeCache(): void {
  bridgeCache.clear();
}
