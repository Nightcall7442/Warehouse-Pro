import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { orderSource } from "./helpers/order-source";

/**
 * За кем числится заказ.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Поле agentId принималось на входе order.create с самого начала — и не
 * использовалось: заказ всегда приписывался ТОМУ, КТО ЕГО СОЗДАЛ. Интерфейс
 * даже слал сюда `agentId: user.id`, то есть себя же.
 *
 * Для арендатора, где заказы оформляет директор или оператор, это означало, что
 * весь KPI агентов пуст: продажи есть, а числятся за тем, кто нажал кнопку.
 * Комиссия считается процентом от заказов, которые человек ОФОРМИЛ, — значит и
 * зарплата агентов выходила нулём. Владелец увидел четыре строки с нулями и
 * спросил, работает ли агентский KPI вообще.
 *
 * Тот же род дефекта, что и у остальных «написано, но не позвано»: поле
 * объявлено, проверяется схемой, доходит до сервера и никуда не идёт.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const ROUTER = read("api/order-router.ts");
const CREATE = ROUTER.slice(ROUTER.indexOf("create: fieldSalesQuery"), ROUTER.indexOf("cancel: fieldSalesQuery"));

describe("заказ достаётся тому, кому назначили", () => {
  it("agentId из запроса доходит до создания", () => {
    // Главная проверка: раньше это число молча выбрасывалось.
    expect(CREATE).toContain("input.agentId");
    /*
      Проверяем два звена по отдельности: кому засчитывается заказ (третий
      довод — именно agentId, а не ctx.user.id) и что остальной ввод доходит
      до создания целиком, а не переписывается полем за полем — иначе новое
      поле терялось бы молча, как когда-то терялся сам agentId.
    */
    expect(CREATE).toContain("OrderService.create(ctx.db, ctx.tenant.id, agentId, {");
    expect(CREATE, "ввод перестал доходить до создания целиком").toContain("...input,");
  });

  it("назначать чужого может только тот, кто распоряжается работой", () => {
    /*
      Агент и мерчандайзер оформляют заказ на себя. Позволь им указывать
      чужого — и любой мог бы переписать чужой KPI и чужую комиссию.
    */
    expect(CREATE).toContain('["ceo", "operator", "supervisor"].includes(ctx.user.role)');
    expect(CREATE).toContain("canAssign && input.agentId ? input.agentId : ctx.user.id");
  });

  it("чужой сотрудник проверяется, свой — нет", () => {
    /*
      Себя проверять нечего: создающий только что прошёл вход. А число из
      запроса на веру брать нельзя — заказ уехал бы на сотрудника чужой
      организации или на уволенного.

      Проверка стоит в резолвере, а не в службе: в службе это был бы лишний
      запрос на КАЖДОМ создании, включая «оформил сам себе», а таких почти все.
    */
    expect(CREATE).toContain("if (agentId !== ctx.user.id)");
    expect(CREATE).toContain("eq(users.tenantId, ctx.tenant.id)");
    expect(CREATE).toContain('eq(users.status, "active")');
  });

  it("служба чужого не проверяет — это дело резолвера", () => {
    // Иначе проверка задвоится и подорожает на каждом заказе.
    const service = orderSource();
    const at = service.indexOf("async create(db: Db, tenantId: number, agentId: number");
    const body = service.slice(at, at + 2500);
    expect(body).not.toContain("Сотрудник не найден");
  });
});

describe("выбор есть на экране", () => {
  it("оформляющий за других видит, кому засчитается продажа", () => {
    // Ручка без экрана — то же самое, что ручки нет.
    const review = read("src/components/orders/OrderReview.tsx");
    expect(review).toContain("Продажа засчитывается");
    expect(review).toContain("onAgentChange");
  });

  it("агенту выбор не показывают", () => {
    /*
      Он оформляет на себя, и лишнее поле мешало бы в форме, которую он
      заполняет по двадцать раз в день.
    */
    const page = read("src/pages/NewOrder.tsx");
    expect(page).toContain('user?.role === "ceo" || user?.role === "operator" || user?.role === "supervisor"');
    expect(page).toContain("enabled: canAssign");
  });

  it("по умолчанию — на себя", () => {
    // Прежнее поведение остаётся, пока человек сознательно не выбрал другого.
    const page = read("src/pages/NewOrder.tsx");
    expect(page).toContain("agentId: agentId > 0 ? agentId : (user?.id ?? 0)");
  });
});
