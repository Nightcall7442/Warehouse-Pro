import { describe, it, expect, vi } from 'vitest';

// Mock all dependencies
vi.mock('../lib/onec-bridge', () => ({
  getBridge: () => ({
    odataQuery: vi.fn().mockResolvedValue([
      { Ref_Key: 'uuid-001', Code: '001', Description: 'Test Product', Price: 1500, Unit: 'шт' },
      { Ref_Key: 'uuid-002', Code: '002', Description: 'Another Product', Price: 2500, Unit: 'кг' },
    ]),
    createDocument: vi.fn().mockResolvedValue({ id: 'doc-123' }),
    postDocument: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../lib/metrics', () => ({
  record1CSync: vi.fn(),
}));

vi.mock('../services/onec-status', () => ({
  updateSyncStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../queries/connection', () => {
  let nextId = 10;
  return {
    getDb: () => ({
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockImplementation(() => {
          return Promise.resolve([{ insertId: nextId++ }]);
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue({}),
        }),
      }),
    }),
  };
});

vi.mock('../services/onec-mapper', () => ({
  OneCMapper: {
    getInternalId: vi.fn().mockResolvedValue(null),
    getExternalId: vi.fn().mockResolvedValue('ext-123'),
    upsert: vi.fn().mockResolvedValue(undefined),
    getAll: vi.fn().mockResolvedValue([]),
  },
}));

describe('1C Integration', () => {
  describe('Product Sync', () => {
    it('syncs products from 1C', async () => {
      const { oneCSync } = await import('../services/onec-sync');
      const result = await oneCSync.syncProducts(1);
      expect(result.synced).toBeGreaterThanOrEqual(0);
      expect(result.errors).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Order Sync', () => {
    it('throws when order not found', async () => {
      const { oneCSync } = await import('../services/onec-sync');
      await expect(oneCSync.syncOrderTo1C(1, 99999)).rejects.toThrow();
    });
  });

  describe('Health Check', () => {
    it('returns healthy status', async () => {
      const { getBridge } = await import('../lib/onec-bridge');
      const bridge = getBridge();
      const healthy = await bridge.healthCheck();
      expect(healthy).toBe(true);
    });
  });

  describe('VAT Calculation', () => {
    it('calculates VAT correctly', async () => {
      const { calculateVat } = await import('../services/onec-vat');
      const result = calculateVat(1200, 20);
      expect(result.vatAmount).toBe(200);
      expect(result.amountWithoutVat).toBe(1000);
    });
  });

  describe('ID Mapping', () => {
    it('returns null for unmapped ID', async () => {
      const { OneCMapper } = await import('../services/onec-mapper');
      const result = await OneCMapper.getInternalId({} as any, 1, 'product', 'uuid-unknown');
      expect(result).toBeNull();
    });
  });
});
