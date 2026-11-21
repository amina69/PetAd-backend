import {
  ListingQualityDto,
  QualityGrade,
  QualityScoreBreakdownDto,
} from './dto/predictive-insights.dto';

const HEALTH_KEYWORDS = [
  'vaccin',
  'spay',
  'neuter',
  'vet',
  'health',
  'shot',
  'medical',
  'deworm',
  'microchip',
  'fixed',
];

export interface ListingQualityInputs {
  hasPhoto?: boolean;
  imageUrl?: string | null;
  description?: string | null;
  breed?: string | null;
  region?: string | null;
  city?: string | null;
  state?: string | null;
}

export class ListingQualityCalculator {
  /**
   * Computes an explainable listing-quality score (0-100) and actionable recommendations.
   */
  static calculate(inputs: ListingQualityInputs): ListingQualityDto {
    const recommendations: string[] = [];

    // 1. Photos evaluation (max 35 pts)
    const hasPhoto = Boolean(
      inputs.hasPhoto || (inputs.imageUrl && inputs.imageUrl.trim().length > 0),
    );
    const photoScore = hasPhoto ? 35 : 0;
    if (!hasPhoto) {
      recommendations.push(
        'Add at least one clear, well-lit photo of the pet to significantly improve adopter interest.',
      );
    }

    // 2. Description length and detail evaluation (max 35 pts)
    const descText = inputs.description?.trim() || '';
    const words = descText ? descText.split(/\s+/).filter(Boolean) : [];
    const wordCount = words.length;

    let descriptionScore = 0;
    if (wordCount >= 50) {
      descriptionScore = 35;
    } else if (wordCount >= 30) {
      descriptionScore = 25;
      recommendations.push(
        'Expand description to at least 50 words detailing temperament, compatibility with children/pets, and favorite activities.',
      );
    } else if (wordCount >= 15) {
      descriptionScore = 15;
      recommendations.push(
        'Description is brief. Add more details about the pet’s personality, routine, and history.',
      );
    } else if (wordCount > 0) {
      descriptionScore = 5;
      recommendations.push(
        'Description is very short. Detailed listings receive up to 3x more adoption inquiries.',
      );
    } else {
      descriptionScore = 0;
      recommendations.push(
        'Write a descriptive summary introducing the pet and their ideal home environment.',
      );
    }

    // 3. Health & medical information evaluation (max 15 pts)
    const lowerDesc = descText.toLowerCase();
    const mentionsHealth = HEALTH_KEYWORDS.some((kw) => lowerDesc.includes(kw));
    const healthInfoScore = mentionsHealth ? 15 : 0;
    if (!mentionsHealth) {
      recommendations.push(
        'Include veterinary and health details such as vaccination status, spaying/neutering, and any medical needs.',
      );
    }

    // 4. Breed and Location completeness evaluation (max 15 pts)
    let locationAndBreedScore = 0;
    const hasBreed = Boolean(inputs.breed && inputs.breed.trim().length > 0);
    if (hasBreed) {
      locationAndBreedScore += 8;
    } else {
      recommendations.push(
        'Specify breed or breed mix to help adopters find matching pets.',
      );
    }

    const hasLocation = Boolean(
      (inputs.state && inputs.state.trim().length > 0) ||
      (inputs.city && inputs.city.trim().length > 0) ||
      (inputs.region && inputs.region.trim().length > 0),
    );
    if (hasLocation) {
      locationAndBreedScore += 7;
    } else {
      recommendations.push(
        'Provide location (city/state) so nearby adopters can discover this pet.',
      );
    }

    const totalScore =
      photoScore + descriptionScore + healthInfoScore + locationAndBreedScore;

    let grade: QualityGrade;
    if (totalScore >= 80) {
      grade = QualityGrade.EXCELLENT;
    } else if (totalScore >= 65) {
      grade = QualityGrade.GOOD;
    } else if (totalScore >= 45) {
      grade = QualityGrade.FAIR;
    } else {
      grade = QualityGrade.NEEDS_IMPROVEMENT;
    }

    const breakdown: QualityScoreBreakdownDto = {
      photoScore,
      descriptionScore,
      healthInfoScore,
      locationAndBreedScore,
    };

    return {
      score: totalScore,
      grade,
      breakdown,
      recommendations,
    };
  }
}
