/**
 * Публичные страницы не обещают того, чего нет в коде.
 *
 * ── Что нашлось при разборе (22.10.2026) ────────────────────────────────────
 *
 * Сравнение с чужой системой (wareon.uz) потребовало честно сказать, что умеем
 * мы. Прошлись по лендингу, /pitch, /compare, тарифам, регистрации и политике
 * конфиденциальности и сверили с кодом сервера и мобильного приложения. Неверных
 * или завышенных фраз нашлось больше восьмидесяти. Самые заметные:
 *
 *   • «GPS-контроль агентов и курьеров» — местоположение курьера не пишется
 *     вовсе: agent.saveLocation стоит на fieldSalesQuery, курьера там нет;
 *   • «Шесть ролей — …склад…» — роли «склад» нет, а мерчендайзер пропущен;
 *   • «след маршрута за день, неделю, месяц» — след рисуется только за сегодня;
 *   • «Excel и CSV» — выгрузку в CSV убрали, остался только журнал действий;
 *   • «командой /manual в Telegram-боте» — команда отвечает только владельцу
 *     платформы;
 *   • «iOS и Android» — сборка для iPhone лежит в TestFlight, в App Store её нет;
 *   • «Визит подтверждён по GPS» — отметка без фото координаты не проверяет;
 *   • «товары, заказы, контрагенты — двусторонняя синхронизация» — каждая
 *     сущность ходит в одну сторону;
 *   • «13 компаний», «1121 заказ за последние 30 дней» — снимок 2 сентября
 *     вместе с песочницами, к концу октября семинедельной давности;
 *   • политика конфиденциальности: «след хранится, пока нужен организации» —
 *     на деле 90 дней и удаляется ночной задачей; про почтовый сервис и Sentry
 *     не было ни слова.
 *
 * ── Как устроена проверка ───────────────────────────────────────────────────
 *
 * Не список запрещённых слов, а пары «обещание — факт в коде». Каждое правило
 * говорит, при каком состоянии кода фраза ложна. Когда возможность появится
 * (курьер начнёт писать GPS, вернётся CSV), правило само перестанет
 * действовать, и фразу можно будет вернуть. Пока кода нет — фраза не проходит.
 *
 * Комментарии из текстов вырезаются: в них прежние формулировки цитируются,
 * чтобы было видно, что и почему поменяли.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Текст без комментариев JS/JSX: в них старые фразы цитируются намеренно. */
