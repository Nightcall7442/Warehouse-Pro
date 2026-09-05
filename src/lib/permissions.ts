/**
 * Что роли разрешено сделать — в тех же границах, что и на сервере.
 *
 * Экран не должен обещать того, чего сервер не даст. Проверка там и остаётся:
 * здесь — только про то, рисовать кнопку или нет. Без этого супервайзер видел
 * «Добавить», «Очистить», «В работу» и получал отказ на каждое нажатие.
 *
 * Границы повторяют виды процедур из api/middleware.ts, и повторяют
 * НАМЕРЕННО: фронтенд не может спросить сервер, кому что можно. Чтобы копия не
 * разошлась с оригиналом, роли сверяются тестом
 * (src/__tests__/read-only-roles.test.ts) прямо с middleware.ts.
 */

/** operatorQuery: заводить и править магазины, заказы, склад. */
export function canOperate(role: string | undefined): boolean {
  return role === "ceo" || role === "operator";
}

/** adminQuery: пользователи, реквизиты организации, брендинг, склады. */
export function canAdminister(role: string | undefined): boolean {
  return role === "ceo";
}

/** supervisorQuery: территории, планы визитов, слежение за агентами. */
export function canSupervise(role: string | undefined): boolean {
  return role === "ceo" || role === "supervisor";
}
