# Категория 1 аудита — деньги, остатки, количества

Отложено 2026-08-06: вернуться к списку и починить только важное.
Найдено 68, из них проверено запуском 47.
По важности: блокеров 2, критичных 11, high 25, medium 21, low 9.

Часть находок описана двумя агентами независимо (например restore() и
PaymentService.addPayment) — при разборе это одна проблема, а не две.

---

## BLOCKER

### reports.getAgentPerformance multiplies each agent's revenue by their number of visits (JOIN fan-out)

**Где:** `api/reports-router.ts:117` • **проверено запуском:** да

**Что происходит.** users LEFT JOIN daily_plans LEFT JOIN orders produces visits×orders rows per agent. `visits` and `orders` are counted with COUNT(DISTINCT ...), but `revenue: COALESCE(SUM(orders.total), 0)` is a plain SUM over the fanned-out row set, so every order total is added once per joined daily_plans row.

**Что это значит на практике.** An agent with 22 visited plans and 5 real orders worth 13 221 250 сум is shown as 290 867 500 сум — 22× inflated. This is the Top-10 agents table on the Reports page; it is also the number an exported report carries. Nothing on the page says the figure is wrong, and it scales with how diligently the agent logs visits, so the hardest-working agent looks the most inflated.

**Как воспроизвести.** One agent, N visited daily_plans rows in the window, M orders. Call reports.getAgentPerformance — revenue comes back N× the true sum. api/__tests__/analytics-business.test.ts only asserts `orderCount` is defined and its fixtures give each agent one plan, so the test passes either way.

**Предлагаемое решение.** Compute revenue in its own query grouped by agent (as analytics.cogsSummary already does for the identical reason — see its 'P0-10 FIX' comment), or use SUM(DISTINCT) semantics via a correlated subquery.

**Чем подтверждено.** Ran the exact query shape against node:sqlite with 1 agent, 22 visited plans and 5 orders. Printed: real revenue 13 221 250, endpoint revenue 290 867 500, inflation factor 22 = number of joined daily_plans rows. JOIN fan-out is ANSI semantics, identical in MySQL. Script: C:\Users\pc\AppData\Local\Temp\claude\C--Users-pc--claude\de3e9dba-cf1d-4560-819e-01a3b36c49a6\scratchpad\__money_proof.mjs (block P1).

### analytics.agentEfficiency has the same visits×orders fan-out on SUM(orders.total)

**Где:** `api/analytics-router.ts:202` • **проверено запуском:** да

**Что происходит.** users LEFT JOIN dailyPlans LEFT JOIN orders, then `revenue: COALESCE(SUM(orders.total), 0)` and ORDER BY that same SUM. Here dailyPlans is joined with no status filter at all, so every planned visit (not just visited ones) multiplies the revenue. `avgOrderValue: AVG(orders.total)` survives — averaging duplicated values gives the same average — which is exactly what makes this hard to spot: two columns on the same row, one right and one wrong.

**Что это значит на практике.** Agent-efficiency revenue is inflated by the agent's plan count for the window (typically 20-150× over 30 days), and the leaderboard ordering is by plan count rather than by money. conversionRate at line 225 is computed from the DISTINCT counts so it stays correct, further disguising the bad revenue column.

**Как воспроизвести.** Any agent with more than one daily_plans row in the last `days` window and at least one delivered order.

**Предлагаемое решение.** Split the revenue/AVG aggregate into a separate per-agent query and join the scalar results, or drop the dailyPlans join and get visits from a correlated subquery.

**Чем подтверждено.** Same mechanism and same proof as reports.getAgentPerformance (P1 in the proof script) — identical three-table LEFT JOIN with a non-distinct SUM of the money column. Read both queries in full; the only difference is that agentEfficiency does not filter dailyPlans.status, which makes the multiplier larger.

---

## CRITICAL

### Флаг courierAlreadySettled «залипает»: после отката статуса товар списывается со склада только на бумаге

**Где:** `api/services/order.ts:870` • **проверено запуском:** да

**Что происходит.** updateStatus вычисляет courierAlreadySettled = order.deliveryStatus === 'delivered' && deductsStock(newStatus) (строка 870) и при true пропускает ВЕСЬ блок движения остатка (условие на строке 872). Но deliveryStatus никогда не сбрасывается обратно: courier-router.ts:192 и :484 ставят 'delivered' навсегда, единственный сброс — переназначение курьера (order-router.ts:391 / courier-router.ts:99). Поэтому флаг перестаёт означать «эта конкретная доставка уже проведена» и начинает означать «любой переход в delivered для этого заказа навсегда бесплатный».

**Что это значит на практике.** Склад продолжает считать своими товары, которые физически уехали в магазин, а резерв остаётся висеть навсегда. Ни одна из трёх колонок не рассинхронизирована (C−R=A сохраняется), поэтому ни один инвариант-чек это не заметит — просто все три числа завышены. Ни одна запись в stock_movements не создаётся, так что расхождение не видно и в истории движений.

**Как воспроизвести.** node <scratchpad>/stock-repro.mjs, секции «### A» и «### A2». Скрипт печатает состояние строки после каждого шага.

**Предлагаемое решение.** Не решать по deliveryStatus. Либо сбрасывать deliveryStatus при откате статуса заказа из delivered, либо (надёжнее) вести признак «остаток по этому заказу уже списан» отдельным полем/фактом, которое обновляется тем же кодом, что двигает current_stock, и учитывать его в stockEffect(order.status), а не как отдельный обход блока.

**Чем подтверждено.** Проигрышка точных UPDATE из исходников в node:sqlite (все эти UPDATE читают только до-присваивательные значения колонок, поэтому семантика MySQL и SQLite совпадает). Сценарий A: старт C=100 R=0 A=100 → создание заказа на 10 → C=100 R=10 A=90 → courier markDelivered → C=90 R=0 A=90 → оператор откатывает delivered→new → C=100 R=10 A=90 (корректно) → оператор возвращает new→delivered → блок пропущен, НАПЕЧАТАНО C=100 R=10 A=90 вместо ожидаемых C=90 R=0 A=90. Сценарий A2 (более вероятный): курьер завершает completeDelivery с result='returned' (courier-router.ts:479/484 ставит status='returned' И deliveryStatus='delivered', резерв освобождается) → оператор исправляет returned→delivered → блок пропущен, НАПЕЧАТАНО C=100 R=0 A=100 вместо C=90 R=0 A=90: 10 единиц никогда не списались.

### cancel()/delete()/restore() освобождают сырое orderItems.quantity, игнорируя deliveredQuantity и проведённые возвраты — reserved уходит в минус, available превышает current_stock

**Где:** `api/services/order.ts:771` • **проверено запуском:** да

**Что происходит.** updateStatus аккуратно считает effectiveQty (строки 863-867) = deliveredQuantity ?? quantity, минус уже возвращённое по completed-возвратам. Но cancel() (строки 770-775), delete() (строки 1001-1006) и restore() (строки 1233-1246) берут Number(i.quantity) напрямую. Если заказ прошёл частичную доставку или частичный возврат, он держит в резерве меньше, чем orderItems.quantity, — и эти три пути отдают назад больше, чем взяли. Ни в cancel(), ни в delete() нет GREATEST-клампа, так что reserved просто уходит в отрицательные значения.

**Что это значит на практике.** Резерв, принадлежащий ДРУГИМ открытым заказам, молча аннулируется, а available становится больше физического current_stock. Система разрешит продать товар, которого нет: прямая пересортица/оверселл. C−R=A при этом сохраняется, поэтому проверка инварианта проходит.

**Как воспроизвести.** node <scratchpad>/stock-repro.mjs, секции «### B» и «### C».

**Предлагаемое решение.** Вынести effectiveQty из updateStatus в общий хелпер и использовать его во всех четырёх путях (cancel, delete, restore, updateStatus). Отдельно — привести клампы к одному виду: сейчас cancel/delete/updateStatus/restore без GREATEST, а applyStockDelta/partial-delivery/courier с ним.

**Чем подтверждено.** Проигрышка точных UPDATE в node:sqlite. Сценарий B: C=100 R=0 A=100 → заказ 10 → new→delivered (effectiveQty=10) C=90 R=0 A=90 → проведён документ возврата на 4 C=94 R=0 A=94 → оператор откатывает delivered→new (effectiveQty=10−4=6) C=100 R=6 A=94 (корректно, держится 6) → cancel() освобождает 10: НАПЕЧАТАНО C=100 R=-4 A=104 — reserved отрицательный, available на 4 больше физического остатка. Сценарий C то же самое через recordPartialDelivery (доставлено 6 из 10) и delete(): НАПЕЧАТАНО C=100 R=-4 A=104. Достижимость проверена по коду: cancel() требует status='new' (order.ts:755), а переход delivered→new разрешён явно (комментарий order.ts:812-815, схема ввода order-router.ts:266 принимает любой статус).

### returns.updateStatus: approved→completed is checked outside the transaction and the UPDATE has no status guard — two overlapping calls credit the same returned goods twice

**Где:** `api/returns-router.ts:216` • **проверено запуском:** да

**Что происходит.** The transition check reads `returns.status` at line 216 through the OUTER `db`, outside any transaction and with no lock. The transaction that actually credits stock only starts at line 252, and the `UPDATE returns SET status` at line 292 has NO `status = 'approved'` condition in its WHERE. So two requests both read status='approved', both enter the transaction, both run the additive `UPDATE warehouse_stock SET current_stock = current_stock + qty, available = available + qty` at line 269, and both write status='completed'. Note the `.for("update")` at line 263 is a real lock but it locks warehouse_stock, not the `returns` row, and the decision was already made before the transaction opened — the lock cannot undo it.

**Что это значит на практике.** Inventory is created out of nothing. A 10-unit return against a 100-unit shelf leaves current_stock=120 and available=120. Nothing errors, nothing is logged as suspicious, and two `stock_movements` rows of type 'in' make the ledger agree with the corrupted figure. The warehouse then oversells 10 units it does not have, and the physical recount silently disagrees with the system. Trigger is a double-click on «Завершить» or any client retry — no unusual conditions needed.

**Как воспроизвести.** npx vitest run api/__tests__/zz-concurrency-audit.test.ts --reporter=verbose --silent=false  (see EVIDENCE 2)

**Предлагаемое решение.** Move the whole read-decide-write into the transaction: `SELECT ... FROM returns WHERE id=? FOR UPDATE` as the FIRST statement inside `db.transaction`, re-check `status === 'approved'` there, and add `eq(returns.status, 'approved')` to the WHERE of the status UPDATE with an `affectedRows !== 1` throw — the same shape arrival-router.ts:218-305 already uses correctly. The linked-order cancelled/returned check at line 226 must move inside the same transaction too, for the same reason.

**Чем подтверждено.** RAN it. Wrote api/__tests__/zz-concurrency-audit.test.ts, EVIDENCE 2. The harness models MySQL row locking in the STRONGEST possible way — `db.transaction()` takes a global mutex, so no two transactions ever overlap (the log printed `TX-START -> TX-COMMIT -> TX-START -> TX-COMMIT`). Output:
  [returns] outcomes: [ 'fulfilled', 'fulfilled' ]
  [returns] stock after (a 10-unit return against a 100-unit shelf): {"currentStock":"120.00","reserved":"0.00","available":"120.00"}
Because the transactions were fully serialized and it still doubled, no amount of row locking inside the transaction can fix this — the flaw is the unlocked read at line 216.

### 1C /payment webhook: the idempotency check runs outside the transaction and `payments` has no unique constraint — a retried webhook records the payment twice and silently forgives real debt

**Где:** `api/webhooks/onec.ts:72` • **проверено запуском:** нет

**Что происходит.** The duplicate-reference check at line 72 uses the outer `db`, outside the transaction that starts at line 80, with no lock and no unique index behind it. Two deliveries of the same 1C payment (the normal webhook failure mode — retry on timeout/5xx) both find no existing row and both insert. The `.for("update")` on `shops` at line 86 does serialize the two transactions, but both have already decided to insert, so it changes nothing. I checked db/schema.ts for a backstop: the only unique indexes in the file are on tenants.slug, users(email,tenantId), products(code,tenantId), orders(orderNumber,tenantId), orders(idempotencyKey,tenantId), warehouse_stock(product,warehouse,tenant), arrivals, schedules, agent_territories, subscriptions.tenantId, billing_events.stripeEventId, tokens, onec mappings, api keys and loading lists. There is NO unique index on `payments` at all — not on notes, not on any reference column.

**Что это значит на практике.** Two payment rows for one real payment. `recalcShopDebt` (services/shop-debt.ts:70-73) sums `payments WHERE type='payment' AND order_id IS NULL` and SUBTRACTS it from what the shop owes, so the shop's debt drops by twice the money actually received. Real receivable disappears from the debtor list with no error and no anomaly on any screen. Contrast: `orders.create` handles exactly this race correctly (services/order.ts:682-694 catches ER_DUP_ENTRY against the `uq_orders_idempotency` index) and the Stripe webhook is protected by `billing_events.stripeEventId` being unique — payments got neither.

**Как воспроизвести.** POST the same {tenantId, shopExternalId, amount, reference} to /webhooks/onec/payment twice concurrently. Expected today: two rows in `payments`, shops.debt lower by 2×amount.

**Предлагаемое решение.** Add a unique index on (tenantId, external reference) for payments — a dedicated `external_ref` column rather than matching on the free-text `notes` — and catch ER_DUP_ENTRY as a duplicate, exactly as OrderService.create does. Moving the check inside the transaction is not sufficient on its own: without a unique index two transactions can still both read 'not present' before either inserts.

**Чем подтверждено.** NOT executed — reproducing it needs the hono handler plus signature middleware, which I judged too much plumbing for the remaining budget. What IS verified by reading: the dedup SELECT is on `db` not `tx` and sits before `db.transaction` (onec.ts:71-78 vs :80); and the absence of any unique index on `payments` (grepped every `unique`/`uniqueIndex` in db/schema.ts — 20 hits, none on payments). Требует проверки только сам прогон двух параллельных вебхуков; структурные факты подтверждены.

### calculateSalary переписывает прошломесячную запись комиссии в текущий месяц — история и деньги за месяц исчезают

**Где:** `api/services/kpi.ts:368` • **проверено запуском:** да

**Что происходит.** Запись комиссии выбирается БЕЗ фильтра по периоду: `.where(tenantId, userId, periodType='monthly').orderBy(desc(periodStart)).limit(1)` — берётся просто самая свежая строка агента. Затем блок persist (строки 448-462) делает UPDATE этой же строки, подставляя periodStart/periodEnd/salesAmount/commissionAmount ТЕКУЩЕГО периода. Новая строка на новый месяц не создаётся никогда, пока существует хоть одна.

**Что это значит на практике.** 1 августа агент (или супервайзер через salaryReport) открывает экран зарплаты — и июльская строка со статусом pending и комиссией 2 500 000 превращается в августовскую со свежими (почти нулевыми) числами. Июльская комиссия уничтожена молча: в таблице commissions по агенту физически не может быть больше одной строки, история выплат не существует. Если бухгалтерия платит по этой таблице — агент за июль не получит ничего, и восстановить сумму нечем. Это происходит от обычного GET-запроса экрана, никакой мутации не требуется.

**Как воспроизвести.** npx vitest run api/__tests__/_audit-commission-evidence.test.ts --silent=false → кейс "A. rewrites LAST month's pending commission row into the new month". В проде: агент с pending-комиссией за прошлый месяц открывает вкладку "Зарплата" 1-го числа.

**Предлагаемое решение.** Искать/создавать строку по ключу (userId, periodType, periodStart = начало запрошенного периода), а не "последнюю". UPDATE не должен трогать periodStart/periodEnd вообще.

**Чем подтверждено.** Прогнал api/__tests__/_audit-commission-evidence.test.ts (кейс A) на движке-двойнике, где update(...).where(...) реально соблюдает условие, а orderBy(desc) реально сортирует. Вывод: до вызова строка {periodStart:'2026-07-01', salesAmount:'50000000.00', commissionAmount:'2500000.00', status:'pending'}, после одного вызова calculateSalary за 1-6 августа — {periodStart:'2026-08-01', periodEnd:'2026-08-06', salesAmount:'1000000.00', commissionAmount:'50000.00'}. Строк в таблице по-прежнему одна, INSERT не выполнялся.