function stripComments(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const dir = (d: string) => readdirSync(join(ROOT, d)).filter(f => /\.(tsx?|html)$/.test(f)).map(f => `${d}/${f}`);

/** Всё, что видит человек до входа и при выборе тарифа. */
const PUBLIC_FILES = [
  ...dir("src/components/landing"),
  ...dir("src/components/pitch"),
  ...dir("src/components/billing"),
  "src/components/compare/compare-content.ts",
  "src/pages/Landing.tsx",
  "src/pages/Pitch.tsx",
  "src/pages/Compare.tsx",
  "src/pages/Privacy.tsx",
  "src/pages/Register.tsx",
  "src/pages/Onboarding.tsx",
  "contracts/constants.ts",
  "index.html",
];
const PUBLIC = PUBLIC_FILES.map(f => ({ f, text: stripComments(read(f)) }));

const MIDDLEWARE = read("api/middleware.ts");
const AGENT_ROUTER = read("api/agent-router.ts");
const COURIER_ROUTER = read("api/courier-router.ts");
const BOT = read("api/telegram/bot.ts");
const PITCH = read("src/components/pitch/pitch-content.ts");
const SCHEMA = read("db/schema.ts");
const ONEC = read("api/services/onec-sync.ts");

/** Роли, которым сервер разрешает записать точку местоположения. */
const fieldSalesRoles = (() => {
  const m = MIDDLEWARE.match(/fieldSalesQuery\s*=\s*authedQuery\s*\.use\(requireRole\(\[([^\]]*)\]\)/);
  if (!m) throw new Error("не нашли fieldSalesQuery в api/middleware.ts");
  return m[1];
})();

/** Кусок роутера от имени процедуры до следующей процедуры того же уровня. */
function procedure(src: string, name: string): string {
  const at = src.indexOf(`  ${name}:`);
  if (at < 0) throw new Error(`не нашли процедуру ${name}`);
  const next = src.slice(at + 3).search(/\n {2}[a-zA-Z]+: /);
  return src.slice(at, next < 0 ? undefined : at + 3 + next);
}

interface Rule {
  name: string;
  /** Пока это верно, фраза ложна. */
  stillTrue: () => boolean;
  forbidden: RegExp;
}

const RULES: Rule[] = [
  {
    name: "курьера на карте нет: saveLocation не пускает роль courier",
    stillTrue: () => !/"courier"/.test(fieldSalesRoles) && /saveLocation:\s*fieldSalesQuery/.test(AGENT_ROUTER),
    forbidden: /GPS[^".\n]{0,40}курьер|курьер[^".\n]{0,30}GPS|агенты и курьеры на карте|kuryerlar GPS|GPS[^".\n]{0,40}kuryer|xaritadagi agentlar va kuryerlar/i,
  },
  {
    name: "роли «склад» нет в users.role",
    stillTrue: () => {
      const m = SCHEMA.match(/role:\s*mysqlEnum\("role",\s*\[([^\]]*)\]/);
      return !!m && !/warehouse|storekeeper/.test(m[1]);
    },
    forbidden: /ролей?\s*—[^"]*\bсклад\b|Директор, оператор, склад|rol\s*—[^"]*\bombor\b|Direktor, operator, ombor/,
  },
  {
    name: "след маршрута — только за один день (getTrail берёт одну дату)",
    stillTrue: () => /getTrail:[\s\S]{0,200}date: z\.string\(\)/.test(AGENT_ROUTER),
    forbidden: /день, неделю, месяц|kun, hafta, oy/,
  },
  {
    name: "CSV-выгрузки отчётов нет: exportToCSV удалена",
    stillTrue: () => !/export (async )?function exportToCSV/.test(read("src/lib/export.ts") + read("src/lib/excel.ts")),
    forbidden: /Excel и CSV|Excel va CSV/,
  },
  {
    name: "/manual в боте отвечает только админ-чату платформы",
    stillTrue: () => /telegramAdminChatId[\s\S]{0,400}\/manual|\/manual[\s\S]{0,400}telegramAdminChatId/.test(BOT),
    forbidden: /командой \/manual|\/manual buyrug/,
  },
  {
    name: "приложение для iPhone ещё не в App Store (в плане /pitch — «Публикация iOS-приложения»)",
    stillTrue: () => PITCH.includes("Публикация iOS-приложения в App Store"),
    forbidden: /iOS и Android|iOS, Android|iOS va Android|PWA, iOS|на проверке в App Store|App Store \(на проверке\)|Приложение для iOS/,
  },
  {
    name: "подсказок «что предложить» нет — они в плане /pitch",
    stillTrue: () => PITCH.includes("список «что предложить»"),
    forbidden: /что взять на пробу|namuna uchun nima olish/,
  },
  {
    name: "отметка визита без фото координаты не проверяет",
    stillTrue: () => !/verifyVisit|haversine|distance/i.test(procedure(AGENT_ROUTER, "updatePlanStatus")),
    forbidden: /координаты подтвердили|подтверждён по GPS|Отмечен по GPS|Отметка визита по GPS|подтверждает, что визит состоялся|koordinatalar tasdiqladi|GPS bo'yicha tasdiqlandi/,
  },
  {
    name: "доставки курьера идут по дате создания, порядка объезда нет",
    stillTrue: () => /orderBy\(desc\(orders\.createdAt\)\)/.test(procedure(COURIER_ROUTER, "listMyDeliveries")),
    forbidden: /в порядке объезда|маршрут в телефоне агента|Погрузочные листы, маршруты/,
  },
  {
    name: "1С: каждая сущность ходит в одну сторону — заказы из 1С не приходят",
    stillTrue: () => !/syncOrdersFrom1C|importOrdersFrom1C/.test(ONEC),
    forbidden: /двусторонн\w* синхронизац|ikki tomonlama sinxronla|Номенклатура и заказы в обе стороны|заказы, остатки и контрагенты синхронизируются/i,
  },
  {
    name: "мок-браузер показывает адрес, на котором живёт продукт",
    stillTrue: () => read("index.html").includes('rel="canonical" href="https://www.warehouse-pro.uz/"'),
    forbidden: /app\.warehouse-pro\.uz/,
  },
  {
    name: "сроков ответа поддержки нигде не обещаем",
    stillTrue: () => true,
    forbidden: /в течение 30 минут|30 daqiqa ichida|исправим в тот же день|o'sha kuni tuzatamiz/,
  },
  {
    name: "«наравне со Smartup и Sales Doctor» — чужих систем изнутри мы не видели (правило /compare)",
    stillTrue: () => true,
    forbidden: /наравне со Smartup|bilan bir qatorda/,
  },
  {
    name: "страницы условий нет — соглашаться можно только с политикой",
    stillTrue: () => !/path="\/(terms|offer|oferta)"/.test(read("src/App.tsx")),
    forbidden: /соглашаетесь с условиями|shartlarga rozilik/,
  },
];

describe("публичные страницы обещают только то, что есть в коде", () => {
  for (const rule of RULES) {
    it(rule.name, () => {
      if (!rule.stillTrue()) return; // возможность появилась — фразу можно вернуть
      const hits = PUBLIC.flatMap(({ f, text }) =>
        text.split("\n").filter(l => rule.forbidden.test(l)).map(l => `${f}: ${l.trim().slice(0, 160)}`));
      expect(hits, `обещание без кода:\n${hits.join("\n")}`).toEqual([]);
    });
  }

  it("цифры на лендинге — те же, что на /pitch, а не свой снимок", () => {
    const landing = stripComments(read("src/pages/Landing.tsx"));
    expect(landing).toMatch(/value: TRACTION\.organizations/);
    expect(landing).toMatch(/value: TRACTION\.shops/);
    expect(landing).toMatch(/value: TRACTION\.deliveredOrders30d/);
    expect(landing).toMatch(/TRACTION\.asOf/);
  });

  it("политика конфиденциальности называет тот срок хранения следа, что стоит в коде", () => {
    const days = read("api/services/location-retention.ts").match(/LOCATION_RETENTION_DAYS\s*=\s*(\d+)/)?.[1];
    expect(days).toBeTruthy();
    expect(stripComments(read("src/pages/Privacy.tsx"))).toContain(`След местоположения — ${days} дней`);
  });

  it("политика называет всех, кому уходят данные: почта и Sentry подключены в коде", () => {
    const privacy = stripComments(read("src/pages/Privacy.tsx"));
    if (/Sentry\.init/.test(read("api/boot.ts") + read("src/sentry.ts"))) expect(privacy).toContain("Sentry");
    if (/nodemailer/.test(read("api/lib/mailer.ts"))) expect(privacy).toContain("Почтовый сервис");
  });

  it("отказ публичного API не отправляет на тариф, которого больше не продают", () => {
    // planHas('standard', 'api') — да: API есть у «Стандарта» и у пробного.
    expect(read("api/public-api.ts")).not.toContain("requires the Exclusive plan");
  });
});
