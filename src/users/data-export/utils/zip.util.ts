import archiver from 'archiver';
import { PassThrough } from 'stream';

export interface ZipEntry {
  name: string;
  content: string | Buffer;
}

export async function createZipArchive(entries: ZipEntry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const passthrough = new PassThrough();
    const chunks: Buffer[] = [];

    passthrough.on('data', (chunk: Buffer) => chunks.push(chunk));
    passthrough.on('end', () => resolve(Buffer.concat(chunks)));
    passthrough.on('error', (err) => reject(err));

    archive.on('error', (err) => reject(err));
    archive.pipe(passthrough);

    for (const entry of entries) {
      archive.append(entry.content, { name: entry.name });
    }

    archive.finalize().catch(reject);
  });
}
