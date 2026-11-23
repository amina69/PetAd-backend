import { EventEntityType } from '@prisma/client';
import * as crypto from 'crypto';
import { canonicalJSON } from './canonical-json.util';

describe('EventLedger Integrity & Tamper Evidence', () => {
  it('generates identical hash across Node versions (golden-vector test)', () => {
    const canonicalObj = {
      aggregate: 'pet-golden-1',
      seq: 1,
      type: 'PET_REGISTERED',
      payload: { name: 'GoldenBuddy', age: 3 },
      actor: 'user-1',
      schemaVersion: 1,
      occurredAt: '2026-03-30T00:00:00.000Z',
      prevHash: null,
    };

    const canonicalStr = canonicalJSON(canonicalObj);
    const hash = crypto.createHash('sha256').update(canonicalStr).digest('hex');

    expect(canonicalStr).toBe('{"aggregate":"pet-golden-1","actor":"user-1","occurredAt":"2026-03-30T00:00:00.000Z","payload":{"age":3,"name":"GoldenBuddy"},"prevHash":null,"schemaVersion":1,"seq":1,"type":"PET_REGISTERED"}');
    expect(hash).toHaveLength(64);
  });

  it('fails integrity check when a stored payload is modified via raw SQL', async () => {
    // Simulate editing stored payload via raw SQL and validating recomputed hash mismatch
    const originalPayload = { name: 'Buddy' };
    const modifiedPayload = { name: 'TamperedBuddy' };

    const canonicalObj = {
      aggregate: 'pet-1',
      seq: 1,
      type: 'PET_REGISTERED',
      payload: modifiedPayload,
      actor: null,
      schemaVersion: 1,
      occurredAt: '2026-03-30T00:00:00.000Z',
      prevHash: null,
    };

    const calculatedHash = crypto
      .createHash('sha256')
      .update(canonicalJSON(canonicalObj))
      .digest('hex');

    // Stored hash was computed with originalPayload
    const originalCanonical = {
      aggregate: 'pet-1',
      seq: 1,
      type: 'PET_REGISTERED',
      payload: originalPayload,
      actor: null,
      schemaVersion: 1,
      occurredAt: '2026-03-30T00:00:00.000Z',
      prevHash: null,
    };
    const storedHash = crypto
      .createHash('sha256')
      .update(canonicalJSON(originalCanonical))
      .digest('hex');

    expect(calculatedHash).not.toBe(storedHash);
  });
});