### После первой approved/paid комиссии новые месячные записи не создаются никогда — начисление молча прекращается

**Где:** `api/services/kpi.ts:448` • **проверено запуском:** да

**Что происходит.** `if (persist && (!commissionRecord || commissionRecord.status === 'pending'))` — ветка INSERT (строка 463, `else if (commissionRate > 0)`) срабатывает только когда записи НЕТ вообще. Как только единственная строка агента получает статус approved или paid, commissionRecord всегда найден, ветка UPDATE выбирается, а её WHERE содержит `eq(status,'pending')` → 0 affected rows. Тихий no-op.

**Что это значит на практике.** Нормальный конец первого расчётного месяца ("утвердили и выплатили") навсегда выключает учёт комиссий этого агента. commission.list показывает бухгалтеру только старую выплаченную строку; commission.calculate за новый месяц не находит строк и возвращает updated:0. Экран зарплаты продолжает показывать агенту живые числа, но в БД для выплаты нет ничего. Восстановить может только оператор, руками заново нажав setRate каждому агенту каждый месяц.

**Как воспроизвести.** npx vitest run api/__tests__/_audit-commission-evidence.test.ts --silent=false → кейс "B. once a row is approved/paid, NO row is ever created for later months".

**Предлагаемое решение.** Разделить поиск "строка за ЭТОТ период" и создание: если строки за текущий период нет — INSERT, независимо от статуса строк за прошлые периоды.

**Чем подтверждено.** Кейс B того же файла-доказательства: строка июля со статусом paid, заказ на 1 000 000 в августе. calculateSalary вернул агенту {sales: 1000000, commission: 50000}, а в таблице осталась ровно одна строка {p:'2026-07-01', s:'50000000.00', st:'paid'}, счётчик выполненных INSERT — 0.

### PaymentService.addPayment has no idempotency of any kind — a retried payment is recorded twice and shop debt drops twice

**Где:** `api/services/payment.ts:42` • **проверено запуском:** да

**Что происходит.** addPayment locks the shop row FOR UPDATE (line 28-32), then unconditionally INSERTs a payments row and calls recalcShopDebt. The FOR UPDATE only serializes the two calls; it does not deduplicate them. There is no idempotency key, no dedup window, no amount ceiling (the overpayment check at line 38-40 is an empty if-block that explicitly does nothing). payments has no unique index that could stop a duplicate (db/schema.ts:479-503). recalcShopDebt subtracts SUM(amount) over all order_id IS NULL payment rows (api/services/shop-debt.ts:70-73), so two rows subtract twice and the derived balance never self-corrects.

**Что это значит на практике.** A shop that paid 300 000 sum once has 600 000 taken off its debt. The shop is under-billed by the duplicated amount, permanently and silently — every debtor report, invoice and collection decision downstream uses shops.debt. Same code path serves type:'debt' (OrderSlideOver 'новый долг'), so a duplicated debt entry over-bills instead. Reachable from ShopDetail.tsx:92 and OrderSlideOver submitDebt. The web UI disables the button while isPending, which stops one client's double-tap but not: a request that times out after the server committed and the operator retries, two browser tabs, or two operators on the same shop. The 1C webhook path (api/webhooks/onec.ts:71-78) does have a dedup check, so the pattern is known and just missing here.

**Как воспроизвести.** Shop with debt 1000. Call shop.addPayment({shopId, amount:'300.00', type:'payment'}) twice (double-tap across two tabs, or retry after a 15s mobile timeout). payments gets two rows of 300.00; shops.debt = 400.00.

**Предлагаемое решение.** Not fixing this pass. Options for the next one: accept a client-supplied idempotencyKey on payments (same pattern as orders.idempotencyKey + unique index + ER_DUP_ENTRY recovery in OrderService.create), or a unique index on (tenant_id, shop_id, amount, created_by, minute-bucket).

**Чем подтверждено.** Ran the real PaymentService.addPayment twice against a fake db that stores rows and applies the documented recalcShopDebt rule (helpers/shop-debt-recalc.ts, the in-memory twin the repo already maintains). Printed: `[A] payment rows=2  debt after 1st=700.00  after 2nd=400.00` — starting debt 1000.00, single payment of 300.00 submitted twice, debt ended at 400.00 instead of 700.00.

### analytics.pnl monthly trend and pnlByPaymentMethod multiply revenue by the number of order line items

**Где:** `api/analytics-router.ts:319` • **проверено запуском:** да

**Что происходит.** Both queries join orders → order_items (needed only for the COGS sum) and then take `revenue: COALESCE(SUM(orders.total), 0)` over that fanned-out row set. In the monthly trend `orderCount` is COUNT(DISTINCT orders.id) — correct — while revenue is not. In pnlByPaymentMethod (line 404) both revenue and `orderCount: count(*)` are inflated. calcPeriod (line 256) does NOT join order_items, so the KPI cards at the top of the P&L page are correct while the trend chart below them is inflated.

**Что это значит на практике.** On the same P&L screen the header says 5 520 500 and the monthly chart says 29 673 500. grossProfit = revenue − cogs and grossMarginPct are derived from the inflated number, so the margin shown for every month and every payment method is fiction. A CEO reading margin by payment method to decide whether to keep selling on credit is reading noise.

**Как воспроизвести.** Any order with more than one line item in the P&L window. The inflation factor is the average basket size.

**Предлагаемое решение.** Query revenue/orderCount from `orders` alone and COGS from `order_items` alone, then merge by month / payment method in JS — the pattern cogsSummary already uses.

**Чем подтверждено.** Ran the query shape in node:sqlite with 3 orders (4, 7 and 1 line items). Printed: real revenue 5 520 500; cash row 28 803 500 (= 1 250 000×4 + 3 400 500×7), debt row 870 000, reported total 29 673 500; orderCount reported 11 for 2 cash orders. Script block P2.

### Soft-deleted orders are still counted as revenue by every analytics, reports, sales-target, forecast and quota query

**Где:** `api/analytics-router.ts:19` • **проверено запуском:** да

**Что происходит.** OrderService.delete sets deleted_at, releases the stock reservation and re-derives shops.debt without the order. But `isNull(orders.deletedAt)` appears 0 times in analytics-router.ts, reports-router.ts, sales-target-router.ts, kpi-router.ts, forecast-router.ts, warehouse-reports-router.ts and services/quota-suggest.ts, while dashboard-router.ts (11 refs), order-router.ts, commission-router.ts and services/kpi.ts do filter it. Affected money queries: salesByShop, topProducts, agentPerformance, cogsByProduct, cogsSummary, shopRevenueTrend, agentEfficiency, pnl (both periods and the trend), pnlByPaymentMethod, agentProductSales, paymentMethodTrend, reports.getDashboardSummary revenueMonth, reports.getVisitChart revenue, sales-target recalcActuals actualAmount.

**Что это значит на практике.** An operator deletes a mis-entered 9 000 000 сум order. It disappears from the orders list, from the Dashboard KPI and from the shop's debt — and stays in the P&L, in sales-by-shop, in the agent's quota progress and in the demand forecast forever. Two revenue numbers in the product now disagree permanently and neither screen says why. Deleting is the documented way to undo a mistake, so this fires on exactly the orders that should not count.

**Как воспроизвести.** Create and deliver an order, delete it, then open Reports → P&L and the Dashboard for the same day. The two revenue figures differ by the deleted order's total.

**Предлагаемое решение.** Add isNull(orders.deletedAt) to every revenue/COGS condition list in those seven files. Consider a shared `revenueOrderConditions(tenantId)` helper so it cannot be forgotten again.

**Чем подтверждено.** grep count of `deletedAt` per router (0 in analytics/reports/sales-target/kpi-router/forecast/warehouse-reports/quota-suggest, 11 in dashboard-router) plus a sqlite differential: 3 delivered orders, one soft-deleted — filtered sum 4 650 500 vs unfiltered 13 650 500. Script block P11.

### courier.completeDelivery: returnedQty ничем не ограничен — курьер может обнулить сумму заказа и испортить остатки

**Где:** `api/courier-router.ts:298` • **проверено запуском:** да

**Что происходит.** В zod-схеме `returnedItems: z.array(z.object({ itemId: z.number(), returnedQty: z.number() }))` — нет .min(0), нет .max, нет проверки против заказанного количества. На сервере (строки 417-452) считается `deliveredQty = qty - returnedQty` без единой проверки. returnedQty > qty даёт отрицательный deliveredQty; returnedQty < 0 даёт deliveredQty больше заказанного. Сравните: операторский путь имеет и `z.number().min(0)` в api/order-router.ts:550, и серверную проверку `if (deliveredQty > orderedQty) throw` в api/services/order.ts:304. В курьерском — ни того, ни другого.

**Что это значит на практике.** ЗАПУЩЕНО (PROBE G): заказ 10x100 + 5x200, subtotal 2000, скидка 10%, total 1800. Отправлено returnedQty=25 по строке 1 и returnedQty=-3 по строке 2 → orders.subtotal='100.00', discount='10.00', total='90.00'. Заказ на 1800 выставлен на 90. По складу: товар 2 current_stock 50→42 и available 45→42 — списано 8 единиц при заказанных 5, и 3 единицы available уничтожены из воздуха. order_items.deliveredQuantity записан как '-15'. ЗАПУЩЕНО (PROBE G2): returnedQty=25 по обеим строкам → orders.subtotal='-5500.00', orders.discount='-550.00', total='0.00'. Колонки DECIMAL(12,2) без unsigned, отрицательные значения сохраняются. Отрицательная скидка попадает в SUM(orders.discount) отчёта P&L (api/analytics-router.ts:126,258). Оператор видит доставленный заказ с итогом 90 сум (или 0) и отрицательным subtotal, долг магазина списан почти полностью. Роль courier — низкопривилегированная.

**Как воспроизвести.** npx vitest run api/__tests__/zz-audit-courier-probe.test.ts — PROBE G и PROBE G2

**Предлагаемое решение.** returnedQty: z.number().min(0) в схеме + серверная проверка `if (returnedQty > qty) throw` в цикле, зеркально order.ts:304.

**Чем подтверждено.** Пробник api/__tests__/zz-audit-courier-probe.test.ts вызывает настоящий courierRouter.completeDelivery через createCaller; SQL для warehouse_stock перехвачен и применён к фейковым строкам по фактическому тексту запроса. Печатает реальные записанные значения.

### Два пути доставки не знают друг о друге: current_stock списывается дважды, available становится больше current_stock

**Где:** `api/courier-router.ts:383` • **проверено запуском:** да

**Что происходит.** courier.completeDelivery с result 'paid'/'partial_paid' списывает `Number(item.quantity)` по всем строкам, игнорируя уже проставленный order_items.deliveredQuantity, и не проверяет order.status (в отличие от markDelivered, где на строке 175 стоит `if (order.status === 'delivered' ...) throw`). Проверяется только deliveryStatus IN ('assigned','out_for_delivery'), а applyPartialDelivery (api/services/order.ts:369-374) ставит status='delivered', но deliveryStatus не трогает. Зеркальная дыра: applyPartialDelivery (order.ts:275) отвергает только cancelled/returned, но не уже доставленный заказ. `GREATEST(0, reserved - qty)` в обоих местах маскирует повторное срабатывание — reserved не уходит в минус, а current_stock уходит.

**Что это значит на практике.** ЗАПУЩЕНО (PROBE J): оператор оформил частичную доставку (товар 1: current 94, reserved 0, available 94), затем курьер завершает тот же заказ как 'paid' → current_stock 94→84, available остаётся 94, reserved 0. Инвариант current_stock = available + reserved сломан: система разрешит продать 94 единицы, физически есть 84. ЗАПУЩЕНО (PROBE L): обратный порядок — заказ доставлен курьером (deliveredQuantity=null), затем вызывается order.recordDeliveryAndPayment → ошибки нет, current_stock 90→80 при available 90. Реальный сценарий для PROBE L: список заказов закеширован, курьер завершил заказ, оператор жмёт «Выполнен» на устаревшей строке (src/pages/Orders.tsx:560, защита `newStatus !== o.status` работает по кешу). Оператор ничего не видит — обе операции возвращают success. Недостача обнаружится только при инвентаризации.

**Как воспроизвести.** npx vitest run api/__tests__/zz-audit-courier-probe.test.ts (PROBE J) и npx vitest run api/services/__tests__/zz-audit-probe.test.ts (PROBE L)

**Предлагаемое решение.** В completeDelivery добавить проверку order.status как в markDelivered:175 и использовать deliveredQuantity, если оно уже проставлено; в applyPartialDelivery добавить отказ при status='delivered'.

**Чем подтверждено.** Оба пробника прогоняют настоящий код и моделируют UPDATE warehouse_stock по фактическому тексту SQL, включая GREATEST(0,...). Печатают current_stock/reserved/available до и после.

---

## HIGH

### Возврат можно провести по ещё ОТКРЫТОМУ заказу: склад получает несуществующий товар, а резерв застревает навсегда

**Где:** `api/returns-router.ts:226` • **проверено запуском:** да

**Что происходит.** Гард в returns-router.ts:226-237 запрещает проведение возврата только если связанный заказ уже cancelled/returned. Заказ в статусе new/processing/shipped/pending проходит свободно (returns.create тоже не проверяет статус, строки 123-167). Проведение делает current_stock += q и available += q, хотя товар со склада ещё не уезжал. Дальше effectiveQty в updateStatus (order.ts:863-867) вычитает уже возвращённое количество и обнуляется, из-за чего все последующие дельты умножаются на 0.

**Что это значит на практике.** Два повреждения сразу: (1) на складе появляется q единиц, которых физически нет; (2) резерв в q единиц становится неосвобождаемым — любой последующий переход статуса умножает дельту на effectiveQty=0, включая delivered→cancelled. Это ровно тот случай «заказ перестал держать товар, а резерв не вернули» из задания.

**Как воспроизвести.** node <scratchpad>/stock-repro.mjs, секция «### D».

**Предлагаемое решение.** Расширить гард на строке 226: проводить возврат можно только если связанный заказ находится в статусе, который уже списал товар (deductsStock), либо если возврат не привязан к заказу вовсе. Сейчас проверяется только «не cancelled/returned».

**Чем подтверждено.** Проигрышка UPDATE из returns-router.ts:269-281 и order.ts:904-918 в node:sqlite. Сценарий D: C=100 R=0 A=100 → заказ 10, статус new → C=100 R=10 A=90 → возврат на 10 проведён → НАПЕЧАТАНО C=110 R=10 A=100 (10 единиц из воздуха) → заказ переводится в delivered, effectiveQty=10−10=0 → НАПЕЧАТАНО C=110 R=10 A=100, ничего не изменилось. Ожидалось C=100 R=0 A=100.

### restore() не блокирует заказ и не перепроверяет deletedAt внутри транзакции — два параллельных восстановления резервируют товар дважды

**Где:** `api/services/order.ts:1209` • **проверено запуском:** нет

**Что происходит.** restore() читает заказ через db.select() ВНЕ транзакции, без .for('update') (строки 1209-1212), а внутри транзакции ставит deletedAt=null безусловным UPDATE без условия isNotNull(deletedAt) (строка 1218). Соседние методы делают это правильно: cancel() (строка 753) и delete() (строка 980) оба используют .for('update') вместе с isNull(orders.deletedAt) и явно объясняют в комментариях, зачем. restore() — единственный из трёх без защиты.

**Что это значит на практике.** Два одновременных вызова orders.restore (двойной клик оператора, повтор запроса по таймауту) оба проходят проверку «заказ удалён» и оба выполняют цикл ре-резервирования на строках 1232-1247. Резерв вырастает вдвое, available падает вдвое — товар, который никто не держит, становится непродаваемым. Обратной операции нет: последующая отмена освободит только один комплект.

**Как воспроизвести.** На реальном MySQL: удалить заказ, затем вызвать orders.restore дважды параллельно и сравнить warehouseStock.reserved с суммой orderItems.quantity.

