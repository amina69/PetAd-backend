import { BadRequestException } from '@nestjs/common';
import { ArgumentMetadata } from '@nestjs/common';
import { SanitizePipe } from './sanitize.pipe';

const metadata = { type: 'body', metatype: Object } as ArgumentMetadata;

describe('SanitizePipe', () => {
  const pipe = new SanitizePipe();

  it('trims, strips control characters and normalises to NFC', () => {
    expect(pipe.transform({ name: '  Cafe\u0301\u0007  ' }, metadata)).toEqual({
      name: 'Café',
    });
  });

  it('preserves leading and trailing spaces in credentials', () => {
    expect(
      pipe.transform({ password: ' Strong Pass123 ' }, metadata),
    ).toEqual({ password: ' Strong Pass123 ' });
  });

  it('rejects null bytes with a client error', () => {
    expect(() => pipe.transform({ name: 'bad\u0000name' }, metadata)).toThrow(
      BadRequestException,
    );
    try {
      pipe.transform({ name: 'bad\u0000name' }, metadata);
    } catch (error) {
      expect((error as BadRequestException).getStatus()).toBe(400);
    }
  });

  it('rejects 100 KB strings with a client error', () => {
    expect(() =>
      pipe.transform({ name: 'a'.repeat(100_001) }, metadata),
    ).toThrow(BadRequestException);
  });

  it('leaves uploaded files untouched', () => {
    const file = {
      originalname: '../../evil.pdf',
      buffer: Buffer.from('%PDF-'),
      mimetype: 'application/pdf',
      size: 5,
    };
    expect(pipe.transform({ file }, metadata)).toEqual({ file });
  });

  it('handles nested objects and arrays', () => {
    expect(
      pipe.transform({ items: [{ label: ' a\u0001 ' }, ' b '] }, metadata),
    ).toEqual({ items: [{ label: 'a' }, 'b'] });
  });
});
