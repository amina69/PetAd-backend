import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import {
  declaredExtension,
  safeDisplayName,
} from './validators/file-name.validator';
import {
  isEncryptedPayload,
  isScriptPayload,
  sniffFileContent,
  svgContainsActiveContent,
} from './validators/magic-bytes.validator';
import {
  isDeniedExtension,
  isDeniedMimeType,
  uploadExceptions,
  UPLOAD_RULES,
  type UploadKind,
} from './validators/upload-rules';

export interface UploadCandidate {
  buffer?: Buffer;
  size?: number;
  originalname?: string;
  mimetype?: string;
}

export interface ValidatedUpload {
  buffer: Buffer;
  /** Sanitised name used only for display; never used as a storage key. */
  displayName: string;
  mimeType: string;
  extension: string;
  size: number;
  /** Random, opaque key for the storage layer. */
  storageKey: string;
}

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'application/x-pdf': 'application/pdf',
  'application/docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function normaliseMime(mimeType: string | undefined): string {
  if (typeof mimeType !== 'string') {
    return '';
  }
  const normalised = mimeType.split(';')[0].trim().toLowerCase();
  return MIME_ALIASES[normalised] ?? normalised;
}

function extensionsMatch(declared: string, detected: string): boolean {
  if (declared === detected) {
    return true;
  }
  return declared === 'jpg'
    ? detected === 'jpeg'
    : declared === 'jpeg'
      ? detected === 'jpg'
      : false;
}

/**
 * Validates uploads by inspecting their bytes instead of trusting the
 * client-supplied MIME type or extension.
 *
 * Public errors use the frontend uploadRules codes:
 * - EMPTY_FILE: zero-byte payload
 * - TOO_LARGE: exceeds the configured MAX_FILE_SIZE
 * - WRONG_TYPE: content/declared mismatch, denied payload or inactive allowlist
 */
@Injectable()
export class UploadService {
  constructor(private readonly configService: ConfigService) {}

  maxFileSize(): number {
    const configured =
      this.configService.get<number>('upload.maxFileSize') ??
      Number.parseInt(process.env.MAX_FILE_SIZE ?? '', 10);
    return Number.isFinite(configured) && configured > 0
      ? configured
      : DEFAULT_MAX_FILE_SIZE;
  }

  async validate(
    file: UploadCandidate,
    kind: UploadKind = 'document',
  ): Promise<ValidatedUpload> {
    const buffer = file?.buffer;
    const size = buffer?.length ?? file?.size ?? 0;

    if (!buffer || buffer.length === 0 || size === 0) {
      throw uploadExceptions.empty();
    }

    const maxFileSize = this.maxFileSize();
    if (size > maxFileSize) {
      throw uploadExceptions.tooLarge(maxFileSize);
    }

    const detected = await sniffFileContent(buffer);
    if (!detected) {
      throw uploadExceptions.wrongType(
        'The file content is not a recognised file type',
      );
    }

    if (
      isDeniedMimeType(detected.mimeType) ||
      isDeniedExtension(detected.extension) ||
      isScriptPayload(buffer)
    ) {
      throw uploadExceptions.wrongType(
        'Executable and script payloads are not allowed',
      );
    }

    if (
      detected.mimeType === 'image/svg+xml' &&
      svgContainsActiveContent(buffer)
    ) {
      throw uploadExceptions.wrongType(
        'SVG files containing scripts or active content are not allowed',
      );
    }

    if (isEncryptedPayload(buffer)) {
      throw uploadExceptions.wrongType(
        'Encrypted or password-protected files are not allowed',
      );
    }

    const rule = UPLOAD_RULES[kind];
    if (
      !rule.mimeTypes.includes(detected.mimeType) ||
      !rule.extensions.includes(detected.extension)
    ) {
      throw uploadExceptions.wrongType(
        `Files of this kind must be one of: ${rule.extensions.join(', ')}`,
      );
    }

    const declaredMime = normaliseMime(file.mimetype);
    if (declaredMime && declaredMime !== detected.mimeType) {
      throw uploadExceptions.wrongType(
        'The declared MIME type does not match the file content',
      );
    }

    const declaredExt = declaredExtension(file.originalname ?? '');
    if (declaredExt) {
      if (
        isDeniedExtension(declaredExt) ||
        !rule.extensions.includes(declaredExt) ||
        !extensionsMatch(declaredExt, detected.extension)
      ) {
        throw uploadExceptions.wrongType(
          'The declared file extension does not match the file content',
        );
      }
    }

    return {
      buffer,
      displayName: safeDisplayName(file.originalname, detected.extension),
      mimeType: detected.mimeType,
      extension: detected.extension,
      size,
      // Never derive the storage key from user input.
      storageKey: `${randomUUID()}.${detected.extension}`,
    };
  }

  /** Validates a batch up-front so no file is stored when any file fails. */
  async validateAll(
    files: UploadCandidate[],
    kind: UploadKind = 'document',
  ): Promise<ValidatedUpload[]> {
    return Promise.all(files.map((file) => this.validate(file, kind)));
  }
}
