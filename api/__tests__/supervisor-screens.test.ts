import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Что супервайзеру показывают — то он и может сделать.
 *
 * Роль надзорная: команду он видит, а деньгами и настройками не распоряжается.
 * Из-за этого экраны, общие с руководителем, легко обещают ему то, чего сервер
 * не отдаст, — и обещание это тихое: кнопка есть, список пуст, сохранение
 * отвечает отказом.
 *
 * Так и было: на «KPI агентов» ему показывали «Настройку ЗП» (внутри user.list
 * — только ceo, и commission.setRate — ceo с оператором), а фильтр «по агенту»
 * на «Отчётах» звал user.list, и выпадающий список оставался пустым у всех,
 * кроме руководителя.
 */
// Переводы строк приводим к одному виду: файлы в репозитории лежат с CRLF, и
// разбор по «\n  {» молча находил ноль записей — проверка проходила вхолостую.
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const MW = read("api/middleware.ts");
const APP = read("src/App.tsx");
const KPI_PAGE = read("src/pages/AgentKpi.tsx");
const FILTERS = read("src/components/reports/ReportFilters.tsx");
const REGISTRY = read("src/components/reports/report-registry.ts");
const ROUTER = read("api/router.ts");

/** Какие роли пускает вид процедуры. */
function rolesOf(kind: string): string[] {
  const at = MW.indexOf(`export const ${kind}`);
  expect(at, `вид процедуры ${kind} не найден`).toBeGreaterThan(0);
  const decl = MW.slice(at, MW.indexOf(";", at));
  const m = decl.match(/requireRole\(\[([^\]]+)\]\)/);
  expect(m, `${kind} без requireRole`).not.toBeNull();
  return m![1].split(",").map(x => x.trim().replace(/["']/g, ""));
}

/** Вид процедуры по её имени в дереве роутеров: "agent.listAgents". */
function kindOfCall(call: string): string | null {
  const [routerKey, proc] = call.split(".");
  const imports = new Map<string, string>();
  for (const m of ROUTER.matchAll(/import \{ (\w+) \}\s+from\s+"\.\/([\w-]+)"/g)) imports.set(m[1], m[2]);
  const mount = ROUTER.match(new RegExp(`^\\s*${routerKey}:\\s*(\\w+),`, "m"));
  if (!mount) return null;
  const file = imports.get(mount[1]);
  if (!file || !fs.existsSync(path.resolve(process.cwd(), `api/${file}.ts`))) return null;
  const m = read(`api/${file}.ts`).match(new RegExp(`^  ${proc}:\\s*(\\w+Query)`, "m"));
  return m ? m[1] : null;
}

/** Роли, которым открыт маршрут в App.tsx. */
function routeRoles(routePath: string): string[] {
  const at = APP.indexOf(`path="${routePath}"`);
  expect(at, `маршрут ${routePath} не найден`).toBeGreaterThan(0);
  const m = APP.slice(at, APP.indexOf("/>", at)).match(/roles=\{\[([^\]]+)\]\}/);
  expect(m, `${routePath} без RoleGuard`).not.toBeNull();
  return m![1].split(",").map(x => x.trim().replace(/["']/g, ""));
}

describe("отчёты", () => {
  it("фильтр «по агенту» доступен всем, кому открыт экран отчётов", () => {
    /*
      Здесь стоял user.list — полный список пользователей, руководителю. У
      оператора, супервайзера и мерчендайзера фильтр приходил отказом и молча
      оставался пустым: отобрать отчёт по агенту они не могли.
    */
    const call = FILTERS.match(/trpc\.(\w+)\.(\w+)\.useQuery/g)?.find(c => /list/i.test(c) && !/shop/i.test(c));
    expect(call, "в фильтрах не нашёлся запрос списка агентов").toBeTruthy();
    expect(FILTERS, "фильтр снова зовёт полный список пользователей").not.toContain("trpc.user.list");

    const allowed = rolesOf(kindOfCall("agent.listAgents")!);
    for (const role of routeRoles("/reports")) {
      expect(allowed, `${role} открывает отчёты, но список агентов ему закрыт`).toContain(role);
    }
  });

  it("каждый отчёт, видимый супервайзеру, ему и отвечает", () => {
    // Реестр отчётов сам решает, кому что показывать. Если у отчёта нет ролей,
    // его видят все, кому открыт экран, — включая супервайзера.
    const entries = REGISTRY.split(/\n {2}\{\n {4}id: "/).slice(1);
    expect(entries.length, "реестр отчётов не разобрался").toBeGreaterThan(5);

    const broken: string[] = [];
    for (const entry of entries) {
      const id = entry.slice(0, entry.indexOf('"'));
      const head = entry.slice(0, entry.indexOf("useQuery:"));
      const roles = head.match(/roles:\s*\[([^\]]*)\]/);
      const visible = !roles || roles[1].includes("supervisor");
      if (!visible) continue;

      for (const m of entry.matchAll(/trpc\.(\w+)\.(\w+)\.use\w+/g)) {
        const kind = kindOfCall(`${m[1]}.${m[2]}`);
        if (!kind) continue;
        if (!rolesOf(kind).includes("supervisor")) broken.push(`${id} → ${m[1]}.${m[2]} (${kind})`);
      }
    }
    expect(broken, `отчёты обещают супервайзеру то, что сервер не отдаст:\n${broken.join("\n")}`).toEqual([]);
  });
});

describe("KPI агентов", () => {
  it("настройка ЗП — только тем, кто может её сохранить", () => {
    /*
      Кнопка вела в панель, где список агентов приходил пустым (user.list —
      только ceo), а любая ставка отвечала отказом (commission.setRate — ceo и
      оператор). Условие стоит и на кнопке, и на самой панели: иначе состояние
      переживёт скрытую кнопку и панель откроется без неё.
    */
    expect(KPI_PAGE).toContain('const canConfigureSalary = viewer?.role === "ceo" || viewer?.role === "operator"');
    expect(KPI_PAGE).toContain("{canConfigureSalary && (");
    expect(KPI_PAGE).toContain("{canConfigureSalary && showSalaryConfig &&");
  });

  it("сам экран супервайзеру открыт — команду он видеть должен", () => {
    // Правка сужает одну панель, а не доступ к экрану.
    expect(routeRoles("/agent/kpi")).toContain("supervisor");
    expect(rolesOf(kindOfCall("kpi.agentList")!)).toContain("supervisor");
  });
});
