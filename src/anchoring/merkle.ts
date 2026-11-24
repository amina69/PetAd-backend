import { createHash } from 'crypto';

export type MerkleProofPosition = 'left' | 'right';

/** One step of a Merkle inclusion proof. */
export interface MerkleProofStep {
  /** Where the sibling sits relative to the current node. */
  position: MerkleProofPosition;
  /** Hex-encoded 32-byte sibling hash. */
  hash: string;
}

export interface MerkleTree {
  /** Hex-encoded 32-byte root. */
  root: string;
  /** Bottom-up layers; layer 0 is the leaf layer. */
  layers: string[][];
  leafCount: number;
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Deterministic JSON serialisation used to hash ledger events. Object keys
 * are sorted recursively so two implementations produce the same bytes.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return 'null';
}

export interface LedgerEventForHash {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  actorId?: string | null;
  payload?: unknown;
  createdAt: Date | string;
}

/**
 * Hash of a ledger event as anchored on chain.
 *
 * Only ledger data is included; no external mutable record is consulted, so
 * a third party with the event row can reproduce this hash independently.
 */
export function hashLedgerEvent(event: LedgerEventForHash): string {
  return sha256Hex(
    canonicalJson({
      id: event.id,
      entityType: event.entityType,
      entityId: event.entityId,
      eventType: event.eventType,
      actorId: event.actorId ?? null,
      payload: event.payload ?? null,
      createdAt:
        event.createdAt instanceof Date
          ? event.createdAt.toISOString()
          : new Date(event.createdAt).toISOString(),
    }),
  );
}

function hashPair(left: string, right: string): string {
  return sha256Hex(
    Buffer.concat([Buffer.from(left, 'hex'), Buffer.from(right, 'hex')]),
  );
}

function normaliseLeaves(leaves: string[]): string[] {
  return leaves.map((leaf) => leaf.toLowerCase());
}

function buildLayers(leaves: string[]): string[][] {
  const normalised = normaliseLeaves(leaves);
  if (normalised.length === 0) {
    return [];
  }

  const layers: string[][] = [normalised];
  let current = normalised;

  while (current.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < current.length; index += 2) {
      const left = current[index];
      // Duplicate the final node when a layer has an odd size.
      const right = current[index + 1] ?? left;
      next.push(hashPair(left, right));
    }
    layers.push(next);
    current = next;
  }

  return layers;
}

export function buildMerkleTree(leaves: string[]): MerkleTree {
  const layers = buildLayers(leaves);
  if (layers.length === 0) {
    throw new Error('Cannot build a Merkle tree with no leaves');
  }

  return {
    root: layers[layers.length - 1][0],
    layers,
    leafCount: leaves.length,
  };
}

/**
 * Produces the inclusion proof for the leaf at `leafIndex`.
 */
export function createMerkleProof(
  leaves: string[],
  leafIndex: number,
): MerkleProofStep[] {
  if (
    !Number.isInteger(leafIndex) ||
    leafIndex < 0 ||
    leafIndex >= leaves.length
  ) {
    throw new Error('Leaf index is out of range');
  }

  const layers = buildLayers(leaves);
  const proof: MerkleProofStep[] = [];
  let index = leafIndex;

  for (let level = 0; level < layers.length - 1; level += 1) {
    const layer = layers[level];
    const siblingIndex = index ^ 1;
    const sibling = layer[siblingIndex] ?? layer[index];

    proof.push({
      position: siblingIndex < index ? 'left' : 'right',
      hash: sibling,
    });
    index = Math.floor(index / 2);
  }

  return proof;
}

const HEX_32_BYTES = /^[a-f0-9]{64}$/i;

/**
 * Recomputes the root from a leaf hash and its proof.
 *
 * Returns null when the input is malformed so callers can answer
 * `valid: false` without throwing on public input.
 */
export function computeRootFromProof(
  leafHash: string,
  proof: MerkleProofStep[],
): string | null {
  if (!HEX_32_BYTES.test(leafHash) || !Array.isArray(proof)) {
    return null;
  }

  let node = leafHash.toLowerCase();

  for (const step of proof) {
    if (
      !step ||
      (step.position !== 'left' && step.position !== 'right') ||
      !HEX_32_BYTES.test(step.hash)
    ) {
      return null;
    }

    const sibling = step.hash.toLowerCase();
    node =
      step.position === 'left'
        ? hashPair(sibling, node)
        : hashPair(node, sibling);
  }

  return node;
}

export function verifyMerkleProof(
  leafHash: string,
  proof: MerkleProofStep[],
  expectedRoot: string,
): boolean {
  if (!HEX_32_BYTES.test(expectedRoot)) {
    return false;
  }
  const computed = computeRootFromProof(leafHash, proof);
  return computed !== null && computed === expectedRoot.toLowerCase();
}
