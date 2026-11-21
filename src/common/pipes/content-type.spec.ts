import { UnsupportedMediaTypeException } from '@nestjs/common';
import { assertSupportedDocument } from './content-type';

const file = (mimetype: string, buffer: Buffer) => ({
  mimetype,
  buffer,
  originalname: 'document.pdf',
});

describe('assertSupportedDocument', () => {
  it('accepts PDFs whose bytes match the declared MIME type', () => {
    expect(() =>
      assertSupportedDocument(
        file('application/pdf', Buffer.from('%PDF-1.7 example')),
      ),
    ).not.toThrow();
  });

  it('accepts DOCX files by their ZIP signature', () => {
    expect(() =>
      assertSupportedDocument(
        file(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
        ),
      ),
    ).not.toThrow();
  });

  it('rejects unexpected MIME types', () => {
    expect(() =>
      assertSupportedDocument(file('text/html', Buffer.from('%PDF-1.7'))),
    ).toThrow(UnsupportedMediaTypeException);
  });

  it('rejects files whose bytes do not match the declared type', () => {
    expect(() =>
      assertSupportedDocument(file('application/pdf', Buffer.from('<html>'))),
    ).toThrow(UnsupportedMediaTypeException);
    expect(() =>
      assertSupportedDocument(
        file(
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          Buffer.from('%PDF-1.7'),
        ),
      ),
    ).toThrow(UnsupportedMediaTypeException);
  });
});
