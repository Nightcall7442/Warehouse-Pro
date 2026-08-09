import { getBridge } from '../lib/onec-bridge';
import { calculateOrderVat, getVatRate } from './onec-vat';
import { logger } from '../lib/logger';

export interface InvoiceItem {
  productExternalId: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  category?: string | null;
}

export interface CreateInvoiceInput {
  tenantId: number;
  orderNumber: string;
  orderDate: Date;
  shopExternalId: string;
  items: InvoiceItem[];
  isExport?: boolean;
}

export async function createInvoice1C(input: CreateInvoiceInput): Promise<string> {
  const bridge = getBridge();

  const vatCalc = calculateOrderVat(
    input.items.map(i => ({ subtotal: i.subtotal, category: i.category })),
    input.isExport,
  );

  const doc = {
    Number: `СФ-${input.orderNumber}`,
    Date: input.orderDate.toISOString().replace('Z', ''),
    Контрагент_Key: input.shopExternalId,
    СуммаДокумента: vatCalc.totalWithVat,
    СуммаНДС: vatCalc.totalVat,
    Товары: input.items.map(item => {
      const rate = getVatRate(item.category ?? null, input.isExport);
      return {
        Номенклатура_Key: item.productExternalId,
        Количество: item.quantity,
        Цена: item.unitPrice,
        Сумма: item.subtotal,
        СтавкаНДС: `${rate}%`,
        СуммаНДС: Math.round(item.subtotal * rate / (100 + rate) * 100) / 100,
      };
    }),
  };

  const result = await bridge.createDocument('Document_СчётФактура', doc);
  await bridge.postDocument('Document_СчётФактура', result.id);

  logger.info('Invoice created in 1C', { invoiceId: result.id, orderNumber: input.orderNumber });
  return result.id;
}
