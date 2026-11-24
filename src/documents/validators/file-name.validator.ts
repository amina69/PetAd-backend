const MAX_FILE_NAME_LENGTH = 120;

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Extracts the lowercased extension from a client-supplied name.
 * Only a short, alphanumeric extension is accepted.
 */
export function declaredExtension(fileName: string): string {
  if (typeof fileName !== 'string') {
    return '';
  }

  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot < 0 || dot === base.length - 1) {
    return '';
  }

  const extension = base.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(extension) ? extension : '';
}

/**
 * Removes path components, control characters, traversal segments and
 * unsafe punctuation from a user-supplied file name.
 *
 * The result is only used as display metadata; storage keys are always
 * random and never derived from this value.
 */
export function sanitizeFileName(
  fileName: string | undefined | null,
  fallback = 'file',
): string {
  if (typeof fileName !== 'string') {
    return fallback;
  }

  // Strip directory components from both POSIX and Windows paths.
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? '';

  const sanitized = base
    .replace(CONTROL_CHARACTERS, '')
    .normalize('NFKC')
    .replace(/[<>:"|?*]/g, '_')
    // Collapse dot runs used for traversal and hide dotfiles.
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!sanitized) {
    return fallback;
  }

  // Keep the name within a predictable length, preserving an extension when
  // the sanitized name has one.
  const limited =
    sanitized.length > MAX_FILE_NAME_LENGTH
      ? sanitized.slice(0, MAX_FILE_NAME_LENGTH).replace(/[.\s]+$/, '')
      : sanitized;

  if (!limited || WINDOWS_RESERVED.test(limited)) {
    return fallback;
  }

  return limited;
}

/**
 * Builds a display name whose extension reflects the sniffed content rather
 * than whatever the client claimed. This prevents "contract.exe" being shown
 * as a PDF after upload.
 */
export function safeDisplayName(
  originalName: string | undefined | null,
  detectedExtension: string,
): string {
  const safe = sanitizeFileName(originalName);
  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const cleanedStem = sanitizeFileName(stem, 'file');
  return `${cleanedStem}.${detectedExtension}`;
}
