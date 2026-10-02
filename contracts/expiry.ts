/**
 * Скоро истекает срок — продастся ли партия до срока и что с ней делать.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Экран «Сроки годности» отвечал «что сгорает» — список партий с датой и
 * суммой. Директор видел «йогурт, 300 шт., через 12 дней» и не знал главного:
 * это уйдёт само или нет? Йогурт продаётся по 40 штук в день — успеет; соус
 * продаётся по одной бутылке в неделю — не успеет и через полгода. Одинаковые
 * строки, противоположные решения.
 *
 * ── Правило (все числа — здесь, одним местом) ───────────────────────────────
 *
 *  Темп — сколько товара уходит в день: доставленные заказы за последние
 *  PACE_WINDOW_DAYS дней минус проведённые возвраты за те же дни (то же
 *  правило, что у выручки: services/revenue-returns.ts), делённое на окно.
 *  Продают только с основного склада (решение владельца), поэтому темп —
 *  один на товар, и делят его только партии основного склада.
 *
 *  FEFO: отгрузка берёт первой партию, которая раньше сгорит
 *  (services/stock-ledger.ts consumeBatches). Значит, партия k получает
 *  только тот спрос, который остался после партий впереди неё:
 *
 *    продано_k = min(остаток_k, max(0, темп × дней_до_срока_k − Σ продано_впереди))
 *
 *  Дни до срока — без самого дня срока: магазин товар «годен до сегодня» не
 *  примет. Просроченные партии в дележе не участвуют — отгрузка их не берёт.
 *
 *  Вердикт партии — одно из пяти, и у каждого своё действие:
 *    expired   — срок вышел: списать (деньги уже потеряны);
 *    elsewhere — лежит не на основном складе: оттуда не продают, переместить;
 *    no_sales  — за окно ни одной продажи: сама не уйдёт;
 *    short     — продаётся, но не успеет: часть останется;
 *    sells     — успеет при нынешнем темпе, делать ничего не нужно.
 *
 *  Скидка — прозрачная лестница по дням до срока, без выдуманной
 *  эластичности: до 7 дней — 30 %, до 14 — 20 %, дальше — 10 %. Это
 *  умолчание; владелец может поменять числа в DISCOUNT_STEPS.
 *
 *  Деньги под риском — непроданный остаток по цене ЗАКУПКИ: столько сгорит
 *  вместе с товаром. Цена продажи здесь ни при чём — непроданное выручки не
 *  приносило. Закупку и маржу видит только директор (как P&L); остальным —
 *  тот же остаток по цене продажи.
 */

export const EXPIRY_RULES = {
  /** Окно темпа продаж, дней. Четыре недели — в нём одинаково будних и выходных. */
  PACE_WINDOW_DAYS: 28,
  /** Скидка по дням до срока: первая подходящая ступень (дней ≤ upToDays). */
  DISCOUNT_STEPS: [
    { upToDays: 7, pct: 30 },
    { upToDays: 14, pct: 20 },
  ] as ReadonlyArray<{ upToDays: number; pct: number }>,
  /** Скидка, когда до срока дальше последней ступени. */
  DISCOUNT_FAR_PCT: 10,
} as const;

export type ExpiryVerdict = "expired" | "elsewhere" | "no_sales" | "short" | "sells";

/** Вердикты, по которым надо что-то сделать до срока. */
export const ACTION_VERDICTS: readonly ExpiryVerdict[] = ["short", "no_sales", "elsewhere"];
export const needsAction = (v: ExpiryVerdict): boolean => ACTION_VERDICTS.includes(v);

/** Дней от одного «ГГГГ-ММ-ДД» до другого — по календарю, без часовых поясов. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.slice(0, 10).split("-").map(Number);
  const [ty, tm, td] = to.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * Темп продаж в день: продано минус возвращено за окно, делённое на окно.
 * Возвратов больше, чем продаж (вернули купленное до окна), — темп ноль, а
 * не отрицательный: «минус две бутылки в день» ничего не прогнозирует.
 */
export function salesPace(sold: number, returned: number, windowDays: number = EXPIRY_RULES.PACE_WINDOW_DAYS): number {
  if (!(windowDays > 0)) return 0;
  const net = (Number(sold) || 0) - (Number(returned) || 0);
  return net > 0 ? net / windowDays : 0;
}

export interface BatchFacts {
  batchId: number;
  productId: number;
  /** Партия на основном складе — только оттуда продают. */
  onDefault: boolean;
  /** Годен до, «ГГГГ-ММ-ДД». */
  expiresAt: string;
  quantity: number;
}

