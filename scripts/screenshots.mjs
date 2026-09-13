/**
 * Снимки экранов для руководства — с настоящего приложения, а не нарисованные.
 *
 * Запускается в CI (.github/workflows/screenshots.yml): там есть база с засевом
 * (demo-uz: директор, оператор, агенты, супервайзер, мерчандайзер, курьеры),
 * собранный веб и, если задан MOBILE_URL, собранная в веб мобилка (Expo web).
 *
 * Каждый снимок — сценарий: куда зайти, что нажать, что снять и какие элементы
 * пометить цифрами (их координаты уходят в index.json — руководство рисует
 * по ним выноски). Падение одного сценария не останавливает остальные:
 * снимок — материал, чего не вышло — записано в index.json с причиной.
 *
 * Локально: WEB_URL=http://127.0.0.1:3100 node scripts/screenshots.mjs
 */
import { chromium, devices } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const WEB = process.env.WEB_URL ?? "http://127.0.0.1:3100";
const MOBILE = process.env.MOBILE_URL ?? "";
const OUT = process.env.OUT ?? "screenshots";
const LANGS = (process.env.LANGS ?? "ru,uz").split(",");
const PASSWORD = "password123";

/** Учётные записи из db/seed.ts — засев, не чьи-то настоящие данные. */
const ACCOUNTS = {
  ceo: "ceo@demo-uz.uz",
  operator: "operator1@demo-uz.uz",
  agent: "agent-tashkent@demo-uz.uz",
  supervisor: "supervisor@demo-uz.uz",
  merchandiser: "merch1@demo-uz.uz",
  courier: "courier1@demo-uz.uz",
};

/* ── мини-язык указателей ─────────────────────────────────────────────────
   "text=/…/"   — по видимому тексту (регулярка, обе языковые формы через |)
   "ph=/…/"     — по placeholder
   "testid=x"   — data-testid
   "role=button:/…/" — по роли и имени
   "css=…"      — селектор; суффикс " >> nth=N" — N-й.                          */
function loc(page, spec) {
  let nth = 0;
  const m = /^(.*) >> nth=(\d+)$/.exec(spec);
  if (m) { spec = m[1]; nth = Number(m[2]); }
  const rx = s => new RegExp(s.slice(1, s.lastIndexOf("/")), s.endsWith("/i") ? "i" : "");
  let l;
  if (spec.startsWith("text=")) l = page.getByText(rx(spec.slice(5)));
  else if (spec.startsWith("ph=")) l = page.getByPlaceholder(rx(spec.slice(3)));
  else if (spec.startsWith("testid=")) l = page.getByTestId(spec.slice(7));
  else if (spec.startsWith("role=")) { const [role, name] = spec.slice(5).split(":", 2); l = page.getByRole(role, { name: rx(name) }); }
  else if (spec.startsWith("css=")) l = page.locator(spec.slice(4));
  else throw new Error(`указатель: ${spec}`);
  return l.nth(nth);
}

/* ── сценарии веба по ролям ───────────────────────────────────────────────
   Каждый: { name, path?, do?: [[act, spec, value?]…], marks?: [[key, spec]…] }
   act: click | fill | key | wait                                            */
const T = {
  newOrder: "role=button:/Новый заказ|Yangi buyurtma/",
  lists: "role=button:/Погрузочные листы|Yuklash varaqalari/",
  pending: "text=/^(Ожидает|Kutmoqda)$/",
  bulkList: "role=button:/Загруз|Yuklash varaqi/",
  makeList: "role=button:/Сформировать лист|Varaqa tuzish/",
  doneNoPrint: "role=button:/Готово, без печати|Tayyor, chop etmasdan/",
  pick: "role=button:/^(Собрать|Yig'ish)$/",
  confirmPick: "role=button:/Подтвердить сборку|Yig'ishni tasdiqlash/",
  newArrival: "role=button:/Новый приход|Yangi kelish/",
  saveComplete: "role=button:/Сохранить и завершить|Saqlash va yakunlash/",
  month: "role=button:/^(Месяц|Oy)$/",
};

