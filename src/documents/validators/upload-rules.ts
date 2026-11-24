import { AppException } from '../../common/exceptions/app.exception';

/**
 * Logical upload kinds. Each kind has its own allowlist so a file that is
 * acceptable as a pet photo (for example) cannot be stored as an adoption
 * document.
 */
export type UploadKind = 'document' | 'image';

export interface UploadRule {
  /** MIME types that may be stored for this kind. */
  mimeTypes: readonly string[];
  /** Extensions that may be declared and stored for this kind. */
  extensions: readonly string[];
}

export const UPLOAD_RULES: Record<UploadKind, UploadRule> = {
  document: {
    mimeTypes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    extensions: ['pdf', 'docx'],
  },
  image: {
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'],
    extensions: ['jpg', 'jpeg', 'png', 'webp', 'svg'],
  },
};

/** Extensions that are equivalent when comparing declared vs detected types. */
export const EQUIVALENT_EXTENSIONS: Record<string, readonly string[]> = {
  jpg: ['jpg', 'jpeg'],
  jpeg: ['jpg', 'jpeg'],
};

const EXECUTABLE_OR_SCRIPT_MIME_TYPES = new Set([
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/vnd.microsoft.portable-executable',
  'application/x-executable',
  'application/x-elf',
  'application/x-mach-binary',
  'application/x-sharedlib',
  'application/x-httpd-php',
  'application/javascript',
  'text/javascript',
  'application/x-sh',
  'text/x-shellscript',
  'application/x-perl',
  'application/x-python',
  'application/x-bat',
  'text/x-powershell',
  'application/x-msi',
  'application/java-archive',
]);

const EXECUTABLE_OR_SCRIPT_EXTENSIONS = new Set([
  'exe',
  'dll',
  'com',
  'msi',
  'bat',
  'cmd',
  'sh',
  'bash',
  'zsh',
  'ps1',
  'py',
  'js',
  'mjs',
  'cjs',
  'php',
  'pl',
  'rb',
  'jar',
  'elf',
  'bin',
]);

export function isDeniedMimeType(mimeType: string): boolean {
  return EXECUTABLE_OR_SCRIPT_MIME_TYPES.has(mimeType.toLowerCase());
}

export function isDeniedExtension(extension: string): boolean {
  return EXECUTABLE_OR_SCRIPT_EXTENSIONS.has(extension.toLowerCase());
}

export type UploadErrorCode = 'EMPTY_FILE' | 'TOO_LARGE' | 'WRONG_TYPE';

const UPLOAD_ERROR_STATUS: Record<UploadErrorCode, number> = {
  EMPTY_FILE: 400,
  TOO_LARGE: 413,
  WRONG_TYPE: 415,
};

/**
 * Upload failures use the stable codes the frontend uploadRules already
 * understands: EMPTY_FILE, TOO_LARGE and WRONG_TYPE.
 */
export class UploadValidationError extends AppException {
  constructor(code: UploadErrorCode, message: string) {
    super(code, message, UPLOAD_ERROR_STATUS[code]);
  }
}

export const uploadExceptions = {
  empty: () =>
    new UploadValidationError('EMPTY_FILE', 'The uploaded file is empty'),
  tooLarge: (maxBytes: number) =>
    new UploadValidationError(
      'TOO_LARGE',
      `File is larger than the ${maxBytes} byte limit`,
    ),
  wrongType: (message = 'The file content does not match its declared type') =>
    new UploadValidationError('WRONG_TYPE', message),
};

/**
 * Multer reports its own limit error before the service runs; map it to the
 * same public code so clients only need to handle TOO_LARGE.
 */
export function isMulterLimitError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'LIMIT_FILE_SIZE'
  );
}
