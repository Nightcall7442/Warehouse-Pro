import { randomUUID } from "node:crypto";
import { resolveNames, type OnecPreset } from "../../lib/onec-presets";

/**
 * Эмулятор стандартного OData 1С для тестов.
 *
 * Отвечает так, как отвечает платформа 8.3: $metadata в EDMX, выборки
 * `{ value: [...] }`, объект по `(guid'…')`, POST создаёт и возвращает объект
 * с Ref_Key, `/Post` проводит, `SliceLast` режет регистр. Ошибки — в форме
 * `{ "odata.error": { message: { value } } }`. Понимает $filter из `eq`,
 * `and`, `substringof`, значения guid'…', '…', true/false и числа; $select,
 * $top, $skip.
 *
 * Наборы заводятся по именам пресета, поэтому тесты ходят через НАСТОЯЩИЙ
 * клиент и настоящие имена: сломается имя в пресете — сломается и тест.
 * Живой базы 1С у нас нет; эмулятор — договор о том, как она отвечает.
 */
type Row = Record<string, unknown>;

export class FakeOneC {
  readonly base: string;
  readonly sets = new Map<string, { fields: Set<string>; rows: Row[] }>();
  readonly requests: Array<{ method: string; path: string; body: unknown }> = [];
  readonly posted: string[] = [];
  auth = { username: "odata", password: "secret" };
  /** Подменить ответ: вернуть Response — он уйдёт как есть. */
  intercept: ((method: string, path: string) => Response | null) | null = null;

  constructor(base = "http://onec.example.test/base", preset: OnecPreset = "bp_uz") {
    this.base = base.replace(/\/+$/, "") + "/odata/standard.odata";
    const n = resolveNames(preset, undefined);
    const std = ["Ref_Key", "DataVersion", "DeletionMark", "Code", "Description", "IsFolder", "Parent_Key"];
    this.define(n.nomenclature.set, [...std, n.nomenclature.code, n.nomenclature.unitRef]);
    this.define(n.units.set, std);
    this.define(n.prices.set, ["Period", n.prices.item, n.prices.type, n.prices.price, "Recorder"]);
    this.define(n.priceTypes.set, std);
    this.define(n.counterparties.set, [...std, n.counterparties.inn, "Телефон"]);
    this.define(n.organizations.set, std);
    this.define(n.warehouses.set, std);
    if (n.contracts) this.define(n.contracts.set, [...std, n.contracts.owner, n.contracts.organization, n.contracts.kind ?? "ВидДоговора"]);
    const s = n.sale;
    this.define(s.set, ["Ref_Key", "DataVersion", "DeletionMark", "Number", "Posted", s.fields.date, s.fields.organization, s.fields.counterparty, s.fields.warehouse, s.fields.contract, s.fields.comment, s.fields.operation, s.items].filter((x): x is string => Boolean(x)));
    if (n.cashIn) {
      const c = n.cashIn;
      this.define(c.set, ["Ref_Key", "DataVersion", "DeletionMark", "Number", "Posted", c.fields.date, c.fields.organization, c.fields.counterparty, c.fields.sum, c.fields.comment, c.fields.operation, c.fields.contract].filter((x): x is string => Boolean(x)));
    }
    if (n.bankIn) {
      const b = n.bankIn;
      this.define(b.set, ["Ref_Key", "DataVersion", "DeletionMark", "Number", "Posted", b.fields.date, b.fields.counterparty, b.fields.sum, b.fields.operation].filter((x): x is string => Boolean(x)));
    }
  }

  define(set: string, fields: string[]): void {
    this.sets.set(set, { fields: new Set(fields), rows: [] });
  }

  /** Убрать поле из набора — «в этой базе оно называется иначе». */
  dropField(set: string, field: string): void {
    this.sets.get(set)?.fields.delete(field);
  }

  add(set: string, row: Row): Row {
    const s = this.sets.get(set);
    if (!s) throw new Error(`FakeOneC: набора ${set} нет`);
    const full: Row = { Ref_Key: randomUUID(), DeletionMark: false, IsFolder: false, ...row };
    s.rows.push(full);
    return full;
  }

  rows(set: string): Row[] {
    return this.sets.get(set)?.rows ?? [];
  }

