/*
  Шаблон накладной — выбор арендатора.

  Владелец (19.09.2026): «накладные занимают больше места на бумаге и нет
  номера магазинов; сделай в настройках, где можно кастомизировать накладные
  полностью, и два-три готовых шаблона». Шаблон — это раскладка; галочки —
  что на ней печатать. Оба хранятся в tenant_branding: это оформление, а не
  реквизит (реквизиты живут в settings, раздел «Компания»).

  Умолчания у каждого шаблона свои: «Компактная» по умолчанию идёт с телефоном
  магазина и знаком Warehouse Pro — так выглядит образец, который принёс
  владелец; «Классическая» — как печаталась до сих пор, без изменений для тех,
  кто ничего не выбирал.
*/

export const INVOICE_TEMPLATES = ["classic", "compact", "detailed"] as const;
export type InvoiceTemplateId = (typeof INVOICE_TEMPLATES)[number];

/** Чей знак печатать в шапке: никакой, организации (из «Компании»/«Брендинга») или Warehouse Pro. */
export type InvoiceLogo = "none" | "company" | "warehouse-pro";

export interface InvoiceOptions {
  logo: InvoiceLogo;
  /** Экземпляров на лист: один или два (покупателю и поставщику). */
  copies: 1 | 2;
  /** Два экземпляра: друг под другом (портрет) или рядом (альбомный лист, как у образца). */
  copiesLayout: "stack" | "side";
  showShopPhone: boolean;
  showShopAddress: boolean;
  showAgent: boolean;
  showAgentPhone: boolean;
  showCourier: boolean;
  showProductCode: boolean;
  showUnit: boolean;
  showDiscount: boolean;
  /** Долг магазина и последняя оплата — блок для экспедитора. */
  showDebt: boolean;
  /** Штрих-код номера заказа — по нему находят заказ сканером. */
  showBarcode: boolean;
  showPaymentMethod: boolean;
  showSignatures: boolean;
  showNotes: boolean;
  /** Дата и время печати рядом с датой заказа. */
  showPrintedAt: boolean;
  fontSize: "small" | "normal";
}

export const INVOICE_OPTION_KEYS = [
  "logo", "copies", "copiesLayout", "showShopPhone", "showShopAddress", "showAgent", "showAgentPhone", "showCourier",
  "showProductCode", "showUnit", "showDiscount", "showDebt", "showBarcode", "showPaymentMethod", "showSignatures",
  "showNotes", "showPrintedAt", "fontSize",
] as const satisfies readonly (keyof InvoiceOptions)[];

export const INVOICE_DEFAULTS: Record<InvoiceTemplateId, InvoiceOptions> = {
  // Как печаталось до 19.09.2026: реквизиты, Times, два экземпляра друг под другом.
  classic: {
    logo: "none", copies: 2, copiesLayout: "stack",
    showShopPhone: false, showShopAddress: true, showAgent: false, showAgentPhone: false, showCourier: false,
    showProductCode: true, showUnit: true, showDiscount: true, showDebt: false, showBarcode: false,
    showPaymentMethod: false, showSignatures: true, showNotes: true, showPrintedAt: false, fontSize: "normal",
  },
  // Образец владельца: половина листа, телефон магазина и агента, знак Warehouse Pro.
  compact: {
    logo: "warehouse-pro", copies: 2, copiesLayout: "side",
    showShopPhone: true, showShopAddress: true, showAgent: true, showAgentPhone: true, showCourier: false,
    showProductCode: true, showUnit: false, showDiscount: true, showDebt: false, showBarcode: false,
    showPaymentMethod: true, showSignatures: true, showNotes: false, showPrintedAt: true, fontSize: "small",
  },
  // Пакетная печать из «Заказов»: долг магазина, штрих-код, примечания.
  detailed: {
    logo: "none", copies: 2, copiesLayout: "stack",
    showShopPhone: true, showShopAddress: true, showAgent: true, showAgentPhone: false, showCourier: false,
    showProductCode: true, showUnit: true, showDiscount: true, showDebt: true, showBarcode: true,
    showPaymentMethod: true, showSignatures: true, showNotes: true, showPrintedAt: false, fontSize: "normal",
  },
};

export const INVOICE_TEMPLATE_LABELS: Record<InvoiceTemplateId, { ru: string; uz: string; descRu: string; descUz: string }> = {
  classic:  { ru: "Классическая", uz: "Klassik", descRu: "Реквизиты продавца и покупателя, таблица с единицами, подписи. Два экземпляра на листе А4 друг под другом.", descUz: "Sotuvchi va xaridor rekvizitlari, birliklar bilan jadval, imzolar. A4 varaqda ikki nusxa ustma-ust." },
  compact:  { ru: "Компактная", uz: "Ixcham", descRu: "Полстраницы на экземпляр: номер, дата, магазин с телефоном, агент, таблица и итог. Два экземпляра рядом на альбомном листе — как у образца.", descUz: "Nusxaga yarim sahifa: raqam, sana, telefoni bilan do'kon, agent, jadval va jami. Ikki nusxa yonma-yon albom varaqda — namunadagidek." },
  detailed: { ru: "Подробная", uz: "Batafsil", descRu: "Для экспедитора: долг магазина и последняя оплата, штрих-код заказа, примечания. Два экземпляра друг под другом.", descUz: "Ekspeditor uchun: do'kon qarzi va oxirgi to'lov, buyurtma shtrix-kodi, izohlar. Ikki nusxa ustma-ust." },
};

/** Настройки арендатора поверх умолчаний шаблона; чужие и пустые ключи не пролезают. */
export function resolveInvoiceOptions(template: InvoiceTemplateId, saved?: Partial<InvoiceOptions> | null): InvoiceOptions {
  const base = INVOICE_DEFAULTS[template];
  if (!saved) return { ...base };
  const out: InvoiceOptions = { ...base };
  for (const key of INVOICE_OPTION_KEYS) {
    const v = saved[key];
    if (v === undefined || v === null) continue;
    (out as unknown as Record<string, unknown>)[key] = v;
  }
  return out;
}