**Предлагаемое решение.** Перенести чтение заказа внутрь транзакции с .for('update'), добавить isNotNull(orders.deletedAt) в WHERE и проверить affectedRows === 1 — тот же паттерн, что уже применён в updateStatus (строки 936-940).

**Чем подтверждено.** Только чтение кода — доказать гонку не удалось: MySQL недоступен (127.0.0.1:3306 ECONNREFUSED, docker в системе отсутствует), а мок-БД в тестах не воспроизводит блокировки и не является MySQL. ТРЕБУЕТ ПРОВЕРКИ на живой базе. Отсутствие .for('update') и отсутствие guard-условия в UPDATE — факт, подтверждённый по исходнику; вредный исход — вывод по аналогии с cancel()/delete().

### OrderService.restore: the `deletedAt` check runs entirely outside the transaction — two overlapping restores reserve the same order's stock twice, permanently

**Где:** `api/services/order.ts:1209` • **проверено запуском:** да

**Что происходит.** `restore` reads the order at line 1209 with the outer `db`, BEFORE `db.transaction` opens at line 1216, with no lock. The `UPDATE orders SET deletedAt = null` at line 1218 has no `deletedAt IS NOT NULL` guard. So two requests both see deletedAt set, both enter the transaction, and both run the re-reservation at line 1242. Second, independent defect inside the transaction: the availability guard at line 1234 is a PLAIN `SELECT available`, not the `.for("update")` query at line 1228 (which selects only `{id}` and throws the value away). Under MySQL's default REPEATABLE READ the snapshot is fixed at the transaction's first consistent read — here `tx.select().from(orderItems)` at line 1223, which happens BEFORE the lock is acquired. The plain read at 1234 is therefore served from the pre-lock snapshot, so the 'недостаточно товара' guard can approve against stock a concurrent transaction has already consumed. The lock is taken and then the decision is made on a stale number.

**Что это значит на практике.** Units are moved from `available` to `reserved` twice for a single order. A 10-unit order restored twice leaves reserved=20, available=80 on a 100-unit shelf. When that order later completes or is cancelled it releases only its own 10, so 10 real units stay reserved forever — permanently unsellable, with no order to explain them and no screen that shows why. The stale-read half additionally allows restoring an order whose stock is no longer there, driving `available` negative.

**Как воспроизвести.** npx vitest run api/__tests__/zz-concurrency-audit.test.ts --reporter=verbose --silent=false  (see EVIDENCE 1 and the sequential baseline)

**Предлагаемое решение.** Move the order read inside the transaction as the FIRST statement with `.for("update")` and `isNull(orders.deletedAt)` in the WHERE, then guard the un-delete UPDATE with `isNotNull(orders.deletedAt)` and throw on affectedRows !== 1 — the shape `cancel()` at line 750 and `delete()` at line 973 already use. Separately, the availability check must read `available` from the same `.for("update")` query rather than a second plain SELECT, the way OrderService.create:616 and StockService.reserve:32 do.

**Чем подтверждено.** RAN it. api/__tests__/zz-concurrency-audit.test.ts, EVIDENCE 1, with transactions fully serialized by a global mutex (log: `TX-START -> TX-COMMIT -> TX-START -> TX-COMMIT`). Output:
  [restore] outcomes: [ 'fulfilled', 'fulfilled' ]
  [restore] stock after: {"currentStock":"100.00","reserved":"20.00","available":"80.00"}
Baseline in the same file, the identical two calls run strictly one after the other:
  [restore-sequential] second call: Заказ не удалён
  [restore-sequential] stock after: {"reserved":"10.00","available":"90.00"}
The pre-transaction check is the only difference, and full serialization does not save it. The REPEATABLE-READ snapshot half of this finding is code-reading only — требует проверки на живом MySQL.

### courier.markFailed has no lock and an unguarded UPDATE — it can revert a delivery that already deducted stock and took cash, silently writing off the unpaid balance

**Где:** `api/courier-router.ts:594` • **проверено запуском:** нет

**Что происходит.** The `deliveryStatus IN ('assigned','out_for_delivery')` pre-check at line 577 runs on `db` outside the transaction. The UPDATE inside the transaction at line 594 sets `deliveryStatus='failed', status='new', courierId=null` with NO deliveryStatus condition in its WHERE and no `.for("update")` anywhere in the procedure — and it does not call recalcShopDebt. Interleaving: (1) completeDelivery locks the order at line 356, deducts current_stock and reserved for every item, inserts the payment row, sets status='delivered'/deliveryStatus='delivered', recalcs debt, commits. (2) markFailed's pre-check ran before that commit and passed; its UPDATE blocks on the order row lock, then after the commit overwrites the row unconditionally.

**Что это значит на практике.** Two separate money/stock losses. (a) The order is now status='new' with a payment row attached. `recalcShopDebt` (shop-debt.ts:50-53) only counts an order that is 'delivered' or payment_method='debt' — a 'new' cash order contributes 0. So the next recalc for that shop, from any unrelated action, silently drops the entire unpaid remainder of a delivery that physically happened. Real receivable vanishes. (b) The stock was already deducted and its reservation cleared, but the order sits in 'new' holding no reservation; the retried delivery deducts current_stock a SECOND time for goods that left the building once.

