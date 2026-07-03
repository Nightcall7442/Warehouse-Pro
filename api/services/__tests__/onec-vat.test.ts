import { describe, it, expect } from 'vitest';
import { getVatRate, calculateVat, calculateOrderVat } from '../onec-vat';

describe('VAT Calculation', () => {
  describe('getVatRate', () => {
    it('returns 0% for export', () => {
      expect(getVatRate(null, true)).toBe(0);
    });

    it('returns 10% for food products', () => {
      expect(getVatRate('Продовольствие')).toBe(10);
      expect(getVatRate('Еда')).toBe(10);
    });

    it('returns 20% for default', () => {
      expect(getVatRate(null)).toBe(20);
      expect(getVatRate('Электроника')).toBe(20);
    });
  });

  describe('calculateVat', () => {
    it('calculates 20% VAT correctly', () => {
      const result = calculateVat(1200, 20);
      expect(result.amountWithoutVat).toBe(1000);
      expect(result.vatAmount).toBe(200);
      expect(result.totalWithVat).toBe(1200);
    });

    it('calculates 10% VAT correctly', () => {
      const result = calculateVat(1100, 10);
      expect(result.amountWithoutVat).toBe(1000);
      expect(result.vatAmount).toBe(100);
      expect(result.totalWithVat).toBe(1100);
    });

    it('returns same amount for 0% VAT', () => {
      const result = calculateVat(1000, 0);
      expect(result.amountWithoutVat).toBe(1000);
      expect(result.vatAmount).toBe(0);
      expect(result.totalWithVat).toBe(1000);
    });
  });

  describe('calculateOrderVat', () => {
    it('aggregates VAT across items', () => {
      const items = [
        { subtotal: 1200, category: 'Электроника' },
        { subtotal: 1100, category: 'Продовольствие' },
      ];
      const result = calculateOrderVat(items);
      expect(result.totalWithVat).toBe(2300);
      expect(result.totalVat).toBe(300);
      expect(result.totalWithoutVat).toBe(2000);
    });
  });
});