  private error(status: number, message: string): Response {
    return new Response(JSON.stringify({ "odata.error": { code: String(status), message: { lang: "ru", value: message } } }), {
      status, headers: { "Content-Type": "application/json" },
    });
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  private metadata(): string {
    const types: string[] = [];
    const entitySets: string[] = [];
    for (const [name, s] of this.sets) {
      const props = [...s.fields].map(f => `<Property Name="${f}" Type="Edm.String"/>`).join("");
      types.push(`<EntityType Name="${name}"><Key><PropertyRef Name="Ref_Key"/></Key>${props}</EntityType>`);
      entitySets.push(`<EntitySet Name="${name}" EntityType="StandardODATA.${name}"/>`);
    }
    return `<?xml version="1.0" encoding="utf-8"?><edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" Version="1.0"><edmx:DataServices><Schema Namespace="StandardODATA">${types.join("")}<EntityContainer Name="StandardODATA">${entitySets.join("")}</EntityContainer></Schema></edmx:DataServices></edmx:Edmx>`;
  }

  /** Разбор $filter: `A eq v and B eq w and substringof('x', C)`. */
  private matcher(filter: string | null): (row: Row) => boolean {
    if (!filter) return () => true;
    const parts = filter.split(/\s+and\s+/);
    const preds = parts.map(p => {
      const sub = p.match(/^substringof\('((?:[^']|'')*)',\s*([\p{L}\p{N}_]+)\)$/u);
      if (sub) {
        const needle = sub[1].replace(/''/g, "'").toLowerCase();
        return (r: Row) => String(r[sub[2]] ?? "").toLowerCase().includes(needle);
      }
      const m = p.match(/^([\p{L}\p{N}_]+)\s+(eq|ge|le|gt|lt)\s+(.+)$/u);
      if (!m) throw new Error(`FakeOneC: не понимаю условие «${p}»`);
      const field = m[1], op = m[2];
      const raw = m[3].trim();
      let value: unknown;
      if (/^guid'/.test(raw)) value = raw.slice(5, -1);
      else if (/^datetime'/.test(raw)) value = raw.slice(9, -1);
      else if (/^'/.test(raw)) value = raw.slice(1, -1).replace(/''/g, "'");
      else if (raw === "true" || raw === "false") value = raw === "true";
      else value = Number(raw);
      if (op !== "eq") {
        // Даты — строки ISO, сравниваются как строки; числа — как числа.
        const cmp = (a: unknown) => typeof value === "number" ? Number(a) - value : String(a ?? "").localeCompare(String(value));
        return (r: Row) => ({ ge: cmp(r[field]) >= 0, le: cmp(r[field]) <= 0, gt: cmp(r[field]) > 0, lt: cmp(r[field]) < 0 })[op as "ge" | "le" | "gt" | "lt"];
      }
      return (r: Row) => r[field] === value || (typeof value === "boolean" && Boolean(r[field]) === value);
    });
    return (row) => preds.every(p => p(row));
  }

  private project(rows: Row[], select: string | null): Row[] {
    if (!select) return rows;
    const cols = select.split(",").map(s => s.trim());
    return rows.map(r => Object.fromEntries(cols.map(c => [c, r[c]])));
  }

  /** То, что подставляется вместо safeFetch. */
  fetch = async (rawUrl: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? "GET").toUpperCase();
    if (!rawUrl.startsWith(this.base)) return this.error(404, `нет такой публикации: ${rawUrl}`);
    const url = new URL(rawUrl);
    const path = decodeURIComponent(url.pathname.slice(new URL(this.base).pathname.length + 1));
    const body = init.body ? JSON.parse(String(init.body)) : null;
    this.requests.push({ method, path, body });

    const auth = (init.headers as Record<string, string>)?.Authorization ?? "";
    const expected = `Basic ${Buffer.from(`${this.auth.username}:${this.auth.password}`).toString("base64")}`;
    if (auth !== expected) return new Response("", { status: 401 });

    const forced = this.intercept?.(method, path);
    if (forced) return forced;

    if (path === "$metadata") return new Response(this.metadata(), { status: 200, headers: { "Content-Type": "application/xml" } });

    const slice = path.match(/^([\p{L}\p{N}_]+)\/SliceLast\(Period=datetime'[^']*',\s*Condition='((?:[^']|'')*)'\)$/u);
    if (slice) {
      const s = this.sets.get(slice[1]);
      if (!s) return this.error(404, `Нет набора ${slice[1]}`);
      const cond = slice[2].replace(/''/g, "'");
      return this.json({ value: this.project(s.rows.filter(this.matcher(cond)), url.searchParams.get("$select")) });
    }

    const post = path.match(/^([\p{L}\p{N}_]+)\(guid'([^']+)'\)\/Post$/u);
    if (post) {
      const s = this.sets.get(post[1]);
      const row = s?.rows.find(r => r.Ref_Key === post[2]);
      if (!row) return this.error(404, `Документ ${post[2]} не найден`);
      row.Posted = true;
      this.posted.push(post[2]);
      return this.json({});
    }

    const one = path.match(/^([\p{L}\p{N}_]+)\(guid'([^']+)'\)$/u);
    if (one) {
      const s = this.sets.get(one[1]);
      if (!s) return this.error(404, `Нет набора ${one[1]}`);
      const row = s.rows.find(r => r.Ref_Key === one[2]);
      if (!row) return this.error(404, `Объект ${one[2]} не найден`);
      if (method === "PATCH") { Object.assign(row, body); return this.json(row); }
      return this.json(this.project([row], url.searchParams.get("$select"))[0]);
    }

    const set = path.match(/^([\p{L}\p{N}_]+)$/u);
    if (!set) return this.error(400, `Не понимаю запрос ${path}`);
    const s = this.sets.get(set[1]);
    if (!s) return this.error(404, `Нет набора ${set[1]}`);
    if (method === "POST") {
      for (const k of Object.keys(body ?? {})) {
        if (!s.fields.has(k)) return this.error(400, `Свойство ${k} не найдено в объекте ${set[1]}`);
      }
      const row = this.add(set[1], body);
      return this.json(row, 201);
    }
    const filtered = s.rows.filter(this.matcher(url.searchParams.get("$filter")));
    const skip = Number(url.searchParams.get("$skip") ?? 0);
    const top = url.searchParams.has("$top") ? Number(url.searchParams.get("$top")) : filtered.length;
    return this.json({ value: this.project(filtered.slice(skip, skip + top), url.searchParams.get("$select")) });
  };
}
