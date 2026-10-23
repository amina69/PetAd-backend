import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import supertest from 'supertest';
import type { Server } from 'node:http';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PetSpecies } from '../../src/common/enums';

type PetResponse = {
  id: string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  distanceKm?: number;
};

type GeoPetResponse = PetResponse & { distanceKm: number };

type PaginatedPetResponse<TPet extends PetResponse = PetResponse> = {
  data: TPet[];
  meta: {
    total: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
};

const responseBody = <T>(response: { body: unknown }): T => response.body as T;
const request = (server: unknown) => supertest(server as Server);

/**
 * Geo search e2e (Issue #232 / BE-035).
 *
 * Fixture point: (52.520, 13.405). Every fixture pet lies on the same
 * meridian, so the Haversine distance collapses to
 * d = R * dLat(rad) with R = 6371 km, i.e. 1° of latitude = 111.1949 km.
 * That makes every expected distance below a one-line hand computation:
 *
 *   52.620 (+0.100°) -> 11.1195 km   inside 25
 *   52.370 (-0.150°) -> 16.6792 km   inside 25
 *   52.720 (+0.200°) -> 22.2390 km   inside 25
 *   52.744 (+0.224°) -> 24.9077 km   inside 25 (edge)
 *   52.745 (+0.225°) -> 25.0189 km   outside 25 (edge)
 *   52.770 (+0.250°) -> 27.7987 km   outside 25
 *   53.870 (+1.350°) -> 150.1132 km  outside 25, inside the 200 km cap
 *   56.120 (+3.600°) -> 400.3017 km  outside the 200 km cap
 */
describe('Pets geo search (E2E)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const FIXTURE_PREFIX = 'GEOFIX_';
  const createdPetIds: string[] = [];
  let createdUserId: string | undefined;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirror the global pipes configured in src/main.ts so query DTO
    // validation behaves exactly like production.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    prisma = moduleFixture.get(PrismaService);
    await app.init();

    const owner = await prisma.user.create({
      data: {
        email: `geo_owner_${Date.now()}@test.com`,
        password: 'hashed',
        firstName: 'Geo',
        lastName: 'Owner',
      },
    });
    createdUserId = owner.id;

    const fixtures: Array<{
      name: string;
      latitude?: number;
      longitude?: number;
    }> = [
      { name: `${FIXTURE_PREFIX}center`, latitude: 52.52, longitude: 13.405 },
      { name: `${FIXTURE_PREFIX}km11`, latitude: 52.62, longitude: 13.405 },
      {
        name: `${FIXTURE_PREFIX}km16_7_south`,
        latitude: 52.37,
        longitude: 13.405,
      },
      { name: `${FIXTURE_PREFIX}km22`, latitude: 52.72, longitude: 13.405 },
      {
        name: `${FIXTURE_PREFIX}km24_9_in`,
        latitude: 52.744,
        longitude: 13.405,
      },
      {
        name: `${FIXTURE_PREFIX}km25_0_out`,
        latitude: 52.745,
        longitude: 13.405,
      },
      { name: `${FIXTURE_PREFIX}km27_8`, latitude: 52.77, longitude: 13.405 },
      { name: `${FIXTURE_PREFIX}km150`, latitude: 53.87, longitude: 13.405 },
      { name: `${FIXTURE_PREFIX}km400`, latitude: 56.12, longitude: 13.405 },
      { name: `${FIXTURE_PREFIX}no_location` },
    ];

    for (const fixture of fixtures) {
      const pet = await prisma.pet.create({
        data: {
          name: fixture.name,
          species: PetSpecies.DOG,
          currentOwnerId: owner.id,
          ...(fixture.latitude !== undefined && {
            latitude: fixture.latitude,
          }),
          ...(fixture.longitude !== undefined && {
            longitude: fixture.longitude,
          }),
        },
      });
      createdPetIds.push(pet.id);
    }
  });

  afterAll(async () => {
    await prisma.pet.deleteMany({ where: { id: { in: createdPetIds } } });
    if (createdUserId) {
      await prisma.user.delete({ where: { id: createdUserId } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  const fixtureName = (pet: { name: string }) =>
    pet.name.replace(FIXTURE_PREFIX, '');

  describe('radius=25 matches the hand-computed set', () => {
    it('returns exactly the five fixtures within 25 km, nearest first', async () => {
      const res = await request(app.getHttpServer())
        .get('/pets')
        .query({ near: '52.520,13.405', radius: 25 })
        .expect(200);

      const names =
        responseBody<PaginatedPetResponse<GeoPetResponse>>(res).data.map(
          fixtureName,
        );
      expect(names).toEqual([
        'center',
        'km11',
        'km16_7_south',
        'km22',
        'km24_9_in',
      ]);
    });

    it('reports hand-computed distances', async () => {
      const res = await request(app.getHttpServer())
        .get('/pets')
        .query({ near: '52.520,13.405', radius: 25 })
        .expect(200);

      const distances = responseBody<PaginatedPetResponse<GeoPetResponse>>(
        res,
      ).data.map((pet) => pet.distanceKm);
      // Hand-computed: d = 6371 * dLat(rad); 1° lat = 111.1949 km.
      expect(distances[0]).toBeCloseTo(0, 1);
      expect(distances[1]).toBeCloseTo(11.1195, 1);
      expect(distances[2]).toBeCloseTo(16.6792, 1);
      expect(distances[3]).toBeCloseTo(22.239, 1);
      expect(distances[4]).toBeCloseTo(24.9077, 1);
    });

    it('excludes the pet one step outside the radius (25.0189 km)', async () => {
      const res = await request(app.getHttpServer())
        .get('/pets')
        .query({ near: '52.520,13.405', radius: 25 })
        .expect(200);

      const names =
        responseBody<PaginatedPetResponse<GeoPetResponse>>(res).data.map(
          fixtureName,
        );
      expect(names).not.toContain('km25_0_out');
      expect(names).not.toContain('km27_8');
      expect(names).not.toContain('km150');
      expect(names).not.toContain('km400');
      expect(names).not.toContain('no_location');
    });

    it('applies other filters on top of the geo candidates', async () => {
      const res = await request(app.getHttpServer())
        .get('/pets')
        .query({
          near: '52.520,13.405',
          radius: 25,
          species: PetSpecies.CAT,
        })
        .expect(200);

      const body = responseBody<PaginatedPetResponse<GeoPetResponse>>(res);
      expect(body.data).toEqual([]);
      expect(body.meta.total).toBe(0);
    });

    it('paginates the distance-ordered result set', async () => {
      const res = await request(app.getHttpServer())
        .get('/pets')
        .query({ near: '52.520,13.405', radius: 25, page: 2, limit: 2 })
        .expect(200);

      const body = responseBody<PaginatedPetResponse<GeoPetResponse>>(res);
      const names = body.data.map(fixtureName);
      // Page 2 (limit 2) of the distance-ordered set: items 3 and 4.
      expect(names).toEqual(['km16_7_south', 'km22']);
      expect(body.meta.total).toBe(5);
      expect(body.meta.hasNextPage).toBe(true);
      expect(body.meta.hasPreviousPage).toBe(true);
    });
  });

  describe('radius handling', () => {
    it('defaults to 10 km when near is supplied without radius', async () => {
      const res = await request(app.getHttpServer())
        .get('/pets')
        .query({ near: '52.520,13.405' })
        .expect(200);

      // Only the centre fixture (0 km) is inside the 10 km default;
      // km11 sits at 11.1195 km.
      const names =
        responseBody<PaginatedPetResponse<GeoPetResponse>>(res).data.map(
          fixtureName,
        );
      expect(names).toEqual(['center']);
    });

    it('caps the radius at 200 km even when a larger value is requested', async () => {
      const res = await request(app.getHttpServer())
        .get('/pets')
        .query({ near: '52.520,13.405', radius: 5000 })
        .expect(200);

      const names =
        responseBody<PaginatedPetResponse<GeoPetResponse>>(res).data.map(
          fixtureName,
        );
      // 150 km is inside the cap...
      expect(names).toContain('km150');
      // ...but 400 km is beyond it, proving the 200 km cap was applied.
      expect(names).not.toContain('km400');
    });

    it('returns distanceKm only when near is supplied', async () => {
      const withNear = await request(app.getHttpServer())
        .get('/pets')
        .query({ near: '52.520,13.405', radius: 25 })
        .expect(200);
      const nearby =
        responseBody<PaginatedPetResponse<GeoPetResponse>>(withNear);
      expect(nearby.data[0]).toHaveProperty('distanceKm');

      const withoutNear = await request(app.getHttpServer())
        .get('/pets')
        .query({ limit: 100 })
        .expect(200);
      const plainList = responseBody<PaginatedPetResponse>(withoutNear);
      for (const pet of plainList.data) {
        expect(pet).not.toHaveProperty('distanceKm');
      }
    });

    it('rejects a malformed near value', async () => {
      await request(app.getHttpServer())
        .get('/pets')
        .query({ near: 'not-a-coord' })
        .expect(400);
    });

    it('rejects an out-of-range latitude in near', async () => {
      await request(app.getHttpServer())
        .get('/pets')
        .query({ near: '999,13.405' })
        .expect(400);
    });

    it('rejects a non-numeric radius', async () => {
      await request(app.getHttpServer())
        .get('/pets')
        .query({ near: '52.520,13.405', radius: 'far' })
        .expect(400);
    });
  });

  describe('privacy: exact owner address never appears in any response', () => {
    const EXACT_LAT = 52.5200349;
    const EXACT_LNG = 13.4049549;
    // Stored/displayed after ~100 m rounding (3 decimal places).
    const ROUNDED_LAT = 52.52;
    const ROUNDED_LNG = 13.405;
    let petId: string;
    let token: string;

    beforeAll(async () => {
      const email = `geo_shelter_${Date.now()}@test.com`;
      const password = 'StrongPass123';

      await request(app.getHttpServer()).post('/auth/register').send({
        email,
        password,
        firstName: 'Geo',
        lastName: 'Shelter',
      });
      // Promote to SHELTER so POST /pets is allowed, then log in again so the
      // fresh JWT carries the new role.
      await prisma.user.update({
        where: { email },
        data: { role: 'SHELTER' },
      });
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(201);
      token = responseBody<{ access_token: string }>(login).access_token;

      const created = await request(app.getHttpServer())
        .post('/pets')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `${FIXTURE_PREFIX}private`,
          species: PetSpecies.DOG,
          latitude: EXACT_LAT,
          longitude: EXACT_LNG,
          city: 'Berlin',
          state: 'Berlin',
          country: 'Germany',
        })
        .expect(201);
      const createdBody = responseBody<PetResponse>(created);
      petId = createdBody.id;

      // The response itself must only carry the rounded coordinates.
      expect(createdBody.latitude).toBe(ROUNDED_LAT);
      expect(createdBody.longitude).toBe(ROUNDED_LNG);
      expect(JSON.stringify(createdBody)).not.toContain('52.5200349');
      expect(JSON.stringify(createdBody)).not.toContain('13.4049549');
    });

    afterAll(async () => {
      await prisma.pet.delete({ where: { id: petId } }).catch(() => undefined);
    });

    it('stores only the rounded coordinates in the database', async () => {
      const stored = await prisma.pet.findUnique({ where: { id: petId } });
      expect(stored?.latitude).toBe(ROUNDED_LAT);
      expect(stored?.longitude).toBe(ROUNDED_LNG);
    });

    it('never returns the exact coordinates from GET /pets/:id', async () => {
      const res = await request(app.getHttpServer())
        .get(`/pets/${petId}`)
        .expect(200);

      const body = responseBody<PetResponse>(res);
      expect(body.latitude).toBe(ROUNDED_LAT);
      expect(body.longitude).toBe(ROUNDED_LNG);
      const raw = JSON.stringify(body);
      expect(raw).not.toContain('52.5200349');
      expect(raw).not.toContain('13.4049549');
    });

    it('never returns the exact coordinates from a geo search', async () => {
      const res = await request(app.getHttpServer())
        .get('/pets')
        .query({ near: '52.520,13.405', radius: 5 })
        .expect(200);

      const body = responseBody<PaginatedPetResponse<GeoPetResponse>>(res);
      const raw = JSON.stringify(body);
      expect(raw).not.toContain('52.5200349');
      expect(raw).not.toContain('13.4049549');

      const match = body.data.find((pet) => pet.id === petId);
      if (!match) {
        throw new Error('Expected geo results to contain the private listing');
      }
      expect(match.latitude).toBe(ROUNDED_LAT);
      expect(match.distanceKm).toBeCloseTo(0, 1);
    });

    it('never returns the exact coordinates from a plain list', async () => {
      const res = await request(app.getHttpServer())
        .get('/pets')
        .query({ search: `${FIXTURE_PREFIX}private` })
        .expect(200);

      const body = responseBody<PaginatedPetResponse>(res);
      const raw = JSON.stringify(body);
      expect(raw).not.toContain('52.5200349');
      expect(raw).not.toContain('13.4049549');
    });

    it('rounds coordinates supplied on update as well', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/pets/${petId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ latitude: 52.5200987, longitude: 13.4049123 })
        .expect(200);

      const body = responseBody<PetResponse>(res);
      expect(body.latitude).toBe(52.52);
      expect(body.longitude).toBe(13.405);
      const raw = JSON.stringify(body);
      expect(raw).not.toContain('52.5200987');
      expect(raw).not.toContain('13.4049123');
    });
  });
});
