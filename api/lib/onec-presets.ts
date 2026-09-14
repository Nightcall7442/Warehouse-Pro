/**
 * Имена объектов 1С по конфигурациям — то, чем обмен отличается у клиентов.
 *
 * ── Что было ────────────────────────────────────────────────────────────────
 *
 * Обмен ждал «1С Bridge» — прослойку, которой не существовало: /health,
 * /Провести, ответ {id}, поля Price и Unit прямо в Номенклатуре. Ни одна
 * настоящая конфигурация так не отвечает, и подключить продукт к 1С клиента
 * было нельзя ни в каком виде.
 *
 * ── Что теперь ──────────────────────────────────────────────────────────────
 *
 * Стандартный интерфейс OData платформы 8.3 (…/odata/standard.odata): его
 * умеет любая конфигурация после публикации на веб-сервере, дописывать в 1С
 * ничего не нужно. Различаются только ИМЕНА: справочник цен, вид цен,
 * документ реализации, поле договора. Здесь они собраны пресетами; «своя
 * конфигурация» переопределяет любое имя, а проверка структуры (см.
 * onec-bridge.metadata) сверяет каждое имя с $metadata базы клиента.
 *
 * Пресеты писаны по типовым конфигурациям без живой базы под рукой: имена
 * взяты из документации платформы и типовых прикладных решений. Первое
 * подключение к настоящей базе клиента обязано пройти через «Проверку
 * структуры» — она скажет, что в этой базе называется иначе.
 */

export type OnecPreset = "bp_uz" | "ut" | "custom";

export interface OnecNames {
  /** Номенклатура: справочник и поля */
  nomenclature: { set: string; name: string; code: string; unitRef: string; deletion: string; folder: string | null };
  /** Единицы измерения */
  units: { set: string; name: string };
  /** Цены: регистр сведений (срез последних) и вид/тип цен */
  prices: { set: string; item: string; type: string; price: string; period: string };
  priceTypes: { set: string; name: string };
  /** Контрагенты */
  counterparties: { set: string; name: string; inn: string; deletion: string; phone?: string };
  organizations: { set: string; name: string };
  warehouses: { set: string; name: string };
  /** Договоры контрагентов (Бухгалтерия требует договор в реализации) */
  contracts: { set: string; name: string; owner: string; organization: string; kind: string | null; kindValue: string | null } | null;
  /** Реализация товаров */
  sale: {
    set: string;
    fields: { organization: string; counterparty: string; warehouse: string; contract: string | null; date: string; comment: string; operation: string | null };
    operationValue: string | null;
    items: string;
    item: { product: string; qty: string; price: string; sum: string; vatRate: string | null; vatSum: string | null; unit: string | null };
    vatRateValue: string | null;
    /** Процент НДС, заложенный в цену (для СуммаНДС); null — НДС не считаем */
    vatPercent: number | null;
  };
  /** Приходный кассовый ордер (оплата покупателя) */
  cashIn: { set: string; fields: { organization: string; counterparty: string; sum: string; date: string; operation: string | null; contract: string | null; comment: string }; operationValue: string | null } | null;
}

const BP_UZ: OnecNames = {
  nomenclature: { set: "Catalog_Номенклатура", name: "Description", code: "Артикул", unitRef: "ЕдиницаИзмерения_Key", deletion: "DeletionMark", folder: "IsFolder" },
  units: { set: "Catalog_КлассификаторЕдиницИзмерения", name: "Description" },
  prices: { set: "InformationRegister_ЦеныНоменклатуры", item: "Номенклатура_Key", type: "ТипЦен_Key", price: "Цена", period: "Period" },
  priceTypes: { set: "Catalog_ТипыЦенНоменклатуры", name: "Description" },
  counterparties: { set: "Catalog_Контрагенты", name: "Description", inn: "ИНН", deletion: "DeletionMark" },
  organizations: { set: "Catalog_Организации", name: "Description" },
  warehouses: { set: "Catalog_Склады", name: "Description" },
  contracts: { set: "Catalog_ДоговорыКонтрагентов", name: "Description", owner: "Owner_Key", organization: "Организация_Key", kind: "ВидДоговора", kindValue: "СПокупателем" },
  sale: {
    set: "Document_РеализацияТоваровУслуг",
    fields: { organization: "Организация_Key", counterparty: "Контрагент_Key", warehouse: "Склад_Key", contract: "ДоговорКонтрагента_Key", date: "Date", comment: "Комментарий", operation: "ВидОперации" },
    operationValue: "РеализацияТоваров",
    items: "Товары",
    item: { product: "Номенклатура_Key", qty: "Количество", price: "Цена", sum: "Сумма", vatRate: "СтавкаНДС", vatSum: "СуммаНДС", unit: null },
    vatRateValue: "НДС12",
    vatPercent: 12,
  },
  cashIn: {
    set: "Document_ПриходныйКассовыйОрдер",
    fields: { organization: "Организация_Key", counterparty: "Контрагент_Key", sum: "СуммаДокумента", date: "Date", operation: "ВидОперации", contract: "ДоговорКонтрагента_Key", comment: "Комментарий" },
    operationValue: "ОплатаПокупателя",
  },
};

