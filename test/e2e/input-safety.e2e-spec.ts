import { Body, Controller, INestApplication, Post, ValidationPipe } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { SanitizePipe } from '../../src/common/pipes/sanitize.pipe';

class FuzzDto {
  @IsString()
  @MaxLength(1000)
  value: string;
}

@Controller('fuzz')
class FuzzController {
  @Post()
  create(@Body() dto: FuzzDto) {
    return dto;
  }
}

describe('input safety (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FuzzController],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new SanitizePipe(),
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with sanitized values for every C0 control character', async () => {
    for (let code = 0; code <= 31; code += 1) {
      if (code === 0 || code === 9 || code === 10 || code === 13) continue;
      const response = await request(app.getHttpServer())
        .post('/fuzz')
        .send({ value: `he${String.fromCharCode(code)}llo` });
      expect(response.status).not.toBe(500);
      expect(response.status).toBe(201);
      expect(response.body.value).toBe('hello');
    }
  });

  it('returns 400 for NUL bytes and 100 KB strings instead of 500', async () => {
    const nul = await request(app.getHttpServer())
      .post('/fuzz')
      .send({ value: `bad\u0000value` });
    expect(nul.status).toBe(400);

    const oversized = await request(app.getHttpServer())
      .post('/fuzz')
      .send({ value: 'a'.repeat(100_001) });
    expect(oversized.status).toBe(400);
  });

  it('rejects unexpected fields with a client error', async () => {
    const invalid = await request(app.getHttpServer())
      .post('/fuzz')
      .send({ value: 'valid', extra: 'ignored' });
    expect(invalid.status).toBe(400);
  });
});
