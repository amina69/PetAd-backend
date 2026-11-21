import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdoptionStatus } from '@prisma/client';
import {
  AdoptionDistanceDistributionDto,
  GeoAnalyticsResponseDto,
  RegionMetricsDto,
} from './dto/geo-analytics-response.dto';

export const DEFAULT_K_ANONYMITY_MIN_CELL_SIZE = 5;

/** Precision limit: Coordinates in geo analytics are rounded to at most 1 decimal place (~11 km) */
const GEO_COORDINATE_DECIMALS = 1;
const GEO_COORDINATE_FACTOR = 10 ** GEO_COORDINATE_DECIMALS;

export function roundGeoCoordinate(coord: number): number {
  return Math.round(coord * GEO_COORDINATE_FACTOR) / GEO_COORDINATE_FACTOR;
}

@Injectable()
export class GeoAnalyticsService {
  private readonly logger = new Logger(GeoAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private getErrorMessage(err: unknown): string {
    if (err instanceof Error) {
      return err.message;
    }
    return String(err);
  }

  /**
   * Computes geographic adoption patterns:
   * - Supply vs demand by region (state/city buckets)
   * - Under-served regions
   * - Adoption distance distribution
   * - Enforces k-anonymity: regions with fewer than 5 records are merged or omitted
   * - Strips all precise coordinates: only rounded coordinates (at most 1 decimal) are ever exposed
   */
  async getGeoPatterns(
    minCellSize: number = DEFAULT_K_ANONYMITY_MIN_CELL_SIZE,
    stateFilter?: string,
  ): Promise<GeoAnalyticsResponseDto> {
    const effectiveMinCellSize = Math.max(1, minCellSize);

    // 1. Fetch pets with location
    const pets = await this.prisma.pet.findMany({
      where: {
        ...(stateFilter ? { state: stateFilter } : {}),
      },
      select: {
        id: true,
        city: true,
        state: true,
        latitude: true,
        longitude: true,
      },
    });

    // 2. Fetch adoptions with pet location
    const adoptions = await this.prisma.adoption.findMany({
      where: {
        ...(stateFilter ? { pet: { state: stateFilter } } : {}),
      },
      select: {
        id: true,
        status: true,
        pet: {
          select: {
            id: true,
            city: true,
            state: true,
            latitude: true,
            longitude: true,
          },
        },
        adopter: {
          select: {
            location: true,
          },
        },
      },
    });

    // 3. Aggregate metrics by region (State or City, State)
    const regionMap: Record<
      string,
      {
        state: string;
        city: string | null;
        supply: number;
        demand: number;
        adoptionsCompleted: number;
        latitudes: number[];
        longitudes: number[];
      }
    > = {};

    const getRegionKey = (
      state?: string | null,
      city?: string | null,
    ): string => {
      const s = state?.trim() || 'Unknown';
      const c = city?.trim();
      return c ? `${c}, ${s}` : s;
    };

    // Aggregate pet supply
    for (const pet of pets) {
      const key = getRegionKey(pet.state, pet.city);
      if (!regionMap[key]) {
        regionMap[key] = {
          state: pet.state?.trim() || 'Unknown',
          city: pet.city?.trim() || null,
          supply: 0,
          demand: 0,
          adoptionsCompleted: 0,
          latitudes: [],
          longitudes: [],
        };
      }
      regionMap[key].supply += 1;
      if (typeof pet.latitude === 'number') {
        regionMap[key].latitudes.push(pet.latitude);
      }
      if (typeof pet.longitude === 'number') {
        regionMap[key].longitudes.push(pet.longitude);
      }
    }

    // Aggregate adoption demand and completions
    for (const adoption of adoptions) {
      const pet = adoption.pet;
      if (!pet) continue;
      const key = getRegionKey(pet.state, pet.city);
      if (!regionMap[key]) {
        regionMap[key] = {
          state: pet.state?.trim() || 'Unknown',
          city: pet.city?.trim() || null,
          supply: 0,
          demand: 0,
          adoptionsCompleted: 0,
          latitudes: [],
          longitudes: [],
        };
      }
      regionMap[key].demand += 1;
      if (adoption.status === AdoptionStatus.COMPLETED) {
        regionMap[key].adoptionsCompleted += 1;
      }
      if (typeof pet.latitude === 'number') {
        regionMap[key].latitudes.push(pet.latitude);
      }
      if (typeof pet.longitude === 'number') {
        regionMap[key].longitudes.push(pet.longitude);
      }
    }

    // 4. Apply k-anonymity: filter out small cells (< minCellSize records) and merge into 'Other'
    const qualifiedRegions: RegionMetricsDto[] = [];
    let mergedSupply = 0;
    let mergedDemand = 0;
    let mergedCompleted = 0;
    let mergedCount = 0;

    for (const [regionName, data] of Object.entries(regionMap)) {
      const totalRecords = data.supply + data.demand;

      // Centroid calculation strictly rounded to 1 decimal place (no precise coordinates)
      const approxLat =
        data.latitudes.length > 0
          ? roundGeoCoordinate(
              data.latitudes.reduce((a, b) => a + b, 0) / data.latitudes.length,
            )
          : null;
      const approxLon =
        data.longitudes.length > 0
          ? roundGeoCoordinate(
              data.longitudes.reduce((a, b) => a + b, 0) /
                data.longitudes.length,
            )
          : null;

      const ratio =
        data.demand > 0
          ? Number((data.supply / data.demand).toFixed(2))
          : data.supply;

      const isUnderServed = data.demand > data.supply;

      const regionMetrics: RegionMetricsDto = {
        region: regionName,
        state: data.state,
        city: data.city,
        supply: data.supply,
        demand: data.demand,
        adoptionsCompleted: data.adoptionsCompleted,
        totalRecords,
        supplyToDemandRatio: ratio,
        underServed: isUnderServed,
        approximateLatitude: approxLat,
        approximateLongitude: approxLon,
      };

      if (totalRecords >= effectiveMinCellSize) {
        qualifiedRegions.push(regionMetrics);
      } else {
        // Acceptance criteria: Regions with fewer than 5 records are merged or omitted
        mergedSupply += data.supply;
        mergedDemand += data.demand;
        mergedCompleted += data.adoptionsCompleted;
        mergedCount += totalRecords;
      }
    }

    // Sort qualified regions by total activity descending
    qualifiedRegions.sort((a, b) => b.totalRecords - a.totalRecords);

    // Merged bucket for suppressed small regions
    const mergedOtherRegions: RegionMetricsDto | null =
      mergedCount > 0
        ? {
            region: 'Other / Merged Regions',
            state: 'Multiple',
            city: null,
            supply: mergedSupply,
            demand: mergedDemand,
            adoptionsCompleted: mergedCompleted,
            totalRecords: mergedCount,
            supplyToDemandRatio:
              mergedDemand > 0
                ? Number((mergedSupply / mergedDemand).toFixed(2))
                : mergedSupply,
            underServed: mergedDemand > mergedSupply,
            approximateLatitude: null,
            approximateLongitude: null,
          }
        : null;

    // Under-served regions
    const underServedRegions = qualifiedRegions.filter((r) => r.underServed);

    // 5. Adoption distance distribution
    const distanceDistribution = this.computeDistanceDistribution(adoptions);

    return {
      kAnonymityMinCellSize: effectiveMinCellSize,
      totalRegions: qualifiedRegions.length,
      regions: qualifiedRegions,
      mergedOtherRegions,
      underServedRegions,
      distanceDistribution,
    };
  }

  /**
   * Calculates the distribution of adoption distances across standard distance bands.
   * Only uses rounded coordinates.
   */
  private computeDistanceDistribution(
    adoptions: Array<{
      status: AdoptionStatus;
      pet?: { latitude?: number | null; longitude?: number | null } | null;
      adopter?: { location?: string | null } | null;
    }>,
  ): AdoptionDistanceDistributionDto[] {
    const completedWithLocation = adoptions.filter(
      (a) =>
        a.status === AdoptionStatus.COMPLETED &&
        typeof a.pet?.latitude === 'number' &&
        typeof a.pet?.longitude === 'number',
    );

    const bands = [
      { band: '0-10 km', min: 0, max: 10, count: 0 },
      { band: '10-25 km', min: 10, max: 25, count: 0 },
      { band: '25-50 km', min: 25, max: 50, count: 0 },
      { band: '50-100 km', min: 50, max: 100, count: 0 },
      { band: '> 100 km', min: 100, max: Infinity, count: 0 },
    ];

    let totalMeasured = 0;

    for (const a of completedWithLocation) {
      const petLat = roundGeoCoordinate(a.pet!.latitude!);
      const petLon = roundGeoCoordinate(a.pet!.longitude!);

      // Check if adopter has coordinate string "lat,lon" in location
      let adopterLat: number | null = null;
      let adopterLon: number | null = null;

      if (a.adopter?.location && a.adopter.location.includes(',')) {
        const parts = a.adopter.location
          .split(',')
          .map((p) => Number(p.trim()));
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
          adopterLat = roundGeoCoordinate(parts[0]);
          adopterLon = roundGeoCoordinate(parts[1]);
        }
      }

      let distanceKm = 5; // Default within-city distance
      if (adopterLat !== null && adopterLon !== null) {
        distanceKm = this.calculateHaversineDistanceKm(
          petLat,
          petLon,
          adopterLat,
          adopterLon,
        );
      }

      totalMeasured += 1;
      const targetBand =
        bands.find((b) => distanceKm >= b.min && distanceKm < b.max) ??
        bands[bands.length - 1];
      targetBand.count += 1;
    }

    return bands.map((b) => ({
      band: b.band,
      count: b.count,
      percentage:
        totalMeasured > 0
          ? Number(((b.count / totalMeasured) * 100).toFixed(1))
          : 0,
    }));
  }

  private calculateHaversineDistanceKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // Earth radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Number((R * c).toFixed(1));
  }
}
