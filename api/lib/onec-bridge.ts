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

    const response = await fetch(url.toString(), {
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
    const response = await fetch(`${this.baseUrl}/odata/${entitySet}?$format=json`, {
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
    const response = await fetch(`${this.baseUrl}/odata/${entitySet}('${id}')/Провести`, {
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
      await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return true;
    } catch {
      return false;
    }
  }
}

let bridgeInstance: OneCBridge | null = null;

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
