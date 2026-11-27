import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import {
  PredictiveInsightsService,
  classifyAgeGroup,
} from './predictive-insights.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdoptionStatus, PetSpecies } from '@prisma/client';
import { ConfidenceLevel, QualityGrade } from './dto/predictive-insights.dto';
import { ListingQualityCalculator } from './listing-quality.calculator';

describe('PredictiveInsightsService', () => {
  let service: PredictiveInsightsService;
  let prisma: {
    pet: { findUnique: jest.Mock };
    adoption: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      pet: { findUnique: jest.fn().mockResolvedValue(null) },
      adoption: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PredictiveInsightsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<PredictiveInsightsService>(PredictiveInsightsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('classifyAgeGroup helper', () => {
    it('should correctly classify age boundaries', () => {
      expect(classifyAgeGroup(0)).toBe('BABY');
      expect(classifyAgeGroup(1)).toBe('BABY');
      expect(classifyAgeGroup(2)).toBe('YOUNG');
      expect(classifyAgeGroup(3)).toBe('YOUNG');
      expect(classifyAgeGroup(5)).toBe('ADULT');
      expect(classifyAgeGroup(8)).toBe('ADULT');
      expect(classifyAgeGroup(10)).toBe('SENIOR');
      expect(classifyAgeGroup(null)).toBe('UNKNOWN');
      expect(classifyAgeGroup(undefined)).toBe('UNKNOWN');
    });
  });

  describe('ListingQualityCalculator', () => {
    it('should calculate complete score and recommendations for poor listing', () => {
      const result = ListingQualityCalculator.calculate({
        hasPhoto: false,
        description: 'Dog',
      });

      expect(result.score).toBeLessThan(45);
      expect(result.grade).toBe(QualityGrade.NEEDS_IMPROVEMENT);
      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations.some((r) => r.includes('photo'))).toBe(
        true,
      );
      expect(result.recommendations.some((r) => r.includes('veterinary'))).toBe(
        true,
      );
    });

    it('should award high score for detailed listing with photos, health info, and breed', () => {
      const result = ListingQualityCalculator.calculate({
        hasPhoto: true,
        description:
          'Max is a wonderful, energetic golden retriever who loves outdoor hikes, playing fetch in the park, and relaxing by your feet at home. ' +
          'He gets along excellently with young children, adults, and other friendly dogs. He is fully house-trained, knows basic commands, and walks nicely on a leash. ' +
          'Fully vaccinated, neutered, microchipped, and recently had his vet checkup with a clean bill of health.',
        breed: 'Golden Retriever',
        state: 'CA',
        city: 'San Francisco',
      });

      expect(result.score).toBeGreaterThanOrEqual(80);
      expect(result.grade).toBe(QualityGrade.EXCELLENT);
      expect(result.breakdown.photoScore).toBe(35);
      expect(result.breakdown.descriptionScore).toBe(35);
      expect(result.breakdown.healthInfoScore).toBe(15);
      expect(result.breakdown.locationAndBreedScore).toBe(15);
    });
  });

  describe('Acceptance Criteria: Predictions include features used and confidence indicator', () => {
    it('should return features used, confidence indicator, and ethical disclaimer', async () => {
      // Setup 25 historical records for DOG (ADULT) in CA (taking 10 days each) -> HIGH confidence
      const records = Array.from({ length: 25 }, (_, i) => ({
        createdAt: new Date(`2026-01-01T00:00:00.000Z`),
        updatedAt: new Date(`2026-01-11T00:00:00.000Z`), // 10 days
        pet: {
          species: PetSpecies.DOG,
          age: 4,
          state: 'CA',
          city: 'Los Angeles',
          createdAt: new Date(`2026-01-01T00:00:00.000Z`),
        },
      }));
      prisma.adoption.findMany.mockResolvedValue(records);

      const prediction = await service.estimateAdoptionTime({
        species: PetSpecies.DOG,
        age: 4,
        region: 'CA',
        description: 'Friendly family dog, fully vaccinated and vet checked.',
        hasPhoto: true,
        breed: 'Labrador',
      });

      // 1. Acceptance Criterion: Predictions include features used
      expect(prediction.featuresUsed).toBeDefined();
      expect(prediction.featuresUsed.species).toBe(PetSpecies.DOG);
      expect(prediction.featuresUsed.age).toBe(4);
      expect(prediction.featuresUsed.ageGroup).toBe('ADULT');
      expect(prediction.featuresUsed.region).toBe('CA');
      expect(prediction.featuresUsed.hasPhoto).toBe(true);
      expect(prediction.featuresUsed.descriptionWordCount).toBeGreaterThan(0);
      expect(prediction.featuresUsed.listingQualityScore).toBeGreaterThan(0);

      // 2. Acceptance Criterion: Confidence indicator
      expect(prediction.confidence).toBe(ConfidenceLevel.HIGH);
      expect(prediction.confidenceNote).toContain('High confidence');
      expect(prediction.confidenceNote).toContain('25 historical adoptions');

      // 3. Estimate values and ranges
      expect(prediction.estimatedDaysToAdoption).toBeGreaterThan(0);
      expect(prediction.estimatedRange.minDays).toBeLessThanOrEqual(
        prediction.estimatedDaysToAdoption,
      );
      expect(prediction.estimatedRange.maxDays).toBeGreaterThanOrEqual(
        prediction.estimatedDaysToAdoption,
      );

      // 4. Listing quality recommendations
      expect(prediction.listingQuality).toBeDefined();
      expect(prediction.listingQuality.score).toBeGreaterThan(0);

      // 5. Ethical safeguard disclaimer (No automated decisions about users)
      expect(prediction.disclaimer).toContain(
        'No automated decisions are made regarding users or eligibility',
      );
    });

    it('should assign LOW confidence when cohort has fewer than 5 records', async () => {
      // Only 2 historical adoptions
      prisma.adoption.findMany.mockResolvedValue([
        {
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-15T00:00:00.000Z'),
          pet: {
            species: PetSpecies.BIRD,
            age: 1,
            state: 'WA',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        },
        {
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-20T00:00:00.000Z'),
          pet: {
            species: PetSpecies.BIRD,
            age: 1,
            state: 'WA',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
          },
        },
      ]);

      const prediction = await service.estimateAdoptionTime({
        species: PetSpecies.BIRD,
        age: 1,
        region: 'WA',
      });

      expect(prediction.confidence).toBe(ConfidenceLevel.LOW);
      expect(prediction.confidenceNote).toContain('Low confidence');
    });

    it('should throw NotFoundException if petId does not exist', async () => {
      prisma.pet.findUnique.mockResolvedValue(null);
      await expect(service.estimateForPet('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('Acceptance Criteria: The estimator is backtested on historical data and the error is documented', () => {
    it('should backtest historical adoptions and report MAE, MdAE, RMSE, and accuracy', async () => {
      // 10 historical adoptions with known durations (e.g. 10 to 14 days)
      const durations = [10, 11, 12, 10, 13, 14, 12, 11, 10, 12];
      const records = durations.map((d, i) => ({
        createdAt: new Date(`2026-01-01T00:00:00.000Z`),
        updatedAt: new Date(
          new Date(`2026-01-01T00:00:00.000Z`).getTime() +
            d * 24 * 60 * 60 * 1000,
        ),
        pet: {
          species: PetSpecies.CAT,
          age: 2,
          state: 'NY',
          city: 'New York',
          createdAt: new Date(`2026-01-01T00:00:00.000Z`),
        },
      }));
      prisma.adoption.findMany.mockResolvedValue(records);

      const backtest = await service.backtestEstimator();

      expect(backtest.sampleSize).toBe(10);
      expect(backtest.meanAbsoluteErrorDays).toBeGreaterThanOrEqual(0);
      expect(backtest.medianAbsoluteErrorDays).toBeGreaterThanOrEqual(0);
      expect(backtest.rootMeanSquaredErrorDays).toBeGreaterThanOrEqual(0);

      // High accuracy for consistent durations
      expect(backtest.accuracyWithin7DaysPercentage).toBe(100);
      expect(backtest.accuracyWithin14DaysPercentage).toBe(100);
      expect(backtest.testedAt).toBeDefined();
      expect(backtest.notes).toContain(
        'Backtested across 10 historical adoptions',
      );
    });
  });
});
