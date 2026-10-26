import { UnsupportedMediaTypeException } from '@nestjs/common';
import {
  assertSupportedAvatar,
  detectImageType,
  MAX_AVATAR_SIZE_BYTES,
} from './image-signature';

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a]);
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
]);
const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'ascii'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 ', 'ascii'),
]);
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]); // MZ header

describe('avatar image signature detection', () => {
  it('detects JPEG, PNG and WebP content', () => {
    expect(detectImageType(JPEG_BYTES)).toBe('JPEG');
    expect(detectImageType(PNG_BYTES)).toBe('PNG');
    expect(detectImageType(WEBP_BYTES)).toBe('WEBP');
  });

  it('does not trust the declared type: SVG is rejected with 415', () => {
    expect(detectImageType(SVG_BYTES)).toBeNull();
    expect(() => assertSupportedAvatar(SVG_BYTES)).toThrow(
      UnsupportedMediaTypeException,
    );
  });

  it('rejects an executable renamed to .png with 415', () => {
    expect(detectImageType(EXE_BYTES)).toBeNull();
    expect(() => assertSupportedAvatar(EXE_BYTES)).toThrow(
      UnsupportedMediaTypeException,
    );
  });

  it('rejects empty or missing content with 415', () => {
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
    expect(detectImageType(null)).toBeNull();
    expect(() => assertSupportedAvatar(undefined)).toThrow(
      UnsupportedMediaTypeException,
    );
  });

  it('accepts a supported image and returns its type', () => {
    expect(assertSupportedAvatar(PNG_BYTES)).toBe('PNG');
  });

  it('limits avatars to 5 MB', () => {
    expect(MAX_AVATAR_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });
});
