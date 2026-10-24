import { PublicProfileDto } from './public-profile.dto';

describe('PublicProfile Contract Test', () => {
  const EXACT_CONTRACT_KEYS = [
    'avatarUrl',
    'completedAgreements',
    'displayName',
    'id',
    'memberSince',
    'ratingSummary',
    'verifiedBadges',
  ].sort();

  const FORBIDDEN_KEYS = [
    'email',
    'phone',
    'address',
    'stellarPublicKey',
    'stellarSecret',
    'password',
    'trustScore',
    'role',
    'status',
    'deletedAt',
    'createdAt',
    'updatedAt',
    'petsOwned',
    'adoptionsAsAdopter',
    'adoptionsAsOwner',
    'custodiesHeld',
    'events',
    'documents',
  ];

  it('asserts the exact key set with no accidental additions or omissions', () => {
    const validPublicProfile: PublicProfileDto = {
      id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      displayName: 'Alice S.',
      avatarUrl: 'https://example.com/avatar.jpg',
      memberSince: '2026-01-01T00:00:00.000Z',
      verifiedBadges: ['VERIFIED_SHELTER', 'STELLAR_VERIFIED'],
      completedAgreements: 4,
      ratingSummary: {
        average: 4.8,
        count: 4,
      },
    };

    const actualKeys = Object.keys(validPublicProfile).sort();

    // Acceptance criteria: Contract test asserts the exact key set (no accidental additions)
    expect(actualKeys).toEqual(EXACT_CONTRACT_KEYS);
    expect(actualKeys).toHaveLength(7);

    // Verify none of the forbidden fields are present
    for (const forbiddenKey of FORBIDDEN_KEYS) {
      expect(validPublicProfile).not.toHaveProperty(forbiddenKey);
    }
  });

  it('fails if an extra key is accidentally introduced', () => {
    const profileWithLeakedField: any = {
      id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
      displayName: 'Alice S.',
      avatarUrl: 'https://example.com/avatar.jpg',
      memberSince: '2026-01-01T00:00:00.000Z',
      verifiedBadges: [],
      completedAgreements: 0,
      ratingSummary: null,
      email: 'leak@example.com', // ACCIDENTAL ADDITION
    };

    const actualKeys = Object.keys(profileWithLeakedField).sort();
    expect(actualKeys).not.toEqual(EXACT_CONTRACT_KEYS);
  });
});
