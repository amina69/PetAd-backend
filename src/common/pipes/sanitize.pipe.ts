import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';

export const MAX_SANITIZED_STRING_LENGTH = 100_000;

const MAX_DEPTH = 20;
const MAX_ARRAY_LENGTH = 10_000;
const MAX_OBJECT_KEYS = 1_000;

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

const PRESERVE_LEADING_TRAILING_SPACE = new Set([
  'password',
  'newpassword',
  'currentpassword',
  'passwordconfirmation',
  'token',
  'refreshtoken',
  'accesstoken',
  'secret',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isUploadedFile(value: unknown): value is Express.Multer.File {
  return (
    isPlainObject(value) &&
    Buffer.isBuffer(value.buffer) &&
    typeof value.originalname === 'string'
  );
}

/**
 * Normalises every incoming string before class-validator sees it. Values are
 * trimmed (except credentials), converted to NFC and stripped of C0/C1 control
 * characters. NUL bytes and oversized strings are rejected with a 400.
 */
@Injectable()
export class SanitizePipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'custom' || value === undefined || value === null) {
      return value;
    }

    return this.sanitize(value, 'request', 0);
  }

  private sanitize(value: unknown, path: string, depth: number): unknown {
    if (depth > MAX_DEPTH) {
      throw new BadRequestException([
        `${path} exceeds the maximum nesting depth of ${MAX_DEPTH}`,
      ]);
    }

    if (typeof value === 'string') {
      return this.sanitizeString(value, path);
    }

    if (
      value instanceof Date ||
      Buffer.isBuffer(value) ||
      value instanceof Uint8Array ||
      isUploadedFile(value)
    ) {
      return value;
    }

    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_LENGTH) {
        throw new BadRequestException([
          `${path} exceeds the maximum array length of ${MAX_ARRAY_LENGTH}`,
        ]);
      }
      return value.map((item, index) =>
        this.sanitize(item, `${path}[${index}]`, depth + 1),
      );
    }

    if (isPlainObject(value)) {
      const entries = Object.entries(value);
      if (entries.length > MAX_OBJECT_KEYS) {
        throw new BadRequestException([
          `${path} exceeds the maximum number of ${MAX_OBJECT_KEYS} fields`,
        ]);
      }

      const result: Record<string, unknown> = {};
      for (const [key, item] of entries) {
        result[key] = this.sanitize(item, `${path}.${key}`, depth + 1);
      }
      return result;
    }

    return value;
  }

  private sanitizeString(value: string, path: string): string {
    if (value.includes('\u0000')) {
      throw new BadRequestException([
        `${path} must not contain null bytes`,
      ]);
    }

    if (value.length > MAX_SANITIZED_STRING_LENGTH) {
      throw new BadRequestException([
        `${path} must be at most ${MAX_SANITIZED_STRING_LENGTH} characters`,
      ]);
    }

    const withoutControlCharacters = value.replace(CONTROL_CHARACTERS, '');
    const normalised = withoutControlCharacters.normalize('NFC');
    const leaf = path.split('.').pop()?.toLowerCase() ?? '';

    return PRESERVE_LEADING_TRAILING_SPACE.has(leaf)
      ? normalised
      : normalised.trim();
  }
}