**Как воспроизвести.** Fire completeDelivery and markFailed for the same orderId concurrently (the mobile app's offline queue dispatches queued actions in parallel — see Warehouse-Pro-Mobile syncDeliveryActions, which the completeDelivery comment at line 350 already cites as a real duplicate source). Then trigger any recalc for that shop and compare shops.debt before and after.

**Предлагаемое решение.** Same shape as markDelivered at line 191: make the UPDATE itself the guard — `WHERE ... AND delivery_status IN ('assigned','out_for_delivery')` — and throw when affectedRows !== 1.

**Чем подтверждено.** Code reading only — the courier router needs sseBus, push-service, notifications and users mocked to drive, which I did not build. Требует проверки прогоном. The structural facts are verified by reading: no `.for("update")` anywhere in markFailed (grep of the file shows locks only at :212 and :365), the UPDATE at :594-596 carries only id+tenantId in its WHERE, and no recalcShopDebt call exists in the procedure.

### courier.markOutForDelivery unconditionally rewrites deliveryStatus with no lock — it can re-open an already-completed delivery for a second stock deduction and a second payment

**Где:** `api/courier-router.ts:150` • **проверено запуском:** нет

**Что происходит.** The pre-check at line 141 (`deliveryStatus = 'assigned'`) runs outside any transaction; the UPDATE at line 150 has no transaction, no lock, and no deliveryStatus condition. If it lands after a concurrent completeDelivery committed, it resets deliveryStatus from 'delivered' back to 'out_for_delivery'. completeDelivery's own gate (line 367) tests ONLY deliveryStatus — it never checks `orders.status` — so the order is now eligible to be completed all over again.

**Что это значит на практике.** The classic 'two couriers complete the same delivery'. The second completeDelivery deducts current_stock for every line a second time and inserts a second `payments` row against the same order. Stock goes short by one order's worth; on the money side `recalcShopDebt` sums payments per order (shop-debt.ts:57-62), so the doubled payment cancels the order's balance and can eat into what the shop owes on OTHER orders — the shop is credited money it never paid.

**Как воспроизвести.** Fire markOutForDelivery and completeDelivery for the same order concurrently, then call completeDelivery once more. Expect two payment rows and a doubled stock deduction.

**Предлагаемое решение.** Add `sql`${orders.deliveryStatus} = 'assigned'`` to the UPDATE's WHERE and throw on affectedRows !== 1. Independently, completeDelivery's in-transaction guard should also reject when `orders.status` is already 'delivered'/'cancelled'/'returned', so a corrupted deliveryStatus cannot alone re-open a closed order.

**Чем подтверждено.** Code reading only — same mocking cost as the markFailed finding. Требует проверки прогоном. Verified by reading: markOutForDelivery contains no `db.transaction` and no `.for("update")` at all, and its UPDATE WHERE (line 152) is `id + tenantId` only; completeDelivery's re-check at line 367 tests `locked.deliveryStatus` and never `order.status`.

### OrderService.updateItems takes the stock lock AFTER the reads it decides from — under REPEATABLE READ both the quantities and the availability check come from a pre-lock snapshot

**Где:** `api/services/order.ts:1089` • **проверено запуском:** нет

**Что происходит.** This is the exact failure mode the brief describes, in its subtler MySQL form. Everything runs on `tx` — I verified that mechanically — but the ORDER of statements defeats the lock. Line 1089 reads the order with a PLAIN select (no `.for("update")`, unlike cancel/delete/updateStatus which all lock the order as their first statement). Line 1098 reads `existingItems` plainly. Only at line 1123 does the loop take `.for("update")` on warehouse_stock — and it selects `{id}` and discards it. Then `applyStockDelta` checks availability with yet another PLAIN select (line 95 for 'reserve' mode, line 113 for 'consumed'). MySQL's default is REPEATABLE READ (I checked api/queries/connection.ts and grepped the repo — no isolationLevel is ever set), and the consistent-read snapshot is fixed at the transaction's FIRST plain read, which here is line 1089 — before the lock. Every value the deltas are computed from is therefore frozen at a moment before the lock was granted.

**Что это значит на практике.** Two concurrent edits of the same order double-apply their delta. Order holds 10 units (reserved 10, available 90 of 100). Operator A sets the line to 4 → delta −6 → reserved 4, available 96, commits. Operator B's transaction opened before that and read quantity=10 from the snapshot; it blocks on the stock lock, then resumes and applies −6 again → `reserved = GREATEST(0, 4−6) = 0`, `available = 96 + 6 = 102`. current_stock is still 100. The invariant current_stock = available + reserved is broken by 2 phantom units, and the order row says 4. Separately, the availability guard at line 99 reads the stale snapshot, so an edit can be approved against stock another transaction already consumed — straightforward overselling. Nothing errors.

**Как воспроизвести.** On MySQL 8 with two sessions: S1 BEGIN; SELECT from orders (plain); SELECT from order_items (plain). S2 BEGIN; run a full updateItems to completion; COMMIT. S1 then SELECT ... FOR UPDATE on warehouse_stock and SELECT available — observe the pre-S2 value.

**Предлагаемое решение.** Lock the order row first (`.for("update")` on the line-1089 select, as cancel/delete/updateStatus already do) so the snapshot is established after the lock, and have applyStockDelta read `available`/`current_stock` from a `.for("update")` query instead of a plain one.

**Чем подтверждено.** Code reading plus documented InnoDB semantics — I could not run it: the harness I built serializes transactions completely, which is exactly what hides a snapshot bug, and no MySQL is reachable here (no docker, and I would not touch the production DATABASE_URL). Требует проверки на живом MySQL. What IS verified: the statement order (plain reads at 1089/1098, lock at 1123, plain availability read at 95/113), that no isolation level is configured anywhere, and the contrast with the correct sites — applyPartialPayment:161 and applyPartialDelivery:263 open with the locking read so their later plain reads land after the lock and are fresh, which is precisely why those two are safe and this one is not.

### 1C /stock webhook locks and reads a warehouse_stock row that is not the one it writes

**Где:** `api/webhooks/onec.ts:141` • **проверено запуском:** нет

**Что происходит.** The `.for("update")` at line 145 filters on productId + tenantId only — no warehouseId — and takes LIMIT 1. The upsert at line 160 then writes the row for the DEFAULT warehouse. In a tenant with more than one warehouse holding that product, the row locked and the `reserved` value read at line 146 can belong to a different warehouse than the row being written. `available` is then computed as `parsedQty - reserved` from that foreign warehouse's reservation.

**Что это значит на практике.** For multi-warehouse tenants the lock protects the wrong row, so a concurrent OrderService.create — which locks the DEFAULT warehouse row (order.ts:616) — does not conflict with it. Sequence: create locks the default row and reserves 5 (reserved 0→5, available 100→95); the 1C sync locked warehouse-2's row instead, read reserved=0, and absolutely overwrites the default row to current_stock=100, available=100. The 5 reserved units become sellable again and are sold twice. Even without a race, `available` is simply computed from another warehouse's reserved figure — the wrong number every time.

**Как воспроизвести.** Tenant with two warehouses both stocking product P. Reserve units of P from the default warehouse while POSTing /webhooks/onec/stock for P; compare warehouse_stock for the default warehouse against reserved.

**Предлагаемое решение.** Resolve the default warehouse BEFORE the locking read (it is currently resolved at line 150, after) and add `eq(warehouseStock.warehouseId, defaultWarehouse.id)` to the FOR UPDATE — so the row locked, the row read and the row written are the same row.

**Чем подтверждено.** Code reading. Требует проверки прогоном. Verified by reading: the WHERE at onec.ts:143 is `and(eq(productId), eq(tenantId))` with no warehouse predicate, while the insert at :160-172 targets `defaultWarehouse.id`. Contrast with StockService.reserve (stock.ts:33-37) and OrderService.create (order.ts:617-621), which both include `eq(warehouseStock.warehouseId, whId)` in the locking read.

### PaymentService.addPayment has no idempotency at all — a double-tap on «Принять оплату» records the payment twice and the lock on shops does not prevent it

**Где:** `api/services/payment.ts:26` • **проверено запуском:** нет

**Что происходит.** The `.for("update")` on `shops` at line 32 is correctly placed (first statement in the transaction, on tx), but it only serializes the two calls — it does not deduplicate them. There is no idempotency key on the input (shop-router.ts:274-286 accepts shopId/amount/type/notes and nothing else), no unique constraint on `payments`, and no time-window duplicate check. Two identical requests — a double-click, a client retry on a slow response — both insert.

**Что это значит на практике.** Two payment rows for one real payment. recalcShopDebt subtracts shop-level payments (shop-debt.ts:70-73), so the shop's debt drops by twice the cash received. The money is silently written off the debtor list. This is the 'payment recorded twice' scenario on the manual path — and it is the one path with no protection at all: applyPartialPayment (order.ts:161-188) is guarded by the order lock plus `priorPaid + paid > total`, courier.markDelivered by the conditional UPDATE at line 191, courier.completeDelivery by the deliveryStatus re-check at line 367.

**Как воспроизвести.** Call shop.addPayment twice with identical arguments; observe two rows in `payments` and shops.debt reduced by 2×amount.

**Предлагаемое решение.** Accept an idempotencyKey on the mutation and back it with a unique index on (tenantId, idempotencyKey) in `payments`, catching ER_DUP_ENTRY — the pattern OrderService.create already uses. A dedup window alone (same shop, same amount, same operator, last N seconds) would also cover the double-tap but not a delayed retry.

**Чем подтверждено.** Code reading. The absence of any dedup mechanism is a structural fact I verified directly: no idempotency field in the zod input at shop-router.ts:274-280, no unique index on `payments` in db/schema.ts, no duplicate-window query in payment.ts. Требует проверки прогоном, но проверять там нечего — механизма защиты просто нет.

### commission.calculate перезаписывает запись, уже помеченную paid/approved

**Где:** `api/commission-router.ts:162` • **проверено запуском:** да

**Что происходит.** Выборка строк (строки 110-117) не фильтрует по status, а UPDATE (162-167) идёт по `eq(commissions.id, agent.id)` — без всякой защиты по статусу. Пересчёт пересчитывает и уже утверждённые, и уже выплаченные строки.

**Что это значит на практике.** Кнопка "Пересчитать комиссии" в UI (src/pages/AgentKpi.tsx:451) всегда шлёт период "1-е число текущего месяца → сегодня". Если после выплаты заказ отменили, вернули или мягко удалили, повторное нажатие молча уменьшит commissionAmount у строки со статусом paid — вплоть до 0.00, при этом статус останется "paid". Расхождение между выплаченным и записанным никак не видно: в списке комиссий будет выплаченная строка с суммой, которой не платили. Колебался между high и critical — remediation требует действия оператора, но результат неотличим от мошенничества в отчётности.

**Как воспроизвести.** npx vitest run api/__tests__/_audit-commission-evidence.test.ts --silent=false → кейс "G. overwrites a row that is already marked PAID".

**Предлагаемое решение.** Добавить eq(commissions.status,'pending') и в выборку строк, и в WHERE апдейта (так, как это уже сделано в kpi.ts).

**Чем подтверждено.** Кейс G: строка {status:'paid', commissionAmount:'2500000.00'}, заказов в периоде больше нет → после caller.calculate строка стала {status:'paid', salesAmount:'0.00', commissionAmount:'0.00'}, updated: 1.

### period_end записывается как "сегодня", а не как конец месяца — последующий пересчёт обрезает месяц

**Где:** `api/services/kpi.ts:447` • **проверено запуском:** да

**Что происходит.** `const monthEnd = periodEnd.toISOString().slice(0,10)`, где periodEnd приходит из getPeriod() = сегодня 23:59:59 (api/kpi-router.ts, функция getPeriod). То есть в period_end пишется дата последнего просмотра экрана. А commission-router.calculate (строки 133-143) берёт верхнюю границу суммирования из `agent.periodEnd` самой строки, а не из запрошенного оператором диапазона.

**Что это значит на практике.** День, когда агент последний раз открыл вкладку "Зарплата", становится датой отсечки для комиссии за весь месяц. Агент зашёл 6 августа и больше не заходил → оператор 1 сентября жмёт "Пересчитать" за 1-31 августа и получает продажи только по 6 августа. Занижение молчаливое: и число, и процент выглядят правдоподобно.

**Как воспроизвести.** npx vitest run api/__tests__/_audit-commission-evidence.test.ts --silent=false → кейс "H. period_end left behind by the salary page truncates the month".

**Предлагаемое решение.** При persist писать календарный конец периода (new Date(y, m+1, 0)), а не курсор "сегодня"; либо в calculate брать границу из input.periodEnd, ограниченного календарным концом периода строки.

**Чем подтверждено.** Два доказательства. (1) Скрипт на реальном drizzle: getPeriod('month') на 6 августа даёт persisted period_end = "2026-08-06". (2) Кейс H: строка с period_end='2026-08-06', заказы 1 000 000 (3 авг) и 9 000 000 (20 авг); оператор запрашивает 2026-08-01…2026-08-31 → в строке salesAmount='1000000.00', commissionAmount='100000.00' при реальных продажах 10 000 000.

### Возврат вычитается дважды, если заказ после проведённого возврата перевели в статус returned/cancelled

**Где:** `api/services/kpi.ts:395` • **проверено запуском:** да

**Что происходит.** База комиссии = SUM(orders.total по статусам REVENUE) − SUM(returns.total_amount по completed-возвратам). Подзапрос по возвратам (kpi.ts:395-407 и commission-router.ts:146-157) джойнит orders, но НЕ фильтрует orders.status. Если заказ ушёл из REVENUE_ORDER_STATUSES (стал 'returned' или 'cancelled'), его сумма уже не входит в валовую часть, а сумма возврата продолжает вычитаться. OrderService.updateStatus разрешает любой переход (api/services/order.ts:812-815) и специально умеет складывать оба пути возврата по складу — но не по деньгам.

**Что это значит на практике.** Вычет съедает комиссию по ДРУГИМ, нетронутым заказам агента. В прогоне: два доставленных заказа по 1 000 000; проведён возврат по второму → база 1 000 000 (верно); оператор дополнительно ставит заказу статус "возвращён" → база 0 и комиссия 0, хотя первый заказ никто не возвращал. При Math.max(0, …) убыток просто обрезается нулём, ошибка нигде не всплывает.

**Как воспроизвести.** npx vitest run api/__tests__/_audit-commission-evidence.test.ts --silent=false → кейс "D. a completed return is subtracted even after the order is moved to 'returned'". В проде: провести возврат по доставленному заказу, затем перевести сам заказ в "возвращён".

**Предлагаемое решение.** В подзапрос по возвратам добавить inArray(orders.status, REVENUE_ORDER_STATUSES) — вычитать возврат только тогда, когда заказ ещё входит в валовую выручку.

**Чем подтверждено.** Кейс D, три последовательных вызова calculateSalary на одних и тех же данных: "no returns: sales = 2000000", "return completed: sales = 1000000", "+ order set 'returned': sales = 0, commission = 0".

### "Оклад" и "ИТОГО К ВЫПЛАТЕ" берутся из плана продаж (sales_targets.target_amount)

**Где:** `api/services/kpi.ts:425` • **проверено запуском:** да

**Что происходит.** `const baseSalary = Number(targetRecord?.targetAmount ?? 0)` — это колонка sales_targets.target_amount, то есть квота по ВЫРУЧКЕ: её же calculateAgentKpi (строка 258) использует как targetRevenue для targetProgress = revenue/targetRevenue, и её же генерирует suggestQuotas (suggestedRevenue = средняя месячная выручка × growth factor). Дальше totalSalary = baseSalary + commission + bonus − fraudDeduction (строка 429), а fraudDeduction = baseSalary × fraudRate% × 0.5 (строка 427).

**Что это значит на практике.** Агенту и супервайзеру в src/pages/AgentKpi.tsx:262/285 показывается "Оклад" = месячный план продаж и "ИТОГО К ВЫПЛАТЕ" = план продаж + комиссия + бонус. При плане 100 000 000 сум зарплата к выплате отображается как ~100+ млн. Штраф за фрод тоже считается от плана продаж. Если план не заполнен, оклад = 0 и "итого" занижено на весь оклад. Ни одно из двух состояний не является зарплатой.

**Как воспроизвести.** Завести агенту план продаж через salesTarget.upsert и открыть вкладку "Зарплата": строка "Оклад" будет равна плану.

**Предлагаемое решение.** Нужно отдельное поле оклада (users.base_salary или своя таблица). Пока его нет — база оклада и штраф от неё не должны считаться от target_amount.

**Чем подтверждено.** Чтение кода без запуска — присваивание прямое, промежуточных преобразований нет: db/schema.ts:604-613 (target_amount в sales_targets рядом с actualAmount/orderCountTarget), api/services/quota-suggest.ts (suggestedRevenue считается из выручки), api/services/kpi.ts:258 (та же колонка = targetRevenue), 414-429, src/pages/AgentKpi.tsx:262,268,281,285 (подписи "Оклад", "ИТОГО К ВЫПЛАТЕ").

### Order already settled by the courier can be run through recordPartialDelivery again — current_stock deducted a second time and the stock invariant breaks

**Где:** `api/services/order.ts:275` • **проверено запуском:** да

**Что происходит.** applyPartialDelivery refuses only cancelled/returned orders (line 275) plus a per-item guard on deliveredQuantity !== null (line 298). courier.completeDelivery with result 'paid'/'partial_paid' (api/courier-router.ts:383-397) and courier.markDelivered (api/courier-router.ts:215-231) both deduct current_stock and set status='delivered' but never write order_items.deliveredQuantity. So the item guard is still null, the status guard passes, and an operator/agent calling order.recordPartialDelivery on that same order runs the full deduction again: current_stock -= deliveredQty, reserved -= orderedQty (floored at 0 by GREATEST, which hides the second hit), available += returnedQty.

**Что это значит на практике.** Goods that physically left the warehouse once are subtracted from stock twice. current_stock stops equalling available + reserved, so the warehouse under-reports what it holds — orders get refused for stock that is on the shelf, and the valuation report understates inventory by the order value. No concurrency needed: this is a plain sequential sequence any operator can perform through the normal UI after a courier closes a delivery.

**Как воспроизвести.** Courier completes delivery of a 10-unit order via courier.completeDelivery({result:'paid'}). Then call order.recordPartialDelivery({orderId, items:[{itemId, deliveredQuantity:10}]}). current_stock drops by another 10.

**Предлагаемое решение.** Not fixing this pass. The natural guard already exists — have the courier paths write order_items.deliveredQuantity (and/or check orders.deliveryStatus === 'delivered') so applyPartialDelivery's existing idempotency check fires.

**Чем подтверждено.** Ran the real OrderService.recordPartialDelivery against a stock row shaped exactly as courier.completeDelivery leaves it (status=delivered, current_stock already reduced 50→40 for the 10 units, reserved=0, deliveredQuantity still NULL). Printed: `[H] after operator recordPartialDelivery: current_stock=30.00 reserved=0.00 available=40.00` — 10 more units deducted, and current_stock (30) no longer equals available + reserved (40).

### order.updateItems is read-then-write with no lock and no dedup — retrying the same 'add product' payload duplicates the line, the charge and the stock reservation

**Где:** `api/services/order.ts:1089` • **проверено запуском:** да

**Что происходит.** updateItems reads the order without .for("update") (line 1089-1093) and its final UPDATE of subtotal/discount/total is unconditional (line 1195-1199). Lines are matched by itemId; an entry without one always inserts a NEW order_items row (line 1163-1176). OrderSlideOver.tsx:365-372 sends newly added lines as {productId, quantity, unitPrice} with no itemId, and on error keeps editLines in state (the catch at line 385 clears nothing), so the operator's retry resends the identical payload. On the second pass the previously-inserted line is not mentioned by the caller, so it is counted again by the 'lines the caller did not mention' loop (line 1182-1186) on top of the freshly inserted duplicate.

**Что это значит на практике.** One 'add 5 × product' action applied twice: the order carries two identical lines, the shop is charged twice for goods it received once (order total, and therefore shops.debt via recalcShopDebt, inflated), and warehouse stock is reserved twice for units that were only ordered once. Money wrong in the customer's favour or against them depending on direction, stock silently wrong either way. No concurrency required — a single timeout-then-retry does it.

**Как воспроизвести.** Open an order, add a product in the editor, save; let the request time out after the server committed; press save again with the same editor state.

**Предлагаемое решение.** Not fixing this pass. Needs either .for("update") on the order plus a client-supplied edit revision/version compare-and-swap, or a client-side line identity so a new line is idempotent on resubmit.

**Чем подтверждено.** Ran the real OrderService.updateItems twice with the exact payload shape OrderSlideOver builds ([{itemId:1,quantity:10,unitPrice:'100'},{productId:8,quantity:5,unitPrice:'50'}]). Printed: `[I] after 1st: order_items=2 total=1250.00 product8.available=95.00` then `[I] after 2nd: order_items=3 total=1500.00 product8.available=90.00`. Third line created, order overcharged by 250, product 8 reserved twice.

### applyPartialPayment's only duplicate guard is the order-total ceiling, so any partial payment ≤ the remaining balance can be booked twice

**Где:** `api/services/order.ts:188` • **проверено запуском:** да

**Что происходит.** applyPartialPayment does lock the order FOR UPDATE (line 161-167) and does read priorPaid after the lock (line 182-186), so the locking is correct. But the only thing standing between a duplicate and a second payments row is `if (priorPaid + paid > total) throw` at line 188. That guard is about overpayment, not about identity. Submitting 400 twice against a 1000 order gives 400 + 400 = 800 ≤ 1000, so the second one is accepted as a legitimate second instalment. There is no idempotency key on the payments row.

**Что это значит на практике.** An agent's partial payment that times out and is re-entered books twice: shops.debt drops by 800 when 400 was collected. The error is bounded by the order total (an exact-duplicate full payment IS rejected), but a payment of up to half the remaining balance is always duplicable, and a third submission is what finally trips the ceiling. Reachable from Warehouse-Pro-Mobile (src/api.ts:1022, order.recordPartialPayment) where the HTTP client has a 15 s timeout (src/api.ts:25) and field connectivity is exactly the case that produces a committed-but-timed-out request.

**Как воспроизвести.** —

**Предлагаемое решение.** Not fixing this pass. Wants a real idempotency key on payments, same as orders.idempotencyKey.

**Чем подтверждено.** Ran the real OrderService.recordPartialPayment twice with paidAmount 400.00 on a 1000.00 delivered order. Printed: `[B] payment rows=2  amounts=400.00,400.00  debt 1st=600.00 2nd=200.00`. Also confirmed the ceiling does catch the full-amount case: `[B2] full-amount duplicate rejected; payment rows=1`.

### returns.updateStatus('completed') is a read-then-write with no lock on the return and no status predicate on the UPDATE — two concurrent calls credit the same goods to stock twice

**Где:** `api/returns-router.ts:216` • **проверено запуском:** да

**Что происходит.** The status is read at line 216-218 with db.select — outside any transaction, no .for("update"). The transition table (line 239-248) then approves approved→completed. Inside the transaction the only rows locked are warehouse_stock (line 263-267); the returns row is never locked and is never re-read. The final write at line 292-293 is `UPDATE returns SET status='completed' WHERE id=? AND tenant_id=?` — no `AND status='approved'`, no affectedRows check. Two concurrent calls therefore both pass the unlocked pre-check; the second blocks on the stock-row lock, then applies `current_stock = current_stock + qty` on top of the first commit and writes status='completed' again unopposed. This is the one flow of its class in the codebase without the guard: arrival completion (arrival-router.ts:218-305), stock transfer completion (warehouse-multi-router.ts:229-322), courier completeDelivery (courier-router.ts:356-369) and OrderService.updateStatus (order.ts:936-940) all re-check under a lock and/or check affectedRows.

**Что это значит на практике.** Warehouse stock inflated by the full return quantity — the system believes it holds goods it does not have, so orders are accepted for stock that cannot be shipped, and the valuation report overstates inventory. Two duplicate stock_movements rows also make the ledger disagree with reality. Debt is unaffected (returns.status stays 'completed' either way).

**Как воспроизвести.** An approved return with items. Fire two returns.updateStatus({id, status:'completed'}) requests simultaneously.

**Предлагаемое решение.** Not fixing this pass. I hesitated between high and medium: no page in src/ calls trpc.returns at all today (grep for 'trpc.returns' and 'returns.updateStatus' across src/ and Warehouse-Pro-Mobile returns nothing), so there is no button to double-tap — the endpoint is reachable only via the tRPC HTTP route, an API key, or an integration. I kept it high because it is stock silently wrong with no guard whatsoever, and the moment a UI is added the trigger is a plain double-tap.

**Чем подтверждено.** Fired two concurrent returnsRouter.updateStatus({id, status:'completed'}) calls through the real router. Printed: `[C] results=fulfilled,fulfilled` and `[C] current_stock 50.00 -> 54.00 (return was 2 units)`, `[C] available 40.00 -> 44.00`. Both succeeded; a 2-unit return credited 4 units. Also confirmed the sequential retry IS blocked by the transition table: `[C2] sequential second call rejected; current_stock=52.00`.

### bulkCompleteWithPayment leaves orders delivered-and-unpaid: float comparison rejects ~11.5% of payments after the status was already committed

**Где:** `api/services/order.ts:1629` • **проверено запуском:** да

**Что происходит.** Line 1629-1631 calls `this.updateStatus(db, ..., 'delivered')` — its own db.transaction, committed immediately. Line 1633 then opens a SECOND transaction for applyPartialPayment with `paidAmount: remaining.toFixed(2)` where remaining = total − Number(alreadyPaid) in floating point. Inside, applyPartialPayment re-reads priorPaid from SQL and throws on `priorPaid + paid > total` (line 188). Because priorPaid and paid are two independently-rounded doubles, their sum overshoots total by 1 ulp in a large fraction of cases: e.g. total 344947.16, alreadyPaid 220815.25, paid 124131.91 → sum 344947.16000000003 > 344947.16 → throw. The throw rolls back only the payment; the delivered status is already committed.

**Что это значит на практике.** The operator ticks a batch of 'these are all paid', the goods are booked out of the warehouse, the order is marked delivered, and no payment row is written — so recalcShopDebt charges the shop the full amount. The order appears in the `failed[]` array with a message about overpayment, which reads like 'nothing happened', not 'stock left the building and the customer now owes you the whole invoice'. Only hits orders that already carry a partial payment, which is precisely the debt-collection case.

**Как воспроизвести.** Order total 344947.16, record a partial payment of 220815.25, then run bulkCompleteWithPayment on it. The order flips to delivered, then the payment throws.

**Предлагаемое решение.** Two separate issues: (a) compare in integer kopeks or with an epsilon in applyPartialPayment line 188; (b) move the updateStatus call inside the same transaction as applyPartialPayment so a rejected payment cannot leave the order delivered. The same float guard also blocks legitimate final payments from the courier/agent flows.

**Чем подтверждено.** Simulated 200 000 random (total, priorPaid, priorPaid2) triples in exact 2-decimal money. 23 057 of 200 000 (11.5%) produced priorPaid+paid > total. Concrete printed rows: {total 344947.16, alreadyPaid 220815.25, paid 124131.91, sum 344947.16000000003}, {455490.47, 34469.69, 421020.78, 455490.47000000003}. Separately confirmed 0 cases of leftover kopeks, so the toFixed itself is fine — the guard is what breaks. Script block P4b. Confirmed by reading updateStatus (order.ts:790) that it opens its own transaction.

### order_items.quantity is never rounded to the column's 2-decimal scale before being stored, so subtotal, stock and quantity disagree

**Где:** `api/services/order.ts:1153` • **проверено запуском:** да

**Что происходит.** updateItems accepts `quantity: z.number().min(0)` (order-router.ts:290 — no scale limit) and writes `quantity: String(line.quantity)` while computing `subtotal: (unitPrice * line.quantity).toFixed(2)` from the unrounded value. order_items.quantity is DECIMAL(10,2), so MySQL rounds on write. The same unrounded number is passed to applyStockDelta and into the warehouse_stock UPDATE (DECIMAL(12,2) columns). OrderService.create has the same shape at line 650: `quantity: item.quantity` is the raw client string, subtotal is computed from Number() of it.

**Что это значит на практике.** quantity 2.555 at 12 000 сум/unit: the row ends up holding quantity 2.56 and subtotal 30 660.00, but unit_price × quantity as the row now reads is 30 720.00 — a 60 сум gap on one line, invisible because both numbers are on the same row and nobody recomputes. At 1.004 and 1.006 the gap is ±180 сум per line. On the stock side a line of 0.004 units reserves 0.00 on the shelf while the customer is billed 0.004 × price, so current_stock = available + reserved drifts. Any invoice or report that recomputes line value from quantity × unit_price disagrees with the stored subtotal.

**Как воспроизвести.** order.updateItems with quantity 2.555 on a line priced 12000. Read back order_items: quantity 2.56, subtotal 30660.00.

**Предлагаемое решение.** Round quantity to the column scale once, at the top of the handler, and use that rounded value for the subtotal, the stock delta and the stored column alike. Add `.multipleOf(0.01)` (or a refine) to the zod schemas.

**Чем подтверждено.** Computed the three values for four realistic (unitPrice, qty) pairs. Printed: qty 2.555 → column holds 2.56, subtotal written 30660.00, unit_price×quantity from the row 30720.00, diff −60.00; qty 0.125 → 0.13 / 112.49 / 116.99, diff −4.50; qty 1.004 → 1.00 / 45180.00 / 45000.00, diff +180.00. Script block P8. MySQL's round-on-write for DECIMAL scale is standard behaviour, not something I ran against a server.

### order_items.subtotal is gross while orders.total is net of discount — both are labelled 'выручка' on the reports hub

**Где:** `api/analytics-router.ts:61` • **проверено запуском:** да

**Что происходит.** OrderService.create writes each line's subtotal as unitPrice × quantity (order.ts:653) and the order's total as subtotal − discount (line 640). The discount is never pushed down to the lines. analytics.topProducts (line 61), analytics.agentProductSales (line 459) and analytics.cogsByProduct (line 107) report `totalRevenue: SUM(order_items.subtotal)` — gross. analytics.salesByShop (line 33), analytics.pnl (line 257), dashboard.kpis and services/kpi.ts report SUM(orders.total) — net. Same word, same page, different meaning.

**Что это значит на практике.** On a single 12% order the two figures differ by the whole discount: 4 502 500 vs 3 962 200. cogsByProduct's implied margin (totalRevenue − totalCost) is overstated by exactly the discount amount, so a product sold at a loss under a large discount still shows a healthy margin. The Reports hub shows both numbers side by side and neither carries a note about which is which.

**Как воспроизвести.** Create an order with any non-zero discount, deliver it, then compare analytics.topProducts.totalRevenue against analytics.salesByShop.revenue for the same window.

**Предлагаемое решение.** Either allocate the discount across lines when writing order_items, or label the two aggregates differently (gross/net) and stop deriving margin from the gross one.

**Чем подтверждено.** Computed both aggregates from the same two-line order with a 12% discount: SUM(order_items.subtotal) = 4 502 500, SUM(orders.total) = 3 962 200, gap 540 300 = the discount. Script block P12. Confirmed by reading order.ts:640/653 that no discount is ever applied to a line.

### Расхождение реализаций: курьерский частичный возврат не переписывает order_items.subtotal, order.ts — переписывает

**Где:** `api/courier-router.ts:449` • **проверено запуском:** да

**Что происходит.** В courier-router.ts блок partial_returned (строки 408-467) обновляет orders.subtotal/discount/total и order_items.deliveredQuantity/returnReason, но НЕ трогает order_items.subtotal. В api/services/order.ts:314-318 applyPartialDelivery делает `set({ deliveredQuantity, returnReason, subtotal: newLineSubtotal.toFixed(2) })` — то есть строку тоже переписывает. Это и есть расхождение двух реализаций: формула скидки у них одинаковая (order.ts:360-363 и courier-router.ts:458-461 совпадают дословно), а запись по строкам — нет.

**Что это значит на практике.** ЗАПУЩЕНО (PROBE E): вернули 4 из 10 по первой строке → orders.subtotal='1600.00' (верно), а order_items.subtotal остались '1000.00' и '1000.00', SUM = 2000.00. Разница 400 на один заказ. Куда это утекает: analytics.topProducts.totalRevenue и cogsByProduct.totalRevenue считаются как SUM(order_items.subtotal) (api/analytics-router.ts:61,110) → выручка по товарам завышена на стоимость всего возвращённого; createLoadingList.totalPrice (order.ts:1428) — то же; печатная накладная (batchGetOrdersForPrint, order.ts:1288) и карточка заказа (getById, order.ts:506) показывают строки на 2000 при шапке 1440. Оператор видит документ, в котором строки не сходятся с итогом, и отчёт «Топ товаров», который показывает больше выручки, чем реально получено.

**Как воспроизвести.** npx vitest run api/__tests__/zz-audit-courier-probe.test.ts — PROBE E

**Предлагаемое решение.** Добавить в цикл partial_returned обновление order_items.subtotal = unitPrice * deliveredQty, как в order.ts:314-318.

**Чем подтверждено.** Пробник печатает orders.subtotal и SUM(order_items.subtotal) после реального вызова completeDelivery.

### updateItems берёт склад и сумму от заказанного количества, игнорируя уже состоявшуюся частичную доставку

**Где:** `api/services/order.ts:1140` • **проверено запуском:** да

**Что происходит.** `const oldQty = Number(item.quantity)` — базой для дельты склада берётся заказанное количество, а не фактически отгруженное order_items.deliveredQuantity. Новый subtotal тоже считается как unitPrice * line.quantity (строка 1158) и unitPrice * item.quantity для незатронутых строк (строка 1185). В updateStatus для ровно этой проблемы есть хелпер effectiveQty (order.ts:863-867), в updateItems его нет. Режим для доставленного заказа — 'consumed' (stockModeFor, order.ts:76-80), то есть дельта пишется прямо в current_stock.

**Что это значит на практике.** ЗАПУЩЕНО (PROBE N): строка заказана 10, доставлено 6 (subtotal заказа 1600, total 1440, товар 1: current 94, available 94). Оператор правит количество с 10 на 8. Должно уйти со склада ещё 2 единицы (6→8). Фактически: current_stock 94→96 и available 94→96 — 2 единицы ПРИБЫЛИ на склад из ниоткуда, знак дельты инвертирован. Деньги: orders.subtotal 1600→1800, total 1440→1620 — 4 возвращённые единицы снова выставлены магазину. При этом order_items.deliveredQuantity остаётся '6.00', а order_items.subtotal становится '800.00' — строка противоречит сама себе. Любая правка состава частично доставленного заказа (даже добавление другого товара) молча отменяет уменьшение суммы за возврат: незатронутые строки пересчитываются по quantity в строке 1185.

**Как воспроизвести.** npx vitest run api/services/__tests__/zz-audit-probe.test.ts — PROBE N

**Предлагаемое решение.** Использовать effectiveQty(item) как базу в updateItems (и для дельты склада, и для newSubtotal), либо запретить updateItems на заказах с непустым deliveredQuantity.

**Чем подтверждено.** Пробник моделирует SQL applyStockDelta (`current_stock = current_stock - ?, available = available - ?`) и печатает остатки до/после плюс записанные суммы.

### applyPartialDelivery считает subtotal только по переданным строкам — остальные позиции исчезают из суммы заказа и навсегда остаются в reserved

**Где:** `api/services/order.ts:309` • **проверено запуском:** да

**Что происходит.** `newSubtotal` накапливается исключительно в цикле `for (const item of input.items)` (строки 286-353). Строки заказа, не упомянутые в запросе, в сумму не попадают, их order_items.subtotal не трогается, и по ним не выполняется ни один UPDATE warehouse_stock — то есть их резерв не снимается. Затем orders.subtotal/discount/total перезаписываются целиком (строки 369-374). Для сравнения: updateItems в этом же файле (строки 1181-1186) явно добавляет неупомянутые строки обратно в newSubtotal с комментарием «Lines the caller did not mention stay as they are and still count». В applyPartialDelivery этого блока нет. Схема роутера (api/order-router.ts:548-552) требует только `.min(1)`.

**Что это значит на практике.** ЗАПУЩЕНО (PROBE A): заказ на 2000 (строки 1000 + 1000), передана только строка 101 с deliveredQuantity=6 → orders.subtotal='600.00', discount='60.00', total='540.00'. Правильно было бы 1600/160/1440. Магазину недосчитали 900. SUM(order_items.subtotal) = 1600 против orders.subtotal = 600. Выполнен ровно 1 UPDATE warehouse_stock — 5 единиц товара 2 остаются в reserved на закрытом заказе навсегда (ничто их больше не освободит). ЗАПУЩЕНО (PROBE C): два последовательных вызова по одной строке, обе доставлены ПОЛНОСТЬЮ (10 и 5) → итог 1000/100/900 вместо 2000/200/1800. Оператор видит полностью доставленный заказ на половину суммы. Веб-интерфейс сейчас всегда шлёт все строки (Orders.tsx:1150, OrderDetail.tsx:740, OrderSlideOver.tsx:831), так что путь достижим через прямой вызов tRPC (роль fieldSales), повтор по одной строке или устаревший список позиций в открытой модалке.

**Как воспроизвести.** npx vitest run api/services/__tests__/zz-audit-probe.test.ts — PROBE A и PROBE C

**Предлагаемое решение.** Либо добавить блок «неупомянутые строки тоже считаются», как в updateItems:1181-1186, либо требовать в схеме полный комплект itemId заказа.

**Чем подтверждено.** Пробник вызывает настоящий OrderService.recordPartialDelivery и печатает orders.* и SUM(order_items.subtotal), плюс счётчик выданных UPDATE warehouse_stock.

### courier.completeDelivery принимает любую сумму оплаты без верхней границы — переплата тихо теряется

**Где:** `api/courier-router.ts:292` • **проверено запуском:** да

**Что происходит.** `paidAmount: z.string().optional()` — ни формата, ни границ. На строке 469 `paidAmount = Number(input.paidAmount ?? 0)`, на 470 `debtAmount = orderTotal - paidAmount`, на 502 в БД пишется `String(Math.max(0, debtAmount))`. Никакой проверки paidAmount против orderTotal и никакой суммы уже внесённых платежей. Сравните: markDelivered в этом же файле отвергает наличные больше total*1.2 (строка 179), а applyPartialPayment в order.ts:188 отвергает `priorPaid + paid > total`. Мобильный клиент шлёт `String(orderTotal)` из своего кеша заказа (Warehouse-Pro-Mobile/app/order/deliver.tsx:174).

**Что это значит на практике.** ЗАПУЩЕНО (PROBE I): заказ на 1800, отправлено paidAmount='5000' → ошибки нет, вставлена строка payments с amount='5000', totalOrderAmount='1800', debtAmount='0'. recalcShopDebt (api/services/shop-debt.ts:52) считает по заказу `GREATEST(0, total - paid)`, поэтому лишние 3200 не уменьшают долг по другим заказам и нигде не отображаются как переплата — они просто исчезают из баланса. Реальный триггер: оператор изменил состав или скидку заказа после того, как курьер открыл экран доставки — курьер отправит устаревшую (завышенную) сумму. Итог: касса курьера сходится на 5000, долг магазина не сдвинулся на 3200, расхождения никто не увидит.

**Как воспроизвести.** npx vitest run api/__tests__/zz-audit-courier-probe.test.ts — PROBE I

**Предлагаемое решение.** paidAmount: z.string().regex(...) и серверная проверка paidAmount + уже оплаченное <= orderTotal, как в applyPartialPayment.

**Чем подтверждено.** Пробник вызывает реальный обработчик и печатает вставленную строку payments.

### result='partial_returned' без returnedItems: заказ закрывается доставленным, склад не двигается вообще

**Где:** `api/courier-router.ts:408` • **проверено запуском:** да

**Что происходит.** `} else if (input.result === 'partial_returned' && input.returnedItems) {` — а `returnedItems` в схеме `.optional()` (строка 296). Если массив не передан, ни одна из трёх веток обработки склада не выполняется, суммы не пересчитываются, но ниже безусловно выставляется status='delivered', deliveryStatus='delivered', deliveryResult='partial_returned'.

**Что это значит на практике.** ЗАПУЩЕНО (PROBE F): не выдано ни одного UPDATE warehouse_stock (список пуст). Товар 1: current_stock остался 100, reserved остался 10; товар 2: 50 и 5. orders.total остался 1800. Заказ закрыт, значит резерв уже никогда не снимется — 15 единиц заморожены на складе навсегда и не видны как доступные к продаже, при том что current_stock завышен на весь заказ. Оператор видит нормально доставленный заказ; кладовщик видит товар, который «есть», но зарезервирован непонятно за чем. Мобильное приложение блокирует пустой список на клиенте (deliver.tsx:150), сервер — нет.

**Как воспроизвести.** npx vitest run api/__tests__/zz-audit-courier-probe.test.ts — PROBE F

**Предлагаемое решение.** Сделать returnedItems обязательным при result='partial_returned' (zod .superRefine) или бросать ошибку на сервере.

**Чем подтверждено.** Пробник печатает список фактически выданных SQL по warehouse_stock (пустой) и остатки.

### applyPartialDelivery молча пропускает всё движение склада, если у тенанта нет склада по умолчанию, но деньги при этом пересчитывает

**Где:** `api/services/order.ts:329` • **проверено запуском:** да

**Что происходит.** Строки 283-284 читают склад по умолчанию, строка 329 — `if (defaultWh) { ... }`. Если склада нет, весь блок движения остатков и записи в леджер пропускается без ошибки, а строки 369-374 всё равно переписывают subtotal/discount/total и ставят status='delivered'. Все остальные пути идут через resolveOrderWarehouse (order.ts:23-32), который бросает «Склад по умолчанию не найден»; courier.completeDelivery тоже бросает (courier-router.ts:378).

**Что это значит на практике.** ЗАПУЩЕНО (PROBE M): при пустой таблице warehouses ошибки нет. orders: status='delivered', subtotal='600.00', discount='60.00', total='540.00'. Выдано 0 запросов к warehouse_stock: товар 1 остался current 100 / reserved 10 / available 90, товар 2 — 50 / 5 / 45. То есть сумма заказа уменьшилась, долг магазина пересчитался вниз, товар списан с продажи в документах, но со склада не ушёл и остался в резерве закрытого заказа. Достижимо не только при пустой таблице: флаг isDefault перекидывается через warehouse-multi-router.ts:76-77 (сначала снимает флаг со всех, потом ставит одному) — окно между этими двумя UPDATE и любой сбой между ними оставляют тенанта без склада по умолчанию.

**Как воспроизвести.** npx vitest run api/services/__tests__/zz-audit-probe.test.ts — PROBE M

**Предлагаемое решение.** Заменить `if (defaultWh)` на resolveOrderWarehouse(tx, tenantId), который бросает исключение.

**Чем подтверждено.** Пробник очищает таблицу warehouses и печатает записанные суммы плюс счётчик SQL по warehouse_stock (0).

---

## MEDIUM

### Клампы GREATEST(0, ...) применены непоследовательно: там, где кламп срабатывает, инвариант available = current_stock − reserved молча рвётся навсегда

**Где:** `api/services/order.ts:105` • **проверено запуском:** да

**Что происходит.** applyStockDelta (order.ts:105), applyPartialDelivery (order.ts:333) и все ветки курьера (courier-router.ts:389, 404, 429, 443) клампят reserved через GREATEST(0, ...), но пересчитывают available без клампа. Одновременно cancel (order.ts:771), delete (order.ts:1001), updateStatus (order.ts:909) и restore (order.ts:1244) клампа не имеют вовсе. Как только кламп срабатывает (reserved уже занижен, например после находки №2), reserved останавливается на 0, а available всё равно получает полную дельту — и C−R=A перестаёт выполняться.

**Что это значит на практике.** Расхождение необратимо: во всём репозитории нет ни одного места, которое пересчитывало бы available из current_stock − reserved (проверено grep по api/, db/, scripts/ — совпадений нет). Нет ни ремонтного джоба, ни generated column: available объявлен обычной decimal-колонкой (db/schema.ts:385). Любой дрейф остаётся в базе навсегда.

**Как воспроизвести.** grep -rn "current_stock - reserved" api/ db/ scripts/ — пусто; db/schema.ts:385 показывает, что available хранимая, а не вычисляемая.

**Предлагаемое решение.** Либо сделать available генерируемой колонкой (available = current_stock - reserved) и убрать её из всех UPDATE, либо привести клампы к единому правилу и добавить регулярную сверку. Смешение «SQL считает» и «JS считает» сейчас есть: webhooks/onec.ts:146-147 считает available в JS, всё остальное — в SQL.

**Чем подтверждено.** Подтверждено чтением исходников + grep: 'current_stock - reserved' / пересчёт available нигде не встречается вне самих мутаций. Само срабатывание клампа на живых данных не воспроизводилось — MySQL недоступен; но условие срабатывания создаётся находкой №2, которая воспроизведена (reserved=-4).

### warehouse.deleteAll стирает строки warehouseStock, не трогая открытые заказы, — их резервы становятся сиротами

**Где:** `api/warehouse-router.ts:273` • **проверено запуском:** нет

**Что происходит.** deleteAll (adminQuery) выполняет tx.delete(warehouseStock).where(eq(warehouseStock.tenantId, tenantId)) и переводит товары в inactive, но открытые заказы со статусами new/processing/shipped/pending продолжают существовать и по-прежнему считаются держателями резерва. После пересоздания строк (createMissing даёт 0/0/0, приход даёт C=q R=0 A=q) резерв уже потерян.

**Что это значит на практике.** Последующая отмена или удаление любого из этих ранее открытых заказов выполнит освобождение поверх reserved=0 — reserved уйдёт в минус, available превысит current_stock (тот же механизм, что в находке №2). Операция явно деструктивная и только для CEO, поэтому не critical, но последствие тихое и отложенное.

**Как воспроизвести.** Создать открытый заказ, вызвать warehouse.deleteAll, восстановить строку остатка приходом, затем отменить заказ и посмотреть reserved/available.

**Предлагаемое решение.** Блокировать deleteAll при наличии открытых заказов, либо в той же транзакции закрывать/отменять их, либо явно обнулять резервы и пересчитывать available.

**Чем подтверждено.** Чтение кода. Числовой прогон не делал — механизм идентичен воспроизведённому сценарию B (освобождение поверх недостаточного reserved), но конкретно эту последовательность не запускал. ТРЕБУЕТ ПРОВЕРКИ.

### OrderService.update recomputes `total` from an unlocked read of `subtotal` — racing updateItems it can bill the shop the pre-edit amount

**Где:** `api/services/order.ts:1037` • **проверено запуском:** нет

**Что происходит.** `update` reads the order at line 1037 with a plain select inside the transaction — no `.for("update")` — then at line 1053 computes `newTotal = subtotal − subtotal×discount%` and writes `orders.total`. `updateItems` concurrently rewrites `subtotal`, `discount` and `total` (line 1195). Neither locks the order row, so nothing serializes them; last writer wins, and if that is `update`, it writes a total derived from the subtotal as it was before the line edit.

**Что это значит на практике.** `orders.total` no longer matches the sum of the order's lines. recalcShopDebt bills the shop straight off `orders.total` (shop-debt.ts:52), so the shop is invoiced for goods it did not receive, or under-invoiced for goods it did. Silent — the order detail screen shows the wrong total as though it were correct. Rated medium rather than high only because it needs two operators editing the same order in the same seconds; I hesitated, because the amount is wrong with no upper bound on the error.

**Как воспроизвести.** Concurrently call order.update({discount}) and order.updateItems({items}) on the same order; compare orders.total against SUM(order_items.subtotal).

**Предлагаемое решение.** Add `.for("update")` to the order read in both `update` and `updateItems` — it also fixes the snapshot ordering in updateItems (separate finding).

**Чем подтверждено.** Code reading. Verified: neither order.ts:1037-1045 nor order.ts:1089-1093 carries `.for("update")`, while cancel (753), delete (980) and updateStatus (804) all do. Требует проверки прогоном.

### warehouse_stock rows are locked in two different orders across the codebase — per-item loops vs a single IN() statement — which deadlocks multi-product orders

**Где:** `api/services/order.ts:762` • **проверено запуском:** нет

**Что происходит.** Four call sites lock stock rows one row per statement, in order-item insertion order: cancel (line 762), delete (line 993), updateItems (line 1123), restore (line 1227), plus courier.markDelivered (line 209). Five others lock in a single `WHERE product_id IN (...) FOR UPDATE` statement, which InnoDB acquires in index order: create (line 616), updateStatus (line 876), StockService.reserve/release/deduct (lines 32/76/120). Two transactions touching the same two products in opposite order take the locks in opposite order.

**Что это значит на практике.** MySQL detects the cycle and kills one transaction with ER_LOCK_DEADLOCK. That is the good case: it rolls back cleanly and the user sees an error. The cost is a user-visible failure on a legitimate action, and inside `bulkUpdateStatus` (order.ts:1351) and `bulkCompleteWithPayment` (order.ts:1604) — which loop one transaction per order — a deadlock leaves earlier orders committed and later ones in `failed`, i.e. a half-applied batch that the operator must reconcile by hand. Rated medium and not higher because it fails loudly rather than corrupting a number.

**Как воспроизвести.** Order A with items [product 5, product 2] and order B with items [2, 5]; cancel A while creating B. Expect ER_LOCK_DEADLOCK on one of them.

**Предлагаемое решение.** Sort product ids ascending before every lock loop, and replace the per-item loops with a single `inArray(warehouseStock.productId, sortedIds).for("update")` — one statement, one consistent order, and it also removes N round-trips.

**Чем подтверждено.** Code reading of the lock-acquisition order at each of the ten sites listed. Требует проверки прогоном на MySQL — I could not run concurrent sessions here.

### Возврат без привязки к заказу (order_id NULL) никогда не уменьшает базу комиссии

**Где:** `api/services/kpi.ts:395` • **проверено запуском:** да

**Что происходит.** Оба подзапроса по возвратам используют innerJoin(orders, eq(returns.orderId, orders.id)). returns.orderId nullable (db/schema.ts:288, onDelete: 'set null'), а returns.create принимает orderId как optional (api/returns-router.ts:96). Такой возврат в JOIN не попадает.

**Что это значит на практике.** Товар физически вернулся на склад (стоки и долг магазина пересчитаны), но комиссия агента считается так, будто продажа состоялась. Агент оставляет себе процент с возвращённого товара. Тот же JOIN обнуляет вычет и в случае, когда исходный заказ мягко удалили (order_id → NULL по FK ON DELETE SET NULL при жёстком удалении заказа).

**Как воспроизвести.** npx vitest run api/__tests__/_audit-commission-evidence.test.ts --silent=false → кейс "E. a return not linked to an order is never subtracted".

**Предлагаемое решение.** Вычитать возвраты по returns.agentId и returns.createdAt (или LEFT JOIN с COALESCE), а не только через JOIN по заказу.

**Чем подтверждено.** Кейс E: заказ 1 000 000, completed-возврат на 400 000 с orderId=null → "sales with a 400 000 unlinked completed return: 1000000, commission = 100000". Оговорка: ни веб-, ни мобильный клиент сейчас не создают возвраты (единственная точка вставки — tRPC returns.create), так что достижимость зависит от внешних интеграций/1С.

### Даты периодов строятся через toISOString() от локальных Date — при TZ≠UTC ключ месяца уезжает на день

**Где:** `api/services/kpi.ts:446` • **проверено запуском:** нет

**Что происходит.** monthStart/monthEnd = periodStart.toISOString().slice(0,10) от Date, собранного в ЛОКАЛЬНОМ времени (new Date(y, m, 1) в getPeriod, api/kpi-router.ts). То же в commission-router.ts:63-64 (setRate). Одновременно periodStart/periodEnd читаются из DATE-колонки как локальная полночь и сравниваются с timestamp-колонкой, а drizzle сериализует Date через toISOString (node_modules/drizzle-orm/mysql-core/columns/timestamp.js, mapToDriverValue).

**Что это значит на практике.** При TZ процесса = UTC (текущий Dockerfile на node:20-alpine, TZ нигде не задаётся) — арифметика сходится, но границы месяца проходят в 05:00 по Ташкенту: заказ, созданный 1-го числа между 00:00 и 05:00 местного, попадёт в комиссию прошлого месяца. Если TZ контейнера когда-нибудь выставят в Asia/Tashkent, ломается ключ периода: месяц августа сохранится как period_start='2026-07-31', а commission.calculate ищет `period_start >= '2026-08-01'` → 0 строк, комиссии за месяц не считаются вообще и никакой ошибки не показывается. Отдельно: клиент строит periodStart в браузерном часовом поясе (src/pages/AgentKpi.tsx:453), т.е. уже сейчас шлёт на сервер "2026-07-31" вместо "2026-08-01".

**Как воспроизвести.** node scratchpad/date-bounds.mjs под TZ=UTC и под TZ=Asia/Tashkent (скрипт лежит в scratchpad, см. ниже).

**Предлагаемое решение.** Строить границы периода как UTC-даты (Date.UTC) либо форматировать ключ месяца локальными компонентами (getFullYear/getMonth/getDate), но одинаково на сервере и на клиенте; зафиксировать TZ контейнера явно.

**Чем подтверждено.** Механизм доказан скриптом на реальном drizzle+mysql2 (scratchpad/date-bounds.mjs): TZ=UTC → params ["2026-01-01 00:00:00.000","2026-01-31 23:59:59.999"], persisted period_start "2026-08-01"; TZ=Asia/Tashkent → params ["2025-12-31 19:00:00.000","2026-01-31 18:59:59.999"], persisted period_start "2026-07-31", setRate month keys "2026-07-31 -> 2026-08-30". ТРЕБУЕТ ПРОВЕРКИ на проде: TZ контейнера и SELECT @@global.time_zone у MySQL — доступа к БД у меня не было.

### План продаж выбирается без привязки к периоду (в KPI — даже без фильтра periodType)

**Где:** `api/services/kpi.ts:258` • **проверено запуском:** да

**Что происходит.** В calculateAgentKpi: `.from(salesTargets).where(and(eq(tenantId), eq(userId))).limit(1)` — ни periodType, ни диапазона дат, ни orderBy. MySQL вернёт произвольную строку, в том числе daily-план. В calculateSalary (строка 414) фильтр periodType='monthly' есть, но периода нет — берётся последний по periodStart план, каким бы старым он ни был.

**Что это значит на практике.** targetProgress ("выполнение плана") может считаться от дневного плана, показывая сотни процентов или наоборот. baseSalary/штраф за фрод берутся из плана чужого месяца. При просмотре исторического периода цифры относятся к другому периоду.

**Как воспроизвести.** Завести агенту daily-план и monthly-план и открыть KPI: targetRevenue возьмётся из произвольной строки.

**Предлагаемое решение.** Фильтровать план по periodType и по пересечению с запрошенным периодом, детерминированно упорядочивать.

**Чем подтверждено.** Чтение кода: в запросе на строках 258-263 условий, кроме tenantId и userId, нет; на 414-421 нет ограничения по датам периода. Отдельного прогона не делал — предикаты видны буквально.

### Список агентов у супервайзера считает выручку по удалённым заказам и без вычета возвратов

**Где:** `api/services/kpi.ts:547` • **проверено запуском:** да

**Что происходит.** В getAgentList запрос по заказам (строки 549-559) содержит tenantId, статус, диапазон дат и agentId — но НЕ содержит isNull(orders.deletedAt), в отличие от calculateAgentKpi (строка 138) и commission.calculate. Возвраты в getAgentList не вычитаются вовсе.

**Что это значит на практике.** Мягко удалённый заказ продолжает приносить агенту выручку и KPI-балл в списке супервайзера. Цифра выручки в списке не совпадает с той, что видит сам агент и по которой считается комиссия — при разборе "почему у меня другая сумма" доверие к обеим цифрам теряется. Прямой выплаты отсюда нет, поэтому не high.

**Как воспроизвести.** Мягко удалить доставленный заказ и сравнить revenue в kpi.agentList и в kpi.agentDetail для того же агента.

**Предлагаемое решение.** Добавить isNull(orders.deletedAt) и вычет completed-возвратов, как в calculateAgentKpi.

**Чем подтверждено.** Чтение кода: сравнение условий в трёх запросах по orders (строки 130-141 vs 549-559); отсутствие джойна с returns в getAgentList.

### OrderService.restore reads deletedAt outside the transaction and its UPDATE has no deletedAt predicate — concurrent restores re-reserve stock twice

**Где:** `api/services/order.ts:1209` • **проверено запуском:** да

**Что происходит.** restore reads the order with db.select (line 1209-1212, outside the transaction, no lock) and throws if !deletedAt. The transaction that follows sets `deletedAt: null` with no `WHERE deleted_at IS NOT NULL` predicate (line 1218) and then re-reserves stock (line 1232-1247). The FOR UPDATE on warehouse_stock at line 1227-1231 serializes the writes but does not deduplicate them, and nothing re-reads the order's deletedAt. This is the odd one out among the order lifecycle methods: cancel (line 750-753) and delete (line 973-980) both take the lock inside the transaction with the status/deletedAt predicate in the locking SELECT, which is what makes them safe.

**Что это значит на практике.** reserved inflated and available deflated by the full order quantity, permanently. The warehouse then refuses to sell goods it physically holds, and the shortfall never surfaces as an error — it just looks like less stock. Also note the available >= qty check at line 1239 is evaluated per call before either commits, so it does not catch it.

**Как воспроизвести.** —

**Предлагаемое решение.** Not fixing this pass. Move the read inside the transaction with .for("update"), or put `isNotNull(orders.deletedAt)` on the UPDATE and check affectedRows === 1, matching what delete/cancel already do.

**Чем подтверждено.** Fired two concurrent OrderService.restore calls on the same soft-deleted 10-unit order. Printed: `[D] results=fulfilled,fulfilled` and `[D] reserved 10.00 -> 30.00, available 40.00 -> 20.00 (order qty 10)`. Neither call threw 'Заказ не удалён'; the reservation was applied twice.

### 1C payment webhook's idempotency check is a read-then-write outside the transaction, and is skipped entirely when `reference` is absent

**Где:** `api/webhooks/onec.ts:71` • **проверено запуском:** нет

**Что происходит.** The duplicate check at line 71-78 selects payments where notes = `1C: ${reference}` before the transaction opens, with no unique index backing it (payments.notes is a TEXT column with no index, db/schema.ts:494-503). Two concurrent deliveries of the same webhook both see no row and both insert. Separately, the whole check is inside `if (reference)` — when 1C posts without a reference the notes become the constant '1C: Payment' and there is no dedup at all, so every redelivery inserts another payment.

**Что это значит на практике.** Same money damage as finding 1 (shop debt reduced twice for one payment), arriving from the integration rather than the UI. Lower than finding 1 because a reference is normally supplied and 1C redeliveries are typically sequential, where the existing check does work.

**Как воспроизвести.** —

**Предлагаемое решение.** Not fixing this pass. Wants a dedicated external_reference column with a unique index per tenant, and rejecting payloads with no reference.

**Чем подтверждено.** Read the full handler and the payments schema; confirmed there is no unique index on notes and confirmed recalcShopDebt sums all order_id IS NULL payment rows. I did not run this path — требует проверки against a real MySQL to confirm the concurrent-insert window and that the notes lookup behaves as expected on a TEXT column.

### orders.subtotal (round-after-sum) does not equal SUM(order_items.subtotal) (round-per-line)

**Где:** `api/services/order.ts:605` • **проверено запуском:** да

**Что происходит.** create accumulates `subtotal += unitPrice * Number(item.quantity)` in full precision and stores `subtotal.toFixed(2)` (line 640), while each line is stored as `(unitPrice * Number(item.quantity)).toFixed(2)` (line 653) — rounded individually. The same split exists in updateItems (1155/1196), applyPartialDelivery (317/370), courier completeDelivery (463) and returns-router (181/193, where returns.totalAmount is the sum-then-rounded value and return_items.subtotal are round-per-line). Only bites when a line value has more than 2 decimals, i.e. fractional quantities (кг/л, which the DECIMAL(10,2) quantity column exists to support).

**Что это значит на практике.** A 4-line order with 2.5 kg / 1.5 kg quantities: orders.subtotal 16942.43 vs SUM(order_items.subtotal) 16942.45 — 2 kopeks. Small per order, but it is the reason the two revenue aggregates above can never be reconciled exactly even after the gross/net issue is fixed. For returns it matters more: returns.totalAmount is what recalcShopDebt subtracts from the shop's balance, while the lines are what an operator eyeballs.

**Как воспроизвести.** —

**Предлагаемое решение.** Round each line first and sum the rounded lines for the order-level subtotal, so the header always equals the sum of what is printed under it. Prefer Math.round(x*100)/100 over toFixed for the rounding itself.

**Чем подтверждено.** Computed both for {1999.99×2.5, 1999.99×2.5, 4550.55×1.5, 33.33×3.5}: lines 4999.98/4999.98/6825.83/116.66 sum to 16942.45, orders.subtotal = 16942.43, difference −0.02. Also printed toFixed(2) on binary-inexact halves: (2.675).toFixed(2) = 2.67 while Math.round(2.675*100)/100 = 2.68, and (1.005).toFixed(2) = 1.00. Script block P3.

### A non-numeric discount passes both guards in OrderService.create/update and reaches the DECIMAL columns as the string "NaN"

**Где:** `api/services/order.ts:549` • **проверено запуском:** да

**Что происходит.** order-router.ts:233 declares `discount: z.union([z.number(), z.string()]).transform(String).default("0.00")` — any string is accepted and `.default` only fires on undefined, so an explicit null becomes the string "null". create then does `Number(input.discount)` and checks `< 0` and `> 100`; both comparisons are false for NaN, so NaN passes. discount = subtotal × NaN/100 = NaN, total = NaN, and `.toFixed(2)` yields the literal string "NaN" which is handed to MySQL for orders.discount and orders.total. OrderService.update (line 1031) is identical. arrival-router.ts:110 has the same shape: decimalOrDefault maps "" to a default but is `z.string()` underneath, so fuelCost "abc" gives totalExpense "NaN".

**Что это значит на практике.** MySQL 8's default sql_mode includes STRICT_TRANS_TABLES and connection.ts sets no sql_mode override, so this should surface as a 1366 error and roll back the whole create — loud, not silent. If any deployment runs non-strict (the zod-decimal.ts comment says 'a 500 under strict SQL mode', implying the team is aware but not enforcing), the order is created with discount 0.00 and total 0.00 and the shop owes nothing for goods that left the warehouse. The empty-string case is safe: Number("") is 0.

**Как воспроизвести.** POST order.create with discount: "7%" (a plausible thing for a client to send from a percentage input).

**Предлагаемое решение.** Replace the union+transform with a coercing numeric schema that rejects NaN (`z.coerce.number().min(0).max(100)`), and add `Number.isFinite` to the service-level guards in create/update/arrival.

**Чем подтверждено.** Ran the exact guard chain over inputs "", "0", "7", "abc", "7%", "1 000", null. Printed: "abc" → Number NaN → guards PASS → discount "NaN" total "NaN"; same for "7%", "1 000" and null (String(null) = "null"). "" → 0, guards PASS, correct totals. Script block P6. The MySQL side (strict vs non-strict outcome) is NOT verified — no server was reachable in this environment. Требует проверки: run `SELECT @@sql_mode` on production and try INSERT ... VALUES ('NaN') into a DECIMAL column.

### courier.completeDelivery accepts paidAmount as a bare optional string: a non-numeric or missing value silently records no payment while the order is marked delivered and 'paid'

**Где:** `api/courier-router.ts:292` • **проверено запуском:** да

**Что происходит.** `paidAmount: z.string().optional()` with no refine, even for result: "paid". Line 469 does `paidAmount = Number(input.paidAmount ?? 0)`; line 491 guards the insert with `if (paidAmount > 0)`, which is false for both 0 and NaN. The order is still set to delivered at line 482, recalcShopDebt then charges the shop the full total, and the notification at line 529 announces '100% оплачен'. There is also no cap: paidAmount is never compared to orderTotal or to prior payments (unlike applyPartialPayment which does check), and it is written with `String(paidAmount)` rather than toFixed(2), so a value with more than 2 decimals is rounded by MySQL while debtAmount was computed in JS from the unrounded one.

**Что это значит на практике.** Courier reports full payment, system books the goods out, records no payment row, and bills the shop the whole invoice — while the CEO's notification says the order was paid in full. The current mobile client guards this (app/order/deliver.tsx:142 requires >0 and sends String(orderTotal) for 'paid'), so it is not reachable from the shipped app today; it is reachable from the offline replay queue with a stale value, from a retry, or from any other API consumer.

**Как воспроизвести.** —

**Предлагаемое решение.** Refine paidAmount to a finite non-negative number, make it required when result is paid/partial_paid, cap it at orderTotal minus prior payments, and write it with toFixed(2).

**Чем подтверждено.** Ran the server-side chain for paidAmount undefined/""/"abc"/"1 250 000"/"1250000". Printed: undefined→0, ""→0, "abc"→NaN, "1 250 000"→NaN all give `paidAmount > 0` false → NO PAYMENT ROW; order still marked delivered. Script block P6. Confirmed by reading courier-router.ts:469-511 that the status update at 482 is unconditional.

### SUM(CAST(total AS DECIMAL(10,2))) silently clamps any single order or shop balance above 99 999 999.99

**Где:** `api/services/kpi.ts:133` • **проверено запуском:** нет

**Что происходит.** orders.total is DECIMAL(12,2) (max 9 999 999 999.99) and shops.debt is DECIMAL(12,2), but the aggregates cast each row down to DECIMAL(10,2) before summing: kpi.ts:133 (agent revenue), kpi.ts:384 (salary salesAmount → commissionAmount), kpi.ts:551 (agent list revenue), kpi.ts:210 (shop debt), system-router.ts:70 (24h revenue). MySQL clamps an out-of-range CAST to the column maximum with a warning rather than erroring, and the cast is applied per row before SUM, so the clamp hits individual large orders. commission-router.ts:159 computes the SAME commission from SUM(orders.total) with no cast, so the two writers of commissions.salesAmount disagree for exactly these rows.

**Что это значит на практике.** A 250 000 000 сум order (≈$20k — an ordinary wholesale drop in UZS) is counted as 99 999 999.99 in the agent's revenue, in their sales target progress and, through calculateSalary line 409, in the commission actually paid to them. At a 3% rate that is 4.5 million сум of commission never paid, with nothing anywhere saying a number was clamped. shops.debt above 100 million is likewise understated in the KPI debt-collection metric.

**Как воспроизвести.** —

**Предлагаемое решение.** Cast to DECIMAL(15,2) everywhere (the precision recalcShopDebt and order-router.ts:142 already use), or drop the cast — the columns are already DECIMAL.

**Чем подтверждено.** NOT RUN — no MySQL server is reachable in this environment (127.0.0.1:3306 refused, no mysqld service installed, no docker). Verified by reading the column definitions in db/schema.ts (orders.total precision 12 scale 2, line 228; shops.debt line 114) against the cast precision in the five query sites. Требует проверки: run `SELECT CAST('250000000.00' AS DECIMAL(10,2)), @@sql_mode; SHOW WARNINGS;` on the production MySQL to confirm it clamps to 99999999.99 with warning 1264 rather than erroring, and `SELECT MAX(CAST(total AS DECIMAL(15,2))) FROM orders` to see whether any tenant is actually over the line today.

### CAST(x AS DECIMAL) with no precision is DECIMAL(10,0) — it rounds kopeks and weights away per row before the SUM

**Где:** `api/shop-router.ts:20` • **проверено запуском:** нет

**Что происходит.** Ten query sites cast a fractional DECIMAL column to bare DECIMAL, which MySQL defines as DECIMAL(10,0): shop-router.ts:20 (SUM of shops.debt for the shops header), shop-router.ts:64 (`CAST(debt AS DECIMAL) > 0` — the onlyDebtors filter), shop-router.ts:67/68/390 and analytics-router.ts:184 and NotificationService.ts:213 (debt sort order), territory-router.ts:19, services/kpi.ts:598, order-router.ts:48 (orders page totalRevenue), plus courier-router.ts:26/56 and warehouse-router.ts:61 and warehouse-multi-router.ts:126 on products.unit_weight, which is DECIMAL(10,3).

**Что это значит на практике.** Money: each shop's debt and each order's total is rounded to whole сум before summing, so the header figure on the Shops page and the totalRevenue on the Orders page drift from SUM(debt)/SUM(total) by up to half a сум per row, and a shop owing 0.40 is excluded from the debtors list entirely because CAST rounds it to 0. Weight: a 0.750 kg product becomes 1 kg (or 0.4 kg becomes 0), so the courier's totalWeightKg per delivery and the warehouse total weight are wrong by up to 100% for light goods — that is the number a courier uses to decide whether a load fits in the van.

**Как воспроизвести.** —

**Предлагаемое решение.** Give every CAST an explicit precision matching or exceeding the source column: DECIMAL(15,2) for money, DECIMAL(15,3) for weight.

**Чем подтверждено.** NOT RUN against MySQL (no server reachable). Verified by reading each call site against the column scale in db/schema.ts: shops.debt DECIMAL(12,2) line 114, orders.total DECIMAL(12,2) line 228, products.unitWeight DECIMAL(10,3) line 143, orderItems.quantity DECIMAL(10,2) line 265. Требует проверки: `SELECT CAST('1234.56' AS DECIMAL), CAST('0.750' AS DECIMAL);` — expected 1235 and 1.

### analytics.pnl compares the current period against a previous period one day shorter

**Где:** `api/analytics-router.ts:242` • **проверено запуском:** да

**Что происходит.** periodMs = to − from, prevFrom = from − periodMs, prevTo = from − 1 day. calcPeriod filters `createdAt >= dateFrom AND createdAt <= dateTo + ' 23:59:59'`, so the current window is inclusive of both endpoints (periodMs/day + 1 days) while the previous window spans periodMs/day days. Every 'vs previous period' delta on the P&L — revenue, COGS, gross profit, operating expenses, net profit — is computed across two windows of different length.

**Что это значит на практике.** A flat business shows growth. Month over month the bias is +3.3%; on a fortnight comparison +7.1%; on a week +16.7%. These are the deltas a CEO reads to decide whether the last week worked.

**Как воспроизвести.** —

**Предлагаемое решение.** prevFrom = from − (periodMs + MS_PER_DAY), so both windows cover the same number of inclusive days.

**Чем подтверждено.** Ran the exact date arithmetic for three ranges. Printed: 2026-07-01..07-31 = 31 days vs previous 2026-06-01..06-30 = 30 days, bias 3.3%; 07-01..07-15 = 15 vs 06-17..06-30 = 14, bias 7.1%; 08-01..08-07 = 7 vs 07-26..07-31 = 6, bias 16.7%. Script block P10.

### commission.calculate overwrites approved and paid commission rows, and computes salesAmount differently from calculateSalary

**Где:** `api/commission-router.ts:162` • **проверено запуском:** нет

**Что происходит.** Two code paths write commissions.salesAmount / commissionAmount for the same row. services/kpi.ts:448 guards with `(!commissionRecord || commissionRecord.status === 'pending')` and re-checks `eq(commissions.status,'pending')` in the WHERE — deliberately, per its own comment about finance having signed off. commission-router.ts:162 has no status guard at all and updates by id alone. They also disagree arithmetically: kpi.ts uses SUM(CAST(total AS DECIMAL(10,2))) while commission-router uses SUM(orders.total) uncast.

**Что это значит на практике.** Re-running 'calculate' for a period silently rewrites commissions that were already approved or marked paid, to a figure that differs from the one the salary screen produced for the same agent and period. Whichever ran last wins, and there is no audit row.

**Как воспроизвести.** —

**Предлагаемое решение.** Mirror kpi.ts: add `eq(commissions.status, 'pending')` to the WHERE, and unify the salesAmount query between the two paths.

**Чем подтверждено.** Code read only — I compared the two write paths and their WHERE clauses side by side. Not executed. Требует проверки with a real row: approve a commission, then call commission.calculate for that period and re-read the row.

### Полностью возвращённый заказ сохраняет полный orders.total, а плитка «ВЫРУЧКА» на странице заказов суммирует total без фильтра по статусу

**Где:** `api/order-router.ts:46` • **проверено запуском:** да

**Что происходит.** В order.stats условия — только tenantId и deletedAt IS NULL (строки 25, 46-51), статус в фильтр не входит, если его не задал пользователь. При этом courier.completeDelivery с result='returned' (courier-router.ts:398-407) ставит status='returned', но orders.total, subtotal и discount не обнуляет. Аналогично analytics.agentPerformance (api/analytics-router.ts:68-84) считает SUM(orders.total) вообще без фильтров по статусу и без isNull(deletedAt). Все остальные отчёты корректно фильтруют по REVENUE_ORDER_STATUSES.

**Что это значит на практике.** ЗАПУЩЕНО (PROBE H): после полного возврата orders.status='returned', но total='1800.00', subtotal='2000.00'. Плитка «ВЫРУЧКА» на странице «Заказы» (src/pages/Orders.tsx:701-703) показывает эти 1800 как выручку, наравне с отменёнными заказами. Долг магазина при этом посчитан правильно (recalcShopDebt исключает cancelled/returned), то есть цифра на экране расходится с бухгалтерией и с дашбордом аналитики, который фильтрует по 'delivered'. Оператор видит два разных числа выручки на двух страницах.

**Как воспроизвести.** npx vitest run api/__tests__/zz-audit-courier-probe.test.ts — PROBE H; фильтры в order-router.ts:25-51 и analytics-router.ts:68-84 прочитаны построчно

**Предлагаемое решение.** Добавить inArray(orders.status, REVENUE_ORDER_STATUSES) в order.stats.totalRevenue и в analytics.agentPerformance (плюс isNull(deletedAt) во второй).

**Чем подтверждено.** Значение orders.total после возврата подтверждено прогоном; отсутствие фильтра по статусу — чтением кода.

### order_items.quantity не уменьшается ни одной из реализаций частичной доставки — себестоимость и «продано штук» считают возвращённый товар

**Где:** `api/services/order.ts:314` • **проверено запуском:** да

**Что происходит.** applyPartialDelivery пишет deliveredQuantity и subtotal, но quantity оставляет заказанным (order.ts:314-318). courier-router.ts:449-451 пишет только deliveredQuantity. Отчёты при этом берут выручку из orders.total (правильно, уменьшено), а себестоимость и количество — из order_items.quantity: `SUM(orderItems.quantity * costPrice)` в analytics-router.ts:110 и 133, `SUM(orderItems.quantity)` в analytics-router.ts:60.

**Что это значит на практике.** Заказ 10 шт по 100 при себестоимости 60: доставлено 6. Выручка в отчёте 600 (верно), COGS 600 вместо 360 → валовая маржа показана нулевой вместо 240. Крайний случай ЗАПУЩЕН (PROBE B): при deliveredQuantity=0 по всем строкам applyPartialDelivery ставит status='delivered' с subtotal/discount/total = '0.00', а quantity остаётся 10 и 5 — заказ попадает в REVENUE_ORDER_STATUSES и даёт полную себестоимость при нулевой выручке. Директор видит систематически заниженную маржу и завышенное «продано штук» — тем сильнее, чем чаще магазины возвращают товар.

**Как воспроизвести.** npx vitest run api/services/__tests__/zz-audit-probe.test.ts — PROBE B; запросы в api/analytics-router.ts:60,110,133

**Предлагаемое решение.** Либо приводить quantity к deliveredQuantity при закрытии, либо во всех отчётах использовать COALESCE(delivered_quantity, quantity).

**Чем подтверждено.** Значения после частичной доставки получены прогоном; влияние на отчёты — чтением SQL-проекций (это чистое чтение, не прогон отчётов).

### Модалка завершения заказа всегда отправляет deliveredQuantity=0 для частично возвращённой строки, показывая при этом «оставлено 7»

**Где:** `src/components/orders/CompletionFlowModal.tsx:174` • **проверено запуском:** да

**Что происходит.** `deliveredQuantity: it.isReturned ? 0 : it.orderedQty - it.returnedQty`. Поле ввода количества возврата рендерится только внутри ветки `it.isReturned` (строки ~250-265), а toggleReturned при включении сразу ставит returnedQty = orderedQty. Значит returnedQty может быть ненулевым только когда isReturned=true — то есть ветка `it.orderedQty - it.returnedQty` недостижима, и частичный возврат по количеству всегда превращается в полный. При этом плитки внизу модалки считают totalKept = orderedQty - returnedQty и показывают оператору «Оставлено 7 / Возврат 3».

**Что это значит на практике.** Оператор отмечает «вернули 3 из 10», видит на экране «Оставлено 7», а на сервер уходит deliveredQuantity=0: строка обнуляется в сумме заказа целиком (магазин получает 7 единиц бесплатно) и на склад возвращается available + 10 при физически вернувшихся 3. Сегодня это латентно: единственный зарегистрированный режим — COMPLETION_STATUSES = { delivered: 'partial_payment' } (useCompletionFlow.ts:9-11 и Orders.tsx:234-236), а showReturnItems (строка 96) истинно только для 'partial_return'/'combined', которые нигде не выставляются. То есть веб-приложение сегодня вообще не умеет оформлять частичный возврат — единственный живой путь частичного возврата это курьерский. Мина сработает в тот день, когда режим включат.

**Как воспроизвести.** —

**Предлагаемое решение.** deliveredQuantity: Math.max(0, it.orderedQty - it.returnedQty) — флаг isReturned уже выражен через returnedQty === orderedQty.

**Чем подтверждено.** Прочитаны все три места вызова модалки и все присвоения completionMode (grep по setCompletionMode / COMPLETION_STATUSES) — 'partial_return' и 'combined' не выставляются нигде, кроме начального значения useState, которое перезаписывается getCompletionMode до открытия.

### Полный возврат с непогашенным полем даты создаёт напоминание о долге на всю сумму заказа

**Где:** `api/courier-router.ts:514` • **проверено запуском:** нет

**Что происходит.** `if (debtAmount > 0 && debtDueDate)` — при result='returned' orderTotal остаётся полным (заказ не обнуляется), paidAmount = 0, значит debtAmount = полная сумма заказа, и вставляется строка debtReminders на неё. В мобильном приложении (Warehouse-Pro-Mobile/app/order/deliver.tsx) состояние debtDueDate объявлено на строке 61 и не сбрасывается при смене result (setResult вызывается только на строке 231, без очистки полей), а на строке 176 отправляется всегда: `debtDueDate: debtDueDate || undefined`.

**Что это значит на практике.** Курьер выбирает «Частичная оплата», вводит дату, потом передумывает и переключается на «Возврат» — на сервер уходит debtDueDate. Создаётся debtReminders на полную сумму заказа (1800) против заказа со статусом 'returned', который по recalcShopDebt не должен ничего. В списке напоминаний о долгах у магазина появляется фантомная задолженность, по которой ему будут звонить, при том что shops.debt её не содержит.

**Как воспроизвести.** Требует проверки на устройстве: выбрать «Частичная оплата», заполнить дату, переключить на «Возврат», отправить, затем посмотреть таблицу debt_reminders.

**Предлагаемое решение.** Не создавать напоминание при finalStatus='returned'; на клиенте сбрасывать debtDueDate/paidAmount при смене result.

**Чем подтверждено.** Код обеих сторон прочитан построчно; вставка debtReminders в пробнике не моделировалась (мок глотает insert), поэтому статус — требует проверки.

---

## LOW

### applyStockDelta молча теряет освобождение, если строка warehouseStock отсутствует, но всё равно пишет движение в леджер

**Где:** `api/services/order.ts:103` • **проверено запуском:** нет

**Что происходит.** При delta < 0 (уменьшение или удаление строки заказа) проверка наличия остатка не выполняется, и UPDATE на строках 103-107 (режим reserve) или 125-129 (режим consumed) может затронуть 0 строк. Результат affectedRows не проверяется. При этом в режиме consumed сразу после этого безусловно вызывается recordStockMovement (строки 130-135).

**Что это значит на практике.** Резерв не освобождается, но в stock_movements появляется запись о движении товара, которого не было. Сумма движений перестаёт сходиться с current_stock — леджер, который по своему же комментарию (stock-ledger.ts:31-42) должен быть сверяемым, теряет это свойство. Требует отсутствующей строки остатка, что нетипично, отсюда low.

**Как воспроизвести.** Удалить строку warehouse_stock для товара, входящего в доставленный заказ, затем через orders.updateItems уменьшить количество этой позиции и сравнить stock_movements с current_stock.

**Предлагаемое решение.** Проверять affectedRows у обоих UPDATE и падать при 0, как это уже делает updateStatus для статуса заказа (строки 938-940); recordStockMovement вызывать только после подтверждённого изменения.

**Чем подтверждено.** Чтение кода. Не воспроизводил — сценарий требует состояния БД (товар в заказе без строки warehouse_stock на складе по умолчанию), которое я не мог создать без MySQL. ТРЕБУЕТ ПРОВЕРКИ.

### updateLoadingListStatus is a check-then-act with no transaction and no lock

**Где:** `api/services/order.ts:1523` • **проверено запуском:** нет

**Что происходит.** Reads the loading list's status at line 1531 and writes the new one at line 1545 with no lock, no transaction, and no status condition in the UPDATE's WHERE.

**Что это значит на практике.** Two concurrent transitions both validate against the same starting status and both apply, so a list can skip a stage (preparing→ready and preparing→ready both succeed, or a later state gets overwritten by an earlier one). No stock or money moves on this path — loading list status is paperwork only — which is why this is low.

**Как воспроизвести.** Call updateLoadingListStatus twice concurrently for the same list.

**Предлагаемое решение.** Add the current status to the UPDATE's WHERE and throw on affectedRows !== 1.

**Чем подтверждено.** Code reading. Требует проверки прогоном.

### returnRate штрафует агента за отклонённые и ещё не проведённые возвраты

**Где:** `api/services/kpi.ts:164` • **проверено запуском:** да

**Что происходит.** Запрос returnStats фильтрует только по tenantId, agentId и дате — без фильтра по returns.status. Считаются pending, approved и даже rejected возвраты.

**Что это значит на практике.** returnRate занижает kpiScore (вес 0.15), а бонус = 2% × продажи × kpiScore/100 → агент теряет часть бонуса из-за возврата, который отклонили, то есть который не состоялся. Величина потери мала (единицы процентов бонуса), поэтому low.

**Как воспроизвести.** Создать возврат, отклонить его (updateStatus → rejected) и сравнить kpiScore/bonusAmount до и после.

**Предлагаемое решение.** Считать returnCount только по completed (или хотя бы исключить rejected).

**Чем подтверждено.** Чтение кода: строки 164-171 (нет условия по status) против строк 148-158, где для денежного вычета status='completed' есть.

### Процедура-запрос kpi.salary выполняет запись — гонка между агентом и отчётом супервайзера

**Где:** `api/kpi-router.ts:141` • **проверено запуском:** нет

**Что происходит.** kpi.salary и kpi.salaryReport объявлены как .query, но внутри calculateSalary делает UPDATE/INSERT в commissions при persist=true. Транзакции и блокировки строки нет.

**Что это значит на практике.** Один и тот же ряд commissions пишут одновременно агент (свой экран) и супервайзер (salaryReport по всем агентам). Плюс любой рефетч/ретрай кэша клиента порождает запись. Последствия перекрываются находками 1 и 4; самостоятельный ущерб — недетерминированные значения в строке.

**Как воспроизвести.** Требует параллельных запросов к реальной MySQL; на моках не показывается.

**Предлагаемое решение.** Вынести запись в отдельную мутацию/крон, либо оборачивать в транзакцию с SELECT ... FOR UPDATE.

**Чем подтверждено.** Только чтение кода (api/kpi-router.ts:136-171, api/services/kpi.ts:444-472). Гонку не воспроизводил — нет доступа к реальной БД.

### applyPartialDelivery rebuilds orders.subtotal from only the items the caller listed, dropping any line it did not mention

**Где:** `api/services/order.ts:279` • **проверено запуском:** нет

**Что происходит.** newSubtotal starts at 0 and accumulates only inside `for (const item of input.items)`, then line 370 writes it as the order's whole subtotal. Unlike updateItems, which explicitly re-adds untouched existing lines at line 1182-1186, there is no such loop here. The router schema is `.min(1)` — it does not require the caller to cover every line. Untouched lines also keep their warehouse reservation forever, since the reserved-release only runs per listed item.

**Что это значит на практике.** A partial-delivery call covering 1 of 3 lines collapses the order total to that line's value, so the shop is never billed for the other two and their stock stays reserved indefinitely. The web CompletionFlowModal maps over all itemStates and the mobile app does not call this endpoint at all, so it is not reachable from the shipped clients — it is an unenforced server-side contract, one client change away from being live.

**Как воспроизвести.** —

**Предлагаемое решение.** Either add the same 'lines the caller did not mention still count' loop updateItems has, or reject the call when input.items does not cover every order line.

**Чем подтверждено.** Code read: traced newSubtotal through applyPartialDelivery (order.ts:279-374) and confirmed no loop over unlisted existing items, then compared against updateItems line 1182-1186 which does have one. Confirmed the web caller sends all lines (src/components/orders/CompletionFlowModal.tsx:172) and grep found no mobile caller. Not executed against a database.

### Saving an order without changing anything moves orders.total by a kopek after a partial delivery

**Где:** `src/components/orders/OrderSlideOver.tsx:295` • **проверено запуском:** да

**Что происходит.** orders.discount is stored as money; the update API takes a percentage. startEditing re-derives the percentage as `Math.round(discount/subtotal*100 * 100)/100` — quantised to 0.01% — and saveEdits always sends it, even when the operator only edited the notes. OrderService.update (order.ts:1054) then recomputes discount and total from that quantised percentage. After applyPartialDelivery has rescaled the discount, the stored percentage is no longer a clean 2-decimal value, so the round trip is lossy.

**Что это значит на практике.** orders.total moves by ±0.01 on a save that changed nothing, and that kopek flows straight into shops.debt via recalcShopDebt. Cosmetically it makes the order history show an adjustment nobody made.

**Как воспроизвести.** —

**Предлагаемое решение.** Only send `discount` when the operator actually edited that field, or store the percentage alongside the money amount so it never has to be reverse-engineered.

**Чем подтверждено.** Simulated 200 000 orders through create → partial delivery of a random fraction → no-op save. 24 804 of 200 000 (12.4%) changed orders.total. Printed rows include {subtotal 2848688.43, storedPct 12.5, uiPct 12.5, totalBefore 2492602.37, totalAfterNoOpSave 2492602.38} and one −0.01 case. Script block P5b.

### quota-suggest averages revenue over months that had sales rather than over the window

**Где:** `api/services/quota-suggest.ts:91` • **проверено запуском:** нет

**Что происходит.** `monthsOfData = Math.max(monthlyRevenue.length, 1)` counts the GROUP BY rows returned, and a month with no delivered orders returns no row at all. avgRevenue then divides the 3-month total by the number of months that happened to have revenue.

**Что это значит на практике.** An agent who sold in 1 of the 3 look-back months gets a suggested quota equal to that single month's full revenue instead of a third of it — a target set three times too high, which then drives targetProgress, the KPI score and the bonus.

**Как воспроизвести.** —

**Предлагаемое решение.** Divide by the number of months in the window, not by monthlyRevenue.length.

**Чем подтверждено.** Code read only. The division and the GROUP BY are two lines apart and the semantics follow directly, but I did not execute it. Требует проверки: an agent with delivered orders in exactly one of the three months.

### subtotal, discount и total округляются независимо — сумма строк не сходится с шапкой на 1-2 тийина

**Где:** `api/services/order.ts:640` • **проверено запуском:** да

**Что происходит.** `subtotal.toFixed(2)`, `discount.toFixed(2)`, `total.toFixed(2)` считаются от неокруглённых чисел независимо друг от друга (order.ts:602-608, 640), а order_items.subtotal округляется отдельно по каждой строке (order.ts:653). Тот же приём в updateItems (1191-1198), applyPartialDelivery (360-372) и courier-router.ts:458-465.

**Что это значит на практике.** ЗАПУЩЕНО (scratchpad/rounding.mjs, 200000 случайных заказов с ценами и количествами в 2 знака): в 50211 случаях stored subtotal − stored discount ≠ stored total, в 48587 случаях SUM(order_items.subtotal) ≠ orders.subtotal. Максимальное расхождение 0.02. Для сумов это несущественно, но накладная, где строки в сумме дают 4548421.24, а шапка 4548421.23, вызывает вопросы у бухгалтерии.

**Как воспроизвести.** node <scratchpad>/rounding.mjs — воспроизводит арифметику OrderService.create строк 601-655

**Предлагаемое решение.** Считать total = Number(subtotal.toFixed(2)) − Number(discount.toFixed(2)) и брать orders.subtotal как сумму уже округлённых строк.

**Чем подтверждено.** Скрипт-брутфорс, копирующий выражения из create дословно.

### applyPartialDelivery не проверяет отрицательное deliveredQuantity — защита только в zod роутера

**Где:** `api/services/order.ts:304` • **проверено запуском:** да

**Что происходит.** Есть только `if (deliveredQty > orderedQty) throw`, нижней границы нет. Сейчас закрыто схемой `deliveredQuantity: z.number().min(0)` в api/order-router.ts:550 и :565 — оба вызывающих эндпоинта её имеют.

**Что это значит на практике.** ЗАПУЩЕНО (PROBE D, вызов на уровне сервиса): deliveredQuantity=-4 по строке из 10 → orders.subtotal='600.00' вместо 1600, и в SQL уходит `current_stock - (-4)` и `available + 14`, то есть склад получает 4 единицы из воздуха и 14 в available. Через tRPC сегодня недостижимо; это защита в глубину — новый вызывающий (1С-мост, импорт, внутренний скрипт) в обход роутера получит это молча.

**Как воспроизвести.** npx vitest run api/services/__tests__/zz-audit-probe.test.ts — PROBE D

**Предлагаемое решение.** Добавить `if (deliveredQty < 0) throw` рядом со строкой 304.

**Чем подтверждено.** Прогон сервисного метода напрямую; ограничение zod в роутере проверено чтением обеих схем.
