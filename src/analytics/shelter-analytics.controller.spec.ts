import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ShelterAnalyticsController } from './shelter-analytics.controller';
import { ShelterAnalyticsService } from './shelter-analytics.service';
import { ROLES_KEY } from '../auth/guards/roles.decorator';
import { Role } from '../auth/enums/role.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ShelterAnalyticsResponseDto } from './dto/shelter-analytics-response.dto';

describe('ShelterAnalyticsController', () => {
  let controller: ShelterAnalyticsController;
  let shelterAnalyticsService: { getShelterMetrics: jest.Mock };
  let reflector: Reflector;

  const mockResponse: ShelterAnalyticsResponseDto = {
    shelterId: 'shelter-1',
    listings: 10,
    timeToAdoption: 15.2,
    timeToAdoptionDays: 15.2,
    approvalResponseTime: 4.8,
    approvalResponseTimeHours: 4.8,
    disputeRate: 0.02,
    ratingSummary: { average: 4.5, count: 20 },
    sampleSizes: {
      listings: 10,
      completedAdoptions: 8,
      reviewedRequests: 12,
      escrows: 10,
      ratings: 20,
    },
    suppressed: {
      timeToAdoption: false,
      approvalResponseTime: false,
      disputeRate: false,
      ratingSummary: false,
    },
  };

  beforeEach(async () => {
    shelterAnalyticsService = {
      getShelterMetrics: jest.fn().mockResolvedValue(mockResponse),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShelterAnalyticsController],
      providers: [
        {
          provide: ShelterAnalyticsService,
          useValue: shelterAnalyticsService,
        },
        Reflector,
      ],
    }).compile();

    controller = module.get<ShelterAnalyticsController>(
      ShelterAnalyticsController,
    );
    reflector = module.get<Reflector>(Reflector);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Guards and Role Permissions', () => {
    it('should be protected with JwtAuthGuard and RolesGuard', () => {
      const guards = (Reflect.getMetadata(
        '__guards__',
        ShelterAnalyticsController,
      ) ?? []) as unknown[];
      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(RolesGuard);
    });

    it('should allow SHELTER, ADMIN, and ANALYST roles', () => {
      const roles = reflector.get<Role[]>(
        ROLES_KEY,
        ShelterAnalyticsController,
      );
      expect(roles).toBeDefined();
      expect(roles).toContain(Role.SHELTER);
      expect(roles).toContain(Role.ADMIN);
      expect(roles).toContain(Role.ANALYST);
    });
  });

  describe('GET /shelters/:id/analytics', () => {
    it('should call shelterAnalyticsService.getShelterMetrics and return results', async () => {
      const user = { userId: 'shelter-1', email: 's@p.ad', role: 'SHELTER' };
      const result = await controller.getShelterMetrics('shelter-1', user);

      expect(shelterAnalyticsService.getShelterMetrics).toHaveBeenCalledWith(
        'shelter-1',
        user,
      );
      expect(result).toEqual(mockResponse);
    });
  });
});
