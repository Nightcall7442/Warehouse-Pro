import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { brandCss } from "@/hooks/useBranding";
import { NAV_ITEMS } from "@/const";

/**
 * PWA = мобилка v8.
 *
 * Владелец, 24.09.2026, сразу после того, как мобилка получила язык v8
 * («C и D»): «PWA тоже точно как мобайл должен быть». Узкая раскладка веба —
 * та, что ставят на экран как приложение, — повторяет мобилку: палитру,
 * поверхности, шапку, панель вкладок, главную агента и вход.
 *
 * Значения ниже — буквально из Warehouse-Pro-Mobile, src/theme.ts (v8). Этот
 * репозиторий мобилку не видит, поэтому числа записаны здесь; поменялась
 * мобилка — меняются вместе.
 *
 * Нарочная поломка (каждая роняет свой тест):
 *   · телефонный блок вынести из @layer base — «цвет арендатора сильнее»;
 *   · в brandCss убрать строку --color-cta — «цвет арендатора ведёт главное действие»;
 *   · вернуть тёмному телефону --color-success: #00e68a — «статусы тёмной без неона»;
 *   · вернуть агенту вкладку «Офлайн» — «вкладки агента — как в мобилке»;
 *   · вернуть на главную агента «НОВЫЙ ЗАКАЗ» — «главная агента»;
 *   · у «Войти» снять var(--color-cta) — «вход».
 */
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const CSS = read("src/index.css");
const LAYOUT = read("src/components/Layout.tsx");
const HOME = read("src/pages/AgentDashboard.tsx");

const PHONE_AT = CSS.indexOf("ТЕЛЕФОН (PWA) = МОБИЛКА v8");
function block(selector: string): string {
  const at = CSS.indexOf(selector + " {", PHONE_AT);
  expect(at, `в телефонном блоке нет ${selector}`).toBeGreaterThan(PHONE_AT);
  return CSS.slice(at, CSS.indexOf("\n    }", at));
}
const LIGHT = block(":root:not(.dark)");
const DARK = block(".dark");
function token(b: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(b);
  expect(m, `--${name} не объявлен`).not.toBeNull();
  return m![1].trim();
}