const WEB_SCENARIOS = {
  operator: [
    { name: "orders", path: "/orders",
      marks: [["summary", T.pending], ["search", "ph=/Поиск заказов|Buyurtma/"], ["lists", T.lists], ["new", T.newOrder], ["status", "css=table tbody tr [role=combobox] >> nth=0"], ["complete", "text=/^(Выполнен|Bajarildi)$/ >> nth=0"]] },
    { name: "order-panel", path: "/orders", do: [["click", "css=table tbody tr td >> nth=1"], ["wait", 1500]],
      marks: [["status", "css=[role=dialog] [role=combobox] >> nth=0"], ["tabs", "text=/^(Детали|Tafsilotlar)$/"], ["sum", "text=/Сумма заказа|Buyurtma summasi/"]] },
    { name: "quick-order", path: "/orders", do: [["click", T.newOrder], ["wait", 1200]],
      marks: [["shop", "css=[role=dialog] input >> nth=0"]] },
    { name: "loading-list-create", path: "/orders",
      do: [["click", "css=table tbody tr td:first-child button >> nth=0"], ["click", "css=table tbody tr td:first-child button >> nth=1"], ["wait", 600], ["click", T.bulkList], ["wait", 1200]],
      marks: [["make", T.makeList]] },
    { name: "loading-list-preview", path: null, do: [["click", T.makeList], ["wait", 2500]],
      marks: [["print", "text=/^(Печать|Chop etish)$/"], ["done", T.doneNoPrint]], after: [["click", T.doneNoPrint], ["wait", 600]] },
    { name: "loading-lists", path: "/orders", do: [["click", T.lists], ["wait", 1500]],
      marks: [["pick", T.pick + " >> nth=0"], ["courier", "css=[role=dialog] [role=combobox] >> nth=0"]] },
    { name: "picking", path: null, do: [["click", T.pick + " >> nth=0"], ["wait", 1500]],
      marks: [["picked", "text=/^(Собрано|Yig'ildi)$/ >> nth=0"], ["confirm", T.confirmPick]] },
    { name: "arrivals", path: "/arrivals", marks: [["new", T.newArrival + " >> nth=0"]] },
    { name: "arrival-form", path: "/arrivals", do: [["click", T.newArrival + " >> nth=0"], ["wait", 1500]],
      marks: [["save", T.saveComplete]] },
    { name: "returns", path: "/returns" },
    { name: "warehouse", path: "/warehouse" },
    { name: "warehouse-reports", path: "/warehouse-reports" },
    { name: "products", path: "/products" },
    { name: "shops", path: "/shops", marks: [["search", "ph=/Название|Nomi|Поиск|Qidir/"]] },
    { name: "barcode", path: "/barcode" },
  ],
  ceo: [
    { name: "dashboard", path: "/",
      marks: [["revenue", "text=/ВЫРУЧКА · СЕГОДНЯ|TUSHUM · BUGUN/"], ["delivered", "text=/Довезено сегодня|Bugun yetkazildi/"], ["debt", "text=/ДОЛГ КЛИЕНТОВ|MIJOZLAR QARZI/"], ["alerts", "css=.neo-card-sm >> nth=0"]] },
    { name: "kpi", path: "/agent/kpi", marks: [["row", "css=table tbody tr >> nth=0"]] },
    { name: "kpi-agent", path: "/agent/kpi", do: [["click", "css=table tbody tr >> nth=0"], ["wait", 2500]] },
    { name: "map", path: "/supervisor", marks: [["states", "text=/На связи|Aloqada/ >> nth=0"]] },
    { name: "plans", path: "/supervisor/plans" },
    { name: "plans-month", path: "/supervisor/plans", do: [["click", T.month + " >> nth=0"], ["wait", 2000]] },
    { name: "reports", path: "/reports" },
    { name: "reports-debts", path: "/reports?tab=debts" },
    { name: "pnl", path: "/pnl" },
    { name: "salaries", path: "/salaries", marks: [["payAll", "text=/Выдать всем|Hammaga berish/ >> nth=0"]] },
    { name: "users", path: "/users" },
    { name: "audit-log", path: "/audit-log" },
    { name: "settings", path: "/settings" },
    { name: "billing", path: "/billing" },
    { name: "notifications", path: "/notifications" },
  ],
  supervisor: [
    { name: "map", path: "/supervisor" },
    { name: "plans", path: "/supervisor/plans" },
    { name: "plans-month", path: "/supervisor/plans", do: [["click", T.month + " >> nth=0"], ["wait", 2000]] },
    { name: "kpi", path: "/agent/kpi" },
  ],
  agent: [
    { name: "home", path: "/agent" }, { name: "shops", path: "/agent/shops" }, { name: "order-new", path: "/orders/new" },
    { name: "orders", path: "/orders" }, { name: "plans", path: "/agent/plans" }, { name: "debts", path: "/agent/debts" }, { name: "kpi", path: "/agent/kpi" },
  ],
  merchandiser: [{ name: "home", path: "/agent" }, { name: "plans", path: "/agent/plans" }],
  courier: [{ name: "deliveries", path: "/deliveries" }],
};

