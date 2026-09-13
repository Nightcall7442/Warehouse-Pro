/**
 * Снимки экранов для обучения — с настоящего приложения, а не нарисованные.
 *
 * Запускается в CI (.github/workflows/screenshots.yml): там есть база с засевом
 * (demo-uz: директор, оператор, агенты, супервайзер, мерчандайзер, курьеры),
 * собранный веб и, если задан MOBILE_URL, собранная в веб мобилка (Expo web).
 * Для каждой роли и каждого языка (ru, uz) проходит по её экранам и кладёт
 * PNG в screenshots/<web|mobile>/<lang>/<role>/<экран>.png плюс index.json.
 *
 * Падение одного экрана не останавливает остальные: снимок — не проверка, а
 * материал; чего не вышло — записано в index.json с причиной.
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

/** Экраны веба по ролям: путь → имя файла. */
const WEB_SCREENS = {
  ceo: {
    "/": "dashboard", "/orders": "orders", "/shops": "shops", "/products": "products", "/warehouse": "warehouse",
    "/arrivals": "arrivals", "/returns": "returns", "/warehouse-reports": "warehouse-reports", "/reports": "reports",
    "/reports?tab=debts": "reports-debts", "/pnl": "pnl", "/salaries": "salaries", "/agent/kpi": "kpi",
    "/supervisor": "map", "/supervisor/plans": "plans", "/users": "users", "/audit-log": "audit-log",
    "/settings": "settings", "/billing": "billing", "/notifications": "notifications",
  },
  operator: {
    "/": "dashboard", "/orders": "orders", "/orders/new": "order-new", "/products": "products", "/shops": "shops",
    "/arrivals": "arrivals", "/returns": "returns", "/warehouse": "warehouse", "/barcode": "barcode", "/settings": "settings",
  },
  agent: {
    "/agent": "home", "/agent/shops": "shops", "/orders/new": "order-new", "/orders": "orders",
    "/agent/plans": "plans", "/agent/debts": "debts", "/agent/kpi": "kpi", "/agent/gps": "gps", "/products": "catalog",
  },
  supervisor: { "/supervisor": "map", "/supervisor/plans": "plans", "/agent/kpi": "kpi", "/agent/gps": "gps" },
  merchandiser: { "/agent": "home", "/agent/plans": "plans", "/agent/shops": "shops" },
  courier: { "/deliveries": "deliveries" },
};

/** Экраны мобилки (Expo Router, web) по ролям. */
const MOBILE_SCREENS = {
  agent: {
    "/": "home", "/shops": "shops", "/catalog": "catalog", "/orders": "orders", "/order/new": "order-new",
    "/plan": "plan", "/debts": "debts", "/gps": "gps", "/salary": "salary", "/profile": "profile", "/notifications": "notifications",
  },
  courier: { "/": "home", "/deliveries": "deliveries", "/profile": "profile" },
  merchandiser: { "/": "home", "/plan": "plan", "/shops": "shops", "/profile": "profile" },
  supervisor: { "/": "home", "/tracking": "map", "/plans": "plans", "/targets": "targets", "/shops": "shops" },
};

const index = { web: [], mobile: [], failures: [] };

const settle = async page => {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(900); // анимации появления
};

async function shootWeb(browser) {
  for (const lang of LANGS) {
    // Экран входа — без учётной записи, один на всех.
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: lang === "uz" ? "uz" : "ru" });
      await ctx.addInitScript(l => { try { localStorage.setItem("lang", l); } catch {} }, lang);
      const page = await ctx.newPage();
      await page.goto(`${WEB}/login`).catch(() => {});
      await settle(page);
      const dir = join(OUT, "web", lang, "login"); mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: join(dir, "login.png") });
      index.web.push({ lang, role: "login", screen: "login", file: `web/${lang}/login/login.png` });
      await ctx.close();
    }
    for (const [role, email] of Object.entries(ACCOUNTS)) {
      const screens = WEB_SCREENS[role];
      if (!screens) continue;
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
      for (const [path, name] of Object.entries(screens)) {
        try {
          await page.goto(`${WEB}${path}`, { waitUntil: "domcontentloaded" });
          await settle(page);
          await page.screenshot({ path: join(dir, `${name}.png`) });
          index.web.push({ lang, role, screen: name, path, file: `web/${lang}/${role}/${name}.png` });
        } catch (e) {
          index.failures.push({ where: `web/${lang}/${role}`, step: path, error: String(e).slice(0, 300) });
        }
      }
      await ctx.close();
    }
  }
}

async function shootMobile(browser) {
  const phone = devices["iPhone 13"];
  for (const lang of LANGS) {
    for (const [role, screens] of Object.entries(MOBILE_SCREENS)) {
      const email = ACCOUNTS[role];
      const ctx = await browser.newContext({ ...phone, locale: lang === "uz" ? "uz" : "ru" });
      // AsyncStorage в вебе — localStorage с тем же ключом, что и на телефоне.
      await ctx.addInitScript(l => { try { localStorage.setItem("app_lang", l); } catch {} }, lang);
      const page = await ctx.newPage();
      const dir = join(OUT, "mobile", lang, role); mkdirSync(dir, { recursive: true });
      try {
        await page.goto(`${MOBILE}/`, { waitUntil: "domcontentloaded" });
        await settle(page);
        if (role === "agent") await page.screenshot({ path: join(dir, "login.png") });
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
      for (const [path, name] of Object.entries(screens)) {
        try {
          await page.goto(`${MOBILE}${path}`, { waitUntil: "domcontentloaded" });
          await settle(page);
          await page.screenshot({ path: join(dir, `${name}.png`) });
          index.mobile.push({ lang, role, screen: name, path, file: `mobile/${lang}/${role}/${name}.png` });
        } catch (e) {
          index.failures.push({ where: `mobile/${lang}/${role}`, step: path, error: String(e).slice(0, 300) });
        }
      }
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
