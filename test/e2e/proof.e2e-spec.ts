import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { ProofService } from '../../src/anchoring/proof.service';

describe('ProofController (e2e)', () => {
  let app: INestApplication;
  let proofService: ProofService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    proofService = app.get<ProofService>(ProofService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('property test: proof verifies for every leaf in batches of size 1 to 1000', () => {
    const batchSizes = [1, 10, 50, 250, 1000];
    for (const size of batchSizes) {
      const leaves: string[] = [];
      for (let i = 0; i < size; i++) {
        leaves.push(ProofService.prototype['hashData'](`leaf-${i}`));
      }

      const { root, proofMap } = ProofService.prototype['generateTreeAndProofs'](leaves);

      for (const leaf of leaves) {
        const path = proofMap.get(leaf)!;
        const isValid = proofService.verifyProof(leaf, root, path);
        expect(isValid).toBe(true);
      }
    }
  });
});
