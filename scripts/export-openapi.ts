import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const outputPath = resolve(process.cwd(), 'docs', 'openapi.json');

async function main(): Promise<void> {
  process.env.DATABASE_URL ??=
    'postgresql://petad:petadpassword@localhost:5432/petad_db';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.JWT_SECRET ??= 'openapi-export-only-secret-that-is-long-enough';
  process.env.JWT_EXPIRATION ??= '7d';
  process.env.NODE_ENV ??= 'development';

  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app.module.js');
  const { API_PREFIX, createOpenApiDocument } =
    await import('../src/common/openapi.js');

  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix(API_PREFIX, { exclude: ['health'] });

  const document = createOpenApiDocument(app);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  await app.close();

  process.stdout.write(`Wrote OpenAPI document to ${outputPath}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
