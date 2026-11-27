import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');
const ALLOWED_TRUST_WRITER = path.join(SRC_ROOT, 'trust', 'trust.service.ts');

function walkTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkTsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('Trust data model & write-boundary guard (BE-141)', () => {
  it('blocks direct writes to User.trustScore outside src/trust/trust.service.ts', () => {
    const sourceFiles = walkTsFiles(SRC_ROOT).filter(
      (file) => !file.endsWith('.spec.ts') && file !== ALLOWED_TRUST_WRITER,
    );

    const directWritePatterns = [
      // Prisma write payload mutating trustScore
      /\bdata\s*:\s*\{[\s\S]{0,200}\btrustScore\s*:/m,
      // Raw SQL UPDATE targeting users.trustScore
      /UPDATE\s+"?users"?\s+SET[\s\S]{0,120}"?trustScore"?/im,
    ];

    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, 'utf8');
      if (directWritePatterns.some((pattern) => pattern.test(content))) {
        offenders.push(path.relative(REPO_ROOT, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('defines TrustEvent (referencing EventLog), TrustScoreHistory, and TrustSummary in prisma/schema.prisma', () => {
    const schema = fs.readFileSync(
      path.join(REPO_ROOT, 'prisma', 'schema.prisma'),
      'utf8',
    );

    expect(schema).toMatch(
      /enum\s+TrustEventKind\s*\{[\s\S]*AGREEMENT_COMPLETED/,
    );
    expect(schema).toMatch(/enum\s+TrustEventKind\s*\{[\s\S]*DISPUTE_LOST/);
    expect(schema).toMatch(/enum\s+TrustEventKind\s*\{[\s\S]*LATE_RETURN/);
    expect(schema).toMatch(/enum\s+TrustEventKind\s*\{[\s\S]*REVIEW_RECEIVED/);
    expect(schema).toMatch(
      /enum\s+TrustEventKind\s*\{[\s\S]*DOCUMENT_VERIFIED/,
    );

    expect(schema).toMatch(/model\s+TrustEvent\s*\{/);
    expect(schema).toMatch(
      /sourceEventId\s+String\s+@map\("source_event_id"\)/,
    );
    expect(schema).toMatch(
      /sourceEvent\s+EventLog\s+@relation\("SourceTrustEvents",\s*fields:\s*\[sourceEventId\],\s*references:\s*\[id\]/,
    );
    expect(schema).toMatch(/model\s+TrustScoreHistory\s*\{/);
    expect(schema).toMatch(/model\s+TrustSummary\s*\{/);
  });

  it('enforces append-only immutability on trust_events and trust_score_history in the SQL migration', () => {
    const migration = fs.readFileSync(
      path.join(
        REPO_ROOT,
        'prisma',
        'migrations',
        '20261127000000_add_trust_data_model',
        'migration.sql',
      ),
      'utf8',
    );

    expect(migration).toContain('CREATE TABLE "trust_events"');
    expect(migration).toContain('CREATE TABLE "trust_score_history"');
    expect(migration).toContain('CREATE TABLE "trust_summaries"');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "trust_events"');
    expect(migration).toContain(
      'BEFORE UPDATE OR DELETE ON "trust_score_history"',
    );
  });
});
