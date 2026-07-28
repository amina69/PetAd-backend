import { CustodyStatus } from '@prisma/client';
import { custodyReducer } from './custody.reducer';

describe('custodyReducer', () => {
  it('should return PENDING when no events are provided', () => {
    const result = custodyReducer([]);
    expect(result).toBe(CustodyStatus.PENDING);
  });

  it('should return PENDING after CUSTODY_CREATED', () => {
    const result = custodyReducer([{ eventType: 'CUSTODY_CREATED' }]);
    expect(result).toBe(CustodyStatus.PENDING);
  });

  it('should return ACTIVE after CUSTODY_STARTED', () => {
    const events = [{ eventType: 'CUSTODY_CREATED' }, { eventType: 'CUSTODY_STARTED' }];
    const result = custodyReducer(events);
    expect(result).toBe(CustodyStatus.ACTIVE);
  });

  it('should return COMPLETED after custody created → started → completed (happy path)', () => {
    const events = [
      { eventType: 'CUSTODY_CREATED' },
      { eventType: 'CUSTODY_STARTED' },
      { eventType: 'CUSTODY_COMPLETED' },
    ];
    const result = custodyReducer(events);
    expect(result).toBe(CustodyStatus.COMPLETED);
  });

  it('should return CANCELLED after custody created → cancelled', () => {
    const events = [
      { eventType: 'CUSTODY_CREATED' },
      { eventType: 'CUSTODY_CANCELLED' },
    ];
    const result = custodyReducer(events);
    expect(result).toBe(CustodyStatus.CANCELLED);
  });

  it('should return ACTIVE after CUSTODY_EXTENDED does not change status', () => {
    const events = [
      { eventType: 'CUSTODY_CREATED' },
      { eventType: 'CUSTODY_STARTED' },
      { eventType: 'CUSTODY_EXTENDED', payload: { newEndDate: '2026-12-31' } },
    ];
    const result = custodyReducer(events);
    expect(result).toBe(CustodyStatus.ACTIVE);
  });

  it('should handle all 5 custody event types without throwing', () => {
    const events = [
      { eventType: 'CUSTODY_CREATED' },
      { eventType: 'CUSTODY_STARTED' },
      { eventType: 'CUSTODY_CANCELLED' },
      { eventType: 'CUSTODY_COMPLETED' },
      { eventType: 'CUSTODY_EXTENDED' },
    ];
    // This just verifies that all event types are recognized
    // The last status-changing event wins (COMPLETED)
    expect(() => custodyReducer(events)).not.toThrow();
    const result = custodyReducer(events);
    expect(result).toBe(CustodyStatus.COMPLETED); // COMPLETED is last status-changing event
  });

  it('should silently ignore unknown event types', () => {
    const events = [
      { eventType: 'CUSTODY_CREATED' },
      { eventType: 'UNKNOWN_EVENT' },
      { eventType: 'SOME_RANDOM_EVENT' },
    ];
    const result = custodyReducer(events);
    expect(result).toBe(CustodyStatus.PENDING);
  });

  it('should return ACTIVE when started from a direct CUSTODY_STARTED event without create', () => {
    const events = [{ eventType: 'CUSTODY_STARTED' }];
    const result = custodyReducer(events);
    expect(result).toBe(CustodyStatus.ACTIVE);
  });

  it('should return the last status-determining event', () => {
    // Even if we go completed → started (which is unlikely in practice),
    // the last event determines the status
    const events = [
      { eventType: 'CUSTODY_CREATED' },
      { eventType: 'CUSTODY_STARTED' },
      { eventType: 'CUSTODY_COMPLETED' },
      { eventType: 'CUSTODY_CREATED' }, // Created again (hypothetical)
    ];
    const result = custodyReducer(events);
    expect(result).toBe(CustodyStatus.PENDING);
  });
});
