import { describe, it, expect } from 'vitest';
import { toPaise, toRupees, formatINR } from './money.js';

describe('Money Utilities (Integer Paise)', () => {
  it('converts numbers to integer paise correctly without floating point errors', () => {
    expect(toPaise(100)).toBe(10000);
    expect(toPaise(100.5)).toBe(10050);
    expect(toPaise(100.55)).toBe(10055);
    expect(toPaise('1234.56')).toBe(123456);
  });

  it('converts paise to rupees', () => {
    expect(toRupees(10000)).toBe(100);
    expect(toRupees(10055)).toBe(100.55);
    expect(toRupees(5000000n)).toBe(50000);
  });

  it('formats INR currency with Indian numbering format', () => {
    const formatted = formatINR(10000000); // 1,00,000 rupees
    expect(formatted).toContain('1,00,000');
  });

  it('throws on invalid money input', () => {
    expect(() => toPaise('not-a-number')).toThrow(TypeError);
  });
});
