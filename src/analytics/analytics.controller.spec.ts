import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { ShelterAnalyticsService } from './shelter-analytics.service';
import { GeoAnalyticsService } from './geo-analytics.service';
import { AnalyticsGranularity } from './dto/analytics-overview-query.dto';
import { AnalyticsOverviewResponseDto } from './dto/analytics-overview-response.dto';
import { ROLES_KEY } from '../auth/guards/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let analyticsService: { getOverview: jest.Mock };
  let shelterAnalyticsService: { getShelterMetrics: jest.Mock };
  let geoAnalyticsService: { getGeoPatterns: jest.Mock };
  let reflector: Reflector;

  const mockOverviewResponse: AnalyticsOverviewResponseDto = {
    timeZone: 'UTC',
    from: '2026-11-01T00:00:00.000Z',
    to: '2026-11-03T23:59:59.999Z',
    granularity: 'day',
    totals: {
      newUsers: 5,
      listings: 3,
      requests: 8,
      completions: 2,
      activeCustody: 1,
      disputeRate: 0.05,
      escrowVolume: 500,
    },
    series: [
      {
        date: '2026-11-01',
        newUsers: 2,
        listings: 1,
        requests: 3,
        completions: 1,
        activeCustody: 0,
        disputeRate: 0,
        escrowVolume: 200,
      },
      {
        date: '2026-11-02',
        newUsers: 0,
        listings: 0,
        requests: 0,
        completions: 0,
        activeCustody: 0,
        disputeRate: 0,
        escrowVolume: 0,
      },
      {
        date: '2026-11-03',
        newUsers: 3,
        listings: 2,
        requests: 5,
        completions: 1,
        activeCustody: 1,
        disputeRate: 0.05,
        escrowVolume: 300,
      },
    ],
  };

  beforeEach(async () => {
    analyticsService = {
      getOverview: jest.fn().mockResolvedValue(mockOverviewResponse),
    };
    shelterAnalyticsService = {
      getShelterMetrics: jest
        .fn()
        .mockResolvedValue({ shelterId: 'shelter-1' }),
    };
    geoAnalyticsService = {
      getGeoPatterns: jest
        .fn()
        .mockResolvedValue({ totalRegions: 1, regions: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        { provide: AnalyticsService, useValue: analyticsService },
        { provide: ShelterAnalyticsService, useValue: shelterAnalyticsService },
        { provide: GeoAnalyticsService, useValue: geoAnalyticsService },
        Reflector,
      ],
    }).compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Guards and Role Permissions', () => {
    it('should be protected with JwtAuthGuard and RolesGuard', () => {
      const guards = (Reflect.getMetadata('__guards__', AnalyticsController) ??
        []) as unknown[];
      expect(guards).toBeDefined();
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(RolesGuard);
    });

    it('should allow ADMIN and ANALYST roles', () => {
      const roles = reflector.get<Role[]>(ROLES_KEY, AnalyticsController);
      expect(roles).toBeDefined();
      expect(roles).toContain(Role.ADMIN);
      expect(roles).toContain(Role.ANALYST);
      expect(roles.length).toBe(2);
    });
  });

  describe('GET /admin/analytics/overview', () => {
    it('should call analyticsService.getOverview and return overview data', async () => {
      const query = {
        from: '2026-11-01',
        to: '2026-11-03',
        granularity: AnalyticsGranularity.DAY,
      };

      const result = await controller.getOverview(query);

      expect(analyticsService.getOverview).toHaveBeenCalledWith(query);
      expect(result).toEqual(mockOverviewResponse);
    });

    it('should pass default or empty query parameters to service', async () => {
      await controller.getOverview({});
      expect(analyticsService.getOverview).toHaveBeenCalledWith({});
    });

    it('should forward getShelterMetricsAdmin to shelterAnalyticsService', async () => {
      const adminUser = {
        userId: 'admin-1',
        email: 'admin@pet.ad',
        role: 'ADMIN',
      };
      await controller.getShelterMetricsAdmin('shelter-1', adminUser);
      expect(shelterAnalyticsService.getShelterMetrics).toHaveBeenCalledWith(
        'shelter-1',
        adminUser,
      );
    });

    it('should forward getGeoPatterns to geoAnalyticsService', async () => {
      await controller.getGeoPatterns(5, 'CA');
      expect(geoAnalyticsService.getGeoPatterns).toHaveBeenCalledWith(5, 'CA');
    });
  });
});
