import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockBridge = {
  createDocument: vi.fn().mockResolvedValue({ id: 'doc-invoice-1' }),
  postDocument: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../lib/onec-bridge', () => ({
  getBridge: () => mockBridge,
}));

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { createInvoice1C } from '../onec-invoice';

beforeEach(() => {
  mockBridge.createDocument.mockReset();
  mockBridge.postDocument.mockReset();
  mockBridge.createDocument.mockResolvedValue({ id: 'doc-invoice-1' });
  mockBridge.postDocument.mockResolvedValue(undefined);
});

describe('createInvoice1C', () => {
  const baseInput = {
    tenantId: 1,
    orderNumber: 'ORD-001',
    orderDate: new Date('2026-01-15'),
    shopExternalId: 'shop-uuid-1',
    items: [
      { productExternalId: 'prod-a', quantity: 2, unitPrice: 100, subtotal: 200, category: 'Электроника' },
    ],
  };

  it('creates and posts document to 1C', async () => {
    const id = await createInvoice1C(baseInput);
    expect(id).toBe('doc-invoice-1');
    expect(mockBridge.createDocument).toHaveBeenCalledOnce();
    expect(mockBridge.postDocument).toHaveBeenCalledOnce();
  });

  it('uses correct document type', async () => {
    await createInvoice1C(baseInput);
    expect(mockBridge.createDocument.mock.calls[0][0]).toBe('Document_СчётФактура');
    expect(mockBridge.postDocument.mock.calls[0][0]).toBe('Document_СчётФактура');
  });

  it('builds document with VAT calculations', async () => {
    await createInvoice1C(baseInput);
    const doc = mockBridge.createDocument.mock.calls[0][1];
    expect(doc.Number).toBe('СФ-ORD-001');
    expect(doc.СуммаДокумента).toBe(200);
    expect(doc.Товары).toHaveLength(1);
    expect(doc.Товары[0].СтавкаНДС).toBe('20%');
  });

  it('handles export items with 0% VAT', async () => {
    await createInvoice1C({ ...baseInput, isExport: true });
    const doc = mockBridge.createDocument.mock.calls[0][1];
    expect(doc.Товары[0].СтавкаНДС).toBe('0%');
    expect(doc.Товары[0].СуммаНДС).toBe(0);
  });

  it('handles food category items with 10% VAT', async () => {
    const foodItems = [
      { productExternalId: 'prod-food', quantity: 1, unitPrice: 110, subtotal: 110, category: 'Продовольствие' },
    ];
    await createInvoice1C({ ...baseInput, items: foodItems });
    const doc = mockBridge.createDocument.mock.calls[0][1];
    expect(doc.Товары[0].СтавкаНДС).toBe('10%');
    expect(doc.Товары[0].СуммаНДС).toBe(10);
  });

  it('passes document id to postDocument', async () => {
    mockBridge.createDocument.mockResolvedValue({ id: 'doc-custom-id' });
    await createInvoice1C(baseInput);
    expect(mockBridge.postDocument.mock.calls[0][1]).toBe('doc-custom-id');
  });
});
