import { BadRequestException } from '@nestjs/common';
import {
  BPS_DENOMINATOR,
  currencyDecimals,
  formatMinorUnits,
  isFloatingPointNumber,
  multiplyBpsRoundHalfUp,
  parseMinorUnits,
} from './money';

describe('payments/money', () => {
  describe('parseMinorUnits', () => {
    it('parses integer strings into bigint minor units', () => {
      expect(parseMinorUnits('0')).toBe(0n);
      expect(parseMinorUnits('10000000')).toBe(10000000n);
      expect(parseMinorUnits('9007199254740993')).toBe(9007199254740993n);
      expect(parseMinorUnits(42n)).toBe(42n);
    });

    it('rejects fractional, signed, scientific and empty amounts', () => {
      for (const value of ['1.5', '-1', '1e6', '', '  ', '0x10', '10.00']) {
        expect(() => parseMinorUnits(value)).toThrow(BadRequestException);
      }
      expect(() => parseMinorUnits(-1n)).toThrow(BadRequestException);
    });

    it('tolerates surrounding whitespace', () => {
      expect(parseMinorUnits('  25  ')).toBe(25n);
    });
  });

  describe('multiplyBpsRoundHalfUp', () => {
    it('rounds half up using integer arithmetic', () => {
      expect(multiplyBpsRoundHalfUp(1n, 5000)).toBe(1n); // 0.5 -> 1
      expect(multiplyBpsRoundHalfUp(3n, 5000)).toBe(2n); // 1.5 -> 2
      expect(multiplyBpsRoundHalfUp(1n, 250)).toBe(0n); // 0.025 -> 0
      expect(multiplyBpsRoundHalfUp(100n, 250)).toBe(3n); // 2.5 -> 3
      expect(multiplyBpsRoundHalfUp(10000n, 250)).toBe(250n);
      expect(multiplyBpsRoundHalfUp(0n, 9999)).toBe(0n);
    });

    it('scales beyond Number.MAX_SAFE_INTEGER exactly', () => {
      const amount = 9007199254740993n;
      const fee = multiplyBpsRoundHalfUp(amount, Number(BPS_DENOMINATOR));
      expect(fee).toBe(amount);
    });

    it('validates the basis-point range', () => {
      expect(() => multiplyBpsRoundHalfUp(10n, -1)).toThrow(RangeError);
      expect(() => multiplyBpsRoundHalfUp(10n, 10001)).toThrow(RangeError);
      expect(() => multiplyBpsRoundHalfUp(10n, 1.5)).toThrow(RangeError);
      expect(() => multiplyBpsRoundHalfUp(-1n, 100)).toThrow(RangeError);
    });
  });

  describe('formatMinorUnits', () => {
    it('formats XLM with 7 decimals using bigint division', () => {
      expect(formatMinorUnits(0n, 'XLM')).toBe('0.0000000');
      expect(formatMinorUnits(1n, 'XLM')).toBe('0.0000001');
      expect(formatMinorUnits(123456789n, 'XLM')).toBe('12.3456789');
      expect(formatMinorUnits(123456789n, 'xlm')).toBe('12.3456789');
    });

    it('formats 2-decimal currencies and unknown currencies', () => {
      expect(formatMinorUnits(12345n, 'USD')).toBe('123.45');
      expect(formatMinorUnits(5n, 'USD')).toBe('0.05');
      expect(formatMinorUnits(5n, 'ZZZ')).toBe('0.05');
    });

    it('is exact for amounts beyond Number.MAX_SAFE_INTEGER', () => {
      expect(formatMinorUnits(9007199254740993n, 'USD')).toBe(
        '90071992547409.93',
      );
    });
  });

  it('knows currency decimals', () => {
    expect(currencyDecimals('XLM')).toBe(7);
    expect(currencyDecimals('usd')).toBe(2);
    expect(currencyDecimals('unknown')).toBe(2);
  });

  it('distinguishes floating-point numbers from integer money', () => {
    expect(isFloatingPointNumber(1.5)).toBe(true);
    expect(isFloatingPointNumber(1n)).toBe(false);
    expect(isFloatingPointNumber('1')).toBe(false);
  });
});
