/*
  Нагрузочный сценарий Warehouse Pro (k6).

  Три населения, как в жизни: агенты в поле (экраны раз в 8–15 с, точка GPS),
  курьеры (список доставок), директора и супервайзеры в офисе (сводка,
  отчёты, KPI, карта — тяжёлые запросы). Каждый виртуальный пользователь
  ходит под учёткой засева (входы — один раз в setup, токены общие: лимит
  входов 20 за 15 минут на почту иначе не пустит). Лимиты частоты на стенде
  выключены (RATE_LIMIT_DISABLED=1) — иначе пятьсот «агентов» на пяти
  учётках упрутся в лимит «на человека», а не в сервер.

  Запуск: BASE_URL=http://127.0.0.1:3100 k6 run scripts/load/k6.js
  Масштаб: AGENTS=300 DIRECTORS=30 COURIERS=30 (число одновременных людей на
  полке), STAGE_MIN=3 (минут на ступень). Ступени: 25% → 50% → 100% → 150%.
  Пороги ниже — то, что считаем «работает»: p95 экрана < 1 с, ошибок < 1%.
*/
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://127.0.0.1:3100";
const AGENTS = Number(__ENV.AGENTS || 300);
const DIRECTORS = Number(__ENV.DIRECTORS || 30);
const COURIERS = Number(__ENV.COURIERS || 30);
const STAGE = `${__ENV.STAGE_MIN || 3}m`;
const PASSWORD = "password123";

const ACCOUNTS = {
  agents: ["agent-tashkent@demo-uz.uz", "agent-samarkand@demo-uz.uz", "agent-bukhara@demo-uz.uz", "agent-nukus@demo-uz.uz", "agent-karshi@demo-uz.uz"],
  directors: ["ceo@demo-uz.uz", "supervisor@demo-uz.uz"],
  couriers: ["courier1@demo-uz.uz", "courier2@demo-uz.uz"],
};

const screen = new Trend("screen_ms", true);        // время одного экрана (несколько запросов)
const heavy = new Trend("heavy_report_ms", true);   // тяжёлые отчёты директора
const failed = new Rate("failed_requests");

const ramp = (n) => [
  { duration: STAGE, target: Math.ceil(n * 0.25) },
  { duration: STAGE, target: Math.ceil(n * 0.5) },
  { duration: STAGE, target: n },
  { duration: STAGE, target: Math.ceil(n * 1.5) },
  { duration: "30s", target: 0 },
];