const UT: OnecNames = {
  nomenclature: { set: "Catalog_Номенклатура", name: "Description", code: "Артикул", unitRef: "ЕдиницаИзмерения_Key", deletion: "DeletionMark", folder: "IsFolder" },
  units: { set: "Catalog_УпаковкиЕдиницыИзмерения", name: "Description" },
  prices: { set: "InformationRegister_ЦеныНоменклатуры25", item: "Номенклатура_Key", type: "ВидЦены_Key", price: "Цена", period: "Period" },
  priceTypes: { set: "Catalog_ВидыЦен", name: "Description" },
  counterparties: { set: "Catalog_Контрагенты", name: "Description", inn: "ИНН", deletion: "DeletionMark" },
  organizations: { set: "Catalog_Организации", name: "Description" },
  warehouses: { set: "Catalog_Склады", name: "Description" },
  contracts: null,
  sale: {
    set: "Document_РеализацияТоваровУслуг",
    fields: { organization: "Организация_Key", counterparty: "Контрагент_Key", warehouse: "Склад_Key", contract: null, date: "Date", comment: "Комментарий", operation: "ХозяйственнаяОперация" },
    operationValue: "РеализацияКлиенту",
    items: "Товары",
    item: { product: "Номенклатура_Key", qty: "Количество", price: "Цена", sum: "Сумма", vatRate: "СтавкаНДС", vatSum: "СуммаНДС", unit: null },
    vatRateValue: "НДС12",
    vatPercent: 12,
  },
  cashIn: {
    set: "Document_ПриходныйКассовыйОрдер",
    fields: { organization: "Организация_Key", counterparty: "Контрагент_Key", sum: "СуммаДокумента", date: "Date", operation: "ХозяйственнаяОперация", contract: null, comment: "Комментарий" },
    operationValue: "ПоступлениеОплатыОтКлиента",
  },
};

export const PRESETS: Record<Exclude<OnecPreset, "custom">, OnecNames> = { bp_uz: BP_UZ, ut: UT };

export const PRESET_LABELS: Record<OnecPreset, { ru: string; uz: string }> = {
  bp_uz: { ru: "1С:Бухгалтерия 8 для Узбекистана (ред. 3.0)", uz: "1C:Buxgalteriya 8 O'zbekiston uchun (3.0)" },
  ut: { ru: "1С:Управление торговлей (ред. 11)", uz: "1C:Savdoni boshqarish (11)" },
  custom: { ru: "Своя конфигурация — имена задаются вручную", uz: "O'z konfiguratsiyasi — nomlar qo'lda" },
};

/** Глубокое слияние: переопределения поверх пресета; null в переопределении отключает поле. */
function merge<T>(base: T, over: unknown): T {
  if (over === null) return null as T;
  if (typeof base !== "object" || base === null || typeof over !== "object" || over === null) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) out[k] = merge(out[k], v);
  return out as T;
}

/** Имена для организации: пресет + её переопределения (для «своей конфигурации» — поверх bp_uz). */
export function resolveNames(preset: OnecPreset, overrides: unknown): OnecNames {
  const base = preset === "ut" ? UT : BP_UZ;
  return overrides ? merge(base, overrides) : base;
}

/** Все пары «набор — поле», которые обмен читает или пишет: для сверки с $metadata. */
export function requiredFields(n: OnecNames): Array<{ set: string; field: string; about: string }> {
  const out: Array<{ set: string; field: string; about: string }> = [];
  const add = (set: string, field: string | null | undefined, about: string) => { if (field) out.push({ set, field, about }); };
  add(n.nomenclature.set, n.nomenclature.name, "номенклатура: название");
  add(n.nomenclature.set, n.nomenclature.code, "номенклатура: код/артикул");
  add(n.nomenclature.set, n.nomenclature.unitRef, "номенклатура: единица измерения");
  add(n.units.set, n.units.name, "единицы измерения");
  add(n.prices.set, n.prices.item, "цены: номенклатура");
  add(n.prices.set, n.prices.type, "цены: тип цен");
  add(n.prices.set, n.prices.price, "цены: цена");
  add(n.priceTypes.set, n.priceTypes.name, "типы цен");
  add(n.counterparties.set, n.counterparties.name, "контрагенты: название");
  add(n.counterparties.set, n.counterparties.inn, "контрагенты: ИНН");
  add(n.organizations.set, n.organizations.name, "организации");
  add(n.warehouses.set, n.warehouses.name, "склады");
  if (n.contracts) {
    add(n.contracts.set, n.contracts.owner, "договоры: владелец");
    add(n.contracts.set, n.contracts.organization, "договоры: организация");
  }
  const s = n.sale;
  add(s.set, s.fields.organization, "реализация: организация");
  add(s.set, s.fields.counterparty, "реализация: контрагент");
  add(s.set, s.fields.warehouse, "реализация: склад");
  add(s.set, s.fields.contract, "реализация: договор");
  add(s.set, s.fields.date, "реализация: дата");
  add(s.set, s.fields.operation, "реализация: вид операции");
  add(s.set, s.items, "реализация: табличная часть товаров");
  if (n.cashIn) {
    add(n.cashIn.set, n.cashIn.fields.counterparty, "ПКО: контрагент");
    add(n.cashIn.set, n.cashIn.fields.sum, "ПКО: сумма");
  }
  return out;
}
