// VAT (НДС) calculation for 1C integration

export type VatRate = 20 | 10 | 0;

export interface VatCalculation {
  amountWithoutVat: number;
  vatAmount: number;
  totalWithVat: number;
  rate: VatRate;
}

export function getVatRate(productCategory: string | null, isExport: boolean = false): VatRate {
  if (isExport) return 0;
  if (!productCategory) return 20;

  const lower = productCategory.toLowerCase();
  if (lower.includes('продовольствие') || lower.includes('еда') || lower.includes('питание')) return 10;
  if (lower.includes('детск') || lower.includes('儿童')) return 10;
  if (lower.includes('медицин') || lower.includes('лекарств')) return 10;

  return 20;
}

export function calculateVat(amount: number, rate: VatRate): VatCalculation {
  if (rate === 0) {
    return {
      amountWithoutVat: amount,
      vatAmount: 0,
      totalWithVat: amount,
      rate: 0,
    };
  }

  const vatAmount = Math.round(amount * rate / (100 + rate) * 100) / 100;
  const amountWithoutVat = Math.round((amount - vatAmount) * 100) / 100;

  return {
    amountWithoutVat,
    vatAmount,
    totalWithVat: amount,
    rate,
  };
}

export function calculateOrderVat(
  items: Array<{ subtotal: number; category?: string | null }>,
  isExport: boolean = false,
): { totalWithoutVat: number; totalVat: number; totalWithVat: number } {
  let totalWithoutVat = 0;
  let totalVat = 0;
  let totalWithVat = 0;

  for (const item of items) {
    const rate = getVatRate(item.category ?? null, isExport);
    const calc = calculateVat(Number(item.subtotal), rate);
    totalWithoutVat += calc.amountWithoutVat;
    totalVat += calc.vatAmount;
    totalWithVat += calc.totalWithVat;
  }

  return {
    totalWithoutVat: Math.round(totalWithoutVat * 100) / 100,
    totalVat: Math.round(totalVat * 100) / 100,
    totalWithVat: Math.round(totalWithVat * 100) / 100,
  };
}
