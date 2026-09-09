import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Курьера цепляют к рейсу, а не к каждому заказу.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Погрузочный лист — это и есть рейс: заказы, собранные вместе, чтобы их отвёз
 * один человек. Курьер при этом назначался НЕ на лист, а на каждый заказ по
 * отдельности — по одному, из карточки или галочками в списке. Собрать лист из
 * двадцати заказов и потом двадцать раз указать одного и того же курьера —
 * работа ни для кого, и половина заказов оставалась без курьера, потому что на
 * середине списка человек сбивался.
 *
 * Вторая нелепость: назначить курьера можно было только пока заказ «новый» или
 * «в обработке». Но заказы собирают в лист, статус становится «отгружен», и
 * ровно в этот момент их отдают курьеру — а поле уже исчезло. При этом рядом
 * массовое назначение с самого начала работало по всем открытым статусам: один
 * и тот же заказ можно было отдать галочкой в списке и нельзя — из его карточки.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const SERVICE = read("api/services/order.ts");
const ASSIGN = SERVICE.slice(
  SERVICE.indexOf("async assignCourierToList"),
  SERVICE.indexOf("async updateLoadingListStatus"),
);

describe("рейс отдают одним действием", () => {
  it("курьер проставляется и листу, и его заказам", () => {
    expect(ASSIGN).toContain("update(loadingLists).set({ courierId })");
    expect(ASSIGN).toContain('set({ courierId, deliveryStatus: "assigned" })');
  });

  it("трогает только открытые заказы", () => {
    /*
      Доставленный из этого же листа уже доехал. Переписать ему курьера значило
      бы задним числом изменить то, по чему уже посчитана зарплата.
    */
    expect(ASSIGN).toContain("inArray(orders.status, OPEN_ORDER_STATUSES)");
  });

  it("курьер — свой, действующий и правда курьер", () => {
    // Число из запроса на веру брать нельзя: рейс уедет на чужого сотрудника,
    // на уволенного или на агента.
    expect(ASSIGN).toContain("eq(users.tenantId, tenantId)");
    expect(ASSIGN).toContain('eq(users.role, "courier")');
    expect(ASSIGN).toContain('eq(users.status, "active")');
  });

  it("отвечает, сколько заказов реально досталось курьеру", () => {
    /*
      «Назначено 18 из 20» — сразу видно, что два заказа уже закрыты. Ответ
      «готово» на том же месте скрыл бы это до первого спора с курьером.
    */
    expect(ASSIGN).toContain("assigned");
    expect(ASSIGN).toContain("total: orderIds.length");
  });
});

describe("одно правило: пока заказ открыт", () => {
  it("поштучное назначение больше не требует «новый»", () => {
    const courier = read("api/courier-router.ts");
    expect(courier).not.toContain("только на заказ в статусе 'новый' или 'в обработке'");
    expect(courier).toContain("OPEN_ORDER_STATUSES.includes(order.status");
  });

  it("экран заказа показывает выбор по тому же правилу", () => {
    /*
      Иначе поле исчезало после сборки листа — ровно тогда, когда курьера и
      назначают.
    */
    const slide = read("src/components/orders/OrderSlideOver.tsx");
    expect(slide).toContain("OPEN_STATUSES.includes(order.status)");
    expect(slide).not.toContain('order.status === "new" || order.status === "processing"');
  });
});

describe("видно, кто везёт", () => {
  it("список рейсов отдаёт курьера", () => {
    // Раньше ответить «кто повезёт этот лист» можно было, только открыв все
    // его заказы по очереди.
    expect(SERVICE).toContain("courierId: loadingLists.courierId");
    expect(SERVICE).toContain("courierName: courierUser.name");
  });

  it("имя курьера берётся отдельным соединением", () => {
    /*
      Лист соединяется с users дважды: раз за агентом, раз за курьером. Без
      псевдонима второе соединение перетирает первое, и в «агенте» оказывается
      курьер.
    */
    expect(SERVICE).toContain('const courierUser = alias(users, "courier_user")');
    // Связь плюс проверка организации в самом ON — как у всех соединений с
    // таблицами арендатора после аудита безопасности.
    expect(SERVICE).toContain("leftJoin(courierUser, and(eq(loadingLists.courierId, courierUser.id), eq(courierUser.tenantId, tenantId)))");
  });

  it("выбор стоит в самом списке рейсов", () => {
    // Уходить за курьером на другой экран и возвращаться — то же самое, что не
    // выбирать.
    const modal = read("src/components/orders/LoadingListsModal.tsx");
    expect(modal).toContain("assignCourierToList");
    expect(modal).toContain("Кому отдать рейс");
  });
});
