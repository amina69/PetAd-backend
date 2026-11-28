import { StorageProvider } from './storage-provider.interface';
import { describe, it, expect } from '@jest/globals';

export function runStorageProviderConformanceTests(name: string, providerFactory: () => StorageProvider) {
  describe(`StorageProvider Conformance Suite: ${name}`, () => {
    let provider: StorageProvider;

    beforeEach(() => {
      provider = providerFactory();
    });

    it('puts, checks existence, gets signed url, and deletes file successfully', async () => {
      const testKey = `conformance-test-${Date.now()}.txt`;
      const testBuffer = Buffer.from('conformance test payload');

      const putResult = await provider.put(testBuffer, testKey, { kind: 'IDENTITY_DOCUMENT' });
      expect(putResult).toHaveProperty('key');
      expect(putResult).toHaveProperty('url');
      expect(putResult).toHaveProperty('provider');

      const existsBefore = await provider.exists(putResult.key);
      expect(existsBefore).toBe(true);

      const signedUrl = await provider.getSignedUrl(putResult.key);
      expect(signedUrl).toBeDefined();

      const deleted = await provider.delete(putResult.key);
      expect(deleted).toBe(true);

      const existsAfter = await provider.exists(putResult.key);
      expect(existsAfter).toBe(false);
    });
  });
}