export interface BatchForecast {
  batchId: number;
  daysLeft: number;
  /** Сколько успеет продаться до срока при нынешнем темпе. */
  sold: number;
  /** Сколько останется к сроку. У просроченной — весь остаток. */
  unsold: number;
  /** Через сколько дней партия кончится при нынешнем темпе — только у тех, что успевают. */
  sellOutDays: number | null;
  verdict: ExpiryVerdict;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Прогноз по партиям: FEFO внутри товара на основном складе.
 *
 * Порядок партий с одинаковым сроком — как пришли во входе: вызывающий
 * отдаёт их в порядке списания (срок, дата прихода, id), сортировка здесь
 * устойчивая и смотрит только на срок.
 */
export function forecastBatches(
  batches: readonly BatchFacts[],
  paceOf: (productId: number) => number,
  today: string,
): Map<number, BatchForecast> {
  const out = new Map<number, BatchForecast>();
  const queue = new Map<number, Array<BatchFacts & { daysLeft: number }>>();

  for (const b of batches) {
    const daysLeft = daysBetween(today, b.expiresAt);
    const quantity = Math.max(0, Number(b.quantity) || 0);
    if (daysLeft < 0) {
      out.set(b.batchId, { batchId: b.batchId, daysLeft, sold: 0, unsold: quantity, sellOutDays: null, verdict: "expired" });
    } else if (!b.onDefault) {
      out.set(b.batchId, { batchId: b.batchId, daysLeft, sold: 0, unsold: quantity, sellOutDays: null, verdict: "elsewhere" });
    } else {
      const list = queue.get(b.productId) ?? [];
      list.push({ ...b, quantity, daysLeft });
      queue.set(b.productId, list);
    }
  }

  for (const [productId, list] of queue) {
    const pace = Math.max(0, paceOf(productId) || 0);
    const fefo = [...list].sort((a, b) => a.daysLeft - b.daysLeft);
    let ahead = 0;
    for (const b of fefo) {
      if (pace === 0) {
        out.set(b.batchId, { batchId: b.batchId, daysLeft: b.daysLeft, sold: 0, unsold: b.quantity, sellOutDays: null, verdict: "no_sales" });
        continue;
      }
      const room = Math.max(0, pace * b.daysLeft - ahead);
      const sold = Math.min(b.quantity, room);
      const unsold = round2(b.quantity - sold);
      const sells = unsold <= 0;
      out.set(b.batchId, {
        batchId: b.batchId,
        daysLeft: b.daysLeft,
        sold: round2(sold),
        unsold: sells ? 0 : unsold,
        // Кончится, когда спрос покроет всё впереди и её саму (см. правило в шапке).
        sellOutDays: sells ? Math.ceil((ahead + b.quantity) / pace - 1e-9) : null,
        verdict: sells ? "sells" : "short",
      });
      ahead += sold;
    }
  }
  return out;
}

/** Скидка по дням до срока — по лестнице DISCOUNT_STEPS. */
export function discountPctFor(daysLeft: number): number {
  for (const step of EXPIRY_RULES.DISCOUNT_STEPS) {
    if (daysLeft <= step.upToDays) return step.pct;
  }
  return EXPIRY_RULES.DISCOUNT_FAR_PCT;
}

/** Цена после скидки, до копеек — так же, как правило прайс-листа «к карточке». */
export function discountedPrice(price: number, pct: number): number {
  return Math.round((Number(price) || 0) * (100 - pct)) / 100;
}

export interface DiscountMoney {
  /** Цена после скидки минус закупка — за единицу. Отрицательная — в минус. */
  unitMargin: number;
  /** Цена после скидки ниже закупки. Без закупки (0) — не судим. */
  belowCost: boolean;
  costKnown: boolean;
  /** Вернётся, если продать весь непроданный остаток по этой цене. */
  recovered: number;
  /** Сгорит, если не продать ничего: остаток по закупке. */
  writeOff: number;
}

/**
 * Деньги скидки — только для директора (в них закупка).
 *
 * Продать ниже закупки — не обязательно ошибка: списание теряет закупку
 * целиком, а продажа в минус возвращает хотя бы часть. Решает человек;
 * здесь — только числа для этого решения.
 */
export function discountMoney(price: number, unitCost: number, unsold: number): DiscountMoney {
  const cost = Math.max(0, Number(unitCost) || 0);
  const costKnown = cost > 0;
  return {
    unitMargin: round2(price - cost),
    belowCost: costKnown && price < cost,
    costKnown,
    recovered: round2(unsold * price),
    writeOff: round2(unsold * cost),
  };
}

export interface ExpirySummaryRow {
  verdict: ExpiryVerdict;
  /** Непроданное к сроку по закупке; null — роль закупку не видит. */
  atRiskCost: number | null;
  /** Непроданное к сроку по цене продажи. */
  atRiskSale: number;
  markdown: unknown | null;
}

export interface ExpirySummary {
  /** Не успеют до срока (short, no_sales, elsewhere). */
  riskCount: number;
  riskCost: number | null;
  riskSale: number;
  expiredCount: number;
  expiredCost: number | null;
  expiredSale: number;
  sellsCount: number;
  /** Сколько из «не успеют» уже уценено. */
  markedDown: number;
}

/** Свод для плиток и главной директора — из тех же строк, что и список. */
export function summarizeExpiry(rows: readonly ExpirySummaryRow[]): ExpirySummary {
  const s: ExpirySummary = { riskCount: 0, riskCost: 0, riskSale: 0, expiredCount: 0, expiredCost: 0, expiredSale: 0, sellsCount: 0, markedDown: 0 };
  let hidden = false;
  for (const r of rows) {
    if (r.atRiskCost == null) hidden = true;
    if (r.verdict === "expired") {
      s.expiredCount += 1;
      s.expiredCost = (s.expiredCost ?? 0) + (r.atRiskCost ?? 0);
      s.expiredSale += r.atRiskSale;
    } else if (r.verdict === "sells") {
      s.sellsCount += 1;
    } else {
      s.riskCount += 1;
      s.riskCost = (s.riskCost ?? 0) + (r.atRiskCost ?? 0);
      s.riskSale += r.atRiskSale;
      if (r.markdown) s.markedDown += 1;
    }
  }
  return {
    ...s,
    riskCost: hidden ? null : round2(s.riskCost ?? 0),
    expiredCost: hidden ? null : round2(s.expiredCost ?? 0),
    riskSale: round2(s.riskSale),
    expiredSale: round2(s.expiredSale),
  };
}

export interface ReasonFacts {
  verdict: ExpiryVerdict;
  daysLeft: number;
  quantity: number;
  sold: number;
  unsold: number;
  pacePerDay: number;
  sellOutDays: number | null;
  warehouseName: string | null;
}

/** Темп для глаз: «0,3», «12», «1,5» — без хвоста из нулей. */
export function paceText(pace: number, lang: string): string {
  const v = pace >= 10 ? Math.round(pace) : Math.round(pace * 10) / 10;
  return lang === "uz" ? String(v) : String(v).replace(".", ",");
}

/**
 * Почему партия в этом состоянии — словами. Экран и выгрузка (по-русски)
 * берут одну фразу, чтобы бумага и экран не расходились.
 */
export function expiryReasonText(r: ReasonFacts, lang: string, qty: (n: number) => string): string {
  const uz = lang === "uz";
  const window = EXPIRY_RULES.PACE_WINDOW_DAYS;
  switch (r.verdict) {
    case "expired":
      return uz
        ? `Muddati ${-r.daysLeft} kun oldin o'tgan — jo'natishga chiqmaydi, hisobdan chiqarish kerak`
        : `Срок вышел ${-r.daysLeft} дн. назад — в отгрузку не уйдёт, остаётся списать`;
    case "elsewhere":
      return uz
        ? `«${r.warehouseName ?? "—"}» da turibdi, sotuv faqat asosiy ombordan — ko'chirish kerak`
        : `Лежит в «${r.warehouseName ?? "—"}», а продают только с основного склада — переместить`;
    case "no_sales":
      return uz
        ? `${window} kunda birorta sotuv yo'q — o'zi ketmaydi`
        : `За ${window} дней ни одной продажи — сама не уйдёт`;
    case "short":
      if (r.daysLeft === 0) {
        return uz ? "Muddati bugun — bugun sotish yoki hisobdan chiqarish" : "Срок сегодня — продать сегодня или списать";
      }
      return uz
        ? `Kuniga ${paceText(r.pacePerDay, lang)} sotilmoqda: muddatgacha ${qty(r.quantity)} dan ~${qty(r.sold)} ketadi, ${qty(r.unsold)} qoladi`
        : `Уходит ${paceText(r.pacePerDay, lang)} в день: до срока продастся ~${qty(r.sold)} из ${qty(r.quantity)}, останется ${qty(r.unsold)}`;
    case "sells":
      return uz
        ? `Ulguradi: ~${r.sellOutDays ?? 0} kunda tugaydi, muddatgacha ${r.daysLeft} kun`
        : `Успеет: уйдёт за ~${r.sellOutDays ?? 0} дн., до срока ${r.daysLeft} дн.`;
  }
}