export const options = {
  scenarios: {
    agents:    { executor: "ramping-vus", exec: "agent",    stages: ramp(AGENTS),    gracefulRampDown: "10s" },
    directors: { executor: "ramping-vus", exec: "director", stages: ramp(DIRECTORS), gracefulRampDown: "10s" },
    couriers:  { executor: "ramping-vus", exec: "courier",  stages: ramp(COURIERS),  gracefulRampDown: "10s" },
  },
  thresholds: {
    "http_req_duration{kind:screen}": ["p(95)<1000"],
    "http_req_duration{kind:heavy}": ["p(95)<3000"],
    failed_requests: ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

function login(email) {
  const r = http.post(`${BASE}/api/login`, JSON.stringify({ email, password: PASSWORD }), { headers: { "Content-Type": "application/json" }, tags: { kind: "login" } });
  if (r.status !== 200) throw new Error(`вход ${email}: ${r.status} ${r.body.slice(0, 120)}`);
  return r.json("token");
}

export function setup() {
  const tokens = {};
  for (const [group, emails] of Object.entries(ACCOUNTS)) tokens[group] = emails.map(login);
  return tokens;
}

const enc = (input) => encodeURIComponent(JSON.stringify({ json: input }));
function q(token, proc, input, kind = "screen") {
  const url = input === undefined ? `${BASE}/api/trpc/${proc}` : `${BASE}/api/trpc/${proc}?input=${enc(input)}`;
  const r = http.get(url, { headers: { Authorization: `Bearer ${token}` }, tags: { kind, proc } });
  const ok = check(r, { [`${proc} 200`]: (x) => x.status === 200 });
  failed.add(!ok);
  return r;
}
function m(token, proc, input, kind = "screen") {
  const r = http.post(`${BASE}/api/trpc/${proc}`, JSON.stringify({ json: input }), { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, tags: { kind, proc } });
  const ok = check(r, { [`${proc} 200`]: (x) => x.status === 200 });
  failed.add(!ok);
  return r;
}
const today = () => new Date().toISOString().slice(0, 10);
const timed = (trend, fn) => { const t0 = Date.now(); fn(); trend.add(Date.now() - t0); };

/** Агент: главная (план + долги), магазины, каталог, заказы, точка GPS. */
export function agent(tokens) {
  const token = tokens.agents[__VU % tokens.agents.length];
  timed(screen, () => { q(token, "agent.getPlans", { date: today() }); q(token, "agent.myDebts"); q(token, "order.stats"); });
  sleep(8 + Math.random() * 7);
  timed(screen, () => q(token, "agent.myShops"));
  sleep(5 + Math.random() * 5);
  timed(screen, () => q(token, "product.listAll"));
  sleep(8 + Math.random() * 7);
  timed(screen, () => q(token, "order.list", { limit: 20, offset: 0 }));
  m(token, "agent.saveLocation", { lat: String(41.3 + Math.random() * 0.1), lng: String(69.2 + Math.random() * 0.1), accuracy: "12" });
  sleep(10 + Math.random() * 10);
}

/** Курьер: список доставок, и ещё раз через минуту. */
export function courier(tokens) {
  const token = tokens.couriers[__VU % tokens.couriers.length];
  timed(screen, () => q(token, "courier.listMyDeliveries"));
  sleep(20 + Math.random() * 20);
}

/** Директор / супервайзер: сводка, отчёты, KPI, карта, заказы. */
export function director(tokens) {
  const token = tokens.directors[__VU % tokens.directors.length];
  timed(heavy, () => { q(token, "dashboard.kpis", undefined, "heavy"); q(token, "dashboard.trends", { range: "7d" }, "heavy"); });
  sleep(10 + Math.random() * 10);
  timed(heavy, () => q(token, "reports.getDashboardSummary", undefined, "heavy"));
  sleep(8 + Math.random() * 8);
  timed(heavy, () => q(token, "kpi.agentList", undefined, "heavy"));
  sleep(8 + Math.random() * 8);
  timed(screen, () => { q(token, "agent.getLocations"); q(token, "order.list", { limit: 50, offset: 0 }); });
  sleep(15 + Math.random() * 15);
}

export function handleSummary(data) {
  const p = (name) => data.metrics[name]?.values ?? {};
  const line = (label, v) => `| ${label} | ${Math.round(v["p(50)"] ?? v.med ?? 0)} | ${Math.round(v["p(95)"] ?? 0)} | ${Math.round(v["p(99)"] ?? 0)} | ${Math.round(v.max ?? 0)} |`;
  const reqs = data.metrics.http_reqs?.values ?? {};
  const fail = data.metrics.failed_requests?.values?.rate ?? 0;
  const md = [
    `## Нагрузочный тест: агентов ${AGENTS}, директоров ${DIRECTORS}, курьеров ${COURIERS} (пик ×1.5)`,
    "", `Запросов всего: ${reqs.count ?? 0}, в секунду: ${(reqs.rate ?? 0).toFixed(1)}, ошибок: ${(fail * 100).toFixed(2)}%`, "",
    "| Метрика | медиана, мс | p95 | p99 | max |", "|---|---|---|---|---|",
    line("Экран (все запросы экрана)", p("screen_ms")),
    line("Тяжёлый отчёт директора", p("heavy_report_ms")),
    line("HTTP-запрос", p("http_req_duration")),
    "", `Пороги: ${Object.entries(data.metrics).filter(([, v]) => v.thresholds).map(([k, v]) => `${k}: ${Object.values(v.thresholds).every(t => t.ok) ? "✅" : "❌"}`).join(", ") || "—"}`,
  ].join("\n");
  return { "load-summary.md": md, "load-summary.json": JSON.stringify(data, null, 1), stdout: md + "\n" };
}
