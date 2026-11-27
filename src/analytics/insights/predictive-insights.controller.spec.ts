import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { PredictiveInsightsController } from './predictive-insights.controller';
import { PredictiveInsightsService } from './predictive-insights.service';
import { PetSpecies } from '@prisma/client';
import { ConfidenceLevel, QualityGrade } from './dto/predictive-insights.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';

describe('PredictiveInsightsController', () => {
  let controller: PredictiveInsightsController;
  let service: {
    estimateForPet: jest.Mock;
    estimateAdoptionTime: jest.Mock;
    backtestEstimator: jest.Mock;
  };

  const mockPrediction = {
    estimatedDaysToAdoption: 12.5,
    estimatedRange: { minDays: 7, maxDays: 19 },
    confidence: ConfidenceLevel.HIGH,
    confidenceNote: 'High confidence based on historical data.',
    featuresUsed: {
      species: 'DOG',
      age: 3,
      ageGroup: 'YOUNG',
      region: 'CA',
      breed: 'Labrador',
      hasPhoto: true,
      descriptionWordCount: 50,
      listingQualityScore: 85,
    },
    listingQuality: {
      score: 85,
      grade: QualityGrade.EXCELLENT,
      breakdown: {
        photoScore: 35,
        descriptionScore: 30,
        healthInfoScore: 10,
        locationAndBreedScore: 10,
      },
      recommendations: [],
    },
    disclaimer:
      'Informational estimate only. No automated decisions are made regarding users or eligibility.',
  };

  beforeEach(async () => {
    service = {
      estimateForPet: jest.fn().mockResolvedValue(mockPrediction),
      estimateAdoptionTime: jest.fn().mockResolvedValue(mockPrediction),
      backtestEstimator: jest.fn().mockResolvedValue({
        sampleSize: 50,
        meanAbsoluteErrorDays: 3.5,
        medianAbsoluteErrorDays: 2.8,
        rootMeanSquaredErrorDays: 4.9,
        accuracyWithin7DaysPercentage: 82.5,
        accuracyWithin14DaysPercentage: 94.0,
        testedAt: '2026-11-21T00:00:00.000Z',
        notes: 'Backtest evaluation passed.',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PredictiveInsightsController],
      providers: [
        { provide: PredictiveInsightsService, useValue: service },
        Reflector,
      ],
    }).compile();

    controller = module.get<PredictiveInsightsController>(
      PredictiveInsightsController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should be protected with JwtAuthGuard and RolesGuard', () => {
    const guards = (Reflect.getMetadata(
      '__guards__',
      PredictiveInsightsController,
    ) ?? []) as unknown[];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(RolesGuard);
  });

  describe('GET /analytics/insights/predict/:petId', () => {
    it('should call service.estimateForPet with petId', async () => {
      const result = await controller.predictForPet('pet-123');
      expect(service.estimateForPet).toHaveBeenCalledWith('pet-123');
      expect(result).toEqual(mockPrediction);
    });
  });

  describe('POST /analytics/insights/estimate', () => {
    it('should call service.estimateAdoptionTime with input DTO', async () => {
      const input = {
        species: PetSpecies.DOG,
        age: 2,
        region: 'CA',
        description: 'Friendly dog',
        hasPhoto: true,
      };

      const result = await controller.estimateDraft(input);
      expect(service.estimateAdoptionTime).toHaveBeenCalledWith(input);
      expect(result).toEqual(mockPrediction);
    });
  });

  describe('GET /analytics/insights/backtest', () => {
    it('should call service.backtestEstimator and return backtest metrics', async () => {
      const result = await controller.runBacktest();
      expect(service.backtestEstimator).toHaveBeenCalled();
      expect(result.sampleSize).toBe(50);
      expect(result.meanAbsoluteErrorDays).toBe(3.5);
    });
  });
});
