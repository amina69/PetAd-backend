import { Test, TestingModule } from '@nestjs/testing';
import { GeoAnalyticsService } from './geo-analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdoptionStatus } from '@prisma/client';

describe('GeoAnalyticsService', () => {
  let service: GeoAnalyticsService;
  let prisma: {
    pet: { findMany: jest.Mock };
    adoption: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      pet: { findMany: jest.fn().mockResolvedValue([]) },
      adoption: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeoAnalyticsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<GeoAnalyticsService>(GeoAnalyticsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Acceptance Criteria: k-Anonymity (Regions with fewer than 5 records are merged or omitted)', () => {
    it('should omit regions with fewer than 5 records from the main regions list and merge them', async () => {
      // Region CA: 4 pets + 2 adoptions = 6 records (>= 5, qualified)
      // Region NY: 1 pet + 1 adoption = 2 records (< 5, suppressed)
      // Region TX: 1 pet + 1 adoption = 2 records (< 5, suppressed)
      prisma.pet.findMany.mockResolvedValue([
        {
          id: 'p1',
          city: 'Los Angeles',
          state: 'CA',
          latitude: 34.0522,
          longitude: -118.2437,
        },
        {
          id: 'p2',
          city: 'Los Angeles',
          state: 'CA',
          latitude: 34.0531,
          longitude: -118.2422,
        },
        {
          id: 'p3',
          city: 'Los Angeles',
          state: 'CA',
          latitude: 34.0519,
          longitude: -118.2441,
        },
        {
          id: 'p4',
          city: 'Los Angeles',
          state: 'CA',
          latitude: 34.0545,
          longitude: -118.2415,
        },
        {
          id: 'p5',
          city: 'New York',
          state: 'NY',
          latitude: 40.7128,
          longitude: -74.006,
        },
        {
          id: 'p6',
          city: 'Austin',
          state: 'TX',
          latitude: 30.2672,
          longitude: -97.7431,
        },
      ]);

      prisma.adoption.findMany.mockResolvedValue([
        {
          id: 'a1',
          status: AdoptionStatus.COMPLETED,
          pet: {
            id: 'p1',
            city: 'Los Angeles',
            state: 'CA',
            latitude: 34.0522,
            longitude: -118.2437,
          },
          adopter: { location: '34.05, -118.24' },
        },
        {
          id: 'a2',
          status: AdoptionStatus.REQUESTED,
          pet: {
            id: 'p2',
            city: 'Los Angeles',
            state: 'CA',
            latitude: 34.0531,
            longitude: -118.2422,
          },
          adopter: { location: '34.05, -118.24' },
        },
        {
          id: 'a3',
          status: AdoptionStatus.REQUESTED,
          pet: {
            id: 'p5',
            city: 'New York',
            state: 'NY',
            latitude: 40.7128,
            longitude: -74.006,
          },
          adopter: { location: '40.71, -74.00' },
        },
        {
          id: 'a4',
          status: AdoptionStatus.REQUESTED,
          pet: {
            id: 'p6',
            city: 'Austin',
            state: 'TX',
            latitude: 30.2672,
            longitude: -97.7431,
          },
          adopter: { location: '30.26, -97.74' },
        },
      ]);

      const result = await service.getGeoPatterns();

      // Only CA has >= 5 records
      expect(result.regions).toHaveLength(1);
      expect(result.regions[0].state).toBe('CA');
      expect(result.regions[0].totalRecords).toBe(6);
      expect(result.regions[0].totalRecords).toBeGreaterThanOrEqual(5);

      // NY and TX (< 5 records) are NOT in the individual regions list
      const statesInRegions = result.regions.map((r) => r.state);
      expect(statesInRegions).not.toContain('NY');
      expect(statesInRegions).not.toContain('TX');

      // They are merged into mergedOtherRegions
      expect(result.mergedOtherRegions).toBeDefined();
      expect(result.mergedOtherRegions?.region).toBe('Other / Merged Regions');
      expect(result.mergedOtherRegions?.totalRecords).toBe(4); // 2 from NY + 2 from TX
      expect(result.mergedOtherRegions?.supply).toBe(2);
      expect(result.mergedOtherRegions?.demand).toBe(2);
    });

    it('should return empty regions array when all regions have fewer than 5 records', async () => {
      prisma.pet.findMany.mockResolvedValue([
        {
          id: 'p1',
          city: 'Miami',
          state: 'FL',
          latitude: 25.7617,
          longitude: -80.1918,
        },
      ]);
      prisma.adoption.findMany.mockResolvedValue([]);

      const result = await service.getGeoPatterns();

      expect(result.regions).toHaveLength(0);
      expect(result.totalRegions).toBe(0);
      expect(result.mergedOtherRegions?.totalRecords).toBe(1);
    });
  });

  describe('Acceptance Criteria: No Precise Coordinates in Responses', () => {
    it('should round all exposed coordinates to at most 1 decimal place (~11 km precision)', async () => {
      // Create 5 records for Chicago, IL with precise GPS coordinates
      const pets = Array.from({ length: 5 }, (_, i) => ({
        id: `pet-${i}`,
        city: 'Chicago',
        state: 'IL',
        latitude: 41.8781136 + i * 0.0001,
        longitude: -87.6297982 - i * 0.0001,
      }));
      prisma.pet.findMany.mockResolvedValue(pets);
      prisma.adoption.findMany.mockResolvedValue([]);

      const result = await service.getGeoPatterns();

      expect(result.regions).toHaveLength(1);
      const region = result.regions[0];

      // Verify coordinate is rounded to at most 1 decimal place
      expect(region.approximateLatitude).toBeDefined();
      expect(region.approximateLongitude).toBeDefined();

      const latDecimals = (
        region.approximateLatitude!.toString().split('.')[1] || ''
      ).length;
      const lonDecimals = (
        region.approximateLongitude!.toString().split('.')[1] || ''
      ).length;

      expect(latDecimals).toBeLessThanOrEqual(1);
      expect(lonDecimals).toBeLessThanOrEqual(1);

      expect(region.approximateLatitude).toBe(41.9);
      expect(region.approximateLongitude).toBe(-87.6);
    });

    it('should not leak exact coordinates in mergedOtherRegions', async () => {
      prisma.pet.findMany.mockResolvedValue([
        {
          id: 'p1',
          city: 'Smallville',
          state: 'KS',
          latitude: 38.1234567,
          longitude: -98.7654321,
        },
      ]);
      prisma.adoption.findMany.mockResolvedValue([]);

      const result = await service.getGeoPatterns();

      expect(result.mergedOtherRegions?.approximateLatitude).toBeNull();
      expect(result.mergedOtherRegions?.approximateLongitude).toBeNull();
    });
  });

  describe('Supply vs Demand & Under-served Regions', () => {
    it('should detect under-served regions where demand exceeds supply', async () => {
      // 1 pet listing in Seattle, WA
      const pets = [
        {
          id: 'p1',
          city: 'Seattle',
          state: 'WA',
          latitude: 47.6062,
          longitude: -122.3321,
        },
      ];
      // 5 adoption requests for that pet in Seattle, WA -> total 6 records (qualified)
      const adoptions = Array.from({ length: 5 }, (_, i) => ({
        id: `adopt-${i}`,
        status: AdoptionStatus.REQUESTED,
        pet: pets[0],
        adopter: { location: 'Seattle, WA' },
      }));

      prisma.pet.findMany.mockResolvedValue(pets);
      prisma.adoption.findMany.mockResolvedValue(adoptions);

      const result = await service.getGeoPatterns();

      expect(result.regions).toHaveLength(1);
      const region = result.regions[0];
      expect(region.supply).toBe(1);
      expect(region.demand).toBe(5);
      expect(region.underServed).toBe(true);

      // Verify underServedRegions contains Seattle
      expect(result.underServedRegions).toHaveLength(1);
      expect(result.underServedRegions[0].region).toBe('Seattle, WA');
    });
  });

  describe('Adoption Distance Distribution', () => {
    it('should compute distance distribution for completed adoptions across bands', async () => {
      prisma.pet.findMany.mockResolvedValue([]);
      prisma.adoption.findMany.mockResolvedValue([
        // Close distance (~3 km) -> 0-10 km band
        {
          id: 'a1',
          status: AdoptionStatus.COMPLETED,
          pet: { latitude: 40.7128, longitude: -74.006 },
          adopter: { location: '40.73, -74.00' },
        },
        // Medium distance (~15 km) -> 10-25 km band
        {
          id: 'a2',
          status: AdoptionStatus.COMPLETED,
          pet: { latitude: 40.7128, longitude: -74.006 },
          adopter: { location: '40.85, -74.00' },
        },
        // Incomplete adoption (REQUESTED) -> not included in completed distance distribution
        {
          id: 'a3',
          status: AdoptionStatus.REQUESTED,
          pet: { latitude: 40.7128, longitude: -74.006 },
          adopter: { location: '40.71, -74.00' },
        },
      ]);

      const result = await service.getGeoPatterns();

      expect(result.distanceDistribution).toHaveLength(5);
      const band0to10 = result.distanceDistribution.find(
        (b) => b.band === '0-10 km',
      );
      const band10to25 = result.distanceDistribution.find(
        (b) => b.band === '10-25 km',
      );

      expect(band0to10?.count).toBe(1);
      expect(band10to25?.count).toBe(1);
      expect(band0to10?.percentage).toBe(50.0);
      expect(band10to25?.percentage).toBe(50.0);
    });
  });
});
