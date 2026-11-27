import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdoptionStatus, PetSpecies } from '@prisma/client';
import {
  AdoptionTimePredictionDto,
  BacktestResultDto,
  ConfidenceLevel,
  EstimateAdoptionTimeInputDto,
  PredictionFeaturesDto,
} from './dto/predictive-insights.dto';
import { ListingQualityCalculator } from './listing-quality.calculator';

export function classifyAgeGroup(age?: number | null): string {
  if (typeof age !== 'number' || isNaN(age) || age < 0) {
    return 'UNKNOWN';
  }
  if (age <= 1) return 'BABY';
  if (age <= 3) return 'YOUNG';
  if (age <= 8) return 'ADULT';
  return 'SENIOR';
}

interface HistoricalRecord {
  durationDays: number;
  species: PetSpecies;
  age: number | null;
  ageGroup: string;
  region: string | null;
}

@Injectable()
export class PredictiveInsightsService {
  private readonly logger = new Logger(PredictiveInsightsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Estimates time-to-adoption for an existing pet listing.
   */
  async estimateForPet(petId: string): Promise<AdoptionTimePredictionDto> {
    const pet = await this.prisma.pet.findUnique({
      where: { id: petId },
      select: {
        id: true,
        species: true,
        age: true,
        breed: true,
        description: true,
        imageUrl: true,
        city: true,
        state: true,
      },
    });

    if (!pet) {
      throw new NotFoundException(`Pet with ID "${petId}" not found`);
    }

    const input: EstimateAdoptionTimeInputDto = {
      species: pet.species,
      age: pet.age ?? undefined,
      region: pet.state ?? pet.city ?? undefined,
      description: pet.description ?? undefined,
      hasPhoto: Boolean(pet.imageUrl && pet.imageUrl.trim().length > 0),
      breed: pet.breed ?? undefined,
    };

    return this.estimateAdoptionTime(input);
  }

  /**
   * Estimates time-to-adoption for draft or simulated listing attributes.
   */
  async estimateAdoptionTime(
    input: EstimateAdoptionTimeInputDto,
  ): Promise<AdoptionTimePredictionDto> {
    const ageGroup = classifyAgeGroup(input.age);
    const listingQuality = ListingQualityCalculator.calculate({
      hasPhoto: input.hasPhoto,
      description: input.description,
      breed: input.breed,
      region: input.region,
    });

    const historical = await this.fetchHistoricalCompletedAdoptions();

    // Find best historical cohort match (hierarchical fallback)
    const cohort = this.selectCohort(
      historical,
      input.species,
      ageGroup,
      input.region,
    );

    let baselineMedianDays = 14; // Default fallback if no data
    if (cohort.records.length > 0) {
      baselineMedianDays =
        this.calculateMedian(cohort.records.map((r) => r.durationDays)) ?? 14;
    }

    // Listing quality impact modifier (explainable speedup/slowdown)
    let qualityModifier = 1.0;
    if (listingQuality.score >= 80) {
      qualityModifier = 0.9; // 10% faster for high quality listings
    } else if (listingQuality.score < 45) {
      qualityModifier = 1.2; // 20% longer for incomplete listings
    }

    const estimatedDays = Number(
      Math.max(1, baselineMedianDays * qualityModifier).toFixed(1),
    );
    const minDays = Math.max(1, Math.round(estimatedDays * 0.6));
    const maxDays = Math.max(minDays + 2, Math.round(estimatedDays * 1.5));

    // Confidence indicator
    let confidence: ConfidenceLevel;
    let confidenceNote: string;
    if (cohort.sampleSize >= 20) {
      confidence = ConfidenceLevel.HIGH;
      confidenceNote = `High confidence: based on ${cohort.sampleSize} historical adoptions matching ${cohort.description}.`;
    } else if (cohort.sampleSize >= 5) {
      confidence = ConfidenceLevel.MEDIUM;
      confidenceNote = `Medium confidence: based on ${cohort.sampleSize} historical adoptions matching ${cohort.description}.`;
    } else {
      confidence = ConfidenceLevel.LOW;
      confidenceNote = `Low confidence: limited historical data (${cohort.sampleSize} cases) matching ${cohort.description}. Baseline is supplemented by broader species median.`;
    }

    const words = input.description
      ? input.description.trim().split(/\s+/).filter(Boolean)
      : [];

    const featuresUsed: PredictionFeaturesDto = {
      species: input.species,
      age: typeof input.age === 'number' ? input.age : null,
      ageGroup,
      region: input.region?.trim() || null,
      breed: input.breed?.trim() || null,
      hasPhoto: Boolean(input.hasPhoto),
      descriptionWordCount: words.length,
      listingQualityScore: listingQuality.score,
    };

    return {
      estimatedDaysToAdoption: estimatedDays,
      estimatedRange: { minDays, maxDays },
      confidence,
      confidenceNote,
      featuresUsed,
      listingQuality,
      disclaimer:
        'Informational estimate only. No automated decisions are made regarding users or eligibility.',
    };
  }

  /**
   * Backtests the estimator against historical completed adoptions and calculates error metrics.
   */
  async backtestEstimator(): Promise<BacktestResultDto> {
    const historical = await this.fetchHistoricalCompletedAdoptions();

    if (historical.length === 0) {
      return {
        sampleSize: 0,
        meanAbsoluteErrorDays: 0,
        medianAbsoluteErrorDays: 0,
        rootMeanSquaredErrorDays: 0,
        accuracyWithin7DaysPercentage: 0,
        accuracyWithin14DaysPercentage: 0,
        testedAt: new Date().toISOString(),
        notes: 'No historical completed adoptions found for backtesting.',
      };
    }

    const errors: number[] = [];
    const squaredErrors: number[] = [];
    let within7DaysCount = 0;
    let within14DaysCount = 0;

    for (let i = 0; i < historical.length; i++) {
      const target = historical[i];
      // Leave-one-out historical subset
      const trainingSet = historical.filter((_, idx) => idx !== i);
      const cohort = this.selectCohort(
        trainingSet,
        target.species,
        target.ageGroup,
        target.region ?? undefined,
      );

      const predictedDays =
        cohort.records.length > 0
          ? (this.calculateMedian(cohort.records.map((r) => r.durationDays)) ??
            14)
          : 14;

      const error = Math.abs(target.durationDays - predictedDays);
      errors.push(error);
      squaredErrors.push(error * error);

      if (error <= 7) within7DaysCount += 1;
      if (error <= 14) within14DaysCount += 1;
    }

    const n = errors.length;
    const mae = Number((errors.reduce((a, b) => a + b, 0) / n).toFixed(2));
    const mdae = Number((this.calculateMedian(errors) ?? 0).toFixed(2));
    const rmse = Number(
      Math.sqrt(squaredErrors.reduce((a, b) => a + b, 0) / n).toFixed(2),
    );
    const acc7 = Number(((within7DaysCount / n) * 100).toFixed(1));
    const acc14 = Number(((within14DaysCount / n) * 100).toFixed(1));

    return {
      sampleSize: n,
      meanAbsoluteErrorDays: mae,
      medianAbsoluteErrorDays: mdae,
      rootMeanSquaredErrorDays: rmse,
      accuracyWithin7DaysPercentage: acc7,
      accuracyWithin14DaysPercentage: acc14,
      testedAt: new Date().toISOString(),
      notes: `Backtested across ${n} historical adoptions using leave-one-out cross-validation. MAE: ${mae} days, MdAE: ${mdae} days, RMSE: ${rmse} days.`,
    };
  }

  private selectCohort(
    records: HistoricalRecord[],
    species: PetSpecies,
    ageGroup: string,
    region?: string,
  ): { records: HistoricalRecord[]; sampleSize: number; description: string } {
    // 1. Try Species + AgeGroup + Region
    if (region) {
      const match1 = records.filter(
        (r) =>
          r.species === species &&
          r.ageGroup === ageGroup &&
          r.region &&
          r.region.toLowerCase() === region.toLowerCase(),
      );
      if (match1.length >= 5) {
        return {
          records: match1,
          sampleSize: match1.length,
          description: `${species} (${ageGroup}) in ${region}`,
        };
      }
    }

    // 2. Try Species + AgeGroup
    const match2 = records.filter(
      (r) => r.species === species && r.ageGroup === ageGroup,
    );
    if (match2.length >= 5) {
      return {
        records: match2,
        sampleSize: match2.length,
        description: `${species} (${ageGroup})`,
      };
    }

    // 3. Try Species
    const match3 = records.filter((r) => r.species === species);
    if (match3.length >= 5) {
      return {
        records: match3,
        sampleSize: match3.length,
        description: `${species}`,
      };
    }

    // 4. Global fallback
    return {
      records,
      sampleSize: records.length,
      description: 'platform-wide historical adoptions',
    };
  }

  private async fetchHistoricalCompletedAdoptions(): Promise<
    HistoricalRecord[]
  > {
    try {
      const adoptions = await this.prisma.adoption.findMany({
        where: {
          status: AdoptionStatus.COMPLETED,
        },
        select: {
          createdAt: true,
          updatedAt: true,
          pet: {
            select: {
              species: true,
              age: true,
              state: true,
              city: true,
              createdAt: true,
            },
          },
        },
      });

      return adoptions
        .map((a) => {
          const pet = a.pet;
          if (!pet) return null;
          const start = pet.createdAt ?? a.createdAt;
          const diffMs = a.updatedAt.getTime() - start.getTime();
          const durationDays = Math.max(
            1,
            Math.round(diffMs / (1000 * 60 * 60 * 24)),
          );
          const ageGroup = classifyAgeGroup(pet.age);
          const region = pet.state || pet.city || null;

          return {
            durationDays,
            species: pet.species,
            age: pet.age ?? null,
            ageGroup,
            region,
          };
        })
        .filter((r): r is HistoricalRecord => r !== null);
    } catch (err: unknown) {
      this.logger.error(
        `Error loading historical completed adoptions: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private calculateMedian(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 !== 0) {
      return sorted[mid];
    }
    return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1));
  }
}
