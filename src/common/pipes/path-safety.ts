import { BadRequestException } from '@nestjs/common';
import * as path from 'path';

const MAX_FILE_NAME_LENGTH = 200;
const FALLBACK_FILE_NAME = 'upload';

/** Strips directories, traversal segments and unsafe characters from a name. */
export function sanitizeFileName(
  originalName: string,
  fallback = FALLBACK_FILE_NAME,
): string {
  if (typeof originalName !== 'string') {
    return fallback;
  }

  const withoutControlCharacters = originalName
    .replace(/\u0000/g, '')
    .replace(CONTROL_CHARACTERS, '');
  const baseName = path
    .basename(withoutControlCharacters.replace(/\\/g, '/'))
    .replace(/^\.+/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, MAX_FILE_NAME_LENGTH)
    .trim();

  return baseName || fallback;
}

/** Allows only characters that are safe in a Cloudinary/public-id path segment. */
export function safePathSegment(value: string, fallback = 'unknown'): string {
  if (typeof value !== 'string') return fallback;

  const segment = value
    .replace(/\u0000/g, '')
    .replace(CONTROL_CHARACTERS, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 128)
    .replace(/^_+|_+$/g, '');

  return segment || fallback;
}

/**
 * Resolves a storage path and guarantees it stays inside the configured
 * directory. Absolute paths are supported because stored export paths are
 * absolute, but they must still be contained by the storage directory.
 */
export function resolveWithinDirectory(
  filePath: string,
  directory: string,
): string {
  if (typeof filePath !== 'string' || filePath.includes('\u0000')) {
    throw new BadRequestException('Invalid file path');
  }

  const root = path.resolve(directory);
  const resolved = path.resolve(root, filePath);
  const relative = path.relative(root, resolved);

  if (
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    relative === ''
  ) {
    throw new BadRequestException('File path must stay inside the storage directory');
  }

  return resolved;
}

const CONTROL_CHARACTERS = /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
