import { UnsupportedMediaTypeException } from '@nestjs/common';

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function startsWith(buffer: Buffer, magic: Buffer): boolean {
  return buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic);
}

/**
 * Verifies that the declared document content type matches the uploaded bytes.
 * MIME headers from clients are advisory only and are never trusted on their
 * own.
 */
export function assertSupportedDocument(
  file: Pick<Express.Multer.File, 'mimetype' | 'buffer' | 'originalname'>,
): void {
  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.mimetype as never)) {
    throw new UnsupportedMediaTypeException(
      'Only PDF and DOCX documents are allowed',
    );
  }

  if (!Buffer.isBuffer(file.buffer)) {
    throw new UnsupportedMediaTypeException('Invalid document contents');
  }

  const isPdf = startsWith(file.buffer, PDF_MAGIC);
  const isDocx = startsWith(file.buffer, ZIP_MAGIC);
  const valid =
    (file.mimetype === 'application/pdf' && isPdf) ||
    (file.mimetype === ALLOWED_DOCUMENT_MIME_TYPES[1] && isDocx);

  if (!valid) {
    throw new UnsupportedMediaTypeException(
      'Document contents do not match the declared content type',
    );
  }
}
