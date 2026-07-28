import { PetStatus } from '../../common/enums/pet-status.enum';
import { petAvailabilityReducer } from './pet-availability.reducer';

describe('petAvailabilityReducer', () => {
  it('should return AVAILABLE when no events are provided', () => {
    const result = petAvailabilityReducer([]);
    expect(result).toBe(PetStatus.AVAILABLE);
  });

  it('should return AVAILABLE after PET_LISTED', () => {
    const result = petAvailabilityReducer([{ eventType: 'PET_LISTED' }]);
    expect(result).toBe(PetStatus.AVAILABLE);
  });

  it('should return PENDING after PET_LISTED → ADOPTION_REQUESTED', () => {
    const events = [
      { eventType: 'PET_LISTED' },
      { eventType: 'ADOPTION_REQUESTED' },
    ];
    const result = petAvailabilityReducer(events);
    expect(result).toBe(PetStatus.PENDING);
  });

  it('should return PENDING after PET_LISTED → PET_ADOPTION_REQUESTED', () => {
    const events = [
      { eventType: 'PET_LISTED' },
      { eventType: 'PET_ADOPTION_REQUESTED' },
    ];
    const result = petAvailabilityReducer(events);
    expect(result).toBe(PetStatus.PENDING);
  });

  it('should return PENDING (reserved) after PET_LISTED → ADOPTION_REQUESTED → ADOPTION_APPROVED', () => {
    const events = [
      { eventType: 'PET_LISTED' },
      { eventType: 'ADOPTION_REQUESTED' },
      { eventType: 'ADOPTION_APPROVED' },
    ];
    const result = petAvailabilityReducer(events);
    expect(result).toBe(PetStatus.PENDING);
  });

  it('should return ADOPTED after PET_LISTED → ADOPTION_REQUESTED → ADOPTION_APPROVED → ADOPTION_COMPLETED', () => {
    const events = [
      { eventType: 'PET_LISTED' },
      { eventType: 'ADOPTION_REQUESTED' },
      { eventType: 'ADOPTION_APPROVED' },
      { eventType: 'ADOPTION_COMPLETED' },
    ];
    const result = petAvailabilityReducer(events);
    expect(result).toBe(PetStatus.ADOPTED);
  });

  it('should return ADOPTED after PET_LISTED → PET_ADOPTED', () => {
    const events = [
      { eventType: 'PET_LISTED' },
      { eventType: 'PET_ADOPTED' },
    ];
    const result = petAvailabilityReducer(events);
    expect(result).toBe(PetStatus.ADOPTED);
  });

  it('should return IN_CUSTODY after custody active event', () => {
    const events = [
      { eventType: 'PET_LISTED' },
      { eventType: 'CUSTODY_STARTED' },
    ];
    const result = petAvailabilityReducer(events);
    expect(result).toBe(PetStatus.IN_CUSTODY);
  });

  it('should return IN_CUSTODY after PET_CUSTODY_ACTIVE', () => {
    const events = [
      { eventType: 'PET_LISTED' },
      { eventType: 'PET_CUSTODY_ACTIVE' },
    ];
    const result = petAvailabilityReducer(events);
    expect(result).toBe(PetStatus.IN_CUSTODY);
  });

  it('should return AVAILABLE after PET_LISTED → CUSTODY_STARTED → CUSTODY_RETURNED', () => {
    const events = [
      { eventType: 'PET_LISTED' },
      { eventType: 'CUSTODY_STARTED' },
      { eventType: 'CUSTODY_RETURNED' },
    ];
    const result = petAvailabilityReducer(events);
    expect(result).toBe(PetStatus.AVAILABLE);
  });

  it('should return AVAILABLE after PET_LISTED → PET_CUSTODY_ACTIVE → PET_RETURNED', () => {
    const events = [
      { eventType: 'PET_LISTED' },
      { eventType: 'PET_CUSTODY_ACTIVE' },
      { eventType: 'PET_RETURNED' },
    ];
    const result = petAvailabilityReducer(events);
    expect(result).toBe(PetStatus.AVAILABLE);
  });

  it('should handle full lifecycle: listed → custody active → returned → adopted → final is ADOPTED', () => {
    // This is the exact scenario from the acceptance criteria
    const events = [
      { eventType: 'PET_LISTED' },
      { eventType: 'PET_CUSTODY_ACTIVE' },
      { eventType: 'PET_RETURNED' },
      { eventType: 'ADOPTION_REQUESTED' },
      { eventType: 'ADOPTION_APPROVED' },
      { eventType: 'PET_ADOPTED' },
    ];
    const result = petAvailabilityReducer(events);
    expect(result).toBe(PetStatus.ADOPTED);
  });

  it('should silently ignore unknown event types', () => {
    const events = [
      { eventType: 'PET_LISTED' },
      { eventType: 'UNKNOWN_EVENT' },
    ];
    const result = petAvailabilityReducer(events);
    expect(result).toBe(PetStatus.AVAILABLE);
  });

  it('should return the last availability-determining event', () => {
    const events = [
      { eventType: 'PET_LISTED' },
      { eventType: 'CUSTODY_STARTED' },
      { eventType: 'CUSTODY_RETURNED' },
      { eventType: 'CUSTODY_STARTED' }, // Active again
    ];
    const result = petAvailabilityReducer(events);
    expect(result).toBe(PetStatus.IN_CUSTODY);
  });
});
