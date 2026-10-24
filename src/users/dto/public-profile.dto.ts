import { ApiProperty } from '@nestjs/swagger';

export class RatingSummaryDto {
  @ApiProperty({ example: 5.0, description: 'Average rating score' })
  average: number;

  @ApiProperty({ example: 10, description: 'Total count of reviews' })
  count: number;
}

export class PublicProfileDto {
  @ApiProperty({
    example: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
    description: 'User ID',
  })
  id: string;

  @ApiProperty({
    example: 'John D.',
    description: 'Display name formatted as First Name + Last Initial',
  })
  displayName: string;

  @ApiProperty({
    example: 'https://example.com/avatar.jpg',
    nullable: true,
    description: 'Avatar URL',
  })
  avatarUrl: string | null;

  @ApiProperty({
    example: '2026-01-01T00:00:00.000Z',
    description: 'Registration date in ISO string format',
  })
  memberSince: string;

  @ApiProperty({
    example: ['VERIFIED_SHELTER'],
    type: [String],
    description: 'List of badges earned by user',
  })
  verifiedBadges: string[];

  @ApiProperty({
    example: 3,
    description: 'Count of completed adoptions and custody agreements',
  })
  completedAgreements: number;

  @ApiProperty({
    type: () => RatingSummaryDto,
    nullable: true,
    description: 'Summary of ratings/reviews',
  })
  ratingSummary: RatingSummaryDto | null;
}
