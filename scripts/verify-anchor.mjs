#!/usr/bin/env node
/**
 * Standalone PetAd anchor verifier.
 *
 * Usage:
 *   node scripts/verify-anchor.mjs <txHash> <eventHash> <proof.json> [horizonUrl]
 *
 * proof.json is either the proof array or an object containing a `proof`
 * array of { position: 'left' | 'right', hash: <64-char hex> } steps.
 *
 * The script uses only public chain data and Node's built-in crypto. It
 * never contacts PetAd.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [txHash, eventHash, proofPath, horizonArg] = process.argv.slice(2);
const horizonUrl = (
  horizonArg ?? 'https://horizon-testnet.stellar.org'
).replace(/\/$/, '');

const HASH = /^[a-f0-9]{64}$/i;

function usage(message) {
  console.error(`Error: ${message}`);
  console.error(
    'Usage: node scripts/verify-anchor.mjs <txHash> <eventHash> <proof.json> [horizonUrl]',
  );
  process.exit(2);
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(2);
}

if (!txHash || !eventHash || !proofPath) {
  usage('missing arguments');
}
if (!HASH.test(txHash)) fail('txHash must be a 32-byte hex string');
if (!HASH.test(eventHash)) fail('eventHash must be a 32-byte hex string');

let parsed;
try {
  parsed = JSON.parse(readFileSync(proofPath, 'utf8'));
} catch (error) {
  fail(`cannot read proof JSON: ${error.message}`);
}

const proof = Array.isArray(parsed) ? parsed : parsed.proof;
if (!Array.isArray(proof))
  fail('proof JSON must be an array or contain `proof`');
if (proof.length > 64) fail('proof is too long');

function hashPair(leftHex, rightHex) {
  return createHash('sha256')
    .update(
      Buffer.concat([
        Buffer.from(leftHex, 'hex'),
        Buffer.from(rightHex, 'hex'),
      ]),
    )
    .digest('hex');
}

let node = eventHash.toLowerCase();
for (const [index, step] of proof.entries()) {
  if (
    !step ||
    (step.position !== 'left' && step.position !== 'right') ||
    !HASH.test(step.hash)
  ) {
    fail(`proof step ${index} is malformed`);
  }
  const sibling = step.hash.toLowerCase();
  node =
    step.position === 'left'
      ? hashPair(sibling, node)
      : hashPair(node, sibling);
}
const computedRoot = node;

const response = await fetch(`${horizonUrl}/transactions/${txHash}`, {
  headers: { Accept: 'application/json' },
});
if (!response.ok) {
  fail(`Horizon returned HTTP ${response.status} for ${txHash}`);
}

const transaction = await response.json();
if (transaction.successful === false) fail('transaction failed on chain');
if (transaction.memo_type !== 'hash' || !transaction.memo) {
  fail('transaction memo is not a hash');
}

const onChainRoot = Buffer.from(transaction.memo, 'base64').toString('hex');
const valid =
  HASH.test(onChainRoot) && computedRoot === onChainRoot.toLowerCase();

console.log(
  JSON.stringify(
    {
      valid,
      eventHash: eventHash.toLowerCase(),
      computedRoot,
      onChainRoot,
      anchoredAt: transaction.created_at ?? null,
      blockHeight: transaction.ledger ?? null,
      txHash,
      explorerUrl: `${horizonUrl}/transactions/${txHash}`,
    },
    null,
    2,
  ),
);

process.exit(valid ? 0 : 1);
