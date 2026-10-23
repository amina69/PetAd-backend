import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

/** Mean Earth radius in kilometres (standard value used by the Haversine formula). */
export const EARTH_RADIUS_KM = 6371;

export interface NearbyPetMatch {
  id: string;
  distanceKm: number;
}

/**
 * Data access layer for pet geo queries.
 *
 * Radius search uses the Haversine formula expressed directly in SQL rather
 * than PostGIS. Decision record: PostGIS was not adopted because (a) the
 * docker-compose / CI images are plain `postgres:15` without the extension
 * available, (b) at the current data volume a sequential scan of the pets
 * table with an in-SQL Haversine predicate is more than fast enough, and
 * (c) it keeps local development and CI configuration unchanged. If listing
 * volume ever requires an index-assisted search, migrating to PostGIS
 * (`earth_distance` / GiST indexes) is the recommended next step — the
 * repository boundary keeps that change contained to this file.
 *
 * Privacy: this layer never reads or returns anything beyond the already
 * rounded coordinates persisted on the pet row (see PetsService), so an
 * owner's exact address cannot leak through geo queries.
 */
@Injectable()
export class PetsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds all pets with location data within `radiusKm` of a point, using the
   * Haversine formula in SQL, ordered nearest-first.
   *
   * A latitude band pre-filter is applied so the `pets(latitude, longitude)`
   * index can narrow the scan. The band is a strict superset of the circle
   * (max latitude separation for two points within a given distance occurs
   * travelling due north/south), so no in-radius pet can be excluded by it.
   * The exact Haversine distance then decides membership, which also keeps
   * the query correct across the meridian and near the poles.
   */
  async findIdsWithinRadius(
    latitude: number,
    longitude: number,
    radiusKm: number,
  ): Promise<NearbyPetMatch[]> {
    const latBand = radiusKm / 111.045;

    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; distance_km: number }>
    >(Prisma.sql`
      SELECT id, distance_km
      FROM (
        SELECT
          id,
          (2 * ${EARTH_RADIUS_KM}::double precision * asin(least(
            1.0::double precision,
            sqrt(
              power(sin(radians((latitude - ${latitude}::double precision) / 2)), 2) +
              cos(radians(${latitude}::double precision)) * cos(radians(latitude)) *
              power(sin(radians((longitude - ${longitude}::double precision) / 2)), 2)
            )
          ))) AS distance_km
        FROM "pets"
        WHERE latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND latitude BETWEEN ${latitude - latBand}::double precision
                           AND ${latitude + latBand}::double precision
      ) AS candidates
      WHERE distance_km <= ${radiusKm}::double precision
      ORDER BY distance_km ASC
    `);

    return rows.map((row) => ({
      id: row.id,
      distanceKm: Number(row.distance_km),
    }));
  }
}
