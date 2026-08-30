import { EventLedgerRepository } from './event-ledger.repository';

describe('EventLedgerRepository', () => {
  const mockEventLog = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
  };

  const prisma = {
    eventLog: mockEventLog,
  };

  let repository: EventLedgerRepository;

  beforeEach(() => {
    jest.clearAllMocks();
    repository = new EventLedgerRepository(prisma as never);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('findLatestByAggregate', () => {
    it('returns the latest event sequence number', async () => {
      mockEventLog.findFirst.mockResolvedValue({ sequenceNumber: 5 });

      const result = await repository.findLatestByAggregate('pet-1');

      expect(result).toEqual({ sequenceNumber: 5 });
      expect(mockEventLog.findFirst).toHaveBeenCalledWith({
        where: { entityId: 'pet-1' },
        orderBy: { sequenceNumber: 'desc' },
        select: { sequenceNumber: true },
      });
    });

    it('returns null when no events exist', async () => {
      mockEventLog.findFirst.mockResolvedValue(null);

      const result = await repository.findLatestByAggregate('pet-1');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('creates an event with correct data', async () => {
      mockEventLog.create.mockResolvedValue({ id: 'evt-1', sequenceNumber: 1 });

      const result = await repository.create({
        entityType: 'PET',
        entityId: 'pet-1',
        eventType: 'PET_REGISTERED',
        payload: { name: 'Buddy' },
        sequenceNumber: 1,
      });

      expect(result.id).toBe('evt-1');
      expect(mockEventLog.create).toHaveBeenCalledWith({
        data: {
          entityType: 'PET',
          entityId: 'pet-1',
          eventType: 'PET_REGISTERED',
          payload: { name: 'Buddy' },
          sequenceNumber: 1,
        },
      });
    });
  });

  describe('findGaps', () => {
    it('returns empty array when no gaps exist', async () => {
      mockEventLog.findMany.mockResolvedValue([
        { sequenceNumber: 1 },
        { sequenceNumber: 2 },
        { sequenceNumber: 3 },
      ]);

      const gaps = await repository.findGaps('pet-1');

      expect(gaps).toEqual([]);
    });

    it('detects gaps in sequence numbers', async () => {
      mockEventLog.findMany.mockResolvedValue([
        { sequenceNumber: 1 },
        { sequenceNumber: 2 },
        { sequenceNumber: 4 },
        { sequenceNumber: 6 },
      ]);

      const gaps = await repository.findGaps('pet-1');

      expect(gaps).toEqual([3, 5]);
    });

    it('returns empty array when no events exist', async () => {
      mockEventLog.findMany.mockResolvedValue([]);

      const gaps = await repository.findGaps('pet-1');

      expect(gaps).toEqual([]);
    });

    it('filters out non-integer and zero sequence numbers', async () => {
      mockEventLog.findMany.mockResolvedValue([
        { sequenceNumber: 1 },
        { sequenceNumber: null },
        { sequenceNumber: 0 },
        { sequenceNumber: 'invalid' },
        { sequenceNumber: 3 },
      ]);

      const gaps = await repository.findGaps('pet-1');

      // Only 1 and 3 are valid, so no gaps between them (if 2 is missing)
      // But actually there IS a gap: 1, 3 → missing 2
      expect(gaps).toEqual([2]);
    });
  });

  describe('findAllByAggregate', () => {
    it('returns events ordered by sequence number', async () => {
      mockEventLog.findMany.mockResolvedValue([
        { id: '1', sequenceNumber: 1 },
        { id: '2', sequenceNumber: 2 },
      ]);

      const result = await repository.findAllByAggregate('pet-1');

      expect(result).toHaveLength(2);
      expect(mockEventLog.findMany).toHaveBeenCalledWith({
        where: { entityId: 'pet-1' },
        orderBy: { sequenceNumber: 'asc' },
        select: {
          id: true,
          entityType: true,
          entityId: true,
          eventType: true,
          actorId: true,
          payload: true,
          sequenceNumber: true,
          createdAt: true,
        },
      });
    });
  });
});
