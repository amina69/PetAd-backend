import { UnsupportedMediaTypeException } from '@nestjs/common';

export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;

export type SupportedImageType = 'JPEG' | 'PNG' | 'WEBP';

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWithBytes(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => buffer[index] === byte);
}

function isWebp(buffer: Buffer): boolean {
  if (buffer.length < 12) {
    return false;
  }
  return (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

/**
 * Sniff the real content type of an uploaded file from its magic bytes.
 *
 * The client-supplied `Content-Type`/filename is never trusted: an SVG or a
 * renamed executable must not be accepted just because it claims to be a PNG.
 */
export function detectImageType(
  buffer?: Buffer | null,
): SupportedImageType | null {
  if (!buffer || buffer.length === 0) {
    return null;
  }
  if (startsWithBytes(buffer, PNG_SIGNATURE)) {
    return 'PNG';
  }
  if (startsWithBytes(buffer, JPEG_SIGNATURE)) {
    return 'JPEG';
  }
  if (isWebp(buffer)) {
    return 'WEBP';
  }
  return null;
}

/**
 * Assert an avatar upload is a real JPEG, PNG or WebP image.
 *
 * @throws UnsupportedMediaTypeException (415) when the bytes are anything
 * else, including SVG and executables renamed to `.png`.
 */
export function assertSupportedAvatar(
  buffer?: Buffer | null,
): SupportedImageType {
  const detected = detectImageType(buffer);
  if (!detected) {
    throw new UnsupportedMediaTypeException(
      'Avatar must be a JPEG, PNG or WebP image',
    );
  }
  return detected;
}