/* ── сценарии мобилки (Expo Router, web) ─────────────────────────────────── */
const M = {
  done: "text=/^(Готово|Tayyor)$/",
  detail: "text=/^(Оформить подробно|Batafsil rasmiylashtirish)$/",
  fail: "text=/^(Не доставлено|Yetkazilmadi)$/",
  cancel: "text=/^(Отмена|Bekor)$/",
};
const MOBILE_SCENARIOS = {
  agent: [
    { name: "home", path: "/", marks: [["visits", "text=/Визиты сегодня|Bugungi tashriflar/"], ["debts", "text=/^(ДОЛГИ|QARZLAR)/"]] },
    { name: "shops", path: "/shops" },
    { name: "catalog", path: "/catalog" },
    { name: "order-step1", path: "/order/new" },
    { name: "order-step2", path: "/order/new?shopId=1&shopName=Demo", do: [["wait", 1500]] },
    { name: "orders", path: "/orders" },
    { name: "plan", path: "/plan", marks: [["done", M.done + " >> nth=0"]] },
    { name: "debts", path: "/debts" },
    { name: "gps", path: "/gps" },
    { name: "salary", path: "/salary" },
    { name: "profile", path: "/profile", marks: [["lang", "text=/^(ЯЗЫК|TIL)$/"]] },
    { name: "notifications", path: "/notifications" },
  ],
  courier: [
    { name: "home", path: "/" },
    { name: "deliveries", path: "/deliveries",
      marks: [["all", "text=/Выехал по всем|Hammasiga yo'lga chiqdim/ >> nth=0"], ["delivered", "text=/^(Доставлено|Yetkazildi)$/ >> nth=0"], ["detail", M.detail + " >> nth=0"], ["fail", M.fail + " >> nth=0"]] },
    { name: "deliver", path: "/deliveries", do: [["click", M.detail + " >> nth=0"], ["wait", 2500]],
      marks: [["result", "text=/^(Частичный возврат|Qisman qaytarish)$/"], ["submit", "text=/ЗАВЕРШИТЬ ДОСТАВКУ|YETKAZISHNI YAKUNLASH/i"]] },
    { name: "fail-reason", path: "/deliveries", do: [["click", M.fail + " >> nth=0"], ["wait", 1200]] },
    { name: "profile", path: "/profile" },
  ],
  merchandiser: [
    { name: "home", path: "/" },
    { name: "plan", path: "/plan", marks: [["done", M.done + " >> nth=0"]] },
    { name: "visit-report", path: "/merchandiser/visit?planId=1&shopId=1&shopName=Demo", do: [["wait", 2500]] },
    { name: "shops", path: "/shops" },
    { name: "profile", path: "/profile" },
  ],
  supervisor: [
    { name: "home", path: "/" }, { name: "map", path: "/tracking" }, { name: "plans", path: "/plans" }, { name: "targets", path: "/targets" }, { name: "shops", path: "/shops" },
  ],
};

const index = { web: [], mobile: [], failures: [] };

const settle = async page => {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(900); // анимации появления
};

async function act(page, [what, spec, value]) {
  if (what === "wait") return page.waitForTimeout(Number(spec));
  if (what === "key") return page.keyboard.press(spec);
  const l = loc(page, spec);
  if (what === "click") return l.click({ timeout: 8_000 });
  if (what === "fill") return l.fill(value, { timeout: 8_000 });
}

async function marksOf(page, marks = []) {
  const out = [];
  for (const [key, spec] of marks) {
    try {
      const box = await loc(page, spec).boundingBox({ timeout: 4_000 });
      if (box) out.push({ key, x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) });
    } catch { /* элемента нет на этом языке/экране — выноски не будет */ }
  }
  return out;
}

async function runScenarios(page, base, scenarios, dir, entry) {
  for (const sc of scenarios) {
    try {
      if (sc.path) { await page.goto(`${base}${sc.path}`, { waitUntil: "domcontentloaded" }); await settle(page); }
      for (const step of sc.do ?? []) await act(page, step);
      const marks = await marksOf(page, sc.marks);
      await page.screenshot({ path: join(dir, `${sc.name}.png`) });
      entry.push({ screen: sc.name, path: sc.path, marks });
      for (const step of sc.after ?? []) await act(page, step).catch(() => {});
      if (sc.do?.length && !sc.after) await page.keyboard.press("Escape").catch(() => {});
    } catch (e) {
      index.failures.push({ where: dir, step: sc.name, error: String(e).slice(0, 300) });
    }
  }
}

