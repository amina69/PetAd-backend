import { fromBuffer } from 'file-type';
import { isDeniedExtension, isDeniedMimeType } from './upload-rules';

export interface SniffedFile {
  mimeType: string;
  extension: string;
  /** How the type was established. */
  source: 'signature' | 'svg';
}

const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function startsWith(buffer: Buffer, prefix: Buffer): boolean {
  return (
    buffer.length >= prefix.length &&
    buffer.subarray(0, prefix.length).equals(prefix)
  );
}

function asText(buffer: Buffer): string {
  return buffer
    .subarray(0, 8192)
    .toString('utf8')
    .replace(/^\uFEFF/, '');
}

export function looksLikeSvg(buffer: Buffer): boolean {
  const head = asText(buffer).trimStart();
  if (!head.startsWith('<')) {
    return false;
  }
  return /<svg[\s>]/i.test(asText(buffer));
}

/**
 * SVG is text, so magic-byte detection cannot classify it. Treat it as a
 * separate sniffing result and inspect the markup for active content.
 */
export function svgContainsActiveContent(buffer: Buffer): boolean {
  const text = buffer.toString('utf8');
  return (
    /<script[\s>]/i.test(text) ||
    /<foreignObject[\s>]/i.test(text) ||
    /\son[a-z]+\s*=/i.test(text) ||
    /javascript:/i.test(text) ||
    /<!ENTITY/i.test(text)
  );
}

export function isEncryptedPayload(buffer: Buffer): boolean {
  // Encrypted PDFs keep the %PDF header but carry an /Encrypt dictionary.
  if (startsWith(buffer, PDF_MAGIC)) {
    return buffer.subarray(0, 65536).includes(Buffer.from('/Encrypt', 'ascii'));
  }

  // ZIP general-purpose bit flag 0 marks traditional encryption. Office
  // documents are ZIP containers, so an encrypted DOCX is rejected here.
  if (startsWith(buffer, ZIP_MAGIC) && buffer.length >= 8) {
    const flags = buffer.readUInt16LE(6);
    return (flags & 0x1) === 0x1;
  }

  // Legacy encrypted OLE compound files (password-protected .doc).
  if (startsWith(buffer, OLE_MAGIC)) {
    return true;
  }

  return false;
}

export function isScriptPayload(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 256).toString('utf8').trimStart();
  return head.startsWith('#!') || /^<\?php/i.test(head);
}

function zipContainsDocxParts(buffer: Buffer): boolean {
  // Cheap structural check: a DOCX is a ZIP with [Content_Types].xml and a
  // word/ part. This keeps a plain archive from passing as a document.
  return (
    buffer.includes(Buffer.from('[Content_Types].xml', 'ascii')) &&
    buffer.includes(Buffer.from('word/', 'ascii'))
  );
}

/**
 * Establishes the true content type of a buffer from its bytes only.
 *
 * Returns null when the payload has no recognisable signature; callers must
 * treat that as WRONG_TYPE rather than trusting the declared MIME.
 */
export async function sniffFileContent(
  buffer: Buffer,
): Promise<SniffedFile | null> {
  if (looksLikeSvg(buffer)) {
    return { mimeType: 'image/svg+xml', extension: 'svg', source: 'svg' };
  }

  const detected = await fromBuffer(buffer);
  if (!detected) {
    return null;
  }

  if (isDeniedMimeType(detected.mime) || isDeniedExtension(detected.ext)) {
    return {
      mimeType: detected.mime,
      extension: detected.ext,
      source: 'signature',
    };
  }

  // DOCX is a ZIP container. Only classify it as a document when the
  // expected Word parts are present; otherwise it stays application/zip and
  // is rejected by the allowlist.
  if (
    detected.ext === 'zip' &&
    detected.mime === 'application/zip' &&
    zipContainsDocxParts(buffer)
  ) {
    return {
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
      source: 'signature',
    };
  }

  return {
    mimeType: detected.mime,
    extension: detected.ext,
    source: 'signature',
  };
}
