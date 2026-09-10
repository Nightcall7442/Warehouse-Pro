import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * KPI у курьера и оператора: пункт меню не должен вести в отказ.
 *
 * У обоих «KPI» стоит в нижней панели, и маршрут их туда пускает, — а сервер
 * запросы отклонял. Пункт всегда вёл в «не удалось загрузить», где «Повторить»
 * повторяет тот же отказ: заявка отклонена не сбоем, а правами.
 *
 * Курьер: считать ему есть что своё — расчёт уже берёт доставки по
 * orders.courier_id и собранные деньги по payments.created_by. Но агентский
 * вид ему не подходит: там визиты, заказы, средний чек, возвраты и магазины,
 * которых у курьера нет.
 *
 * Оператор: приравнен к директору решением владельца — видит список агентов и
 * разбор по каждому. Своя зарплата у него фиксированная сама собой: комиссия
 * считается процентом от заказов, которые человек ОФОРМИЛ, а оператор их не
 * оформляет.
 */
const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf8");
const MW = read("api/middleware.ts");
const KPI = read("api/kpi-router.ts");
const PAGE = read("src/pages/AgentKpi.tsx");
const SERVICE = read("api/services/kpi.ts");

function rolesOf(kind: string): string[] {
  const at = MW.indexOf(`export const ${kind}`);
  expect(at, `вид процедуры ${kind} не найден`).toBeGreaterThan(0);
  const m = MW.slice(at, MW.indexOf(";", at)).match(/requireRole\(\[([^\]]+)\]\)/);
  expect(m, `${kind} без requireRole`).not.toBeNull();
  return m![1].split(",").map((x) => x.trim().replace(/"/g, ""));
}

function kindOf(op: string): string {
  const m = KPI.match(new RegExp(`^  ${op}:\\s*(\\w+Query)`, "m"));
  expect(m, `${op} не найдена`).not.toBeNull();
  return m![1];
}

describe("курьер и свой KPI", () => {
  it("может открыть собственные числа", () => {
    expect(rolesOf(kindOf("courierKpi")), "курьеру снова закрыли его же KPI").toContain("courier");
  });

  it("чужого при этом не открылось", () => {
    // Список агентов и разбор по каждому — не для курьера.
    expect(rolesOf(kindOf("agentList"))).not.toContain("courier");
    expect(rolesOf(kindOf("agentDetail"))).not.toContain("courier");
  });

  it("видит свой экран, а не агентский", () => {
    // В агентском виде визиты, средний чек и возвраты — у курьера всё нули.
    expect(PAGE).toContain("CourierKpiView");
    expect(PAGE).toContain('const isCourier = user?.role === "courier"');
  });

  it("агентский расчёт ему даже не запрашивают", () => {
    /*
      Он отвечает нулями по визитам, планам и выручке и оценкой «F» — не
      потому что человек плохо работает, а потому что меряет не то. Раз экран
      этих чисел не показывает, и спрашивать их незачем.
    */
    const line = PAGE.split("\n").find((l) => l.includes("kpi.agentKpi.useQuery"));
    expect(line, "запрос агентского KPI не найден").toBeDefined();
    expect(line!, "курьеру снова считают агентский KPI").toContain("!isCourier");
  });
});

/*
  ── Зарплата курьера ────────────────────────────────────────────────────────

  Раньше её не запрашивали вовсе, и это было верно: агентский расчёт давал
  курьеру «оклад и три нуля». Комиссия — процент от заказов, которые человек
  ОФОРМИЛ (у курьера orders.agent_id пуст), премия — от оценки по визитам и
  планам, которых ему не ставят, вычет — за подозрительные визиты, которых он
  не делает.

  Решение владельца: фиксированная сумма за каждую довезённую заявку. Срывы её
  не уменьшают — они видны в показателях, но платят за факт.
*/
describe("зарплата курьера", () => {
  const salary = SERVICE.slice(SERVICE.indexOf("export async function calculateSalary"));

  it("теперь запрашивается", () => {
    const line = PAGE.split("\n").find((l) => l.includes("kpi.salary.useQuery"));
    expect(line, "запрос зарплаты не найден").toBeDefined();
    expect(line!, "курьеру снова отключили зарплату").not.toContain("!isCourier");
  });

  it("и сервер ему отвечает, а не отказывает", () => {
    /*
      Тут страж и молчал. Проверялось, что ЭКРАН спрашивает, — и всё; кто
      отвечает, не смотрел никто. А `salary` стояла под fieldSalesQuery, где
      курьера в списке ролей НЕТ.

      Отказ при этом не выглядел отказом: блок зарплаты в CourierKpiView
      рисуется по `salary &&`, поэтому курьер видел не ошибку, а отсутствие
      блока — и считал, что зарплату ему просто не показывают. Вместе с ней он
      не видел обеда и дорожных, то есть настройки, ради которой всё и
      затевалось, для того самого человека, о котором она.

      Своё, а не чужое: запрос считает строго ctx.user.id, поэтому расширение
      никому ничего не открывает.
    */
    expect(rolesOf(kindOf("salary")), "курьеру снова закрыли его же зарплату").toContain("courier");
  });

  it("все три собственных показателя открыты ему одинаково", () => {
    // Расходятся такие списки поодиночке: три ручки про «свои числа» лежат в
    // одном файле, а вид процедуры у каждой свой, и правят их порознь.
    for (const op of ["agentKpi", "courierKpi", "salary"]) {
      expect(rolesOf(kindOf(op)), `${op}: курьер не допущен к своим числам`).toContain("courier");
    }
  });

  it("считается ставкой за доставку, а не процентом", () => {
    expect(salary).toContain("deliveredCount * deliveryRate");
  });

  it("итог курьера — только оклад и доставки", () => {
    /*
      Без этой проверки к сумме легко вернутся комиссия, премия и вычет: все
      три в той же функции строкой выше, и все три у курьера ноль или мусор.
    */
    const total = salary.slice(salary.indexOf("const totalSalary"), salary.indexOf("return {"));
    expect(total).toContain("baseSalary + deliveryPay");
    expect(total).toMatch(/isCourier/);
  });

  it("срывы выплату не уменьшают", () => {
    // Платим за факт: сорванные видны в показателях, но из денег не вычитаются.
    const total = salary.slice(salary.indexOf("const totalSalary"), salary.indexOf("return {"));
    expect(total).not.toMatch(/failed/);
  });

  it("строку комиссии курьеру не пишут", () => {
    // Запись означала бы «комиссия ноль» вместо «комиссии нет».
    expect(salary).toContain("persist && !isCourier");
  });

  it("доставки считаются по дате доставки, а не создания заказа", () => {
    /*
      Заказ мог быть оформлен в конце месяца, а доехать в начале следующего.
      По дате создания доставка попала бы в месяц, в котором курьер её ещё не
      делал, и в свой месяц не попала бы вовсе — человек недосчитался бы денег.
    */
    const stats = SERVICE.slice(
      SERVICE.indexOf("export async function calculateCourierStats"),
      SERVICE.indexOf("export interface AgentListEntry"),
    );
    expect(stats).toContain("COALESCE(${orders.deliveredAt}, ${orders.createdAt})");
  });

  it("деньги считаются по тому, кто их внёс", () => {
    /*
      Не по заказу: тот же заказ мог частью погасить агент при визите, и эти
      деньги курьеру не приписываются.
    */
    const stats = SERVICE.slice(
      SERVICE.indexOf("export async function calculateCourierStats"),
      SERVICE.indexOf("export interface AgentListEntry"),
    );
    expect(stats).toContain("payments.createdBy");
  });
});

describe("оператор наравне с директором", () => {
  it("видит список агентов и разбор", () => {
    for (const op of ["agentList", "agentDetail", "territoryKpi"]) {
      expect(rolesOf(kindOf(op)), `оператору закрыт ${op}`).toContain("operator");
    }
  });

  it("своя зарплата ему запрашивается", () => {
    const line = PAGE.split("\n").find((l) => l.includes("kpi.salary.useQuery"));
    expect(line!, "оператор снова не видит свой оклад").toContain("isOperator");
  });

  it("оклад не показывают, пока он не заведён", () => {
    // Карточка с нулём выдавала бы за настоящую цифру незаполненное поле.
    expect(PAGE).toContain("mySalary.totalSalary > 0");
  });
});

/*
  ── Процент вместо ставки за штуку ──────────────────────────────────────────

  Владелец одного арендатора платит курьерам процентом, а не суммой за
  довезённую заявку. Способ выбирается по человеку и хранится в
  commissions.courier_pay_mode, поэтому в одной организации могут работать оба:
  платформа ни одного не навязывает.

  Процент считается от суммы ДОВЕЗЁННОГО, а не от собранных денег: довёз —
  сделал свою работу, а заплатит ли магазин сегодня или в долг, курьер не
  решает.
*/
describe("курьеру можно платить процентом", () => {
  const salary = SERVICE.slice(SERVICE.indexOf("export async function calculateSalary"));
  const total = salary.slice(salary.indexOf("const courierRate"), salary.indexOf("return {"));

  it("способ хранится явно, а не выводится из заполненного поля", () => {
    /*
      Вывести было бы короче: стоит ставка — платим за штуку, стоит процент —
      процентом. Но заполнены могут оказаться оба (курьера перевели с одного на
      другой, не обнулив прежнее), и правило пришлось бы додумывать — а речь о
      зарплате, где догадка кончается спором с человеком, который недосчитался
      денег.
    */
    const schema = read("db/schema.ts");
    expect(schema).toContain('mysqlEnum("courier_pay_mode", ["per_delivery", "percent"])');
    expect(schema, "умолчание должно повторять прежнее поведение").toMatch(
      /courier_pay_mode[\s\S]{0,120}default\("per_delivery"\)/,
    );
  });

  it("процент берётся от суммы довезённого", () => {
    expect(total).toContain("deliveredAmount * (commissionRate / 100)");
  });

  it("за штуку считается по-прежнему", () => {
    // Второй способ никуда не делся: большинство платит именно так.
    expect(total).toContain("deliveredCount * deliveryRate");
  });

  it("способ выбирает, какую ставку спрашивать", () => {
    /*
      Иначе курьер на проценте с пустой ставкой за штуку выглядел бы человеком
      без ставки вовсе, и показатели ему бы не считали.
    */
    expect(total).toContain('courierPayMode === "percent" ? commissionRate : deliveryRate');
  });

  it("экран называет строку расчёта по способу", () => {
    /*
      «12 × 15 000» и «3 200 000 × 5%» дают разные суммы из одних и тех же
      данных. Не назвав способ, экран оставляет человека без возможности
      пересчитать свою зарплату в уме.
    */
    const view = read("src/components/kpi/CourierKpiView.tsx");
    expect(view).toContain("courierPayMode");
    expect(view).toContain("Сумма довезённого × процент");
    expect(view).toContain("Довезено × ставка");
  });

  it("способ задаётся в настройках зарплат", () => {
    // Ручка без экрана — то же самое, что ручки нет.
    const page = read("src/pages/AgentKpi.tsx");
    expect(page).toContain("courierPayMode");
    expect(page).toContain("saveCourierMode");
  });

  it("не переданный способ не затирает выбранный", () => {
    /*
      Экран ставок агента про способ ничего не знает и обнулять чужую настройку
      не должен — та же оговорка, что и у ставки за доставку.
    */
    const router = read("api/commission-router.ts");
    expect(router).toContain("input.courierPayMode === undefined ? {} :");
  });
});

/*
  ── Курьеры в списке для руководителя ───────────────────────────────────────

  В «KPI агентов» курьеров не было вовсе: руководитель видел четверых агентов и
  ни одного из тех, кто возит. Дописать их строками в агентскую таблицу нельзя —
  там заказы, выручка, визиты и оценка по визитам, а у курьера ничего этого нет:
  вышло бы четыре нуля и «F» на человеке, который весь месяц работал. Ту же
  ошибку уже исправляли на его собственном экране.
*/
describe("курьеры видны руководителю", () => {
  const list = SERVICE.slice(
    SERVICE.indexOf("export async function getCourierList"),
    SERVICE.indexOf("export interface AgentListEntry"),
  );

  it("список есть и открыт тем же, кому список агентов", () => {
    expect(KPI).toContain("courierList: managementQuery");
    expect(rolesOf(kindOf("courierList"))).toEqual(rolesOf(kindOf("agentList")));
  });

  it("считается двумя запросами, а не по человеку в цикле", () => {
    /*
      calculateCourierStats делает три обращения к базе на человека. Позвать её
      по очереди было бы короче и дороже втрое: у арендатора с десятью
      курьерами это тридцать запросов на открытие экрана.
    */
    // Ищем ВЫЗОВ, а не упоминание: на поштучный расчёт ссылается комментарий
    // о том, откуда взято правило счёта, и запрет на слово ломался бы об него.
    expect(list, "список считает курьеров поштучно").not.toMatch(/await calculateCourierStats\(/);
    expect((list.match(/\.groupBy\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("берёт только действующих курьеров своей организации", () => {
    expect(list).toContain('eq(users.role, "courier")');
    expect(list).toContain('eq(users.status, "active")');
    expect(list).toContain("eq(users.tenantId, tenantId)");
  });

  it("доставки считаются по дате доставки, а не создания заказа", () => {
    // То же правило, что и в расчёте зарплаты: заказ конца месяца мог доехать
    // в начале следующего.
    expect(list).toContain("COALESCE(${orders.deliveredAt}, ${orders.createdAt})");
  });

  it("курьер без заявок не получает ноль процентов успеха", () => {
    /*
      Ноль назначенных — «мерить нечего», а не «ноль процентов». Красный ноль
      на курьере, которому не давали заявок, обвиняет его в чужом решении.
    */
    expect(list).toContain("assigned === 0 ? 0 :");
    const page = read("src/pages/AgentKpi.tsx");
    expect(page).toContain('assigned === 0 ? "—"');
  });

  it("у курьеров своя таблица и свои плитки", () => {
    const page = read("src/pages/AgentKpi.tsx");
    expect(page).toContain("CourierTable");
    expect(page).toContain('tab === "couriers"');
    // Агентские плитки курьеру не показываются: у него нет ни выручки, ни визитов.
    expect(page).toMatch(/tab === "couriers" \? \(/);
  });
});

/*
  ── Оценка без данных ───────────────────────────────────────────────────────

  У арендатора все четыре строки горели красным: 18·F, 25·F, 15·F, 48·D. Ни у
  кого нет ни визитов, ни планов, у двоих нет и заказов — балл считался от нулей
  и выходил приговором работе, которой не было.
*/
describe("балл не выносят приговор без данных", () => {
  const page = read("src/pages/AgentKpi.tsx");

  it("нет заказов и нет планов — вместо оценки сказано «нет данных»", () => {
    expect(page).toContain("a.orderCount > 0 || a.totalPlans > 0");
    expect(page).toContain("нет данных");
  });

  it("«0/0» визитов заменено прочерком", () => {
    // Ноль из нуля — не результат, а отсутствие плана: визитов не назначали,
    // и сравнивать не с чем.
    expect(page).toContain('a.totalPlans > 0 ? `${a.visitedPlans}/${a.totalPlans}` : "—"');
  });
});

/*
  ── Разбор по одному курьеру ────────────────────────────────────────────────

  Строка курьера в списке была немой: посмотреть человека отдельно было нечем,
  тогда как у агента разбор открывался кликом с самого начала.
*/
describe("курьера можно разобрать отдельно", () => {
  const page = read("src/pages/AgentKpi.tsx");

  it("ручка отдаёт всё для карточки одним запросом", () => {
    // Три отдельных запроса на один клик — три ожидания вместо одного.
    expect(KPI).toContain("courierDetail: managementQuery");
    const at = KPI.indexOf("courierDetail: managementQuery");
    const body = KPI.slice(at, KPI.indexOf("agentDetail:", at));
    expect(body).toContain("calculateCourierStats");
    expect(body).toContain("calculateSalary");
    expect(body).toContain("getCourierDaily");
  });

  it("просмотр чужой карточки ничего не записывает", () => {
    /*
      calculateSalary умеет писать строку комиссии. Руководитель только
      смотрит, и просмотр не должен менять чужие данные — persist = false
      передан явно, а не оставлен на умолчание.
    */
    const at = KPI.indexOf("courierDetail: managementQuery");
    const body = KPI.slice(at, KPI.indexOf("agentDetail:", at));
    expect(body).toMatch(/calculateSalary\([^)]*undefined,\s*false\)/);
  });

  it("чужого сотрудника и не-курьера отдаёт отказом, а не пустой карточкой", () => {
    // Пустая карточка читается как «ничего не возил» — это неправда.
    const at = KPI.indexOf("courierDetail: managementQuery");
    const body = KPI.slice(at, KPI.indexOf("agentDetail:", at));
    expect(body).toContain('eq(users.tenantId, ctx.tenant.id)');
    expect(body).toContain('who.role !== "courier"');
    expect(body).toContain("NOT_FOUND");
  });

  it("строка кликается и открывается с клавиатуры", () => {
    expect(page).toContain("onSelect(c.courierId)");
    expect(page).toContain('e.key === "Enter" || e.key === " "');
  });

  it("показатели курьеру и руководителю рисует один и тот же вид", () => {
    // Два разных вида одних и тех же чисел разошлись бы через месяц.
    expect(page).toContain("<CourierKpiView stats={courierDetail.stats}");
  });

  it("график по дням есть", () => {
    /*
      «Тридцать довезено за месяц» не отвечает, работал человек ровно или закрыл
      всё за три дня. Одним числом это не сказать.
    */
    expect(page).toContain("CourierDaysChart");
    const chart = read("src/components/kpi/CourierDaysChart.tsx");
    // Оси — прямыми детьми: обёртка над ними молча убивает подписи.
    expect(chart).toMatch(/<BarChart[\s\S]{0,400}<XAxis/);
    expect(chart).toMatch(/<XAxis[\s\S]{0,400}<YAxis/);
  });
});

/*
  ── Довезённое считается по факту, а не по отметке в приложении ─────────────

  delivery_status заполняет только курьерское приложение. Заказ при этом
  закрывают и из веба: оператор жмёт «Выполнить», проводит оплату или частичную
  доставку — и там пишется orders.status = 'delivered', а delivery_status
  остаётся прежним.

  У арендатора так и вышло: курьер отработал, на дашборде пять доставленных
  заказов, а в его KPI и зарплате стояли нули. Мерили не работу, а то, через
  какой экран её отметили.
*/
describe("курьеру засчитывают доставленный заказ", () => {
  /*
    Срез до СЛЕДУЮЩЕЙ функции, а не до конца курьерского блока.

    Сначала здесь стояло «до AgentListEntry» — и в кусок попадали все три
    функции сразу: показатели, список и разбивка по дням. Сломай счёт в одной,
    строка нашлась бы в двух других, и проверка осталась бы зелёной. Проверено
    поломкой: так и было.
  */
  const stats = SERVICE.slice(
    SERVICE.indexOf("export async function calculateCourierStats"),
    SERVICE.indexOf("export async function getCourierDaily"),
  );

  it("довезённое берётся из статуса заказа", () => {
    expect(stats).toContain("${orders.status} = 'delivered' THEN 1 ELSE 0 END");
  });

  it("сумма довезённого — оттуда же", () => {
    // Иначе число доставок и деньги за них считались бы по разным правилам, и
    // «5 довезено на 0 сум» выглядело бы поломкой расчёта.
    expect(stats).toContain("${orders.status} = 'delivered' THEN CAST(${orders.total}");
  });

  it("список и разбивка по дням считают так же", () => {
    /*
      Три места считают одно и то же, и разойтись им нельзя: у руководителя в
      списке одно число, в карточке другое, а на графике третье — и не понять,
      какому верить.
    */
    const list = SERVICE.slice(
      SERVICE.indexOf("export async function getCourierList"),
      SERVICE.indexOf("export interface AgentListEntry"),
    );
    const daily = SERVICE.slice(
      SERVICE.indexOf("export async function getCourierDaily"),
      SERVICE.indexOf("export interface CourierListEntry"),
    );
    expect(list).toContain("${orders.status} = 'delivered' THEN 1 ELSE 0 END");
    expect(daily).toContain("${orders.status} = 'delivered' THEN 1 ELSE 0 END");
  });

  it("сорванное остаётся по отметке курьера", () => {
    /*
      «Магазин закрыт», «не дозвонились», «отказ» отмечает именно курьер в
      приложении — другого источника у этого нет, и статус заказа при срыве
      возвращается в «новый».
    */
    expect(stats).toContain("${orders.deliveryStatus} = 'failed'");
  });
});

describe("веб-закрытие оставляет след доставки", () => {
  const order = read("api/services/order.ts");

  it("смена статуса на «доставлен» ставит отметку и дату", () => {
    /*
      Считать мы умеем и без этого, но без delivered_at период доставки
      определяется по дате СОЗДАНИЯ заказа: доставка конца месяца попадает не в
      тот месяц, за который курьеру платят.
    */
    expect(order).toContain('newStatus === "delivered"');
    expect(order).toContain('deliveryStatus: "delivered" as const, deliveredAt: new Date()');
  });

  it("выполнение с оплатой — тоже", () => {
    const at = order.indexOf("// Update order status — goods were delivered");
    expect(order.slice(at, at + 500)).toContain('deliveryStatus: "delivered"');
  });

  it("частичная доставка — тоже доставка", () => {
    // Товар довезли, часть вернулась: работа курьера сделана.
    const at = order.indexOf("subtotal: newSubtotal.toFixed(2)");
    expect(order.slice(at, at + 400)).toContain('deliveryStatus: "delivered"');
  });
});