async function shootWeb(browser) {
  for (const lang of LANGS) {
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: lang === "uz" ? "uz" : "ru" });
      await ctx.addInitScript(l => { try { localStorage.setItem("lang", l); } catch {} }, lang);
      const page = await ctx.newPage();
      await page.goto(`${WEB}/login`).catch(() => {});
      await settle(page);
      const dir = join(OUT, "web", lang, "login"); mkdirSync(dir, { recursive: true });
      const marks = await marksOf(page, [["email", "testid=login-email"], ["password", "testid=login-password"], ["submit", "testid=login-submit"]]);
      await page.screenshot({ path: join(dir, "login.png") });
      index.web.push({ lang, role: "login", screen: "login", file: `web/${lang}/login/login.png`, marks });
      await ctx.close();
    }
    for (const [role, email] of Object.entries(ACCOUNTS)) {
      const scenarios = WEB_SCENARIOS[role];
      if (!scenarios) continue;
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: lang === "uz" ? "uz" : "ru" });
      await ctx.addInitScript(l => { try { localStorage.setItem("lang", l); } catch {} }, lang);
      const page = await ctx.newPage();
      try {
        await page.goto(`${WEB}/login`);
        await page.getByTestId("login-email").fill(email);
        await page.getByTestId("login-password").fill(PASSWORD);
        await page.getByTestId("login-submit").click();
        await page.waitForURL(u => !new URL(u).pathname.startsWith("/login"), { timeout: 20_000 });
      } catch (e) {
        index.failures.push({ where: `web/${lang}/${role}`, step: "login", error: String(e).slice(0, 300) });
        await ctx.close();
        continue;
      }
      const dir = join(OUT, "web", lang, role); mkdirSync(dir, { recursive: true });
      const entry = [];
      await runScenarios(page, WEB, scenarios, dir, entry);
      for (const e of entry) index.web.push({ lang, role, ...e, file: `web/${lang}/${role}/${e.screen}.png` });
      await ctx.close();
    }
  }
}

async function shootMobile(browser) {
  const phone = devices["iPhone 13"];
  for (const lang of LANGS) {
    for (const [role, scenarios] of Object.entries(MOBILE_SCENARIOS)) {
      const email = ACCOUNTS[role];
      const ctx = await browser.newContext({ ...phone, locale: lang === "uz" ? "uz" : "ru" });
      // AsyncStorage в вебе — localStorage с тем же ключом, что и на телефоне.
      await ctx.addInitScript(l => { try { localStorage.setItem("app_lang", l); } catch {} }, lang);
      const page = await ctx.newPage();
      const dir = join(OUT, "mobile", lang, role); mkdirSync(dir, { recursive: true });
      const entry = [];
      try {
        await page.goto(`${MOBILE}/`, { waitUntil: "domcontentloaded" });
        await settle(page);
        if (role === "agent") {
          const marks = await marksOf(page, [["email", "ph=/you@company.com/"], ["password", "ph=/••••••••/"], ["submit", "role=button:/Войти|Kirish/"]]);
          await page.screenshot({ path: join(dir, "login.png") });
          entry.push({ screen: "login", path: "/", marks });
        }
        await page.getByPlaceholder("you@company.com").fill(email);
        await page.getByPlaceholder("••••••••").fill(PASSWORD);
        await page.getByRole("button", { name: /Войти|Kirish/ }).first().click();
        await page.waitForTimeout(2500);
        await settle(page);
      } catch (e) {
        index.failures.push({ where: `mobile/${lang}/${role}`, step: "login", error: String(e).slice(0, 300) });
        await ctx.close();
        continue;
      }
      await runScenarios(page, MOBILE, scenarios, dir, entry);
      for (const e of entry) index.mobile.push({ lang, role, ...e, file: `mobile/${lang}/${role}/${e.screen}.png` });
      await ctx.close();
    }
  }
}

const browser = await chromium.launch();
try {
  await shootWeb(browser);
  if (MOBILE) await shootMobile(browser);
} finally {
  await browser.close();
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 2));
console.log(`web: ${index.web.length}, mobile: ${index.mobile.length}, не вышло: ${index.failures.length}`);
for (const f of index.failures) console.log(`  ✗ ${f.where} ${f.step}: ${f.error}`);
