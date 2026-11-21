import { BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveWithinDirectory,
  safePathSegment,
  sanitizeFileName,
} from './path-safety';

describe('path safety', () => {
  describe('sanitizeFileName', () => {
    it('removes traversal segments from unix and windows paths', () => {
      expect(sanitizeFileName('../../etc/passwd.pdf')).toBe('passwd.pdf');
      expect(sanitizeFileName('C:\\Windows\\System32\\evil.pdf')).toBe(
        'evil.pdf',
      );
    });

    it('strips control characters and collapses unsafe characters', () => {
      expect(sanitizeFileName('my\u0000file?.pdf')).toBe('myfile_.pdf');
    });

    it('falls back when nothing safe remains', () => {
      expect(sanitizeFileName('../../../')).toBe('upload');
    });
  });

  describe('safePathSegment', () => {
    it('allows only id-like characters', () => {
      expect(safePathSegment('abc-123_DEF')).toBe('abc-123_DEF');
      expect(safePathSegment('../../etc/passwd')).toBe('etc_passwd');
    });
  });

  describe('resolveWithinDirectory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'petad-path-'));

    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('resolves contained relative and absolute paths', () => {
      expect(resolveWithinDirectory('exports/report.zip', root)).toBe(
        path.join(root, 'exports/report.zip'),
      );
      expect(resolveWithinDirectory(path.join(root, 'report.zip'), root)).toBe(
        path.join(root, 'report.zip'),
      );
    });

    it('rejects traversal outside the storage directory', () => {
      expect(() => resolveWithinDirectory('../secret.txt', root)).toThrow(
        BadRequestException,
      );
      expect(() =>
        resolveWithinDirectory(path.join(root, '../../secret.txt'), root),
      ).toThrow(BadRequestException);
      expect(() => resolveWithinDirectory('/etc/passwd', root)).toThrow(
        BadRequestException,
      );
    });

    it('rejects null bytes before any filesystem call', () => {
      const readFile = jest.spyOn(fs.promises, 'readFile');
      expect(() =>
        resolveWithinDirectory('report\u0000.zip', root),
      ).toThrow(BadRequestException);
      expect(readFile).not.toHaveBeenCalled();
      readFile.mockRestore();
    });
  });
});