// Контраст по WCAG — тот же расчёт, что в мобилке (theme-contrast.test.ts).
function lum(hex: string): number {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe("палитра телефона — мобилка v8", () => {
  it("телефонный блок на месте и в слое base", () => {
    // Цвет арендатора (useBranding) вставляется таблицей ВНЕ слоёв и потому
    // бьёт всё, что внутри @layer. Вынеси блок из слоя — и запасная бирюза
    // перекрасит чужой бренд на каждом телефоне.
    const base = CSS.indexOf("@layer base {");
    const components = CSS.indexOf("@layer components {");
    expect(PHONE_AT).toBeGreaterThan(base);
    expect(PHONE_AT, "телефонный блок вышел из @layer base — цвет арендатора проиграет").toBeLessThan(components);
    expect(CSS.slice(PHONE_AT, components)).toContain("@media (max-width: 767.98px) {");
  });

  it("светлая — «Финтех»: холст, белая карточка, бирюза, жёлтое главное действие", () => {
    expect(token(LIGHT, "color-canvas")).toBe("#f1f4f3");
    expect(token(LIGHT, "color-surface")).toBe("#ffffff");
    expect(token(LIGHT, "color-text-primary")).toBe("#13201e");
    expect(token(LIGHT, "color-text-secondary")).toBe("#4b5a57");
    expect(token(LIGHT, "color-text-tertiary")).toBe("#5f6d6a");
    expect(token(LIGHT, "color-border")).toBe("#dfe6e4");
    expect(token(LIGHT, "color-primary")).toBe("#0e4f49");
    expect(token(LIGHT, "color-cta")).toBe("#f5c518");
    expect(token(LIGHT, "color-on-cta")).toBe("#13201e");
    expect(token(LIGHT, "color-field")).toBe("#ffffff");
  });

  it("светлая: тени вертикальные, без неоморфной пары «блик + тень»", () => {
    for (const name of ["shadow-xs", "shadow-sm", "shadow-raised", "shadow-md", "shadow-lg", "shadow-xl"]) {
      const v = token(LIGHT, name);
      for (const layer of v.split(/,(?![^(]*\))/)) {
        expect(layer.trim(), `${name}: тень со сдвигом вбок — это снова неоморфизм`).toMatch(/^0 \d/);
      }
      expect(v, `${name}: белый блик вернулся`).not.toMatch(/255,\s*255,\s*255/);
    }
    expect(token(LIGHT, "shadow-pressed")).toBe("inset 0 0 0 1px #dfe6e4");
  });

  it("тёмная: статусы без неона, поверхности — линией", () => {
    expect(token(DARK, "color-success")).toBe("#3ddc97");
    expect(token(DARK, "color-danger")).toBe("#ff7a7a");
    expect(token(DARK, "color-warning")).toBe("#f0b545");
    expect(token(DARK, "color-info")).toBe("#7cb8e6");
    for (const neon of ["#00e68a", "#ff4d6a", "#00b4ff", "#00d4ff", "#00e5ff", "#a78bfa"]) {
      expect(DARK.toLowerCase().includes(neon), `неон ${neon} в тёмной теме телефона`).toBe(false);
    }
    for (const name of ["shadow-xs", "shadow-sm", "shadow-raised", "shadow-md", "shadow-lg", "shadow-xl"]) {
      expect(token(DARK, name), name).toBe("0 0 0 1px #322e28");
    }
  });

  it("надписи читаются: главное действие, бренд, третий текст, статусы тёмной", () => {
    expect(contrast(token(LIGHT, "color-on-cta"), token(LIGHT, "color-cta"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(LIGHT, "color-on-primary"), token(LIGHT, "color-primary"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(LIGHT, "color-primary-text"), token(LIGHT, "color-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(LIGHT, "color-text-tertiary"), token(LIGHT, "color-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(LIGHT, "color-text-tertiary"), token(LIGHT, "color-canvas"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(LIGHT, "color-info-text"), token(LIGHT, "color-surface"))).toBeGreaterThanOrEqual(4.5);
    for (const s of ["color-success", "color-danger", "color-warning", "color-info"]) {
      expect(contrast(token(DARK, s), "#221f1c"), s).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("поверхности: без блика, перелива, ореола и «подпрыгивания» от касания", () => {
    const tail = CSS.slice(CSS.indexOf("Телефон (PWA) = мобилка v8: поверхности"));
    expect(tail).toContain("@layer components {");
    expect(tail).toMatch(/\.neo-card::before,[^{]*\{ display: none; \}/);
    expect(tail).toMatch(/\.neo-btn-primary,[^{]*\{ box-shadow: none; \}/);
    expect(tail).toMatch(/\.neo-card:not\(\.neo-card-static\):hover[^{]*\{ transform: none; \}/);
    expect(tail).toContain(".neo-input, .neo-field { background: var(--color-field); }");
  });
});

describe("цвет арендатора сильнее запасного", () => {
  it("brandCss ведёт главное действие цветом арендатора в обеих темах", () => {
    // Без этого на телефоне у арендатора с синим брендом кнопки были бы жёлтыми.
    const css = brandCss("#2563eb");
    const [light, dark] = css.split("\n");
    expect(light.startsWith(":root {")).toBe(true);
    expect(dark.startsWith(":root.dark {")).toBe(true);
    for (const rule of [light, dark]) {
      const primary = /--color-primary: ([^;]+);/.exec(rule)![1];
      expect(rule).toContain(`--color-cta: ${primary};`);
      expect(rule).toMatch(/--color-on-cta: #[0-9a-f]{6};/i);
    }
  });

  it("плашка цифры светлой темы — цвет бренда, тёмной — карточка (как hero мобилки)", () => {
    const light = CSS.slice(CSS.indexOf(":root, .light {"), CSS.indexOf("\n  }", CSS.indexOf(":root, .light {")));
    const dark = CSS.slice(CSS.indexOf("  .dark {"), CSS.indexOf("\n  }", CSS.indexOf("  .dark {")));
    expect(token(light, "color-hero")).toBe("var(--color-primary)");
    expect(token(light, "color-on-hero")).toBe("var(--color-on-primary)");
    expect(token(dark, "color-hero")).toBe("var(--color-surface)");
    expect(token(dark, "color-on-hero")).toBe("var(--color-text-primary)");
  });
});

/** Пункты нижней панели роли: [путь, подпись, значок]. */
function tabs(role: string): Array<[string, string, string]> {
  const body = LAYOUT.slice(LAYOUT.indexOf("const BOTTOM_NAV"));
  const at = body.indexOf(`  ${role}: [`);
  expect(at, `панель роли ${role} не найдена`).toBeGreaterThan(0);
  const b = body.slice(at, body.indexOf("\n  ],", at));
  return [...b.matchAll(/ru: "([^"]+)".*?path: "([^"]+)".*?icon: "([^"]+)"/g)].map(m => [m[2], m[1], m[3]]);
}

describe("панель вкладок — как в мобилке", () => {
  it("вкладки агента — как в мобилке: Главная, Магазины, Каталог, Заказы, Профиль", () => {
    expect(tabs("agent")).toEqual([
      ["/agent", "Главная", "House"],
      ["/agent/shops", "Магазины", "ShoppingBag"],
      ["/catalog", "Каталог", "LayoutGrid"],
      ["/orders", "Заказы", "Clipboard"],
      ["/settings", "Профиль", "User"],
    ]);
  });

  it("вкладки мерчендайзера — как в мобилке: Главная, Магазины, План, Профиль", () => {
    expect(tabs("merchandiser").map(t => t[0])).toEqual(["/agent", "/agent/shops", "/agent/plans", "/settings"]);
  });

  it("очередь неотправленного не потеряла двери", () => {
    // Вкладкой её больше нет — значит, дверь в боковом меню и значок в шапке.
    expect(NAV_ITEMS.agent.map(i => i.path)).toContain("/offline-orders");
    expect(LAYOUT).toContain("<OfflineQueueBadge />");
  });

  it("вид панели: подушка 52×30 у активной, подписи 11", () => {
    const nav = LAYOUT.slice(LAYOUT.indexOf("const BottomNav = memo"), LAYOUT.indexOf("// ── Mobile drawer"));
    expect(nav).toContain("style={{ width: 52, height: 30, background: isActive ? \"var(--color-primary-subtle)\" : \"transparent\" }}");
    expect(nav).toContain("fontSize: \"11px\"");
    expect(nav, "вернулась полоска-чёрточка над активной вкладкой").not.toContain("w-5 h-[3px]");
  });

  it("шапка — как PageHeader: заголовок слева жирным, круглые кнопки", () => {
    const head = LAYOUT.slice(LAYOUT.indexOf("const MobileHeader = memo"), LAYOUT.indexOf("// ── Mobile bottom navigation"));
    expect(head).toContain("fontSize: \"20px\", fontWeight: 800");
    expect(head).toContain("const roundSize = { width: 36, height: 36, borderRadius: 999 };");
    expect(head, "кнопка меню потеряла имя — e2e и экранный диктор её не найдут").toContain("aria-label={lang === \"uz\" ? \"Menyu\" : \"Меню\"}");
    expect(head, "заголовок снова по центру").not.toContain("items-center\">\n        <span style={{ fontSize: \"15px\"");
  });
});

describe("главная агента — раскладка мобилки", () => {
  it("«Новый заказ» — главное действие, выручка — на плашке hero", () => {
    expect(HOME).toContain("background: \"var(--color-cta)\", color: \"var(--color-on-cta)\"");
    expect(HOME).toContain("background: \"var(--color-hero)\"");
    expect(HOME).toContain("color: \"var(--color-on-hero)\"");
    expect(HOME).toContain("t(\"Новый заказ\", \"Yangi buyurtma\")");
    expect(HOME).toContain("t(\"Выручка за сегодня\", \"Bugungi tushum\")");
  });

  it("подписи обычными буквами, без цвета числом", () => {
    for (const caps of ["НОВЫЙ ЗАКАЗ", "МОИ МАГАЗИНЫ", "ЗАКАЗОВ", "ВЫРУЧКА", "МАГАЗИНОВ", "ПЛАН ВИЗИТОВ", "ДОЛГ МАГАЗИНОВ"]) {
      expect(HOME.includes(caps), `вернулся КАПС «${caps}»`).toBe(false);
    }
    const code = HOME.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], "цвет числом на главной агента").toEqual([]);
  });

  it("сбой связи не рисуется нулём выручки", () => {
    expect(HOME).toContain("kpisFailed ? (");
    expect(HOME).toContain("t(\"Нет связи — обновите страницу\", \"Aloqa yo'q — sahifani yangilang\")");
  });
});

describe("вход — как в мобилке", () => {
  it("на телефоне плашка hero сверху, «Войти» — главное действие", () => {
    const shell = read("src/components/auth/AuthShell.tsx");
    expect(shell).toContain("data-testid=\"auth-phone-hero\"");
    expect(shell).toContain("style={{ background: \"var(--color-hero)\", color: \"var(--color-on-hero)\"");
    const login = read("src/pages/Login.tsx");
    const submit = login.slice(login.indexOf("data-testid=\"login-submit\""), login.indexOf("</button>", login.indexOf("data-testid=\"login-submit\"")));
    expect(submit).toContain("background: \"var(--color-cta)\", color: \"var(--color-on-cta)\"");
  });
});
